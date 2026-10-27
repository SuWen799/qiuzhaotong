# 秋招通 · 简历智能填充插件（Chrome MV3）

本插件是「秋招通（QiuzhaoHub）」系统的一部分，用于在招聘网站填写简历时，**根据当前公司自动从后端拉取“为该公司定制的简历版本”并填充可变模块**（实习经历 / 项目经历 / 核心能力），而基本信息、学历、家庭等不变模块保持原样不动。

> 原始工程为 `Edge简历智能填充助手`，本目录是其改造版本，复用了其稳健的表单填充能力（content script / matcher / filler）。

---

## 一、加载插件（开发者模式）

1. 打开 Chrome / Edge，访问 `chrome://extensions`（或 `edge://extensions`）。
2. 右上角打开 **“开发者模式”**（Developer mode）。
3. 点击 **“加载已解压的扩展程序”**（Load unpacked）。
4. 选择本目录（`resume-fill-plugin/`）。
5. 加载成功后，浏览器工具栏会出现“秋招通 · 简历填充”图标。点击即可打开弹窗（Popup）。

> 后端需已启动并监听 `http://127.0.0.1:8080`（Spring Boot）。插件通过 `/api/plugin/*` 接口通信。

---

## 二、首次配置（后端地址 + 访问令牌）

点击弹窗右上角 **「配置」**：

- **后端地址（Base URL）**：默认 `http://127.0.0.1:8080/api`，部署到其他机器时修改。
- **访问令牌（Token）**：后端 `Setting` 表里的 `plugin_token`，默认值：
  `qzh_plugin_token_8f3c2a1b9e7d6f4c5a0b1c2d3e4f5a6b`
  （独立于 admin 密码，可在后端 `/api/plugin/token` 查看，或直接在数据库 `setting` 表读取）。

填好后点 **「保存配置」**，或点 **「测试连接」** 验证：成功会显示“共 N 个可用版本”。

配置保存在浏览器 `chrome.storage.local`，无需重复填写。

---

## 三、使用流程

### 第 1 步：识别当前公司
在浏览器中打开目标招聘网站的简历填写页（如百度招聘、Moka、BOE、飞书、前程无忧、Hotjob 等），然后：

1. 点击插件图标打开弹窗。
2. 点击 **「识别当前公司」**。
3. 插件会读取页面 `title` 与可见正文，与后端版本公司列表做包含匹配，弹出候选公司列表。
4. 在候选列表中点击正确的公司名确认。

**识别失败兜底**：若未识别到公司（页面未包含公司名），用 **「手动搜索公司」** 输入框输入关键字，插件会模糊匹配后端公司列表并下拉，选中即可。也可直接输入完整公司名后拉取。

### 第 2 步：拉取并填充
确认公司后，点击 **「拉取并填充」**：

- 插件调用 `GET /api/plugin/resume-version?company=<公司>&token=<令牌>`。
- 解析返回的 `variableModules`（实习 / 项目 / 核心能力），构造一个**仅包含可变模块的临时简历**。
- 复用原插件的扫描 + 匹配 + 填充流程写入页面表单。
- 由于临时简历不含基本信息/学历/家庭，**这些不变模块不会被触碰**。
- 填充完成后，弹窗会报告成功/失败项数；对未自动填充的字段，会提示“以下字段未自动填充，请手动检查：……”。

> 插件**不自动保存或提交**表单，请人工核对后再操作。

---

## 四、填充机制说明（稳健性）

- **字段匹配**：优先按字段 label / placeholder / 相邻文本 / name / id 匹配；不同站点（百度、Moka、BOE、飞书、51job、Hotjob、通用）有专属映射。
- **找不到则跳过**：若某可变字段在页面上找不到对应控件，会跳过并在结果中提示，不会报错中断。
- **可变模块写入方式**：
  - 实习经历 `internship`、项目经历 `project`：后端返回文本按条目拆分（编号条目或空行），每条整体写入该经历的“工作内容 / 项目内容”文本域。
  - 核心能力 `core_skills`：整段文本写入页面“核心能力 / 专业技能 / 技能特长 / 自我评价”等文本域（取最匹配者）。
- **不变模块保护**：仅靠“临时简历只含可变模块”这一设计保证基本信息/学历/家庭零改动，无需逐字段排除。

---

## 五、后端接口（已就绪，照此调用）

| 接口 | 说明 |
| --- | --- |
| `GET /api/plugin/versions?token=` | 返回所有可用版本公司列表 `[{company, jobId, createdAt}]`，供识别/搜索下拉。 |
| `GET /api/plugin/resume-version?company=&token=` | 拉取某公司定制简历，返回 `{company, variableModules, baseSnapshot, createdAt}`。 |
| `GET /api/plugin/token`（需 JWT 登录） | 查看当前 plugin_token。 |

`variableModules` 结构示例（internship/project/core_skills 可为数组或整段文本，插件均兼容）：
```json
{
  "internship": ["（实习经历1文本）", "（实习经历2文本）"],
  "project": ["（项目经历1文本）"],
  "core_skills": "（核心能力整段文本）"
}
```

---

## 六、文件结构

```
resume-fill-plugin/
├─ manifest.json            # MV3 清单（permissions / host_permissions 含本地后端）
├─ popup/                   # 弹窗 UI：识别按钮、搜索框、配置区、拉取填充
│  ├─ popup.html
│  ├─ popup.js
│  └─ popup.css
├─ content/
│  ├─ content.js            # 页面扫描/匹配/填充；新增 ERA_PLUGIN_FILL 仅填可变模块
│  └─ content.css
├─ shared/
│  ├─ plugin-api.js         # 【新增】后端通信（versions / resume-version，token 存 storage）
│  ├─ company-detector.js   # 【新增】公司识别（提取页面文本 + 与公司列表匹配 + 模糊搜索）
│  ├─ profile-normalizer.js # 简历 → 候选字段；新增 coreSkills 段落
│  ├─ matcher.js            # 字段匹配；contextSection 新增 core_skills 识别
│  ├─ filler.js             # 单字段填充（原生/React/自定义组件等）
│  ├─ content-injector.js   # 弹窗↔页面消息路由
│  └─ ...（其余为原插件复用）
├─ data/profile.json        # 内置基础资料（不变模块来源，插件填充可变模块时不依赖它）
└─ options/                 # 资料维护页（原插件功能保留）
```

---

## 七、注意事项

- 后端未启动或令牌错误时，识别/拉取会明确报错，请检查「配置」与后端状态。
- 本插件只读取/写入当前页表单，不上传任何个人信息到除配置后端以外的第三方。
- 不同招聘网站表单结构差异大，少量字段可能需手动补充；弹窗会列出未自动填充项。
