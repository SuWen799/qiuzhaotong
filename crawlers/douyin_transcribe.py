# -*- coding: utf-8 -*-
"""
crawlers/douyin_transcribe.py
用 faster-whisper 把抖音音轨转成带时间戳的中文逐字稿。

用法: python douyin_transcribe.py <音频文件> [输出txt]
环境变量: WHISPER_MODEL=small|medium|base  (默认 small)
"""
import os
import sys

from faster_whisper import WhisperModel

audio = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else None
model_size = os.environ.get("WHISPER_MODEL", "small")

print("LOADING_MODEL:", model_size, flush=True)
model = WhisperModel(model_size, device="cpu", compute_type="int8")

# 给模型一点领域上下文，能明显改善专有名词与断句
PROMPT = (
    "以下是关于 AI Agent 项目架构的中文技术讲解，涉及数据层、知识库、RAG、"
    "agent runtime、agent loop、Harness、工具调用、Eval 评测、goodcase、badcase、"
    "自进化、上下文工程、秋招等术语。"
)

segments, info = model.transcribe(
    audio,
    language="zh",
    beam_size=5,
    vad_filter=True,
    initial_prompt=PROMPT,
)
print("DURATION_SEC:", round(info.duration, 1), flush=True)

lines = []
for s in segments:
    ts = "[%02d:%02d]" % (int(s.start // 60), int(s.start % 60))
    line = "%s %s" % (ts, s.text.strip())
    lines.append(line)
    print(line, flush=True)

text = "\n".join(lines)
if out_path:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
    print("SAVED:", out_path, flush=True)
print("SEGMENTS:", len(lines), flush=True)
