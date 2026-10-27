"""
用 resume-engine 的 md 生成代码（md_generator 渲染管线）重新生成「个人简历」标准版 md。

流程：build_base_parts() -> _render_internships / _render_core_skills -> assemble_resume()
直接走引擎代码路径，不做 JD 优化（通用简历），输出到 个人简历/原版简历.md。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import md_generator

OUT_PATH = r"C:\Users/<你的Windows用户名>\Desktop\秋招文件\个人简历\原版简历.md"


def main():
    base = md_generator.build_base_parts()
    internship_md = md_generator._render_internships(base["internships"])
    core_md = md_generator._render_core_skills(base["core_skills"])
    final_md = md_generator.assemble_resume(
        base["header"], base["education"], internship_md, core_md, base["cert"]
    )

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(final_md)
    print(f"[ok] 已生成: {OUT_PATH}")
    print(f"[info] 实习段数: {len(base['internships'])}")
    for it in base["internships"]:
        print(f"  - {it['company']} | {it['role']} | {it['period']} | {len(it.get('projects', []))} 个项目")


if __name__ == "__main__":
    main()
