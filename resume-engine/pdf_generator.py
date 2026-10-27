"""
PDF生成器 - Playwright 本地生成（复刻旧版「自动生成简历」渲染）

直接复用旧版系统的 HTML/CSS 模板与 Chromium 渲染管线，保证 PDF 版式
与旧版一模一样：
  - 字体 Microsoft YaHei / SimHei
  - 标题色 #1a3c5e，A4 边距 1.1cm 1.8cm
  - 基本信息以固定表格 + 头像渲染
  - 超长自动缩放（max_pages 页内）

使用 Playwright 自带的 Chromium（非系统 Edge），避免与用户正在使用的
Edge 浏览器冲突，同时避免 msedgewebview2 进程残留堆积导致后续生成卡死。

生命周期说明：
  - Java 后端通过 ProcessBuilder 每次启动新的 Python 子进程，
    因此每个请求都是「一次性」生成。这里使用 with-context 在生成后
    立即关闭浏览器并释放 Playwright 资源，确保子进程能够及时退出，
    避免 Java 端长时间阻塞在 proc.waitFor() 上。
"""

import re
import os
import base64
from playwright.sync_api import sync_playwright
from project_knowledge import PHOTO_PATH, PERSONAL_INFO


# 实习公司 logo 映射：公司名关键词 -> logo 文件基名（按 png/jpg/svg 优先级，官方图优先于占位 svg）
_COMPANY_LOGO_FILES = [
    ("示例公司A", "horizon"),
    ("示例公司B", "huolala"),
    ("示例公司C", "yonyou"),
    ("示例公司E", "digiwin"),
    ("示例公司D", "supermap"),
]
_LOGO_CACHE = {}


