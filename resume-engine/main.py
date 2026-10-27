"""
简历自动生成引擎 - 命令行入口（供 Spring Boot 通过 ProcessBuilder 调用）

调用约定：
    python main.py --jd-text "<JD文本>" --company "<公司名>" --output-dir "<输出目录>" [--use-llm]
    python main.py --jd-file "<jd文件路径>" --company "<公司名>" --output-dir "<输出目录>" [--use-llm]

环境变量：
    RESUME_LLM_API_KEY / RESUME_LLM_BASE_URL / RESUME_LLM_MODEL / RESUME_LLM_TEMPERATURE  (LLM 配置，由 Spring Boot 注入)
    REFERENCES_DIR  (参考素材目录，默认 D:/qiuzhaohub/uploads/references)

输出契约：
    - 所有日志打印到 stderr
    - 进程结束前，向 stdout 打印**一行纯 JSON**：
      {"md_file":..., "pdf_file":..., "jd_summary":..., "variable_modules":{...}, "match_score":..., "coverage":{...}}
"""

import os
import sys
import json
import argparse

# 让相对 import 稳定
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 确保 stdout 以 UTF-8 输出（Windows 下默认可能是 GBK，会导致中文文件名/内容在跨进程解析时乱码）。
# ProcessBuilder 端也会注入 PYTHONIOENCODING=utf-8 作为双保险。
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from config import load_llm_config, REFERENCES_DIR
import jd_parser
import md_generator
import project_knowledge as pk
import resume_match
from pdf_generator import generate_pdf


def _log(*args):
    print(*args, file=sys.stderr)


def _read_jd(args):
    if args.jd_file:
        with open(args.jd_file, "r", encoding="utf-8") as f:
            return f.read()
    if args.jd_text:
        return args.jd_text
    raise SystemExit("必须提供 --jd-text 或 --jd-file")


