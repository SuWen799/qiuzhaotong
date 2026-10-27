"""
岗位匹配度计算模块

计算思路（可解释、可复现）：
1. 以 JD 识别出的关键词（带分类权重）为基础，检查候选人简历文本中是否命中。
2. 命中率 = 命中关键词的加权得分 / JD 全部关键词的加权总分。
3. 叠加教育匹配（专业/学历是否对口）与竞赛/开源等"加分项"的额外奖励。
4. 最终匹配度 = 关键词命中得分(70%) + 教育匹配(15%) + 加分项(15%)，封顶 100。
5. 输出已匹配关键词、待提升关键词（按缺失权重排序）、分类覆盖明细，供前端展示。
"""

import re
from collections import defaultdict
from config import JD_TECH_KEYWORDS
from project_knowledge import load_all_data

# 分类权重（与 jd_parser 保持一致口径；此处用于打分）
CATEGORY_WEIGHTS = {
    "agent": 3.0, "rag": 3.0, "llm": 2.8, "nlp": 2.2, "cv": 2.2,
    "train_infer": 2.4, "distributed": 2.0, "backend": 1.8,
    "multimodal": 2.0, "spatial": 1.6, "frontend": 1.4, "data": 1.6,
    "devops": 1.4, "recommendation": 1.4, "compile_opt": 1.6,
    "coding": 1.8, "ai_tools": 2.0, "safety": 1.8, "observability": 1.6,
}

# 短词/易误命中词，匹配简历时也要词边界精确匹配
EXACT_TOKENS = {
    "go", "rag", "api", "cv", "3d", "io", "sse", "ast", "gpu",
    "sql", "c++", "cpp", "nlp", "llm", "icpc", "dpo", "sft",
    "rest", "clip", "k8s", "bert",
}

# 教育匹配关键词
EDU_TARGET_MAJORS = ["计算机", "软件", "人工智能", "数学", "统计", "自动化", "电子", "通信", "数据科学", "机器学习"]
EDU_TARGET_DEGREES = ["本科", "硕士", "博士"]

# 加分项关键词
BONUS_KEYWORDS = {
    "竞赛": ["acm", "icpc", "kaggle", "天池", "算法竞赛", "竞赛"],
    "开源/社区": ["开源", "开源项目", "社区", "核心贡献", "github", "contributor"],
    "后训练对齐": ["后训练", "post-training", "rlhf", "dpo", "sft", "对齐", "强化学习"],
    "CV/NLP基础": ["计算机视觉", "cv", "自然语言处理", "nlp"],
    "完整落地": ["从0到1", "0到1", "完整", "落地", "主导"],
    "分布式性能": ["高并发", "分布式", "性能调优", "大流量", "后端开发"],
}


def _token_in_text(token, text_lower):
    if token in EXACT_TOKENS or len(token) <= 2:
        pattern = r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])"
        return re.search(pattern, text_lower) is not None
    return token in text_lower


def _build_resume_text(base_md=None):
    """汇总候选人所有可匹配文本。"""
    parts = []
    if base_md:
        parts.append(base_md)
    data = load_all_data()
    core = data.get("core_skills", {})
    for s in core.get("technical", []):
        parts.append(s)
    for s in core.get("soft", []):
        parts.append(s)
    for edu in data.get("education", []):
        for k, v in edu.items():
            parts.append(str(v))
    for c in data.get("certificates", []):
        parts.append(str(c))
    for intern in data.get("internships", []):
        for proj in intern.get("projects", []):
            parts.append(str(proj.get("techStack", "")))
            parts.append(str(proj.get("description", "")))
            for h in proj.get("highlights", []):
                parts.append(str(h))
    return "\n".join(parts)


