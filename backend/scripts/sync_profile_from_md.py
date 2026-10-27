# -*- coding: utf-8 -*-
"""
把本地原版简历 md（个人简历/原版简历.md）的动态部分，用**大模型总结**后同步到
插件在线简历的「原版简历」profile（plugin/resume-fill-plugin/data/profile.json）。

与旧版的关键区别：
  - 旧版是「识别后复制粘贴」：把 md 的项目描述/技术栈/bullet 直接拼接塞进 profile。
  - 本版是「调用大模型总结」：把每个实习段 / 每个项目的原始 Markdown 交给 LLM，
    由模型**提炼**成在线简历所需的 工作内容 / 工作成果 / 项目内容 / 本人职责 / 项目成果，
    而不是直接搬运原文。符合用户对「要总结、不是单纯复制」的要求。

映射关系：
  md ## 实习经历（公司 + 嵌套项目）  -> profile internship
       每个公司段原文 -> LLM 总结 -> 工作内容 / 工作成果
  md ## 实习经历 各项目            -> profile project
       每个项目原文 -> LLM 总结 -> 项目内容 / 本人职责 / 项目成果
  md ## 核心能力（bullet 列表）    -> profile self.自我描述

硬性规则（来自用户要求）：
  - 项目经历的「项目链接」与「项目地址」一律填 **"无"**（覆盖原值，不保留旧地址）。
  - md 无法提供的静态字段（部门/行业/地点/薪资/参与人数）按 时间段（实习）或
    项目名称（项目）匹配原 profile 后**保留**，只覆盖可推导的动态内容。
  - LLM 未配置或调用失败时，**降级**为忠实抽取（复制原文），保证热更新不中断。

LLM 配置：从环境变量 RESUME_LLM_API_KEY / RESUME_LLM_BASE_URL / RESUME_LLM_MODEL /
RESUME_LLM_TEMPERATURE 读取（由后端调度器从 settings 表注入）。
"""
import re
import os
import json
import sys
import unicodedata

MD_PATH = r"C:\Users/<你的Windows用户名>\Desktop\秋招文件\个人简历\原版简历.md"
PROFILE_PATH = r"C:\Users/<你的Windows用户名>\Desktop\秋招文件\秋招助手\秋招通\plugin\resume-fill-plugin\data\profile.json"

# Sunwz|2026-09-28|落盘日志：调度器（OriginalResumeAutoSync）会吞掉 stderr，
# 出问题时没有诊断证据。所有 warn/info 同步写入本文件，事后可查。
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync_last_run.log")


def _runlog(msg):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(msg.rstrip("\n") + "\n")
    except Exception:
        pass
    try:
        sys.stderr.write(msg if msg.endswith("\n") else msg + "\n")
    except Exception:
        pass


# Sunwz|2026-09-28|堆砌判定：LLM 调用失败时脚本会静默降级为「忠实抽取」（复制原文），
# 产出的内容带【题目】/「技术栈：」等堆砌特征。用这些特征守住写入质量：
# 新值堆砌而旧值完好时，保留旧值（质量只升不降）。
def is_pile(s):
    s = str(s or "").strip()
    if len(s) < 20:
        return True
    if "【" in s or "技术栈：" in s or "技术栈:" in s:
        return True
    # Sunwz|2026-10-01|纯技术栈串特征：分隔符密集**且每段都是短技术名**（无长句）。
    # "Python Flask；LangGraph；…" 曾因开头技术名不在黑名单而漏判（示例平台A 本人职责事故）。
    # 注意不能只数分号个数——正常成果/职责的分号段是长句（如示例公司D工作成果），会误伤。
    for sep in ("；", ";", " / "):
        parts = [x.strip() for x in s.split(sep) if x.strip()]
        if len(parts) >= 5 and all(len(x) <= 16 for x in parts):
            return True
    if s.startswith(("Vue 3", "Spring Boot 3", "FastAPI；", "FastAPI;", "Python Flask",
                     "LangGraph", "React", "Next.js", "TypeScript")):
        return True
    return False