def main():
    parser = argparse.ArgumentParser(description="简历自动生成引擎")
    parser.add_argument("--jd-text", help="JD 文本")
    parser.add_argument("--jd-file", help="JD 文件路径")
    parser.add_argument("--company", required=True, help="公司名（用于文件命名）")
    parser.add_argument("--output-dir", required=True, help="输出目录")
    parser.add_argument("--use-llm", action="store_true", help="启用 LLM 优化（缺 key 自动回退规则）")
    # 可选的 LLM 覆盖参数（优先级高于环境变量）
    parser.add_argument("--llm-api-key", default=None)
    parser.add_argument("--llm-base-url", default=None)
    parser.add_argument("--llm-model", default=None)
    parser.add_argument("--llm-temperature", default=None)
    args = parser.parse_args()

    jd_text = _read_jd(args)
    company = args.company
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    # 1) LLM 配置（环境变量 + 命令行覆盖）
    llm_cfg = load_llm_config(override={
        "api_key": args.llm_api_key,
        "base_url": args.llm_base_url,
        "model": args.llm_model,
        "temperature": args.llm_temperature,
    })
    use_llm = bool(args.use_llm and llm_cfg.get("api_key") and llm_cfg.get("base_url") and llm_cfg.get("model"))
    if args.use_llm and not use_llm:
        _log("[warn] 指定了 --use-llm 但 LLM 配置不完整，自动回退规则优化。")

    # 2) 解析 JD
    _log("[1/5] 解析 JD ...")
    jd_parsed = jd_parser.JDParser().parse_jd(jd_text)
    jd_summary = jd_parsed.get("summary", "")
    jd_keywords = jd_parsed.get("all_skills", [])
    _log(f"  方向: {jd_summary} | 关键词 {len(jd_keywords)} 个")

    # 3) 基础（稳定）部分 + 原始数据
    _log("[2/5] 加载参考素材 ...")
    base = md_generator.build_base_parts()

    # 4) 按 JD 优化「变化模块」
    _log("[3/5] 优化变化模块（实习/项目/核心能力）...")
    if use_llm:
        # 两段 LLM 优化互相独立，并行执行以缩短总耗时（单段约 15s，串行≈32s 易触发前端超时）
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as _ex:
            _f_int = _ex.submit(
                md_generator.llm_optimize_internships,
                base["internships"], jd_text, jd_keywords, llm_cfg)
            _f_core = _ex.submit(
                md_generator.llm_optimize_core_skills,
                base["core_skills"], jd_text, jd_keywords, llm_cfg)
            opt_internships = _f_int.result()
            opt_core = _f_core.result()
    else:
        opt_internships = md_generator.rule_based_optimize_internships(
            base["internships"], jd_keywords)
        opt_core = base["core_skills"]

    # 计算原 base 项目的总数量，flatten 时硬截断用（防 LLM 拆条）
    orig_projects_count = sum(len(i.get('projects', [])) for i in base["internships"])
    # 项目经验补充素材（来自 materialDir 自动转的 md），按同名合并到 base projects，
    # 不增加项目条数，保证奥比中光等定制版字段数与原版一致（176）。
    project_extras = pk.load_project_extras() if hasattr(pk, 'load_project_extras') else []
    projects = md_generator.flatten_projects(opt_internships, orig_projects_count, project_extras)

    internship_md = md_generator._render_internships(opt_internships)
    core_md = md_generator._render_core_skills(opt_core)

    # 5) 组装最终 MD
    final_md = md_generator.assemble_resume(
        base["header"], base["education"], internship_md, core_md, base["cert"])

    md_filename = f"{company}.md"
    md_path = os.path.join(output_dir, md_filename)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(final_md)
    _log(f"  MD 已生成: {md_path}")

    # 6) 生成 PDF（失败不中断，pdf_file 置 null）
    _log("[4/5] 生成 PDF ...")
    pdf_filename = None
    pdf_path = os.path.join(output_dir, f"{company}.pdf")
    try:
        generate_pdf(final_md, pdf_path, include_photo=True)
        pdf_filename = f"{company}.pdf"
        _log(f"  PDF 已生成: {pdf_path}")
    except Exception as e:
        _log(f"[error] PDF 生成失败（MD 已保留）: {e}")
        pdf_filename = None

    # 7) 匹配度 + 覆盖率
    _log("[5/5] 计算匹配度与覆盖度 ...")
    match = resume_match.compute_match(jd_text, jd_parsed, base_md=final_md)
    match_score = match.get("match_percent", 0)

    covered = [m["keyword"] for m in match.get("matched_keywords", [])]
    not_covered = [g["keyword"] for g in match.get("gap_keywords", [])]
    total = len(covered) + len(not_covered)
    coverage_rate = f"{len(covered)}/{total}" if total else "0/0"

    # 8) 输出契约 JSON（仅 stdout）
    result = {
        "md_file": md_filename,
        "pdf_file": pdf_filename,
        "md_content": final_md,
        "jd_summary": jd_summary,
        "variable_modules": {
            "internship": opt_internships,
            "project": projects,
            "core_skills": opt_core,
        },
        "match_score": match_score,
        "coverage": {
            "covered": covered,
            "not_covered": not_covered,
            "coverage_rate": coverage_rate,
        },
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")


def _cleanup_children():
    """退出前强制清理当前 Python 进程的所有子进程（主要是 Playwright 残留的 Chromium）。

    Playwright 在 Windows 上偶尔无法完全清理浏览器子进程，残留会导致后续生成
    越来越慢甚至超时。这里用 psutil 在进程退出前兜底杀掉所有子进程。
    """
    try:
        import psutil
    except ImportError:
        return
    try:
        me = psutil.Process()
        for child in me.children(recursive=True):
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        _, still_alive = psutil.wait_procs(me.children(recursive=True), timeout=3)
        for child in still_alive:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    finally:
        _cleanup_children()
