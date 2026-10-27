# 秋招通 QiuzhaoHub

> 把「公司官网汇总」「JD 驱动简历自动生成」「浏览器简历智能填充」三大秋招工具整合为一体的个人求职辅助系统。
> 后端 Java Spring Boot 3.3.4 + PostgreSQL 17；前端 Vue3 + Vite；简历引擎 Python；浏览器插件 Chrome MV3；爬虫桥接 Node.js。

```
公司官网 ──► Node 爬虫 ──► 聚合入库(5400+ 企业) ──► 前端浏览/筛选/统计
                                                        │
                                          选中公司+粘贴 JD
                                                        ▼
              参考素材(JSON) ──► Python 简历引擎 ◄── LLM 改写(可选)
                                     │
                                     ▼
                        定制版简历 MD/PDF（每公司一版）
                                     │
                                     ▼
                     Chrome MV3 插件一键填充到招聘网站
```

## 功能总览

| 模块 | 说明 |
| --- | --- |
| 官网汇总 | 抓取各公司校招官网职位信息，聚合入库，支持筛选/排序/全局搜索/投递统计 |
| 简历生成 | 按 JD 动态改写实习经历/项目经历/核心能力三个可变模块，生成 MD/PDF，每公司一版 |
| 参考素材 | 简历素材（实习/项目/核心能力/教育/证书）以 JSON 管理，上传即生效 |
| 简历版本库 | 已生成版本查看/下载/删除，支持多版本管理 |
| 浏览器插件 | 在招聘网站一键识别公司 → 拉取对应定制版 → 自动填充（只替换可变模块） |
| 自动同步 | 监听本地原版简历文件变更，LLM 总结后同步到在线简历（非破坏性合并） |

## 目录结构

```
qiuzhaotong/
├─ backend/                    # Spring Boot 后端（Java 21，端口 8080，context-path /api）
├─ frontend/                   # Vue3 + Vite 前端（端口 5173）
├─ resume-engine/              # Python 简历生成引擎（MD → PDF）
├─ crawlers/                   # 招聘信息爬虫（Node.js + Playwright）
├─ crawler-bridge/             # Node 桥接脚本（合并爬虫输出为统一 JSON）
├─ plugin/resume-fill-plugin/  # Chrome MV3 简历智能填充插件
├─ data/                       # 运行时数据目录（原始爬取数据不入库，见下文说明）
├─ db/init.sql                 # 建库建表脚本
├─ scripts/                    # 辅助脚本
└─ 启动系统.bat / 停止系统.bat   # Windows 一键启停
```

## 环境依赖

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| JDK | 21 | 后端运行 |
| Maven | 3.9.x | 后端构建 |
| Node.js | 18+ | 爬虫及桥接脚本 |
| Python | 3.10+ | 简历生成引擎（建议 venv） |
| PostgreSQL | 15+ | 数据库，建库 `qiuzhaohub` |
| Chrome / Edge | 最新 | 浏览器插件与爬虫 |

> 本项目目录含中文路径。Maven 在中文路径下偶发 `application.yml 拒绝访问` 的编码问题，若报此错请把源码复制到纯英文目录构建。

## 快速开始

### 1. 数据库

```sql
CREATE DATABASE qiuzhaohub;
```

建表脚本见 `db/init.sql`；后端首次启动也会自动建表（JPA ddl-auto=update）。
连接信息在 `backend/src/main/resources/application.yml`（默认 `postgres/postgres`，按需修改）。

首次启动自动写入：
- 管理员账号 `admin` / `admin123`（bcrypt 加密）
- 插件独立令牌 `plugin_token`（与插件配置保持一致）

### 2. 后端

```bash
cd backend
mvn -DskipTests package
java -jar target/qiuzhaohub-backend-1.0.0.jar --server.port=8080
```

验证：

```bash
curl http://127.0.0.1:8080/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

### 4. 简历素材

把 `resume-engine/参考素材/` 下的 JSON 素材（个人信息/教育背景/核心能力/实习经历/证书）放到后端配置的参考素材目录，并在前端「参考素材」页登记，引擎生成简历时实时读取。
`个人信息.json` 内置的是**示例数据（张三）**，请替换为你自己的信息。

### 5. 浏览器插件

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `plugin/resume-fill-plugin/`
3. 插件面板 → 「配置」→ 填后端地址 `http://127.0.0.1:8080/api` 与访问令牌（后端 settings 表中的 `plugin_token`）
4. 在招聘网站简历填写页：识别公司 → 选版本 → 一键填充（只替换实习/项目/核心能力等可变模块，基本信息/学历/家庭保持不动）

## 数据说明（重要）

- `data/` 目录的原始爬取数据（`feishu_raw.json`、`merged.json`、`links.json` 等）**不在本仓库中**——其中含招聘联系人邮箱等第三方个人信息，不适合公开分发。
- 首次使用请自行运行爬虫生成数据，或在「官网汇总」页点「手动爬取」。
- 仓库内所有真实姓名、手机号、邮箱均已替换为示例值（张三 / 13900000000 / zhangsan@example.com）。

## 核心接口速查

| 功能 | 接口 | 说明 |
| --- | --- | --- |
| 手动爬取 | `POST /api/companies/crawl` | 异步触发，合并数据写入 `companies` 表 |
| 爬虫状态 | `GET /api/companies/crawl/status` | running / lastCount / lastError |
| 简历生成 | `POST /api/resume/generate` | 按 JD 生成某公司可变模块版本（MD/PDF） |
| 插件拉取 | `GET /api/plugin/resume-version?company=&token=` | 插件识别公司后拉取可变模块（免 JWT） |
| 素材管理 | `POST /api/references/upload` | 上传/替换素材，引擎实时读取 |

## 常见问题

1. **后端端口随机而非 8080**：用 `java -jar xxx.jar --server.port=8080` 显式指定。
2. **Maven 报 `application.yml 拒绝访问`**：中文路径编码问题，把 backend 拷到英文目录构建。
3. **爬虫 0 条**：数据源依赖浏览器 cookie，无人值守可能失败；先手动登录一次数据源页面再爬。
4. **插件报「未找到该公司版本」**：先在「简历生成」页为该公司生成一版。
5. **LLM 不可用**：前端「设置」页填 LLM base_url / api_key / model（OpenAI 兼容协议均可）。

## 免责声明

本项目仅供学习与个人求职辅助使用：
1. 遵守目标网站的 robots 协议与用户协议，控制爬取频率，数据勿用于商业牟利
2. 招聘平台账号行为自负，请合规使用自动填充功能
3. 请勿将含他人个人信息的数据（如招聘联系人邮箱）公开发布

## License

[MIT](LICENSE)
