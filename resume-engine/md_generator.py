"""
MD生成器 - 从 JSON 参考素材读取并据 JD 优化

设计要点（相对旧版改造）：
- LLM 调用改为**参数化**：llm_cfg 由调用方（main.py）从环境变量/命令行构造后传入，
  不再写死在 config 里（适配 Spring Boot 通过环境变量注入）。
- 实习经历 / 项目经历 / 核心能力 三类「随 JD 变化」的模块，均支持 LLM 优化；
  LLM 失败或不可用（无 key）时自动走规则兜底（关键词加粗），保证永远有有效输出。
- 优化后的结构化内容直接返回，供 main.py 写入 variable_modules。
- 所有进度/调试日志打印到 stderr，保证 stdout 只有最终一行 JSON。
"""

import re
import sys
import json
import unicodedata
from project_knowledge import load_all_data, PHOTO_PATH


def _log(*args):
    print(*args, file=sys.stderr)


def _call_llm(system_prompt, user_prompt, llm_cfg, max_tokens=8000):
    """调用 LLM（OpenAI 兼容接口）。llm_cfg 必须含 api_key/base_url/model。"""
    import requests

    if not (llm_cfg and llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model")):
        raise RuntimeError("LLM 未配置（缺少 api_key/base_url/model），走规则兜底")

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
    # 超时拆分为 (连接, 读取)：连接 10s / 读取 50s。避免服务端 TCP 半开或响应极慢时
    # 长时间阻塞整个生成流程；失败则交由上层回退规则优化。
    response = requests.post(url, headers=headers, json=payload, timeout=(10, 50))
    if response.status_code != 200:
        # 打印详细错误便于调试（LLM 服务端返回的 400 通常含具体原因）
        _log(f"[LLM DEBUG] url={url} model={llm_cfg.get('model')} status={response.status_code} body={response.text[:500]}")
        raise RuntimeError(f"LLM API错误: {response.status_code}")
    data = response.json()
    content = data["choices"][0]["message"].get("content", "")
    content = re.sub(r"^```(?:json|markdown|md)?\s*\n", "", content)
    content = re.sub(r"\n```\s*$", "", content)
    return content.strip()


def extract_jd_keywords(jd_text):
    """从 JD 中提取关键词（规则为主）。

    返回：
    {
        "summary": "岗位方向简述",
        "priority_skills": [...],
        "keywords_by_category": {...},
        "all_skills": [...]
    }
    """
    from jd_parser import JDParser
    parser = JDParser()
    parsed = parser.parse_jd(jd_text)

    return {
        "summary": parsed.get("summary", ""),
        "priority_skills": parsed.get("priority_skills", []),
        "keywords_by_category": parsed.get("keywords", {}),
        "all_skills": parsed.get("all_skills", []),
    }


# 兼容旧调用名
def extract_jd_keywords_with_llm(jd_text):
    return extract_jd_keywords(jd_text)


# ============ 基础（稳定）部分渲染 ============

def _render_header(p):
    md = []
    md.append("## 基本信息")
    md.append("")
    # 基本信息是 2 组「标签 | 值」并排布局，共 4 列（姓名/性别 一行，年龄/籍贯 一行，电话/邮箱 一行）。
    # 表头行（| | | |）与数据行均为 4 单元格，分隔符必须也是 4 列，否则严格 GFM
    # 渲染器会按 3 列解析并把第 4 列（性别/籍贯/邮箱）整列丢弃，表现为「内容缺失 + 格式错乱」。
    # 注意：PDF 渲染走 pdf_generator 的独立表格解析（skip_until_hr 会跳过这几行），此改动不影响 PDF。
    md.append("| | | | |")
    md.append("|---|---|---|---|")
    md.append(f"| **姓名** | {p['name']} | **性别** | {p['gender']} |")
    md.append(f"| **年龄** | {p['age']} | **籍贯** | {p['hometown']} |")
    md.append(f"| **电话** | {p['phone']} | **邮箱** | {p['email']} |")
    md.append("")
    md.append("---")
    md.append("")
    return "\n".join(md)


def _render_education(education):
    md = ["## 教育背景", ""]
    for edu in education:
        md.append(f"**{edu['school']}** | {edu['major']}（{edu['degree']}）| {edu['period']}")
        md.append("")
    md.append("")
    md.append("---")
    md.append("")
    return "\n".join(md)


def _render_certificates(certificates):
    md = ["## 荣誉证书", ""]
    for cert in certificates:
        md.append(f"- {cert}")
    md.append("")
    return "\n".join(md)


def _render_core_skills(core_skills):
    md = ["## 核心能力", ""]
    for skill in core_skills.get("technical", []):
        md.append(f"- {skill}")
    md.append("")
    md.append("---")
    md.append("")
    return "\n".join(md)


def _render_internships(internships):
    """将优化后的 internships 结构化数据渲染为 MD。
    一个实习经历含多个项目时，用「项目一：/ 项目二：」编号 + 加粗，使多个项目一眼可辨；
    仅一个项目时直接写项目名（不加编号）。"""
    md = ["## 实习经历", ""]
    for internship in internships:
        md.append(f"### {internship['company']} | {internship['role']} | {internship['period']}")
        md.append("")
        projects = internship.get("projects", [])
        n = len(projects)
        for idx, proj in enumerate(projects, start=1):
            if n == 1:
                md.append(f"**{proj['name']}**")
            else:
                cn = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][idx - 1]
                md.append(f"**项目{cn}：{proj['name']}**")
            md.append("")
            md.append(f"**项目描述**：{proj['description']}")
            md.append("")
            md.append(f"**技术栈**：{proj['techStack']}")
            md.append("")
            for highlight in proj.get("highlights", []):
                md.append(f"- {highlight}")
            md.append("")
        md.append("---")
        md.append("")
    return "\n".join(md)