# ----------------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------------
def norm(s):
    """归一化：NFKC + 去空白，便于名称/时间段匹配。"""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"\s+", "", s).lower()


def normalize_period(s):
    """'2026.03 ~ 2026.08' -> ('2026-03', '2026-08')"""
    parts = re.split(r"\s*~\s*", str(s).strip())
    out = []
    for p in parts[:2]:
        p = p.strip().replace("—", "-").replace("~", "-")
        m = re.match(r"(\d{4})[.\-/](\d{1,2})", p)
        if m:
            out.append("%s-%s" % (m.group(1), m.group(2).zfill(2)))
        else:
            out.append(p)
    while len(out) < 2:
        out.append("")
    return out[0], out[1]


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# ----------------------------------------------------------------------------
# 解析 md（同时保留每段/每个项目的原始文本，供 LLM 总结使用）
# ----------------------------------------------------------------------------
def parse_internship(md):
    """返回 [ {company, role, start, end, raw, projects:[{name,desc,tech,bullets,raw}]} ]"""
    m = re.search(r"##\s*实习经历\s*\n(.*?)(?=\n##\s*核心能力|\n##\s*荣誉证书|\Z)", md, re.S)
    if not m:
        return []
    block = m.group(1)
    parts = re.split(r"\n###\s+", "\n" + block)
    companies = []
    title_re = re.compile(r"^\*\*(.+?)\*\*\s*$", re.M)
    for part in parts[1:]:
        lines = part.split("\n")
        header = lines[0].strip()
        segs = [s.strip() for s in header.split("|")]
        company = segs[0] if len(segs) > 0 else ""
        role = segs[1] if len(segs) > 1 else ""
        start, end = normalize_period(segs[2]) if len(segs) > 2 else ("", "")
        tmatches = list(title_re.finditer(part))
        projects = []
        for i, tm in enumerate(tmatches):
            name = re.sub(r"^项目[一二三四五六七八九十]+[:：]\s*", "", tm.group(1).strip())
            s = tm.end()
            e = tmatches[i + 1].start() if i + 1 < len(tmatches) else len(part)
            seg = part[s:e]
            dm = re.search(r"\*\*项目描述\*\*[：:]\s*(.*?)(?=\n\*\*技术栈|\n- |\Z)", seg, re.S)
            desc = dm.group(1).strip() if dm else ""
            tm2 = re.search(r"\*\*技术栈\*\*[：:]\s*(.*?)(?=\n- |\Z)", seg, re.S)
            tech = tm2.group(1).strip() if tm2 else ""
            bullets = []
            for bl in seg.split("\n"):
                bl = bl.strip()
                bm = re.match(r"-\s*\*\*(.+?)\*\*[：:]\s*(.*)", bl)
                if bm:
                    bullets.append("%s：%s" % (bm.group(1).strip(), bm.group(2).strip()))
            projects.append({
                "name": name, "desc": desc, "tech": tech, "bullets": bullets,
                "raw": seg.strip(),
            })
        companies.append({
            "company": company, "role": role, "start": start, "end": end,
            "raw": part.strip(), "projects": projects,
        })
    return companies


def parse_core(md):
    """md ## 核心能力 的 bullet 列表 -> [str]"""
    m = re.search(r"##\s*核心能力\s*\n(.*?)(?=\n##\s*荣誉证书|\Z)", md, re.S)
    if not m:
        return []
    bullets = []
    for line in m.group(1).split("\n"):
        line = line.strip()
        if line.startswith("-") and "**" in line:
            t = line[1:].strip()
            t = re.sub(r"^\*\*(.+?)\*\*\s*[:：]?", r"\1：", t)
            if t:
                bullets.append(t)
    return bullets