def compute_match(jd_text, jd_parsed=None, base_md=None):
    """计算岗位匹配度。"""
    from jd_parser import JDParser

    if jd_parsed is None:
        jd_parsed = JDParser().parse_jd(jd_text)

    keywords_by_category = jd_parsed.get("keywords", {})
    resume_text = _build_resume_text(base_md)
    resume_lower = resume_text.lower()

    matched = []
    missing = []
    cat_cover = {}

    kw_best = {}
    for cat, kws in keywords_by_category.items():
        w = CATEGORY_WEIGHTS.get(cat, 1.0)
        for kw in kws:
            kl = kw.lower()
            if kl not in kw_best or w > kw_best[kl][0]:
                kw_best[kl] = (w, cat)

    total_weight = 0.0
    earned_weight = 0.0
    for kl, (w, cat) in kw_best.items():
        total_weight += w
        display = None
        for kws in keywords_by_category.values():
            if kl in [k.lower() for k in kws]:
                display = next(k for k in kws if k.lower() == kl)
                break
        display = display or kl
        hit = _token_in_text(kl, resume_lower)
        cat_cover.setdefault(cat, [0, 0])
        cat_cover[cat][1] += 1
        if hit:
            earned_weight += w
            cat_cover[cat][0] += 1
            matched.append((display, w, cat))
        else:
            missing.append((display, w, cat))

    keyword_score = (earned_weight / total_weight) if total_weight > 0 else 0.0

    edu_score, edu_detail = _edu_match(jd_text, resume_lower)
    bonus_score, bonus_detail = _bonus_match(jd_text, resume_lower, jd_parsed)

    raw = keyword_score * 0.70 + edu_score * 0.15 + bonus_score * 0.15
    match_percent = min(100, round(raw * 100))

    if match_percent >= 85:
        level = "高度匹配"
    elif match_percent >= 70:
        level = "较匹配"
    elif match_percent >= 55:
        level = "基本匹配"
    else:
        level = "匹配度偏低"

    missing_sorted = sorted(missing, key=lambda x: -x[1])
    gap_keywords = [{"keyword": k, "weight": w, "category": c} for k, w, c in missing_sorted[:12]]
    gap_categories = sorted({c for _, _, c in missing}, key=lambda c: -sum(w for _, w, cc in missing if cc == c))[:5]

    matched_sorted = sorted(matched, key=lambda x: -x[1])
    matched_keywords = [{"keyword": k, "weight": w, "category": c} for k, w, c in matched_sorted]

    cat_cover_pct = {
        cat: round((cov[0] / cov[1] * 100) if cov[1] else 0)
        for cat, cov in cat_cover.items()
    }

    return {
        "match_percent": match_percent,
        "level": level,
        "breakdown": {
            "keyword_score": round(keyword_score * 100),
            "edu_score": round(edu_score * 100),
            "bonus_score": round(bonus_score * 100),
            "weights": {"keyword": 70, "education": 15, "bonus": 15},
        },
        "matched_count": len(matched),
        "total_count": len(kw_best),
        "matched_keywords": matched_keywords,
        "gap_keywords": gap_keywords,
        "gap_categories": gap_categories,
        "category_coverage": cat_cover_pct,
        "edu_detail": edu_detail,
        "bonus_detail": bonus_detail,
        "summary": jd_parsed.get("summary", ""),
    }


def _edu_match(jd_text, resume_lower):
    """教育匹配：专业对口 + 学历达标。"""
    data = load_all_data()
    edu_text = " ".join(str(v) for edu in data.get("education", []) for v in edu.values()).lower()

    major_hit = [m for m in EDU_TARGET_MAJORS if m in resume_lower or m in edu_text]
    jd_major_req = [m for m in EDU_TARGET_MAJORS if m in jd_text.lower()]
    major_ok = bool(major_hit) and (not jd_major_req or bool(set(major_hit) & set(jd_major_req)))

    jd_degree_req = [d for d in EDU_TARGET_DEGREES if d in jd_text]
    edu_degree_ok = True
    if jd_degree_req:
        edu_degree_ok = any(d in edu_text for d in jd_degree_req)

    score = 0.0
    if major_ok:
        score += 0.6
    if edu_degree_ok:
        score += 0.4
    detail = {
        "major_match": major_ok,
        "major_hit": major_hit,
        "degree_match": edu_degree_ok,
        "jd_major_req": jd_major_req,
        "jd_degree_req": jd_degree_req,
    }
    return min(1.0, score), detail


def _bonus_match(jd_text, resume_lower, jd_parsed):
    """加分项匹配。"""
    jd_lower = jd_text.lower()
    hit_bonus = []
    for label, tokens in BONUS_KEYWORDS.items():
        if not any(t in jd_lower for t in tokens):
            continue
        if any(_token_in_text(t, resume_lower) for t in tokens):
            hit_bonus.append(label)
    score = min(1.0, len(hit_bonus) * 0.34)
    return score, {"hit_bonus": hit_bonus}


if __name__ == "__main__":
    import sys
    sample = sys.stdin.read() if not sys.argv[1:] else open(sys.argv[1], encoding="utf-8").read()
    from jd_parser import JDParser
    parsed = JDParser().parse_jd(sample)
    r = compute_match(sample, parsed)
    import json
    print(json.dumps(r, ensure_ascii=False, indent=2))