def build_base_parts():
    """返回稳定部分 MD（header / education / core / cert）以及原始数据。"""
    data = load_all_data()
    header = _render_header(data["personal"])
    education = _render_education(data["education"])
    cert = _render_certificates(data["certificates"])
    return {
        "header": header,
        "education": education,
        "cert": cert,
        "personal": data["personal"],
        "education_data": data["education"],
        "certificates": data["certificates"],
        "core_skills": data["core_skills"],
        "internships": data["internships"],
    }


def assemble_resume(header, education, internship_md, core_md, cert):
    """拼接最终简历 MD。"""
    return "\n".join([header, education, internship_md, core_md, cert]).strip() + "\n"


# ============ 规则兜底 ============

SOFT_SKILLS = [
    "系统思维", "问题解决能力", "代码质量意识", "独立调研", "技术选型",
    "技术预研", "学习能力", "团队协作", "自驱意识", "沟通能力",
    "责任心", "抗压能力", "创新能力", "执行力", "领导力"
]


def rule_based_optimize_internships(internships, jd_keywords):
    """规则兜底（忠实复制，不做 JD 关键词加粗）。

    实习/项目文本严格按参考素材原样输出，仅保留素材中本就写好的「要点前置加粗」
    （如 **多模态接入与多 Agent 编排**：），不额外对正文里的技术词做关键词加粗，
    避免正文被拆成花花绿绿的加粗片段、影响阅读与打印。"""
    import copy
    return copy.deepcopy(internships)


def _bold_keywords(text, jd_keywords):
    if not text:
        return text
    result = text
    for kw in sorted(jd_keywords, key=len, reverse=True):
        if len(kw) < 2:
            continue
        pattern = re.compile(r"\*\*" + re.escape(kw) + r"\*\*")
        if pattern.search(result):
            continue
        result = re.sub(r"(?<![\*\w])" + re.escape(kw) + r"(?![\*\w])", f"**{kw}**", result)
    return result


# ============ LLM 优化 ============