# ----------------------------------------------------------------------------
# LLM 调用（兼容 OpenAI 接口，复刻 resume-engine 的 _call_llm）
# ----------------------------------------------------------------------------
def load_llm_config():
    """从环境变量读取 LLM 配置（后端调度器会从 settings 表注入）。"""
    return {
        "api_key": os.environ.get("RESUME_LLM_API_KEY"),
        "base_url": os.environ.get("RESUME_LLM_BASE_URL"),
        "model": os.environ.get("RESUME_LLM_MODEL"),
        "temperature": os.environ.get("RESUME_LLM_TEMPERATURE") or "0.3",
    }


def _call_llm(system_prompt, user_prompt, llm_cfg, max_tokens=800):
    import requests
    if not (llm_cfg and llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model")):
        raise RuntimeError("LLM 未配置（缺少 api_key/base_url/model）")
    url = llm_cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + llm_cfg["api_key"],
        "Content-Type": "application/json",
    }
    try:
        temperature = float(llm_cfg.get("temperature", 0.3))
    except (ValueError, TypeError):
        temperature = 0.3
    payload = {
        "model": llm_cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    # Sunwz|2026-09-26|失败重试 1 次（网络/超时抖动会导致条目静默降级为复制粘贴）
    last_err = None
    for attempt in (1, 2, 3):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=(10, 90))
            if r.status_code != 200:
                raise RuntimeError("LLM API错误: %s | %s" % (r.status_code, r.text[:300]))
            data = r.json()
            content = data["choices"][0]["message"].get("content", "")
            # 去掉可能的 ```json ``` 围栏
            content = re.sub(r"^```(?:json|markdown|md)?\s*\n", "", content)
            content = re.sub(r"\n```\s*$", "", content)
            return content.strip()
        except Exception as e:
            last_err = e
            if attempt < 3:
                import time
                time.sleep(3 * attempt)
    raise last_err


def extract_json(text):
    """从 LLM 输出里抠出第一个 JSON 对象。"""
    text = text.strip()
    s = text.find("{")
    e = text.rfind("}")
    if s == -1 or e == -1:
        return None
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return None


# ----------------------------------------------------------------------------
# 总结函数（LLM 优先，失败降级为忠实抽取）
# ----------------------------------------------------------------------------

def loose_extract(out, keys):
    """宽松字段抽取：JSON 严格解析失败时，按 "键":"值" 逐个正则抠出。
    兜底模型输出的未转义引号/换行导致的 JSON 解析失败。"""
    res = {}
    for k in keys:
        m = re.search(r'"' + k + r'"\s*:\s*"(.*?)"\s*(?=,\s*"|\}|$)', out, re.S)
        if m and m.group(1).strip():
            res[k] = m.group(1).strip()
    return res or None

INTERN_SYSTEM = (
    "你是资深简历优化专家。根据用户提供的某段实习经历的原始 Markdown 内容，"
    "提炼并重写为在线简历所需的「工作内容」与「工作成果」两段文字。\n"
    "要求：\n"
    "1) 工作内容——概括该段实习（含其下所有项目）的核心职责与所做工作，"
    "详实展开为一段完整文字：做了什么+怎么做的+达到什么效果，禁止写成一句话或罗列技术栈；\n"
    "2) 工作成果——概括关键产出、量化指标或业务价值，分点用分号衔接、含数字对比；\n"
    "3) 中文精炼，不编造原文没有的信息，宁精勿长但必须详实到动作级；\n"
    "4) 直接输出最终 JSON：禁止输出任何分析过程、计划、字数统计或解释；字符串值内引用术语用中文引号、不要换行；\n"
    "5) 只输出 JSON：{\"工作内容\":\"...\",\"工作成果\":\"...\"}，不要解释、不要 Markdown 代码块。"
)

