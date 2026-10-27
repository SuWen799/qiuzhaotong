# -*- coding: utf-8 -*-
"""
crawlers/douyin_download.py
从 douyin_fetch.js 产出的 JSON 里取出视频直链并下载（带 Referer / Cookie，否则 CDN 403）。

用法: python douyin_download.py <fetch产出的json> <输出mp4> [cookies.txt]
"""
import json
import os
import sys
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def load_cookie_header(path):
    """把 Netscape cookies.txt 压成一个 Cookie 请求头"""
    jar = {}
    if not path or not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                jar[parts[5]] = parts[6]
    return "; ".join("%s=%s" % (k, v) for k, v in jar.items())


def pick_url(obj, track="video"):
    """抖音 web 走 DASH，音视频是分离的两条流，分别按 media-video / media-audio 匹配"""
    media = obj.get("netMedia") or []
    want = "media-audio" if track == "audio" else "media-video"
    for u in media:
        if want in u:
            return u
    for u in media:
        if ".mp4" in u or "douyinvod" in u:
            return u
    for u in obj.get("playUrls") or []:
        if "douyin_pc_client" in u:  # 客户端下载广告，跳过
            continue
        return u
    return None


def fetch(url, out, cookie_header):
    headers = {"User-Agent": UA, "Referer": "https://www.douyin.com/", "Accept": "*/*"}
    if cookie_header:
        headers["Cookie"] = cookie_header
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(data)
    return data


def main():
    track = "audio" if "--audio" in sys.argv else "video"
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    json_path, out_path = pos[0], pos[1]
    ck_path = pos[2] if len(pos) > 2 else None

    with open(json_path, encoding="utf-8") as f:
        obj = json.load(f)

    url = pick_url(obj, track)
    print("TRACK:", track)
    if not url:
        print("NO_URL_FOUND")
        sys.exit(1)

    print("URL:", url[:160])
    ck = load_cookie_header(ck_path)
    print("COOKIE_HEADER_LEN:", len(ck))

    data = fetch(url, out_path, ck)
    print("SIZE_BYTES:", len(data))
    print("SIZE_MB:", round(len(data) / 1048576, 2))
    print("HEAD_HEX:", data[:24].hex())
    print("SAVED:", out_path)


if __name__ == "__main__":
    main()