PRESERVE_TERMS = [
    "RAG", "向量检索", "Qdrant", "Elasticsearch", "MCP", "AgentScope",
    "Tool Calling", "ReAct", "Memory", "Planning", "Reflection",
    "Prompt Engineering", "Cross-Encoder", "双路召回", "RRF融合",
    "LangGraph", "AutoGen", "CrewAI", "MetaGPT", "FastAPI", "Flask",
]


def llm_optimize_internships(internships, jd_text, jd_keywords, llm_cfg):
    """LLM 优化实习/项目经历（结构化 JSON 输出）。
    失败 / 返回非法 JSON 时回退规则兜底。"""
    keywords_str = "、".join(jd_keywords[:20])
    preserve_str = "、".join(PRESERVE_TERMS)
    soft_skills_str = "、".join(SOFT_SKILLS)
    # 拼好"段数与每段项目数"约束提示，拼到 prompt 中间
    seg_hint = "、".join(
        f"段{i}={len(intern.get('projects', []))}项"
        for i, intern in enumerate(internships)
    )

    prompt = f"""你是资深简历优化专家。根据JD优化下面的「实习经历」数据（JSON数组）。

## 岗位JD（节选）
{jd_text[:1500]}

## JD关键词
{keywords_str}

## 待优化的实习经历（JSON）
{json.dumps(internships, ensure_ascii=False)}

## 严格规则
1. **结构与条目数严格不变**：输出 JSON 数组长度必须 = {len(internships)}（与输入一致）；不得新增、不得删除、不得拆分公司条目
2. 每个元素保持 company/role/period/projects 四字段；projects 数组长度也必须与对应原项目数量一致——输入各段项目数为：{seg_hint}，输出对应段项目数必须相同
3. 项目name必须原样保留，不得改名、不得拆分
4. 数据真实，不得夸大；保留原有量化指标
5. 把JD技术关键词自然融入 highlights/description/techStack，并用**加粗**标记
6. 每个项目 highlights 不超过5条，单条不超过60字
7. 以下软技能禁止写入实习/项目经历：{soft_skills_str}
8. 必须保留的技术术语：{preserve_str}

只输出优化后的 JSON 数组，不要解释、不要 Markdown 代码块标记。"""

    try:
        out = _call_llm(
            "简历优化专家。仅优化实习经历JSON，按JD融入关键词并加粗，结构不变。",
            prompt, llm_cfg, max_tokens=6000,
        )
    except Exception as e:
        _log(f"[llm_optimize_internships] LLM调用失败，回退规则优化: {e}")
        return rule_based_optimize_internships(internships, jd_keywords)

    try:
        parsed = json.loads(out)
        if isinstance(parsed, list) and parsed:
            # 简单校验结构
            _ = parsed[0].get("projects")
            # 关键后处理：防止 LLM 把项目错放到其它实习公司下
            return restore_internship_structure(internships, parsed)
    except Exception as e:
        _log(f"[llm_optimize_internships] JSON解析失败，回退规则优化: {e}")
    _log("[llm_optimize_internships] LLM返回非预期格式，回退规则优化")
    return rule_based_optimize_internships(internships, jd_keywords)


def llm_optimize_core_skills(core_skills, jd_text, jd_keywords, llm_cfg):
    """LLM 优化核心能力（结构化 JSON）。失败回退原样。"""
    keywords_str = "、".join(jd_keywords[:20])
    prompt = f"""你是资深简历优化专家。根据JD优化下面的「核心能力」JSON。

## 岗位JD（节选）
{jd_text[:1200]}

## JD关键词
{keywords_str}

## 待优化核心能力（JSON）
{json.dumps(core_skills, ensure_ascii=False)}

## 规则
1. 结构不变：含 technical(列表)/soft(列表)
2. 把JD关键词自然融入 technical 表述，用**加粗**标记；soft 保持原样
3. 按JD相关性对 technical 排序（最相关在前），不得删减真实能力
4. 只输出优化后的 JSON，不要解释。"""

    try:
        out = _call_llm(
            "简历优化专家。仅优化核心能力JSON，按JD融入关键词并加粗，结构不变。",
            prompt, llm_cfg, max_tokens=3000,
        )
    except Exception as e:
        _log(f"[llm_optimize_core_skills] LLM调用失败，回退原样: {e}")
        return core_skills

    try:
        parsed = json.loads(out)
        if isinstance(parsed, dict) and "technical" in parsed:
            return parsed
    except Exception as e:
        _log(f"[llm_optimize_core_skills] JSON解析失败，回退原样: {e}")
    return core_skills