PROJECT_SYSTEM = (
    "你是资深简历优化专家。根据提供的单个项目原始 Markdown 内容，"
    "提炼为在线简历所需的「项目内容」「本人职责」「项目成果」三段。\n"
    "格式硬标准（用户已验收，必须严格遵守）：\n"
    "1) 项目内容——2~3 句话说明项目业务场景、要解决的痛点与平台定位；\n"
    "2) 本人职责——固定句式「负责XX核心模块开发：动作1；动作2；动作3；动作4；动作5。」"
    "每条动作 = 做什么 + 用什么技术 + 做到什么程度，用分号分隔，"
    "整段篇幅与下方范例相当；禁止写成一句话总括后跟技术栈列表收尾；\n"
    "3) 项目成果——按「成果标题：具体做法与量化价值。」分块展开，含数字对比；\n"
    "4) 不编造原文没有的信息，宁精勿长但必须详实到动作级；\n"
    "5) 直接输出最终 JSON：禁止输出任何分析过程、计划、字数统计或解释；字符串值内引用术语用中文引号、不要换行；\n"
    "6) 只输出 JSON：{\"项目内容\":\"...\",\"本人职责\":\"...\",\"项目成果\":\"...\"}，不要解释、不要 Markdown 代码块。\n"
    "【本人职责范例（用户认可的标准格式，照此详实程度与句式写）】："
    "负责 AI 中台核心模块设计与开发：基于 Spring Boot 3 + Java 21 构建 Agent 主框架，"
    "通过 MCP 将 APS/MES/WMS/QMS 接口注册为 Agent 可调用的标准化工具；"
    "搭建多模型网关统一接入 14+ 模型 provider 并按租户/场景智能路由；"
    "基于 A2A 协议实现 13+ 制造垂域 Agent 的注册、委派与结构化回传；"
    "构建父子切片 + 向量/FTS 双路召回 + RRF 融合 + Cross-Encoder 精排的制造知识 RAG 链路；"
    "集成 FunASR/PaddleOCR 本地双路径与五层安全护栏实现数据不出厂的离线部署。"
)


def summarize_internship(company_raw, llm_cfg):
    """返回 (工作内容, 工作成果)。LLM 优先（条目级最多 3 轮重试），失败降级为忠实抽取。"""
    import time
    if llm_cfg:
        for attempt in range(3):
            try:
                out = _call_llm(INTERN_SYSTEM, "实习经历原文：\n" + company_raw, llm_cfg, max_tokens=6000)
                j = extract_json(out) or loose_extract(out, ["工作内容", "工作成果"])
                # Sunwz|2026-09-26|有效性校验：值过短或为占位符（如模板回显 "..."）视为无效，触发重试
                # Sunwz|2026-10-01|阈值提高：详实格式硬标准（工作内容>=120/工作成果>=100），
                # 一句话短版直接判无效重试，防止「简短但干净」绕过守卫
                if j and len(str(j.get("工作内容","")).strip()) >= 120 and len(str(j.get("工作成果","")).strip()) >= 100:
                    return j["工作内容"].strip(), j["工作成果"].strip()
                _runlog("[warn] 实习 LLM 第 %d 轮返回不可用，重试\n" % (attempt + 1))
            except Exception as e:
                _runlog("[warn] 实习 LLM 第 %d 轮调用失败: %s\n" % (attempt + 1, e))
            time.sleep(2)
        _runlog("[warn] 实习 LLM 三轮均失败，降级为原文抽取\n")
    # 降级：把各项目描述/技术栈/bullet 拼接
    c = {"projects": []}
    for blk in re.split(r"\*\*项目[一二三四五六七八九十]+[:：]", company_raw):
        name = blk.split("**", 1)[0].strip() if "**" in blk else ""
        dm = re.search(r"\*\*项目描述\*\*[：:]\s*(.*?)(?=\n\*\*技术栈|\n- |\Z)", blk, re.S)
        desc = dm.group(1).strip() if dm else ""
        tm = re.search(r"\*\*技术栈\*\*[：:]\s*(.*?)(?=\n- |\Z)", blk, re.S)
        tech = tm.group(1).strip() if tm else ""
        bullets = []
        for bl in blk.split("\n"):
            bl = bl.strip()
            bm = re.match(r"-\s*\*\*(.+?)\*\*[：:]\s*(.*)", bl)
            if bm:
                bullets.append("%s：%s" % (bm.group(1).strip(), bm.group(2).strip()))
        c["projects"].append({"name": name, "desc": desc, "tech": tech, "bullets": bullets})
    work, results = [], []
    for p in c["projects"]:
        blk = []
        if p["name"]:
            blk.append("【" + p["name"] + "】")
        if p["desc"]:
            blk.append(p["desc"])
        if p["tech"]:
            blk.append("技术栈：" + p["tech"])
        work.append("\n".join(blk))
        results.extend(p["bullets"])
    return "\n\n".join(work), "\n".join(results)


