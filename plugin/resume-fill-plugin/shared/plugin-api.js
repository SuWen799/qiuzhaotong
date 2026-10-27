// 秋招通插件后端通信模块
// 负责：读取配置（base URL / 访问令牌）、调用 /plugin/versions 与 /plugin/resume-version
// 所有说明与注释均为中文。
(function initPluginApi(global) {
  "use strict";

  // 默认后端地址（本地部署）。可被用户配置覆盖。
  const DEFAULT_BASE_URL = "http://127.0.0.1:8080/api";
  // 默认访问令牌（独立于 admin 密码，存在 Setting 表的 plugin_token）。
  const DEFAULT_TOKEN = "qzh_plugin_token_8f3c2a1b9e7d6f4c5a0b1c2d3e4f5a6b";

  const STORAGE_KEYS = {
    baseUrl: "pluginBaseUrl",
    token: "pluginToken",
  };

  function getConfig() {
    // 在 content script 等非 popup 环境也尝试读取；失败则回退默认值。
    if (global.chrome?.storage?.local?.get) {
      // 同步封装：返回 Promise，但允许调用方 await
      return new Promise((resolve) => {
        global.chrome.storage.local.get(
          [STORAGE_KEYS.baseUrl, STORAGE_KEYS.token],
          (stored) => {
            resolve({
              baseUrl: (stored[STORAGE_KEYS.baseUrl] || DEFAULT_BASE_URL).replace(/\/+$/, ""),
              token: stored[STORAGE_KEYS.token] || DEFAULT_TOKEN,
            });
          }
        );
      });
    }
    return Promise.resolve({ baseUrl: DEFAULT_BASE_URL, token: DEFAULT_TOKEN });
  }

  async function saveConfig(config) {
    const payload = {};
    if (typeof config.baseUrl === "string") payload[STORAGE_KEYS.baseUrl] = config.baseUrl.replace(/\/+$/, "");
    if (typeof config.token === "string") payload[STORAGE_KEYS.token] = config.token;
    if (global.chrome?.storage?.local?.set) {
      return new Promise((resolve) => global.chrome.storage.local.set(payload, resolve));
    }
    return Promise.resolve();
  }

  // ===== 后端请求代理 =====
  // content script 在 https 页面直接 fetch http://127.0.0.1 会被混合内容拦截，
  // 真实扩展里改走 background service worker（不受混合内容限制）。
  // 注入测试等无 SW 环境（chrome.runtime.sendMessage 为桩）自动回退直连 fetch。
  // Sunwz|2026-09-26|新增 body 参数：PUT/POST JSON 请求体透传（面板保存资料写回原版简历文件用）。
  async function backendFetch(url, method = "GET", body = null) {
    const hasSw =
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.id &&
      typeof chrome.runtime.sendMessage === "function";
    if (hasSw) {
      try {
        const p = chrome.runtime.sendMessage({ type: "ERA_FETCH", url, method, body });
        const r = p && typeof p.then === "function" ? await p : undefined;
        if (r && (r.ok === true || r.ok === false) && r.error === undefined) {
          return {
            ok: r.ok,
            status: r.status,
            json: async () => {
              try { return JSON.parse(r.text || "null"); } catch { return null; }
            },
          };
        }
        if (r && r.error) throw new Error(r.error);
        // r 为 undefined（桩环境）→ 落到下方直连
      } catch (e) {
        console.warn("[era-api] background 代理失败，回退直连：", e && e.message ? e.message : e);
      }
    }
    const response = await fetch(url, {
      method,
      ...(body != null
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    return response;
  }

  // 兼容 variableModules 可能为字符串（JSON）或对象；
  // 新版 structured 数据：internship/project 为对象数组，core_skills 为对象；
  // 旧版文本数据：为字符串/字符串数组。统一保留结构化对象，字符串数组才做文本化。
  function normalizeVariableModules(raw) {
    let modules = raw;
    if (typeof raw === "string") {
      try { modules = JSON.parse(raw); } catch { modules = {}; }
    }
    modules = modules || {};
    const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
    const normalize = (value) => {
      if (value == null) return "";
      if (typeof value === "string") return value.trim();
      if (isPlainObject(value)) return value;
      if (Array.isArray(value)) {
        // 过滤 null/undefined/空对象/空字符串
        const items = value.filter((item) => {
          if (item == null) return false;
          if (typeof item === "string") return item.trim() !== "";
          if (isPlainObject(item)) return Object.keys(item).length > 0;
          return true;
        });
        return items.length ? items : "";
      }
      return String(value);
    };
    return {
      internship: normalize(modules.internship),
      project: normalize(modules.project),
      core_skills: normalize(modules.core_skills),
    };
  }

  // 列出所有可用版本的公司名：GET /plugin/versions?token=
  // 返回 [{company, jobId, createdAt}]
  async function listVersions(config) {
    const cfg = config || await getConfig();
    const url = `${cfg.baseUrl}/plugin/versions?token=${encodeURIComponent(cfg.token)}`;
    const response = await backendFetch(url);
    if (!response.ok) {
      const text = await response.text?.().catch(() => "") || "";
      throw new Error(`拉取版本列表失败（HTTP ${response.status}）${text ? "：" + text : ""}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("版本列表返回格式异常");
    return data.map((item) => ({
      company: String(item.company || "").trim(),
      jobId: item.jobId || "",
      createdAt: item.createdAt || "",
    })).filter((item) => item.company);
  }

  // 拉取某公司简历版本：GET /plugin/resume-version?company=<公司名>&token=<令牌>
  // 成功返回 {company, variableModules, baseSnapshot, createdAt}
  async function fetchResumeVersion(company, config) {
    return fetchResumeVersionById(company, null, config);
  }

  // 按版本 id 拉取某公司简历版本：额外携带 versionId 查询参数。
  // versionId 为 null/空时等价于「原版简历」（后端按默认/最新回退）。
  // 成功返回 {company, versionId, variableModules, baseSnapshot, createdAt, isDefault}
  async function fetchResumeVersionById(company, versionId, config) {
    const cfg = config || await getConfig();
    let url = `${cfg.baseUrl}/plugin/resume-version?company=${encodeURIComponent(company)}&token=${encodeURIComponent(cfg.token)}`;
    if (versionId) url += `&versionId=${encodeURIComponent(versionId)}`;
    const response = await backendFetch(url);
    if (!response.ok) {
      const text = await response.text?.().catch(() => "") || "";
      throw new Error(`拉取「${company}」版本失败（HTTP ${response.status}）${text ? "：" + text : ""}`);
    }
    const data = await response.json();
    if (!data || data.error) {
      throw new Error(data?.error || "后端未返回有效数据");
    }
    return {
      company: String(data.company || company),
      versionId: data.versionId || versionId || null,
      variableModules: normalizeVariableModules(data.variableModules),
      baseSnapshot: data.baseSnapshot || null,
      createdAt: data.createdAt || "",
      isDefault: Boolean(data.isDefault),
    };
  }

  // 拉取全部版本列表（含 id / isDefault），不做字段裁剪，供前端筛选某公司的版本。
  // GET /plugin/versions?token=
  // 返回 [{id, company, jobId, isDefault, createdAt}]
  async function listAllVersions(config) {
    const cfg = config || await getConfig();
    const url = `${cfg.baseUrl}/plugin/versions?token=${encodeURIComponent(cfg.token)}`;
    const response = await backendFetch(url);
    if (!response.ok) {
      const text = await response.text?.().catch(() => "") || "";
      throw new Error(`拉取版本列表失败（HTTP ${response.status}）${text ? "：" + text : ""}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("版本列表返回格式异常");
    return data.map((item) => ({
      id: item.id || "",
      company: String(item.company || "").trim(),
      jobId: item.jobId || "",
      isDefault: Boolean(item.isDefault),
      createdAt: item.createdAt || "",
    })).filter((item) => item.company);
  }

  // 取某公司的所有定制版本（从全量列表里按 company 过滤）。
  // 返回 [{id, company, jobId, isDefault, createdAt}]，按 createdAt 倒序（最新在前）。
  async function fetchCompanyVersions(company, config) {
    const all = await listAllVersions(config);
    const target = String(company || "").trim();
    return all
      .filter((item) => item.company === target)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  // 取某公司「最新版」：isDefault=true 优先，否则 createdAt 最新。无版本时返回 null。
  async function fetchLatestVersion(company, config) {
    const versions = await fetchCompanyVersions(company, config);
    if (!versions.length) return null;
    const def = versions.find((v) => v.isDefault);
    return def || versions[0];
  }

  const api = {
    DEFAULT_BASE_URL,
    DEFAULT_TOKEN,
    STORAGE_KEYS,
    getConfig,
    saveConfig,
    listVersions,
    listAllVersions,
    fetchCompanyVersions,
    fetchLatestVersion,
    fetchResumeVersion,
    fetchResumeVersionById,
    normalizeVariableModules,
  };

  global.EdgeResumePluginApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
