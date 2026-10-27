# 秋招通 API 契约与前端规范（供子 agent 开发用）

> 后端 base: http://127.0.0.1:8080/api
> 鉴权: Authorization: Bearer <token> (登录后所有请求携带)
> 插件接口: 免 JWT，用 ?token=<plugin_token> 鉴权

## 1. 认证
- POST /auth/login  {username, password} -> {token, username}
- GET  /auth/me  (Authorization) -> {username}

## 2. 官网汇总 (companies)
- GET /companies?keyword=&type=&industry=&recruitTarget=&recruitType=&deadline=&status=&sort=&page=&size=
      -> {content:[Company], total, page, size}
- GET /companies/stats -> {total, byStatus, ...}
- GET /companies/daily -> [DailyStat]
- PUT /companies/{id}/status {status, applyDate, note} -> ok
- POST /companies/crawl  (触发手动爬取，异步) -> {taskId}
- GET  /companies/crawl/status -> {running, lastRun}

## 3. 简历生成 (resume)
- POST /resume/generate {jdText, company, useLlm?} -> {outputName, mdPath, pdfPath, jdSummary, matchedSkills, coverage, match}
- GET  /resume/base -> [ResumeBase]
- PUT  /resume/base/{section} {content} -> ok
- GET  /resume/versions -> [ResumeVersion]
- GET  /resume/versions/{id} -> ResumeVersion
- DELETE /resume/versions/{id} -> ok
- GET  /resume/versions/{id}/download?type=md|pdf -> file

## 4. 参考素材 (references)
- GET  /references?category=&keyword= -> [ReferenceFile]
- POST /references/upload (multipart: file, category, note) -> ReferenceFile
- GET  /references/{id}/download -> file
- GET  /references/{id}/content -> {content}  (读取文本)
- DELETE /references/{id} -> ok

## 5. 设置 (settings)
- GET  /settings -> {key:value,...}  (仅 LLM 相关 + crawl 开关)
- PUT  /settings {key, value} -> ok  (批量或单条)

## 6. 插件管理 (plugin, 免JWT+token参数)
- GET /plugin/resume-version?company=&token= -> {company, variableModules, baseSnapshot}
- GET /plugin/versions?token= -> [{company, jobId, createdAt}]
- GET /plugin/token (需JWT) -> {token}
- GET /plugin/profile -> 在线编辑用的全量 profile JSON（基础+版本）
- PUT /plugin/profile (需JWT) {profile} -> ok

## 前端页面清单（Vue3 + Element Plus）
路由(侧边栏):
- /login (登录，无布局)
- / (重定向到 /dashboard 或 /companies)
- /companies (官网汇总: 内部 3 子页 Tab: 企业列表 / 趋势统计 / 投递统计)
- /resume/generate (简历生成)
- /resume/base (基础档案维护)
- /resume/versions (简历版本库)
- /references (参考素材管理)
- /plugin (插件管理: 资料编辑 / 版本浏览 / 识别说明 / 令牌)
- /settings (LLM与系统设置)

布局: 左侧边栏(Logo"秋招通" + 菜单) + 顶栏(用户/退出) + 内容区
技术: Vue3 + Vite + Element Plus + Vue Router + Pinia + Axios(拦截器带token)
Axios baseURL: http://127.0.0.1:8080/api

## Python 引擎调用约定 (resume-engine/)
Spring Boot 通过 ProcessBuilder 调用:
  python resume_engine/main.py --jd-file <path> --company <name> --output-dir <dir> --config <json>
或传 jd 文本:
  python resume_engine/main.py --jd-text "..." --company <name> --output-dir <dir>
输出: 在 output-dir 生成 <name>.md 和 <name>.pdf，并打印一行 JSON:
  {"md_file":"...","pdf_file":"...","jd_summary":"...","variable_modules":{...},"match_score":N,"coverage":{...}}
variable_modules 结构: {"internship":[...], "project":[...], "core_skills":[...]}
参考素材读取: resume-engine 从 <uploads>/references/ 读取最新参考 MD/JSON
