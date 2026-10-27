"""驱动：复用 resume-engine 的 pdf_generator 生成 原版简历.pdf
- 基本信息 / 照片由 project_knowledge.PERSONAL_INFO + 证件照.jpg 自动注入
- 实习项目内容来自 个人简历/简历参考.md（已注入本 md）
- 格式（CSS/版式）与参考系统完全一致
"""
import os
import sys

# 让 import pdf_generator / project_knowledge 能解析
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from pdf_generator import generate_pdf, md_to_html

MD_PATH = r"C:\Users/<你的Windows用户名>\Desktop\秋招文件\个人简历\原版简历.md"
OUT_PATH = r"C:\Users/<你的Windows用户名>\Desktop\秋招文件\个人简历\原版简历.pdf"

with open(MD_PATH, encoding="utf-8") as f:
    md = f.read()

print("== markdown 字符数:", len(md))
out = generate_pdf(md, OUT_PATH, include_photo=True, max_pages=2)
print("== PDF 已生成:", out, "存在:", os.path.exists(out))
print("== 大小(bytes):", os.path.getsize(out) if os.path.exists(out) else 0)