def summarize_project(project_raw, llm_cfg):
    """返回 (项目内容, 本人职责, 项目成果)。LLM 优先（条目级最多 3 轮重试），失败降级。"""
    import time
    if llm_cfg:
        for attempt in range(3):
            try:
                out = _call_llm(PROJECT_SYSTEM, "项目原文：\n" + project_raw, llm_cfg, max_tokens=4800)
                j = extract_json(out) or loose_extract(out, ["项目内容", "本人职责", "项目成果"])
                # Sunwz|2026-10-01|分字段阈值：本人职责>=150（详实格式硬标准，一句话短版判无效重试）、
                # 项目内容>=60、项目成果>=100；过短触发重试，3 轮都短则降级→is_pile 守卫兜底
                if j and (len(str(j.get("项目内容","")).strip()) >= 60
                          and len(str(j.get("本人职责","")).strip()) >= 150
                          and len(str(j.get("项目成果","")).strip()) >= 100):
                    return (j["项目内容"].strip(), j["本人职责"].strip(), j["项目成果"].strip())
                _runlog("[warn] 项目 LLM 第 %d 轮返回不可用，重试\n" % (attempt + 1))
            except Exception as e:
                _runlog("[warn] 项目 LLM 第 %d 轮调用失败: %s\n" % (attempt + 1, e))
            time.sleep(2)
        _runlog("[warn] 项目 LLM 三轮均失败，降级为原文抽取\n")
    # 降级
    dm = re.search(r"\*\*项目描述\*\*[：:]\s*(.*?)(?=\n\*\*技术栈|\n- |\Z)", project_raw, re.S)
    desc = dm.group(1).strip() if dm else ""
    tm = re.search(r"\*\*技术栈\*\*[：:]\s*(.*?)(?=\n- |\Z)", project_raw, re.S)
    tech = tm.group(1).strip() if tm else ""
    bullets = []
    for bl in project_raw.split("\n"):
        bl = bl.strip()
        bm = re.match(r"-\s*\*\*(.+?)\*\*[：:]\s*(.*)", bl)
        if bm:
            bullets.append("%s：%s" % (bm.group(1).strip(), bm.group(2).strip()))
    return desc, tech, "\n".join(bullets)


