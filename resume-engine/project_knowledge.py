"""
项目经历知识库 - 从 JSON 参考素材文件读取

参考素材目录由 config.REFERENCES_DIR 决定（优先环境变量，回退内置目录）。
"""

import os
import re
import json

from config import REFERENCES_DIR

# 参考素材文件夹路径（运行时由 config 解析）
REF_DIR = REFERENCES_DIR
# 内置兜底目录（与本文件同级的 参考素材/），用于 REFERENCES_DIR 缺某个文件时二级回退
DEFAULT_REF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "参考素材")
INTERNSHIP_DIR = os.path.join(REF_DIR, "实习经历")
PROJECT_EXTRAS_DIR = os.path.join(REF_DIR, "项目经验")  # 2026-08-24 新增：项目介绍 md 自动同步到这里
CERT_DIR = os.path.join(REF_DIR, "证书")

# 头像路径
PHOTO_PATH = os.path.join(REF_DIR, "证件照.jpg")


def load_json(filename, subdir=""):
    """加载 JSON 文件。

    二级回退：先在用户 REFERENCES_DIR 找，缺则静默到内置 DEFAULT_REF_DIR 找。
    这样用户在用户目录只上传/编辑了部分素材（缺核心能力/证书等）时，缺失项
    自动用内置兜底，不会渲染出空段（如「荣誉证书」/「软技能」空白）。
    """
    primary = os.path.join(REF_DIR, subdir, filename) if subdir else os.path.join(REF_DIR, filename)
    if os.path.exists(primary):
        with open(primary, "r", encoding="utf-8") as f:
            return json.load(f)
    fallback = os.path.join(DEFAULT_REF_DIR, subdir, filename) if subdir else os.path.join(DEFAULT_REF_DIR, filename)
    if os.path.exists(fallback):
        with open(fallback, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_json(data, filename, subdir=""):
    """保存 JSON 文件"""
    filepath = os.path.join(REF_DIR, subdir, filename) if subdir else os.path.join(REF_DIR, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_personal_info():
    """加载个人信息"""
    return load_json("个人信息.json") or {
        "name": "张三",
        "gender": "男",
        "age": "23岁",
        "hometown": "示例城市A",
        "phone": "13900000000",
        "email": "zhangsan@example.com"
    }


def load_education():
    """加载教育背景"""
    return load_json("教育背景.json") or []


def load_core_skills():
    """加载核心能力"""
    return load_json("核心能力.json") or {"technical": [], "soft": []}


def load_certificates():
    """加载荣誉证书"""
    return load_json("荣誉证书.json", subdir="证书") or []


def _parse_period_start(period):
    """从 'YYYY.MM ~ YYYY.MM' 解析起始日期，用于按时间倒序排序。"""
    if not period:
        return (0, 0)
    first = period.split("~")[0].strip()
    m = re.search(r"(\d{4})\.(\d{1,2})", first)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (0, 0)


def load_internships():
    """加载所有实习经历（按开始时间倒序：最新的排在前面）"""
    internships = []
    if os.path.exists(INTERNSHIP_DIR):
        for filename in sorted(os.listdir(INTERNSHIP_DIR)):
            if filename.endswith(".json"):
                data = load_json(filename, subdir="实习经历")
                if data:
                    internships.append(data)
    internships.sort(key=lambda d: _parse_period_start(d.get("period", "")), reverse=True)
    return internships


def load_project_extras():
    """加载「项目经验/」目录下（含子文件夹，递归）的所有 json 补充素材。

    与后端 syncMaterialMdToReferences 的递归同步保持一致：用户按公司建子目录存放
    的项目介绍 md，会同步成 项目经验/<公司>/<文件名>.json，此处递归读取全部。
    返回 list[dict]，每个元素是单个项目 {name, techStack, description, highlights[]}。
    在 flatten_projects 时会与 base 实习的项目按名称相似度合并，**不增加**项目条数。"""
    extras = []
    if not os.path.isdir(PROJECT_EXTRAS_DIR):
        return extras
    for root, _dirs, files in os.walk(PROJECT_EXTRAS_DIR):
        for filename in sorted(files):
            if not filename.endswith(".json"):
                continue
            # 以「项目经验/」为基准的相对路径（正斜杠），load_json 据此拼出嵌套文件真实路径
            rel = os.path.relpath(os.path.join(root, filename), PROJECT_EXTRAS_DIR).replace("\\", "/")
            data = load_json(rel, subdir="项目经验")
            if isinstance(data, dict) and data.get("name"):
                extras.append(data)
    return extras


def load_all_data():
    """加载所有数据"""
    return {
        "personal": load_personal_info(),
        "education": load_education(),
        "core_skills": load_core_skills(),
        "certificates": load_certificates(),
        "internships": load_internships(),
        "project_extras": load_project_extras(),
    }

# 个人信息快捷访问
PERSONAL_INFO = load_personal_info()