def flatten_projects(internships, original_projects_count=None, project_extras=None):
    """从优化后的 internships 扁平化出 project 列表，供 variable_modules。

    project_extras: 项目经验目录下补充素材列表（每个 {name, techStack, description, highlights[]}）。
    本函数会按 name 相似度把 extras 的内容合并到 base 项目中（追加 highlights，叠加 description/techStack），
    但**不增加项目总条数**——避免奥比中光等定制版字段数从 176 膨胀到 216。
    """
    projects = []
    for intern in internships:
        for proj in intern.get("projects", []):
            p = dict(proj)
            p["_company"] = intern.get("company", "")
            p["_role"] = intern.get("role", "")
            p["_period"] = intern.get("period", "")
            projects.append(p)

    # 合并项目经验补充素材：按 name 相似度匹配到 base 项目，追加到 highlights/description/techStack
    if project_extras:
        for extra in project_extras:
            extra_name = (extra.get("name") or "").strip()
            if not extra_name:
                continue
            match, score = _best_project_match(extra_name, projects)
            if not match or score < 0.35:
                continue
            base_proj = match
            # 追加 highlights（去重）
            existing_hl = list(base_proj.get("highlights") or [])
            extra_hl = list(extra.get("highlights") or [])
            for h in extra_hl:
                if h and h not in existing_hl:
                    existing_hl.append(h)
            base_proj["highlights"] = existing_hl
            # 叠加 techStack（去重；Sunwz|2026-10-01|extras 的 techStack 是 " / " 分隔整串，
            # 旧逻辑只按 、, 切会把整串当一项追加 → 简历技术栈重复堆叠；现统一按多分隔符切）
            if extra.get("techStack"):
                import re as _re
                def _split_ts(s):
                    return [x.strip() for x in _re.split(r"[、,，；;／/]", str(s)) if x.strip()]
                ts_items = _split_ts(base_proj.get("techStack")) + _split_ts(extra["techStack"])
                seen, out = set(), []
                for x in ts_items:
                    if x and x.lower() not in seen:
                        seen.add(x.lower())
                        out.append(x)
                base_proj["techStack"] = "；".join(out)

    # 硬截断：projects 总数 ≤ 原 base 总数（防止 LLM 在某段实习下多加 projects）
    if original_projects_count is not None and len(projects) > original_projects_count:
        _log(f"[flatten_projects] 警告：扁平化后 projects {len(projects)} > 原 {original_projects_count}，已截断")
        projects = projects[:original_projects_count]
    return projects


# ============ LLM 输出结构后处理：防止项目被错误合并到其它实习公司下 ============

def _norm(s):
    """名称归一化：NFKC + 去空白 + 小写，便于中文/英文/括号差异匹配。"""
    return unicodedata.normalize('NFKC', str(s or '')).lower().strip().replace(' ', '')


