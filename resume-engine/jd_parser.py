"""
JD解析和关键词提取模块
"""

import re
import json
import os
from collections import Counter
from config import JD_TECH_KEYWORDS, BASE_DIR

# JD 解析缓存目录（可选，不影响核心功能）
JD_CACHE_DIR = os.path.join(BASE_DIR, "jd_cache")


class JDParser:
    """岗位JD解析器"""

    def __init__(self):
        os.makedirs(JD_CACHE_DIR, exist_ok=True)
        self.tech_keywords = JD_TECH_KEYWORDS
        # 单字符/极短、易误命中的关键词，必须用词边界精确匹配
        self.exact_match_tokens = {
            "go", "rag", "api", "cv", "3d", "io", "sse", "ast", "gpu",
            "sql", "c++", "cpp", "nlp", "llm", "icpc", "dpo", "sft",
            "rest", "clip", "k8s",
        }

    def _token_in_text(self, token, text_lower):
        """判断是否命中关键词。"""
        if token in self.exact_match_tokens or len(token) <= 2:
            pattern = r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])"
            return re.search(pattern, text_lower) is not None
        return token in text_lower

    def parse_jd(self, jd_text):
        """解析JD文本，提取结构化信息"""
        result = {
            "raw": jd_text,
            "keywords": {},
            "skills": [],
            "experience_req": [],
            "education_req": [],
            "summary": "",
            "priority_skills": [],
            "all_skills": [],
        }

        text_lower = jd_text.lower()

        for category, keywords in self.tech_keywords.items():
            found = []
            for kw in keywords:
                if self._token_in_text(kw.lower(), text_lower):
                    found.append(kw)
            if found:
                result["keywords"][category] = list(set(found))

        seen = set()
        all_skills = []
        for found in result["keywords"].values():
            for kw in found:
                key = kw.lower()
                if key not in seen:
                    seen.add(key)
                    all_skills.append(kw)
        # 通用抽取：弥补硬编码词表覆盖不到的关键词（如 Axure/MindManager 等英文专有名词、
        # 以及「知识图谱」「知识库」等中文复合名词）。这些词同样参与命中计算与简历加粗。
        extra = self._extract_generic_keywords(jd_text, text_lower)
        for kw in extra:
            key = kw.lower()
            if key not in seen:
                seen.add(key)
                all_skills.append(kw)
        result["skills"] = all_skills
        result["all_skills"] = all_skills

        exp_patterns = [
            r"(?:经验|experience)[：:：\s]*([^。\n]+)",
            r"(\d+\s*年[^。\n]*经验)",
        ]
        for pattern in exp_patterns:
            matches = re.findall(pattern, jd_text, re.IGNORECASE)
            result["experience_req"].extend(matches)
        result["experience_req"] = result["experience_req"][:5]

        edu_match = re.findall(r"(本科|硕士|博士|大专)[及以上学历]*", jd_text, re.IGNORECASE)
        result["education_req"] = list(set(edu_match))

        category_weights = {
            "agent": 3.0, "rag": 3.0, "llm": 2.8, "nlp": 2.2, "cv": 2.2,
            "train_infer": 2.4, "distributed": 2.0, "backend": 1.8,
            "multimodal": 2.0, "spatial": 1.6, "frontend": 1.4, "data": 1.6,
            "devops": 1.4, "recommendation": 1.4, "compile_opt": 1.6,
            "coding": 1.8, "ai_tools": 2.0, "safety": 1.8, "observability": 1.6,
            "embedded": 1.8,  # 2026-08-24 新增：嵌入式/工业软件/产测类 JD
        }

        skill_cat_weight = {}
        for category, found in result["keywords"].items():
            w = category_weights.get(category, 1.0)
            for skill in found:
                if skill.lower() not in skill_cat_weight or w > skill_cat_weight[skill.lower()][1]:
                    skill_cat_weight[skill.lower()] = (skill, w)

        skill_score = Counter()
        for skill, (_, w) in skill_cat_weight.items():
            count = text_lower.count(skill)
            skill_score[skill_cat_weight[skill][0]] += count * w

        result["priority_skills"] = [s for s, _ in skill_score.most_common(20)]
        result["_skill_cat_weight"] = {k: v[1] for k, v in skill_cat_weight.items()}

        result["summary"] = self._generate_summary(jd_text, result["keywords"])

        return result

    def _extract_generic_keywords(self, jd_text, text_lower):
        """通用关键词抽取（兜底，弥补硬编码词表遗漏）。

        抽取两类：
        1) 英文/数字混合专有名词：含大写字母、长度>=2 的词（如 Axure、MindManager、NLP、RAG、
           但排除纯全大写极短 token 以免噪声）。从 JD 原文按词边界切出。
        2) 中文复合名词：从预定义「中文关键名词表」里做子串匹配（如 知识图谱、知识库、智能客服、
           原型工具、思维导图、产品设计、需求拆解、数据治理 等）。
        返回去重后的关键词原始大小写形式列表。
        """
        found = []

        # 1) 英文专有名词：JD 原文中连续英文/数字、且含至少一个大写字母、长度>=2
        #    例：Axure / MindManager / RAG(全大写长度3保留) / KnowledgeGraph(驼峰)
        #    排除：纯小写普通词（由硬编码词表覆盖）、单字符、纯数字
        for m in re.finditer(r"[A-Za-z][A-Za-z0-9+#.\-]*", jd_text):
            w = m.group(0)
            if len(w) < 2:
                continue
            # 含大写字母（排除全小写），或长度>=3 的全大写缩写（如 RAG/NLP 已多由词表覆盖，这里仅补充遗漏）
            has_upper = any(c.isupper() for c in w)
            if not has_upper:
                continue
            # 过滤常见噪声：与已知技术词表重复的不在此重复（调用方会去重），这里直接加入候选
            # 仅当该词在 JD 中作为独立词出现（避免嵌在其他词里），用原匹配即可
            found.append(w)

        # 2) 中文复合名词表（产品/知识管理/通用岗位高频词 + 2026-08-24 增补嵌入式/工业软件/产测）
        CN_NOUN_TABLE = [
            "知识图谱", "知识库", "知识工程", "知识管理", "知识运营", "知识资产",
            "知识沉淀", "知识平台", "知识治理", "知识校验", "知识质检", "智能纠错",
            "知识问答", "知识检索", "知识结构化", "知识采集", "知识加工", "知识分发",
            "智能客服", "语义理解", "检索增强", "问答推理", "自动化知识",
            "产品设计", "产品方案", "产品规划", "产品运营", "原型设计", "原型工具",
            "思维导图", "脑图", "需求拆解", "需求分析", "产品需求", "业务拆解",
            "方案设计", "用户研究", "交互设计", "信息架构", "数据治理",
            "大模型应用", "智能体", "全链路", "行业领先",
            # 嵌入式/工业软件/Windows客户端/产测（2026-08-24 增补）
            "智能硬件", "产测系统", "产测模块", "生产测试", "测试工位",
            "自动化测试软件", "测试软件开发", "瓶颈工位", "工位设计",
            "运动控制卡二次开发", "运动控制", "工控自动化", "工业自动化",
            "windows客户端开发", "windows客户端", "windows调试",
            "进程线程调度", "进程线程", "通信协议", "文件系统", "内存管理",
            "模块化设计", "架构优化", "架构设计", "需求架构",
        ]
        for cn in CN_NOUN_TABLE:
            if cn in jd_text:
                found.append(cn)

        # 去重（保留首次出现顺序），统一用小写判断重复
        seen_low = set()
        out = []
        for w in found:
            kl = w.lower()
            if kl in seen_low:
                continue
            seen_low.add(kl)
            out.append(w)
        return out

    def _generate_summary(self, jd_text, keywords):
        parts = []
        if "agent" in keywords: parts.append("Agent开发")
        if "rag" in keywords: parts.append("RAG知识工程")
        if "llm" in keywords: parts.append("LLM应用开发")
        if "nlp" in keywords: parts.append("NLP自然语言处理")
        if "cv" in keywords: parts.append("CV计算机视觉")
        if "train_infer" in keywords: parts.append("大模型训推/对齐")
        if "distributed" in keywords: parts.append("分布式/高并发系统")
        if "backend" in keywords: parts.append("后端开发")
        if "frontend" in keywords: parts.append("前端开发")
        if "safety" in keywords: parts.append("Agent安全体系")
        if "observability" in keywords: parts.append("可观测评估")

        direction = "、".join(parts) if parts else "AI应用开发"
        total = sum(len(v) for v in keywords.values())
        cats = list(keywords.keys())
        return f"方向：{direction} | 匹配关键词{total}个 | 主要类别：{cats}"

    def format_for_llm(self, parsed_jd):
        """格式化为LLM可读文本"""
        lines = [f"## 岗位方向：{parsed_jd['summary']}", "", "### 核心技术关键词（按优先级）："]
        for i, skill in enumerate(parsed_jd["priority_skills"], 1):
            lines.append(f"{i}. {skill}")

        if parsed_jd["keywords"]:
            lines.append("\n### 技术分类：")
            for cat, skills in parsed_jd["keywords"].items():
                lines.append(f"- {cat}: {', '.join(skills)}")

        if parsed_jd["experience_req"]:
            lines.append("\n### 经验要求：")
            for req in parsed_jd["experience_req"]:
                lines.append(f"- {req}")

        return "\n".join(lines)

    def save_jd_cache(self, job_id, parsed_jd):
        cache_path = os.path.join(JD_CACHE_DIR, f"jd_{job_id}.json")
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(parsed_jd, f, ensure_ascii=False, indent=2)

    def load_jd_cache(self, job_id):
        cache_path = os.path.join(JD_CACHE_DIR, f"jd_{job_id}.json")
        if os.path.exists(cache_path):
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None
