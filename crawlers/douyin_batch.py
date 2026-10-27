# -*- coding: utf-8 -*-
"""
crawlers/douyin_batch.py
抖音批量流水线：批量抓页面 -> 逐条下音频轨 -> 批量转写逐字稿。

用法:
  python douyin_batch.py --list links.txt --out <输出目录> [--model <ASR模型目录>] [--no-asr] [--only-asr]

links.txt: 每行一个抖音链接（v.douyin.com 短链或 douyin.com/video/ 长链均可），
           "#" 开头为注释；一行里带备注文字也可以，会自动取其中的 http 链接。

阶段产物（均在 --out 下）:
  <awemeId>.json / .png      页面元数据与截图
  <awemeId>.audio.mp4        音轨（转写用）
  <awemeId>.transcript.txt   原始逐字稿（带时间戳）
  cookies.txt                浏览器导出的 cookie
  _summary.json / _batch_report.json   过程与汇总
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
NODE = "C:/Users/<你的Windows用户名>/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
NODE_MODULES = os.path.join(HERE, "node_modules")
PY = sys.executable
DEFAULT_MODEL = os.path.join(REPO, "outputs", "douyin", "model", "faster-whisper-small")


def log(*a):
    print(*a, flush=True)


def run(cmd, env=None, cwd=None, quiet_ok=True):
    """跑子进程；失败时把尾部输出打出来便于定位"""
    r = subprocess.run(cmd, env=env, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        log("  ! returncode", r.returncode)
        if r.stdout:
            log("  stdout tail:", r.stdout.strip()[-800:])
        if r.stderr:
            log("  stderr tail:", r.stderr.strip()[-800:])
    return r


def read_urls(path):
    urls, seen = [], set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.search(r"https?://\S+", line)
            if not m:
                continue
            u = m.group(0).rstrip("，,;；。)")
            if u not in seen:
                seen.add(u)
                urls.append(u)
    return urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True, help="链接列表 txt")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--model", default=os.environ.get("DOUYIN_ASR_MODEL", DEFAULT_MODEL))
    ap.add_argument("--no-asr", action="store_true", help="只抓取+下音频，不转写")
    ap.add_argument("--only-asr", action="store_true", help="跳过抓取，直接对已有音频转写")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    urls = read_urls(args.list)
    log("LINKS:", len(urls))
    if not urls and not args.only_asr:
        log("没有解析到任何链接，退出")
        return

    env = dict(os.environ)
    env["NODE_PATH"] = NODE_MODULES

    # ---------- 阶段 1：批量抓页面 ----------
    if not args.only_asr:
        log("=== [1/3] 抓取页面（单次浏览器会话） ===")
        cmd = [NODE, os.path.join(HERE, "douyin_fetch_multi.js"), out] + urls
        run(cmd, env=env, cwd=HERE)

    summary_path = os.path.join(out, "_summary.json")
    summary = []
    if os.path.exists(summary_path):
        with open(summary_path, encoding="utf-8") as f:
            summary = json.load(f)
    elif args.only_asr:
        # only-asr 模式下从已有 json 反推
        for fn in os.listdir(out):
            if fn.endswith(".json") and not fn.startswith("_"):
                summary.append({"awemeId": fn[:-5], "error": None})

    ok = [s for s in summary if not s.get("error") and s.get("awemeId")]
    log("可用视频:", len(ok))

    cookies = os.path.join(out, "cookies.txt")

    # ---------- 阶段 2：下音频轨 ----------
    if not args.only_asr:
        log("=== [2/3] 下载音轨 ===")
        for s in ok:
            vid = s["awemeId"]
            jf = os.path.join(out, vid + ".json")
            af = os.path.join(out, vid + ".audio.mp4")
            if os.path.exists(af) and os.path.getsize(af) > 10240:
                log("  跳过（已存在）", vid)
                s["audio"] = af
                continue
            r = run([PY, os.path.join(HERE, "douyin_download.py"), jf, af, cookies, "--audio"], cwd=HERE)
            s["audio"] = af if os.path.exists(af) and os.path.getsize(af) > 10240 else None
            log("  ", vid, "audio:", "OK" if s["audio"] else "FAIL")

    # ---------- 阶段 3：转写 ----------
    if not args.no_asr:
        log("=== [3/3] 转写 ===")
        if not os.path.isdir(args.model):
            log("  ! 模型目录不存在:", args.model)
        for s in ok:
            vid = s["awemeId"]
            af = s.get("audio") or os.path.join(out, vid + ".audio.mp4")
            tf = os.path.join(out, vid + ".transcript.txt")
            if os.path.exists(tf) and os.path.getsize(tf) > 50:
                log("  跳过（已存在）", vid)
                s["transcript"] = tf
                continue
            if not os.path.exists(af):
                log("  ! 缺音频，跳过", vid)
                continue
            env2 = dict(env)
            env2["HF_HUB_OFFLINE"] = "1"
            env2["WHISPER_MODEL"] = args.model
            r = run([PY, os.path.join(HERE, "douyin_transcribe.py"), af, tf], env=env2, cwd=HERE)
            s["transcript"] = tf if os.path.exists(tf) and os.path.getsize(tf) > 50 else None
            log("  ", vid, "transcript:", "OK" if s["transcript"] else "FAIL")

    with open(os.path.join(out, "_batch_report.json"), "w", encoding="utf-8") as f:
        json.dump({"links": len(urls), "videos": summary}, f, ensure_ascii=False, indent=2)

    log("=== 完成 ===")
    log("输出目录:", out)
    for s in summary:
        log("  %-22s %s" % (s.get("awemeId", "?"), (s.get("title") or s.get("error") or "")[:60]))


if __name__ == "__main__":
    main()
