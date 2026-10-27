# -*- coding: utf-8 -*-
"""
sync_company_resume.py —— 流二：按 JD 生成「该岗位的在线简历」。

输入：
  --md-path      本次生成的 JD 定制版简历 md（{公司}.md，已由简历引擎产出）
  --profile-path 原版在线简历 profile.json（plugin.profile-path 指向的权威文件）
  --output-path  输出的按公司在线简历 json 完整路径（pluginDataDir/versions/<company>.json）
  --company      公司名（仅用于日志/落盘文件名安全化）
  --jd-text      岗位 JD 文本（可选，用于让 LLM 更准确地派生自评/项目亮点）

行为：
  1. 读取原版 profile.json（完整 profileV2.sections）。
  2. 解析生成版 md 的「实习经历」段，得到 公司/职位/时间 + 其下多个项目（项目描述/技术栈/要点）。
  3. 对每个公司调一次 LLM，总结 实习「工作内容 / 工作成果」；
     对每个项目调一次 LLM，总结 项目「项目内容 / 本人职责 / 项目成果」；
     对整份简历调一次 LLM，派生 在线简历「自我描述 / 自我评价」。
     —— 全部必须是 LLM 提炼总结，严禁把 md 原文直接拼接塞入。
    4. 以原版 profile 为底座，**逐条保留** internship / project 的全部静态字段
       （公司/部门/行业/地点/薪资/证明人/参与人数/项目链接/项目地址/...），
       仅用 md 中「同名」公司/项目覆盖其动态文案（工作内容/工作成果/项目内容/本人职责/项目成果）；
       若 md 中无同名条目（如简历引擎误改公司名），则该条原样保留不丢失任何字段。
    5. 其余所有 section（basic/education/intention/work/awards/...）原样保留。
  6. 写出两份产物（同目录）：
     a) <company>.json            —— 完整 profileV2.sections（供在线简历预览/编辑）
     b) <company>.variable_modules.json —— 引擎格式 variable_modules，供插件填充管线直接消费：
        { internship:[{company,role,period,projects:[...]}],
          project:[{name,_role,_period,description,techStack,highlights}],
          self:{自我描述,自我评价} }
    （core_skills 不重写，保持原版，由插件沿用本地母本）

LLM 配置从环境变量 RESUME_LLM_API_KEY / RESUME_LLM_BASE_URL / RESUME_LLM_MODEL /
RESUME_LLM_TEMPERATURE 读取（与简历引擎、原版在线简历同步脚本共用 settings 表注入）。
LLM 未配置或调用失败时，自动回退为忠实抽取（复制原文拼接），保证流程不中断。

注意：本脚本由 Java 后端在「生成简历」之后异步触发，不应阻塞生成响应。
"""

import os
import sys
import re
import json
import argparse
import unicodedata


def clean_text(s):
    """清洗 LLM / 解析产物中的 markdown 与特殊符号，压成一段纯文本。"""
    if not s:
        return ""
    s = str(s)
    for ch in ["`", "*", "#", "【", "】", "「", "」", "『", "』"]:
        s = s.replace(ch, "")
    lines = []
    for line in s.split("\n"):
        line = line.strip()
        if line.startswith(("-", "*", "+")):
            line = line[1:].strip()
        elif line and line[0].isdigit():
            i = 0
            while i < len(line) and line[i].isdigit():
                i += 1
            if i < len(line) and line[i] in ".、":
                line = line[i + 1:].strip()
        lines.append(line)
    s = " ".join(lines)
    while "  " in s:
        s = s.replace("  ", " ")
    return s.strip()


