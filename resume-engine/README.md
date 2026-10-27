# 简历自动生成引擎（resume-engine）

一套根据岗位 JD 自动优化简历、生成 Markdown 与 PDF 的 Python 引擎，**去 Flask 化**，
作为命令行工具被 Spring Boot 后端通过 `ProcessBuilder` 调用。

> 原系统「自动生成简历」（Flask 版）已弃用，本目录为其迁移整合版。

---

## 目录结构

```
resume-engine/
├── main.py              # 命令行入口（唯一被 Java 调用的入口）
├── config.py            # 路径/字体/LLM 配置（LLM 改从环境变量读取）
├── jd_parser.py         # JD 解析、关键词提取
├── md_generator.py      # MD 简历生成（LLM / 规则优化、variable_modules）
├── pdf_generator.py     # PDF 渲染（reportlab，中文需字体）
├── resume_match.py      # 匹配度 / 覆盖度计算
├── project_knowledge.py # 参考素材加载（从 REFERENCES_DIR 读取）
├── 参考素材/            # 内置兜底素材（个人信息/教育/核心能力/实习/证书/证件照）
├── requirements.txt
└── README.md
```

---

## 运行方式

```bash
# 用环境变量注入 LLM 配置（由 Spring Boot 注入，也可本地测试时手动设置）
export RESUME_LLM_API_KEY="ak-xxxx"
export RESUME_LLM_BASE_URL="https://api.xxx/openai/v1"
export RESUME_LLM_MODEL="your-model"
export RESUME_LLM_TEMPERATURE="0.3"
export REFERENCES_DIR="D:/qiuzhaohub/uploads/references"   # 前端上传管理的参考素材目录

python main.py --jd-text "<JD文本>" --company "测试公司" --output-dir "D:/tmp/out" --use-llm
# 或
python main.py --jd-file "jd.txt" --company "测试公司" --output-dir "D:/tmp/out" --use-llm
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--jd-text` | 二选一 | 岗位 JD 文本 |
| `--jd-file` | 二选一 | JD 文件路径（utf-8） |
| `--company` | 是 | 公司名，用于生成 `<公司名>.md` / `<公司名>.pdf` |
| `--output-dir` | 是 | 输出目录（自动创建） |
| `--use-llm` | 否 | 启用 LLM 优化；**未配置 key 时自动回退规则兜底**（关键词加粗），仍正常生成 |
| `--llm-api-key/--llm-base-url/--llm-model/--llm-temperature` | 否 | 命令行覆盖 LLM 配置（优先级高于环境变量） |

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `RESUME_LLM_API_KEY` | LLM API Key | 无 |
| `RESUME_LLM_BASE_URL` | LLM 兼容 OpenAI 的 base_url | 无 |
| `RESUME_LLM_MODEL` | 模型名 | 无 |
| `RESUME_LLM_TEMPERATURE` | 采样温度 | 0.3 |
| `REFERENCES_DIR` | 参考素材目录（优先级最高） | `D:\qiuzhaohub\uploads\references`；不存在则回退内置 `参考素材/` |

---

## 输出契约（stdout 一行 JSON）

进程结束前，**向 stdout 打印一行纯 JSON**（其余日志均打到 stderr）：

```json
{
  "md_file": "<公司名>.md",
  "pdf_file": "<公司名>.pdf 或 null",
  "jd_summary": "<岗位方向摘要>",
  "variable_modules": {
    "internship": [ ... 优化后的实习经历（结构化） ... ],
    "project":    [ ... 扁平化后的项目经历 ... ],
    "core_skills": { "technical": [...], "soft": [...] }
  },
  "match_score": 87,
  "coverage": {
    "covered": ["python", "rag", ...],
    "not_covered": ["kubernetes", ...],
    "coverage_rate": "12/15"
  }
}
```

- `variable_modules` 为按该公司 JD 优化后的最终内容，Spring Boot 存入 `resume_versions.variable_modules` 字段。
- PDF 因字体缺失等原因失败时，`pdf_file` 置 `null`，**不影响 MD 生成**，错误信息在 stderr。

---

## 依赖安装

```bash
pip install -r requirements.txt
```

PDF 中文需要系统中文字体（自动探测 `C:\Windows\Fonts\simhei.ttf` / `msyh.ttc`）；
若服务器无中文字体，请将 `simhei.ttf` 放到引擎 `fonts/` 目录，或安装相应字体包。

---

## 与原项目差异

- 移除 Flask / Playwright / 浏览器依赖，PDF 改用 `reportlab` 直接渲染。
- LLM 配置不再写死，改为环境变量 + 命令行参数。
- 参考素材从 `REFERENCES_DIR`（前端上传目录）读取，内置 `参考素材/` 作为兜底。
- 实习/项目/核心能力三类「随 JD 变化」模块均支持 LLM 优化，并结构化回写 `variable_modules`。
- 所有进度日志走 stderr，stdout 仅保留一行 JSON 契约。