# ----------------------------------------------------------------------------
# 写回 profile
# ----------------------------------------------------------------------------
def load_profile(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_profile(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def update_profile(profile, companies, core_bullets, llm_cfg):
    sections = profile["profileV2"]["sections"]

    # ---------- internship ----------
    intern_sec = sections.setdefault("internship", {"kind": "repeat", "items": []})
    existing = intern_sec.get("items", [])
    new_interns = []
    for c in companies:
        match = None
        for e in existing:
            ev = e.get("values", {})
            if norm(ev.get("开始时间")) == norm(c["start"]) and norm(ev.get("结束时间")) == norm(c["end"]):
                match = e
                break
        if match is None:
            for e in existing:
                ev = e.get("values", {})
                if norm(c["company"]) in norm(ev.get("公司", "")) or norm(ev.get("公司", "")) in norm(c["company"]):
                    match = e
                    break
        vals = dict(match["values"]) if match else {}
        work_content, work_result = summarize_internship(c["raw"], llm_cfg)
        import time
        time.sleep(2)
        vals["公司"] = c["company"]
        vals["职位"] = c["role"] or vals.get("职位", "")
        if c["start"]:
            vals["开始时间"] = c["start"]
        if c["end"]:
            vals["结束时间"] = c["end"]
        # 质量守卫：LLM 降级堆砌而原值完好时，保留原值（质量只升不降）
        old_wc = str(vals.get("工作内容", "") or "")
        old_wr = str(vals.get("工作成果", "") or "")
        if is_pile(work_content) and not is_pile(old_wc):
            _runlog("[keep] %s 工作内容 LLM 降级堆砌，保留原值" % c["company"][:14])
        else:
            vals["工作内容"] = work_content
        if is_pile(work_result) and not is_pile(old_wr):
            _runlog("[keep] %s 工作成果 LLM 降级堆砌，保留原值" % c["company"][:14])
        else:
            vals["工作成果"] = work_result
        new_interns.append({"title": c["company"], "values": vals})
    intern_sec["items"] = new_interns

    # ---------- project ----------
    proj_sec = sections.setdefault("project", {"kind": "repeat", "items": []})
    existing_p = proj_sec.get("items", [])
    new_projs = []
    for c in companies:
        for p in c["projects"]:
            match = None
            for e in existing_p:
                ev = e.get("values", {})
                if (norm(ev.get("项目名称", "")) == norm(p["name"])) or (
                    p["name"] and (norm(p["name"]) in norm(ev.get("项目名称", "")) or norm(ev.get("项目名称", "")) in norm(p["name"]))
                ):
                    match = e
                    break
            vals = dict(match["values"]) if match else {}
            pc, pj, pr = summarize_project(p["raw"], llm_cfg)
            import time
            time.sleep(2)
            vals["项目名称"] = p["name"]
            vals["职位"] = c["role"] or vals.get("职位", "")
            if c["start"]:
                vals["开始时间"] = c["start"]
            if c["end"]:
                vals["结束时间"] = c["end"]
            # 质量守卫：LLM 降级堆砌而原值完好时，保留原值（质量只升不降）
            for k, nv in (("项目内容", pc), ("本人职责", pj), ("项目成果", pr)):
                if not nv:
                    continue
                ov = str(vals.get(k, "") or "")
                if is_pile(nv) and not is_pile(ov):
                    _runlog("[keep] %s %s LLM 降级堆砌，保留原值" % (p["name"][:14], k))
                else:
                    vals[k] = nv
            # 硬性规则：项目链接 / 项目地址 一律填「无」
            vals["项目链接"] = "无"
            vals["项目地址"] = "无"
            new_projs.append({"title": p["name"], "values": vals})
    proj_sec["items"] = new_projs

    # ---------- self：自我描述来自核心能力，保留自我评价 ----------
    self_sec = sections.setdefault("self", {"kind": "simple", "values": {}})
    vals = dict(self_sec.get("values", {}))
    if core_bullets:
        vals["自我描述"] = "\n".join(core_bullets)
    self_sec["values"] = vals

    return profile


def main():
    llm_cfg = load_llm_config()
    if llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model"):
        _runlog("[info] LLM 已启用: %s @ %s\n" % (llm_cfg["model"], llm_cfg["base_url"]))
    else:
        _runlog("[info] LLM 未配置，降级为忠实抽取（复制原文）\n")

    md = read_text(MD_PATH)
    companies = parse_internship(md)
    core = parse_core(md)
    profile = load_profile(PROFILE_PATH)
    profile = update_profile(profile, companies, core, llm_cfg if (llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model")) else None)
    save_profile(PROFILE_PATH, profile)
    n_intern = len(companies)
    n_proj = sum(len(c["projects"]) for c in companies)
    print("OK: 同步完成（LLM总结）| 实习公司=%d 项目=%d 核心能力=%d 条" % (n_intern, n_proj, len(core)))
    print("  internship items=%d, project items=%d" % (n_intern, n_proj))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERR: %s" % e, file=sys.stderr)
        sys.exit(1)