# ----------------------------------------------------------------------------
# LLM 调用（OpenAI 兼容，与 resume-engine 一致）
# ----------------------------------------------------------------------------
def _call_llm(system_prompt, user_prompt, llm_cfg, max_tokens=4000):
    import requests

    if not (llm_cfg and llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model")):
        raise RuntimeError("LLM 未配置，走降级抽取")

    url = llm_cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + llm_cfg["api_key"],
        "Content-Type": "application/json",
    }
    payload = {
        "model": llm_cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": llm_cfg.get("temperature", 0.3),
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    response = requests.post(url, headers=headers, json=payload, timeout=(10, 50))
    if response.status_code != 200:
        raise RuntimeError("LLM API 错误: %s" % response.status_code)
    data = response.json()
    content = data["choices"][0]["message"].get("content", "")
    content = re.sub(r"^```(?:json|markdown|md)?\s*\n", "", content)
    content = re.sub(r"\n```\s*$", "", content)
    return content.strip()


def _extract_json(raw):
    """容错解析 LLM 返回的 JSON：先整体解析，失败再截取首个 {...} 块。

    兼容 LLM 在 JSON 之外多嘴（前导/后置文字）的情况，避免直接坠入降级分支。
    """
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = re.search(r"\{.*\}", raw, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def load_llm_cfg():
    return {
        "api_key": os.environ.get("RESUME_LLM_API_KEY", ""),
        "base_url": os.environ.get("RESUME_LLM_BASE_URL", ""),
        "model": os.environ.get("RESUME_LLM_MODEL", ""),
        "temperature": os.environ.get("RESUME_LLM_TEMPERATURE", "0.3"),
    }


# ----------------------------------------------------------------------------
# 解析生成版 md 的「实习经历」段
# ----------------------------------------------------------------------------
def parse_generated_internships(md):
    """返回 [{company, role, period, projects:[{name, description, techStack, highlights[]}]}]。"""
    lines = md.split("\n")
    start = None
    for i, l in enumerate(lines):
        if l.strip().startswith("## 实习经历"):
            start = i + 1
            break
    if start is None:
        return []
    seg = []
    for l in lines[start:]:
        if l.startswith("## ") and not l.startswith("### "):
            break
        seg.append(l)

    companies = []
    cur = None
    cur_proj = None
    for l in seg:
        s = l.strip()
        if s.startswith("### "):
            hdr = s[4:].strip()
            parts = [p.strip() for p in hdr.split("|")]
            company = parts[0] if parts else hdr
            role = parts[1] if len(parts) > 1 else ""
            period = ""
            for p in parts[2:]:
                if re.search(r"\d{4}", p):
                    period = p
                    break
            if not period and len(parts) > 2:
                period = parts[2]
            cur = {"company": company, "role": role, "period": period, "projects": []}
            companies.append(cur)
            cur_proj = None
        elif re.match(r"^(时间|期间|period)\s*[:：]", s):
            if cur is not None and not cur.get("period"):
                cur["period"] = re.split(r"[:：]", s, 1)[-1].strip()
        elif s.startswith("**") and s.endswith("**"):
            # 项目标题行（整行加粗）：**name** 或 **项目N：name**
            # 字段行（**项目描述**：等）不以 ** 结尾，已被排除。
            name = s[2:-2].strip()
            name = re.sub(r"^项目[一二三四五六七八九十]：", "", name)
            cur_proj = {"name": name, "description": "", "techStack": "", "highlights": []}
            if cur is not None:
                cur["projects"].append(cur_proj)
        elif s.startswith("**项目描述"):
            if cur_proj is not None:
                cur_proj["description"] = re.sub(r"^\*\*项目描述\*?\*?[:：]?\s*", "", s).strip()
        elif s.startswith("**技术栈"):
            if cur_proj is not None:
                cur_proj["techStack"] = re.sub(r"^\*\*技术栈\*?\*?[:：]?\s*", "", s).strip()
        elif s.startswith("- "):
            if cur_proj is not None:
                cur_proj["highlights"].append(s[2:].strip())
    return companies


# ----------------------------------------------------------------------------
# 名称归一化与匹配
# ----------------------------------------------------------------------------
# 常见「康熙部首」字符与对应正写汉字的映射（如 ⼩→小、⼈→人），
# 原版母本与简历引擎生成文本可能用不同字形，导致按名匹配失配。
_KANGXI_MAP = {
    "⼈": "人", "⼩": "小", "⼤": "大", "⼆": "二", "⼦": "子", "⼿": "手",
    "⼼": "心", "⽇": "日", "⽉": "月", "⽊": "木", "⽔": "水", "⽕": "火",
    "⽥": "田", "⽴": "立", "⽵": "竹", "⼥": "女", "⼭": "山", "⽯": "石",
    "⽅": "方", "⽂": "文", "⽿": "耳", "⾐": "衣", "⾛": "走", "⾨": "门",
    "⾦": "金", "⾬": "雨", "⾴": "页", "⾻": "骨", "⾼": "高", "⿊": "黑",
}


def normalize_name(s):
    s = str(s or "")
    for k, v in _KANGXI_MAP.items():
        s = s.replace(k, v)
    s = unicodedata.normalize("NFKC", s)   # 全角→半角、兼容字形归一
    s = re.sub(r"\s+", "", s).lower()
    return s


def name_match(a, b):
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


# ----------------------------------------------------------------------------
# LLM 总结（带降级）
# ----------------------------------------------------------------------------
INTERN_SYSTEM = (
    "你是资深简历顾问。根据候选人某段实习（含其下多个项目）的已有素材，"
    "为在线简历表单提炼『工作内容』与『工作成果』两段纯文本。"
    "要求：用连贯叙述概括，不要逐条罗列原文；突出技术深度与量化产出；"
    "不编造不存在的内容；不出现 markdown 符号；输出纯文本一段话，"
    "不使用 **、*、#、【】、反引号等任何标记，用中文标点自然断句。"
)


def llm_internship(intern, llm_cfg):
    proj_txt = []
    for p in intern.get("projects", []):
        proj_txt.append(
            "项目名：%s\n项目描述：%s\n技术栈：%s\n亮点：%s"
            % (p.get("name", ""), p.get("description", ""), p.get("techStack", ""),
               "；".join(p.get("highlights", [])))
        )
    user = (
        "公司：%s\n职位：%s\n时间：%s\n\n项目素材：\n%s\n\n"
        "请输出 JSON：{\"工作内容\":\"...\",\"工作成果\":\"...\"}"
        % (intern.get("company", ""), intern.get("role", ""), intern.get("period", ""),
           "\n\n".join(proj_txt))
    )
    try:
        out = _call_llm(INTERN_SYSTEM, user, llm_cfg, max_tokens=1500)
        obj = _extract_json(out)
        if not obj:
            raise ValueError("LLM 未返回可解析 JSON，走降级")
        return {
            "工作内容": clean_text(obj.get("工作内容", "")),
            "工作成果": clean_text(obj.get("工作成果", "")),
        }
    except Exception:
        # 降级：忠实拼接（仍清洗 markdown/特殊符号，保持纯文本一段话）
        desc_parts = []
        hl_parts = []
        for p in intern.get("projects", []):
            if p.get("description"):
                desc_parts.append(clean_text(p.get("description", "")))
            hl_parts.extend(clean_text(h) for h in p.get("highlights", []) if h.strip())
        return {
            "工作内容": " ".join(x for x in desc_parts if x),
            "工作成果": "；".join(x for x in hl_parts if x),
        }


PROJECT_SYSTEM = (
    "你是资深简历顾问。根据单个项目的素材（项目名/项目描述/技术栈/亮点），"
    "为在线简历表单提炼三段【互不相同】的纯文本：\n"
    "1) 项目内容：用第三人称概述项目是什么、解决什么问题、核心系统与技术架构（中性介绍，2-3句）。\n"
    "2) 本人职责：必须用第一人称『我』叙述你亲手负责/具体做的动作（如『我负责设计了…』『我实现了…』），聚焦个人贡献，2-4条要点式；禁止复述项目概述，禁止与项目内容雷同。\n"
    "3) 项目成果：突出量化结果与业务价值（性能指标/准确率/规模/效率提升等），第三人称，2-3句。\n"
    "硬性要求：三段必须各不相同；本人职责必须含第一人称『我』且是动作描述；不得把项目内容或项目成果抄入本人职责；"
    "输出纯文本，不出现 **、*、#、【】、反引号等任何标记，用中文标点自然断句。"
)


def _split_highlights(hl):
    """把亮点拆成『职责动作』与『成果量化』两组，用于降级时拼出三份不同内容。"""
    if not hl:
        return [], []
    mid = max(1, len(hl) // 2)
    return hl[:mid], hl[mid:]


def _degrade_project(desc, hl, hl_text):
    """LLM 不可用时的降级：用 description + 拆分 highlights 拼出三份【互不相同】的内容。"""
    resp_hl, out_hl = _split_highlights(hl)
    responsibility = "我负责" + "；我负责".join(resp_hl) if resp_hl else desc
    if out_hl:
        outcome = "；".join(out_hl)
    elif hl:
        outcome = hl[0] + "，相关能力在项目中得到落地验证"
    else:
        outcome = desc
    return {"项目内容": desc, "本人职责": responsibility, "项目成果": outcome}


def _distinct_project(d, desc, hl_text):
    """最终兜底：保证 项目内容/本人职责/项目成果 两两不同（用 desc 与 hl_text 把重复项错开）。"""
    a, b, c = d["项目内容"], d["本人职责"], d["项目成果"]
    if b and c and b == c:                       # 本人职责 ≠ 项目成果
        c = hl_text if (hl_text and hl_text != b) else (desc if (desc and desc != b) else c)
    if a and b and a == b:                       # 本人职责 ≠ 项目内容（本人职责强制第一人称）
        b = hl_text if (hl_text and hl_text != a) else ("我负责" + a if a else b)
    if a and c and a == c:                       # 项目内容 ≠ 项目成果
        c = hl_text if (hl_text and hl_text != a) else (desc if (desc and desc != a) else c)
    return {"项目内容": a, "本人职责": b, "项目成果": c}


def llm_project(proj, llm_cfg):
    desc = clean_text(proj.get("description", ""))
    hl = [clean_text(h) for h in proj.get("highlights", [])]
    hl_text = "；".join(hl)
    user = (
        "项目名：%s\n项目描述：%s\n技术栈：%s\n亮点：%s\n\n"
        "请输出 JSON：{\"项目内容\":\"...\",\"本人职责\":\"...\",\"项目成果\":\"...\"}"
        % (proj.get("name", ""), desc, proj.get("techStack", ""), hl_text)
    )

    def _try(sys_prompt, u):
        try:
            out = _call_llm(sys_prompt, u, llm_cfg, max_tokens=1500)
            obj = _extract_json(out)
            if not obj:
                raise ValueError("LLM 未返回可解析 JSON")
            return {
                "项目内容": clean_text(obj.get("项目内容", "")) or desc,
                "本人职责": clean_text(obj.get("本人职责", "")),
                "项目成果": clean_text(obj.get("项目成果", "")),
            }
        except Exception:
            return None

    d = _try(PROJECT_SYSTEM, user)
    # 偶尔模型照抄导致重复 → 补一刀重试
    if d is None or len({d["项目内容"], d["本人职责"], d["项目成果"]}) < 3:
        retry_user = (user +
            "\n\n【重要】你刚才返回的三段有重复。务必让『项目内容』(第三人称概述)、"
            "『本人职责』(第一人称『我』的具体动作)、『项目成果』(量化结果) 三段互不相同。")
        d2 = _try(PROJECT_SYSTEM, retry_user)
        if d2 is not None:
            d = d2
    # LLM 完全不可用 → 降级（已保证三份不同）
    if d is None:
        d = _degrade_project(desc, hl, hl_text)
    # 最终兜底去重（保证项目内容/本人职责/项目成果 两两不同）
    return _distinct_project(d, desc, hl_text)


SELF_SYSTEM = (
    "你是资深简历顾问。根据一份 JD 优化后的候选人简历（及岗位 JD），"
    "为在线简历表单撰写『自我描述』与『自我评价』两段纯文本。"
    "要求：自我描述聚焦技术能力画像；自我评价聚焦软素质与岗位匹配度；"
    "贴合 JD、不空泛；不编造；不出现 markdown 符号；输出纯文本一段话，"
    "不使用 **、*、#、【】、反引号等任何标记，用中文标点自然断句。"
)


def llm_self(md_text, jd_text, llm_cfg):
    user = "岗位 JD（节选）：\n%s\n\n候选人简历（节选）：\n%s\n\n请输出 JSON：{\"自我描述\":\"...\",\"自我评价\":\"...\"}" \
           % ((jd_text or "")[:1200], (md_text or "")[:3000])
    try:
        out = _call_llm(SELF_SYSTEM, user, llm_cfg, max_tokens=1200)
        obj = _extract_json(out)
        if not obj:
            raise ValueError("LLM 未返回可解析 JSON，走降级")
        return {
            "自我描述": clean_text(obj.get("自我描述", "")),
            "自我评价": clean_text(obj.get("自我评价", "")),
        }
    except Exception:
        return {"自我描述": "", "自我评价": ""}


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def split_period(period):
    if not period:
        return "", ""
    s = period.strip()
    if re.search(r"至今|present|current", s, re.I):
        end_ph = "至今"
        s = re.split(r"至今|present|current", s, flags=re.I)[0].strip()
    else:
        end_ph = ""
    m = re.search(r"(\d{4}[./\-年]\d{1,2}(?:月)?)\s*(?:～|~|—|至|-)\s*(\d{4}[./\-年]\d{1,2}(?:月)?)", s)
    if m:
        # 统一输出 YYYY-MM（横线），与原版母本 month 字段格式一致，
        # 否则 <input type="month"> 会把点号 2026.03 判为非法值显示空白。
        a = m.group(1).replace("年", "-").replace("月", "").replace(".", "-")
        b = m.group(2).replace("年", "-").replace("月", "").replace(".", "-")
        return a, b
    if re.search(r"\d{4}[./\-年]\d{1,2}", s):
        return s.replace(".", "-"), end_ph
    return s.replace(".", "-"), end_ph


def build_output(profile, companies, self_text, jd_text, llm_cfg):
    sections = (profile.get("profileV2", {}).get("sections", {})) if isinstance(profile, dict) else {}

    # 原版实习 / 项目 items（作为「底座」，保留全部静态字段）
    orig_interns = sections.get("internship", {}).get("items", []) if isinstance(sections.get("internship"), dict) else []
    orig_projects = sections.get("project", {}).get("items", []) if isinstance(sections.get("project"), dict) else []

    intern_items = []     # 完整 profile 的 internship.items（以原版为底座）
    vm_internship = []    # 引擎格式 internship
    proj_items = []       # 完整 profile 的 project.items（以原版为底座）
    vm_projects = []      # 引擎格式 project

    # 扁平化 md 项目（保留父公司上下文），用于按项目名匹配原始条目
    md_proj_list = []
    for c in companies:
        for p in c.get("projects", []):
            md_proj_list.append((c, p))

    # LLM 结果缓存：同一项目/实习在「完整 profile」与「引擎格式」两处复用，保证一致且省调用
    _cache = {}

    def _intern_summary(c):
        key = ("intern", c.get("company", ""))
        if key not in _cache:
            _cache[key] = llm_internship(c, llm_cfg)
        return _cache[key]

    def _proj_summary(p):
        key = ("proj", p.get("name", ""))
        if key not in _cache:
            _cache[key] = llm_project(p, llm_cfg)
        return _cache[key]

    # —— 完整 profile：以「原版」为底座，深拷贝全部静态字段，只覆盖动态文案 ——
    for it in orig_interns:
        base = dict(it.get("values", {}))            # 深拷贝原版所有静态字段
        cname = base.get("公司", "")
        m_company = next((c for c in companies if name_match(cname, c["company"])), None)
        if m_company is not None:
            summary = _intern_summary(m_company)
            s, e = split_period(m_company.get("period", ""))
            if summary.get("工作内容"): base["工作内容"] = summary["工作内容"]
            if summary.get("工作成果"): base["工作成果"] = summary["工作成果"]
            if m_company.get("role"): base["职位"] = m_company["role"]
            if s: base["开始时间"] = s
            if e: base["结束时间"] = e
        intern_items.append({"title": cname, "values": base})

    for it in orig_projects:
        base = dict(it.get("values", {}))            # 深拷贝原版所有静态字段
        pname = base.get("项目名称", "")
        hit = next(((c, p) for (c, p) in md_proj_list if name_match(pname, p["name"])), None)
        if hit is not None:
            c, p = hit
            ps = _proj_summary(p)
            if ps.get("项目内容"): base["项目内容"] = ps["项目内容"]
            if ps.get("本人职责"): base["本人职责"] = ps["本人职责"]
            if ps.get("项目成果"): base["项目成果"] = ps["项目成果"]
            s, e = split_period(c.get("period", ""))
            if c.get("role"): base["职位"] = c["role"]
            if s: base["开始时间"] = s
            if e: base["结束时间"] = e
            # 项目链接 / 项目地址：保留原版值，不强制覆盖为「无」，保证字段完整
        proj_items.append({"title": pname, "values": base})

    # —— 引擎格式 variable_modules（供插件填充管线直接消费）——
    # 以 md 为来源（JD 定制的选择/顺序），仅提炼动态文案，复用上方缓存。
    def _vm_projects_for_company(c):
        out = []
        for p in c.get("projects", []):
            ps = _proj_summary(p)
            out.append({
                "name": p.get("name", ""),
                "description": ps["项目内容"],
                "techStack": clean_text(p.get("techStack", "")),
                "responsibility": ps["本人职责"],
                "highlights": [clean_text(h) for h in ps["项目成果"].split("\n") if h.strip()],
            })
        return out

    for c in companies:
        projs = _vm_projects_for_company(c)
        vm_internship.append({
            "company": c["company"],
            "role": c.get("role", ""),
            "period": c.get("period", ""),
            "projects": projs,
        })
        for pj in projs:
            vm_projects.append({
                "name": pj["name"],
                "_role": c.get("role", ""),
                "_period": c.get("period", ""),
                "description": pj["description"],
                "techStack": pj["techStack"],
                "responsibility": pj["responsibility"],
                "highlights": pj["highlights"],
            })

    # —— self（自评）——
    self_summary = llm_self(self_text, jd_text, llm_cfg)
    orig_self = sections.get("self", {}).get("values", {}) if isinstance(sections.get("self"), dict) else {}
    self_vals = dict(orig_self)
    if self_summary.get("自我描述"):
        self_vals["自我描述"] = self_summary["自我描述"]
    if self_summary.get("自我评价"):
        self_vals["自我评价"] = self_summary["自我评价"]

    # —— 组装完整 profile（其余 section 全量保留；internship/project 以原版为底座覆盖动态字段）——
    new_sections = json.loads(json.dumps(sections))  # 深拷贝
    new_sections["internship"] = dict(sections.get("internship") or {"kind": "repeat", "items": []})
    new_sections["internship"]["items"] = intern_items
    new_sections["project"] = dict(sections.get("project") or {"kind": "repeat", "items": []})
    new_sections["project"]["items"] = proj_items
    new_sections["self"] = dict(sections.get("self") or {"kind": "simple", "values": {}})
    new_sections["self"]["values"] = self_vals
    output = {"profileV2": {"sections": new_sections}}

    # —— 引擎格式 variable_modules（供插件填充管线直接消费）——
    # core_skills 不重写，保持原版（插件沿用本地母本）。
    variable_modules = {
        "internship": vm_internship,
        "project": vm_projects,
        "self": self_vals,
    }
    return output, variable_modules


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md-path", required=True)
    ap.add_argument("--profile-path", required=True)
    ap.add_argument("--output-path", required=True)
    ap.add_argument("--company", default="")
    ap.add_argument("--jd-text", default="")
    args = ap.parse_args()

    llm_cfg = load_llm_cfg()

    with open(args.profile_path, "r", encoding="utf-8") as f:
        profile = json.load(f)

    with open(args.md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    companies = parse_generated_internships(md_text)
    output, variable_modules = build_output(profile, companies, md_text, args.jd_text, llm_cfg)

    # 产物 a)：完整 profile
    os.makedirs(os.path.dirname(args.output_path), exist_ok=True)
    with open(args.output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 产物 b)：引擎格式 variable_modules（同目录，<company>.variable_modules.json）
    vm_path = re.sub(r"\.json$", ".variable_modules.json", args.output_path)
    with open(vm_path, "w", encoding="utf-8") as f:
        json.dump(variable_modules, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "success": True,
        "company": args.company,
        "internship": len(output["profileV2"]["sections"]["internship"]["items"]),
        "project": len(output["profileV2"]["sections"]["project"]["items"]),
        "self_filled": bool(self_summary_filled(output)),
        "vm_path": vm_path,
    }, ensure_ascii=False))


def self_summary_filled(output):
    vals = output["profileV2"]["sections"].get("self", {}).get("values", {})
    return bool(vals.get("自我描述") or vals.get("自我评价"))


if __name__ == "__main__":
    main()