def _company_logo_html(title):
    """按 h3 标题中的公司名关键词返回内联 <img> logo（base64）；无匹配返回空串。"""
    if title in _LOGO_CACHE:
        return _LOGO_CACHE[title]
    logos_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logos")
    uri = ""
    for kw, base in _COMPANY_LOGO_FILES:
        if kw in title:
            for ext in ("png", "jpg", "jpeg", "svg"):
                path = os.path.join(logos_dir, f"{base}.{ext}")
                if os.path.exists(path):
                    mime = {"png": "image/png", "jpg": "image/jpeg",
                            "jpeg": "image/jpeg", "svg": "image/svg+xml"}[ext]
                    with open(path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    uri = f'<img class="company-logo" src="data:{mime};base64,{b64}" alt="{kw}"/>'
                    break
        if uri:
            break
    _LOGO_CACHE[title] = uri
    return uri


def md_to_html(md_content, include_photo=True):
    """将Markdown转换为HTML"""
    # 行内代码 `x` 是 MD 语法，PDF 里只保留内容（否则反引号会原样印出来）
    md_content = re.sub(r"`([^`]+)`", r"\1", md_content)
    lines = md_content.split("\n")
    html_parts = []
    in_table = False
    in_ul = False
    skip_until_hr = False
    in_honors = False  # 荣誉证书节标记：该节内的顶层列表用两列排版渲染

    # 处理头像
    photo_html = ""
    if include_photo and os.path.exists(PHOTO_PATH):
        with open(PHOTO_PATH, "rb") as f:
            photo_b64 = base64.b64encode(f.read()).decode()
        photo_html = f'<img src="data:image/jpeg;base64,{photo_b64}" class="photo" />'

    for line in lines:
        stripped = line.strip()

        # 如果处于跳过模式，直到遇到---
        if skip_until_hr:
            if stripped == "---":
                skip_until_hr = False
                html_parts.append("<hr/>")
            continue

        # 空行
        if not stripped:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if in_table:
                html_parts.append("</table>")
                in_table = False
            continue

        # 分隔线
        if stripped == "---":
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if in_table:
                html_parts.append("</table>")
                in_table = False
            html_parts.append("<hr/>")
            continue

        # 一级标题 - 跳过
        if stripped.startswith("# ") and not stripped.startswith("## "):
            continue

        # 二级标题
        if stripped.startswith("## "):
            title = stripped[3:].strip()
            title = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", title)
            if "基本信息" in title:
                html_parts.append(f"<h2>{title}</h2>")
                html_parts.append("<div class=\"basic-info\">")
                html_parts.append("<table>")
                p = PERSONAL_INFO
                html_parts.append(f"<tr><td class=\"label\">姓名</td><td class=\"value\">{p['name']}</td><td class=\"label\">性别</td><td class=\"value\">{p['gender']}</td><td rowspan=\"3\" class=\"photo-cell\">{photo_html}</td></tr>")
                html_parts.append(f"<tr><td class=\"label\">年龄</td><td class=\"value\">{p['age']}</td><td class=\"label\">籍贯</td><td class=\"value\">{p['hometown']}</td></tr>")
                html_parts.append(f"<tr><td class=\"label\">电话</td><td class=\"value\">{p['phone']}</td><td class=\"label\">邮箱</td><td class=\"value\">{p['email']}</td></tr>")
                html_parts.append("</table>")
                html_parts.append("</div>")
                skip_until_hr = True
                continue
            else:
                in_honors = "荣誉" in title
                in_edu = "教育" in title
                html_parts.append(f"<h2>{title}</h2>")
                continue

        # 三级标题（实习公司头部：公司名前注入 logo）
        if stripped.startswith("### "):
            in_honors = False
            in_edu = False
            title = stripped[4:].strip()
            title = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", title)
            logo_html = _company_logo_html(title)
            html_parts.append(f"<h3>{logo_html}{title}</h3>")
            continue

        # 普通表格行
        if "|" in stripped and stripped.startswith("|"):
            cells = [c.strip() for c in stripped.split("|")]
            if cells and not cells[0]:
                cells = cells[1:]
            if cells and not cells[-1]:
                cells = cells[:-1]

            if all(set(c) <= set("-: ") for c in cells):
                continue

            if not in_table:
                html_parts.append("<table>")
                in_table = True

            row_html = "<tr>"
            for cell in cells:
                cell = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", cell)
                row_html += f"<td>{cell}</td>"
            row_html += "</tr>"
            html_parts.append(row_html)
            continue
        else:
            if in_table:
                html_parts.append("</table>")
                in_table = False

        # Bullet point
        if stripped.startswith("- ") or stripped.startswith("* "):
            text = re.sub(r"^[-*]\s+", "", stripped)
            text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
            indent = len(line) - len(line.lstrip())
            if indent > 2:
                if not in_ul:
                    html_parts.append("<ul>")
                    in_ul = True
                html_parts.append(f"<li class=\"sub\">{text}</li>")
            else:
                if not in_ul:
                    # 荣誉证书节的两列排版（2×2）：其余节的列表不受影响
                    html_parts.append("<ul class=\"honors-cols\">" if in_honors else "<ul>")
                    in_ul = True
                html_parts.append(f"<li>{text}</li>")
            continue
        else:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False

        # 教育背景节：`**学校** | 方向（学历）| 时间` 渲染为三列对齐表格（学校左、方向中、时间右）
        if in_edu and stripped.count("|") >= 2 and not stripped.startswith("-"):
            parts = [p.strip() for p in stripped.split("|") if p.strip()]
            if len(parts) == 3:
                school = re.sub(r"\*\*(.+?)\*\*", r"\1", parts[0])
                html_parts.append(
                    '<table class="edu-table"><tr>'
                    f'<td class="edu-school"><b>{school}</b></td>'
                    f'<td class="edu-time">{parts[2]}</td>'
                    f'<td class="edu-major">{parts[1]}</td>'
                    '</tr></table>')
                continue

        # 普通段落（项目名整体加粗时用 proj-name 样式突出；支持「项目一：/ 项目二：」编号与单项目直书项目名两种写法）
        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", stripped)
        if text.startswith("<b>") and text.endswith("</b>"):
            html_parts.append(f'<p class="proj-name">{text}</p>')
        else:
            html_parts.append(f"<p>{text}</p>")

    if in_ul:
        html_parts.append("</ul>")
    if in_table:
        html_parts.append("</table>")

    return "\n".join(html_parts)


def generate_pdf(md_content, output_path, include_photo=True, max_pages=2):
    """生成PDF（默认强制控制在 max_pages 页内，超长自动缩放）"""
    html_body = md_to_html(md_content, include_photo=include_photo)

    html_full = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {{
    size: A4;
    margin: 0.9cm 1.5cm;
}}
body {{
    font-family: "Microsoft YaHei", "SimHei", "Helvetica Neue", Arial, sans-serif;
    font-size: 12.5px;
    line-height: 1.38;
    color: #222;
}}
h2 {{
    color: #1a3c5e;
    font-size: 15px;
    margin: 12px 0 5px 0;
    padding-bottom: 3px;
    border-bottom: 1.5px solid #1a3c5e;
}}
h3 {{
    color: #2c3e50;
    font-size: 14px;
    margin: 7px 0 3px 0;
}}
.company-logo {{
    height: 2.2em;
    width: auto;
    vertical-align: -0.3em;
    margin-right: 10px;
}}
.basic-info table {{
    width: 100%;
    border-collapse: collapse;
    margin: 5px 0;
}}
.basic-info td {{
    padding: 3px 7px;
    vertical-align: top;
    font-size: 13px;
}}
.basic-info td.label {{
    font-weight: bold;
    color: #333;
    white-space: nowrap;
}}
.basic-info td.value {{
    color: #444;
}}
.basic-info td.photo-cell {{
    text-align: center;
    vertical-align: middle;
}}
.basic-info .photo {{
    width: 70px;
    height: 90px;
    object-fit: cover;
    border-radius: 3px;
}}
table {{
    width: 100%;
    border-collapse: collapse;
    margin: 5px 0;
}}
td {{
    padding: 3px 7px;
    vertical-align: top;
    font-size: 13px;
}}
ul {{
    margin: 2px 0;
    padding-left: 16px;
}}
li {{
    margin: 1.5px 0;
    font-size: 13px;
}}
li.sub {{
    margin-left: 15px;
    list-style: circle;
}}
/* 荣誉证书 2×2 两列：条目纵向流（前两条在第一列、后两条在第二列），长项自然聚在第一列 */
ul.honors-cols {{
    columns: 2;
    column-gap: 28px;
}}
ul.honors-cols li {{
    break-inside: avoid;
}}
/* 教育背景三列对齐：学校左对齐加粗、时间居中列、研究方向（学历）右对齐到行尾 */
/* 两行是独立 table，必须 fixed 布局+固定列宽，否则 auto 按学校名长度分列导致时间列错位 */
table.edu-table {{
    width: 100%;
    table-layout: fixed;
}}
table.edu-table td {{
    border: none;
    padding: 2px 0;
    font-size: 13px;
}}
table.edu-table td.edu-school {{
    width: 35%;
    white-space: nowrap;
    padding-right: 14px;
}}
table.edu-table td.edu-time {{
    width: 30%;
    text-align: center;
    white-space: nowrap;
    color: #444;
}}
table.edu-table td.edu-major {{
    width: 35%;
    text-align: right;
    white-space: nowrap;
}}
p {{
    margin: 1.5px 0;
    font-size: 13px;
}}
p.proj-name {{
    color: #1a3c5e;
    font-size: 13.5px;
    font-weight: bold;
    margin: 8px 0 3px 0;
}}
hr {{
    border: none;
    border-top: 0.5px solid #ddd;
    margin: 7px 0;
}}
b {{
    color: #000;
}}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

    # 一次性生成：创建浏览器 → 渲染 → 导出 PDF → 立即关闭并释放资源。
    # with-context 保证 Playwright 线程/进程全部退出，子进程能够正常结束。
    # 防残留：二分搜索会向同一路径反复覆盖写入 PDF，Windows 下偶发旧文件句柄未释放、
    # 最终落盘文件停留在上一版本（内容比传入的 md 旧）。生成前先删旧文件，强制干净写入。
    if os.path.exists(output_path):
        try:
            os.remove(output_path)
        except OSError:
            pass
    with sync_playwright() as p:
        # 使用 Playwright 自带的 Chromium，避免与用户系统 Edge 冲突或残留 webview2。
        browser = p.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
        # 关键修复：先把视口宽度设为 A4 内容宽度（96dpi 下 793px - 左右边距各 1.8cm≈68px = 657px）。
        # 旧逻辑用浏览器默认宽视口测 document.body.scrollHeight，文字回行少、高度被严重低估
        # （如 234 简历估算 1.45 页，实际打印 3 页），导致永不该触发缩放。
        A4_W_PX = 793.0
        MARGIN_LR_MM = 15.0  # 1.5cm
        content_w = int(A4_W_PX - 2 * (MARGIN_LR_MM * 96.0 / 25.4))
        page = browser.new_page(viewport={"width": content_w, "height": 1123})
        try:
            page.set_content(html_full)
            # A4 每页可用内容高度（96dpi）：1123px - 上下边距(各约34px, 0.9cm) ≈ 1055px
            usable_h = 1055.0
            content_h = page.evaluate("() => document.body.scrollHeight")
            est_pages = content_h / usable_h

            # 缩放策略（最终版）：二分搜索「能塞进 max_pages 页的最大 scale」。
            # scale 越大 → 内容被拉伸越多 → 页数越多（单调）。因此「最大的、仍满足
            # 页数 <= max_pages 的 scale」就是把 max_pages 页填得最满的 scale。
            #   - 内容天然不足 max_pages：会一路放大到 MAX_SCALE（封顶，避免字号过大）；
            #   - 内容天然超出 max_pages：会缩小到刚好 2 页。
            # 之前 0.647 的根因：用的是「页数比值」(2/3) 而非「内容高度比值」，导致轻微
            # 溢出（约 2.1 页）被错误地砍成 2/3，第 2 页反而更空；正确填 2 页的 scale≈0.95。
            MAX_SCALE = 1.12  # 向上缩放填满 2 页时字号上限（避免比原版过大）
            MIN_SCALE = 0.5

            def _render_and_count(s):
                page.pdf(
                    path=output_path,
                    format="A4",
                    margin={"top": "0.9cm", "bottom": "0.9cm", "left": "1.5cm", "right": "1.5cm"},
                    print_background=True,
                    scale=s,
                )
                return _count_pdf_pages(output_path)

            # 二分：在 [MIN_SCALE, MAX_SCALE] 内找最大的、页数仍 <= max_pages 的 scale
            lo, hi = MIN_SCALE, MAX_SCALE
            best = None
            for _ in range(20):
                mid = (lo + hi) / 2.0
                if _render_and_count(mid) <= max_pages:
                    best = mid
                    lo = mid  # 还能更大，继续往上探
                else:
                    hi = mid  # 超页了，需要更小
            scale = best if best is not None else MIN_SCALE
            # 循环最后一次渲染落在某个 mid 上，未必等于 best；
            # 这里显式用最终 scale 再渲染一次，保证磁盘 PDF 与 scale 完全一致。
            page.pdf(
                path=output_path,
                format="A4",
                margin={"top": "0.9cm", "bottom": "0.9cm", "left": "1.5cm", "right": "1.5cm"},
                print_background=True,
                scale=scale,
            )
            print("== resume pdf scale:", round(scale, 3), "est_pages:", round(est_pages, 3))
        finally:
            try:
                page.close()
            finally:
                browser.close()

    return output_path


def _count_pdf_pages(path):
    """返回 PDF 实际页数（pymupdf 权威计数；不可用再退回 pypdf / 正则兜底）。"""
    try:
        import fitz
        return fitz.open(path).page_count
    except Exception:
        try:
            import pypdf
            return len(pypdf.PdfReader(path).pages)
        except Exception:
            try:
                import re
                data = open(path, "rb").read().decode("latin-1", "ignore")
                # 页面节点 = 含 /Type /Page 但不含 /Type /Pages 的对象
                return len(re.findall(r"/Type\s*/Page[^s]", data))
            except Exception:
                return 1
