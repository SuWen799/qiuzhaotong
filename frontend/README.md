# 秋招通 QiuzhaoHub · 前端工程

Vue 3 + Vite + Element Plus + Vue Router + Pinia + Axios。

## 启动

```bash
npm install
npm run dev      # 默认 http://localhost:5173
```

## 配置

- 后端 baseURL：`src/utils/request.js` 中 `BASE_URL = http://127.0.0.1:8080/api`
- 登录后 token 存于 `localStorage`，Axios 请求拦截器自动附加 `Authorization: Bearer <token>`
- 401 自动跳转 `/login`

## 目录结构

```
src/
├─ api/          # 各业务接口封装（auth/companies/resume/references/settings/plugin）
├─ layout/       # 主布局（侧边栏 + 顶栏）
├─ router/       # 路由 + 守卫
├─ stores/       # Pinia（user）
├─ utils/        # request（axios 封装）、download
└─ views/        # 登录 + 6 大业务页
```

## 页面

- `/login` 登录
- `/companies` 官网汇总（企业列表 / 趋势统计 / 投递统计）
- `/resume/generate` 简历生成
- `/resume/base` 基础档案维护
- `/resume/versions` 简历版本库
- `/references` 参考素材管理
- `/plugin` 插件管理（资料编辑 / 版本浏览 / 识别说明 / 访问令牌）
- `/settings` 系统设置（LLM / 爬取开关）