def _name_similarity(a, b):
    """基于最长公共子序列的相似度（0~1）。"""
    ca, cb = _norm(a), _norm(b)
    if not ca or not cb:
        return 0.0
    if ca == cb:
        return 1.0
    # 去掉通用词减少干扰
    for w in ['项目', '平台', '系统', '方案', '工程']:
        ca = ca.replace(w, '')
        cb = cb.replace(w, '')
    if not ca or not cb:
        return 0.0
    m, n = len(ca), len(cb)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ca[i - 1] == cb[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[m][n] / max(m, n)


def _best_project_match(name, targets):
    """在 targets（project 列表）中按名称找最佳匹配，返回 (project, score)。"""
    best = None
    best_score = 0.0
    name_n = _norm(name)
    for p in targets:
        p_name = p.get('name') or ''
        score = _name_similarity(name, p_name)
        # 子串命中给较高权重
        if name_n and _norm(p_name) in name_n or name_n in _norm(p_name):
            score = max(score, 0.9)
        if score > best_score:
            best_score = score
            best = p
    return best, best_score


def _best_company_match(company, originals):
    """在 original internships 中按公司名找最佳匹配，返回索引。"""
    best_idx = 0
    best_score = -1.0
    for idx, intern in enumerate(originals):
        score = _name_similarity(company, intern.get('company', ''))
        if _norm(company) in _norm(intern.get('company', '')) or _norm(intern.get('company', '')) in _norm(company):
            score = max(score, 0.9)
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx


def restore_internship_structure(original_internships, optimized_internships):
    """把 LLM 优化后的 internships 按「原实习公司-项目」映射重新归位。

    LLM 在一次性优化多段实习时，可能把项目全部塞进第一个实习条目。此函数保证：
      1. 实习条目数量/公司/角色/时间与原结构一致（硬截断：超出部分丢弃）；
      2. 每个项目按名称匹配回到它原来所属的实习公司下；
      3. 优化后的文本内容（description/techStack/highlights）得到保留；
      4. 每段实习下 projects 数量严格 ≤ 原对应段 projects 数量（防 LLM 拆条导致膨胀）。
    """
    if not original_internships:
        return optimized_internships or []

    # 硬截断：实习条目数最多 = 原条目数（防止 LLM 在顶层数组加新元素）
    if optimized_internships and len(optimized_internships) > len(original_internships):
        _log(f"[restore_internship_structure] 警告：LLM 实习条目数 {len(optimized_internships)} > 原 {len(original_internships)}，已截断到原长度")
        optimized_internships = optimized_internships[:len(original_internships)]

    # 输出结构：深拷贝原实习条目，清空 projects 后重新分配
    out = [dict(intern, projects=[]) for intern in original_internships]
    used = set()

    # 收集所有优化后的项目，并记录其来自哪个优化实习条目
    opt_projects = []
    for opt_idx, opt in enumerate(optimized_internships or []):
        for p in opt.get('projects', []):
            p = dict(p)
            p['_opt_company'] = opt.get('company', '')
            p['_opt_idx'] = opt_idx
            opt_projects.append(p)

    # 第一轮：按原项目名精确/模糊匹配，把优化项目放回对应原实习公司
    for o_idx, intern in enumerate(original_internships):
        for orig_proj in intern.get('projects', []):
            match, score = _best_project_match(orig_proj.get('name', ''), opt_projects)
            if match and score >= 0.35 and id(match) not in used:
                out[o_idx]['projects'].append(match)
                used.add(id(match))

    # 第二轮：把剩余优化项目按公司名归属回原实习公司
    for p in opt_projects:
        if id(p) in used:
            continue
        target_idx = _best_company_match(p.get('_opt_company', ''), original_internships)
        out[target_idx]['projects'].append(p)
        used.add(id(p))

    # 第三轮：若某原实习公司最终没有项目，保留原项目（避免丢数据）
    for o_idx, intern in enumerate(original_internships):
        if not out[o_idx].get('projects'):
            out[o_idx]['projects'] = [dict(p) for p in intern.get('projects', [])]

    # 第四轮（硬截断）：每段实习下 projects 数严格 ≤ 原对应段 projects 数（防 LLM 拆条）
    for o_idx, intern in enumerate(original_internships):
        orig_n = len(intern.get('projects', []))
        if len(out[o_idx].get('projects', [])) > orig_n:
            _log(f"[restore_internship_structure] 警告：实习段[{o_idx}] {intern.get('company','')} projects 数 {len(out[o_idx]['projects'])} > 原 {orig_n}，已截断")
            out[o_idx]['projects'] = out[o_idx]['projects'][:orig_n]

    return out
