// 秋招通插件 Popup 逻辑
// 流程：识别/选择当前公司 → 选择简历版本 → 拉取该版本可变模块 → 填充页面（不变模块不动）
// 选中公司与版本会持久化到 chrome.storage.local，关闭重开仍保留。
(function initPopup() {
  "use strict";

  const api = window.EdgeResumePluginApi;
  const detector = window.EdgeResumeCompanyDetector;
  const injector = window.EdgeResumeContentInjector;

  const STORAGE_KEYS = {
    company: "pluginSelectedCompany",
    version: "pluginSelectedVersion",
  };

  const ORIGIN_VERSION = "__origin__"; // “原版简历”选项值

  const els = {
    feedback: document.getElementById("feedback"),
    settingsToggle: document.getElementById("settingsToggle"),
    configPanel: document.getElementById("configPanel"),
    baseUrl: document.getElementById("baseUrl"),
    token: document.getElementById("token"),
    saveConfig: document.getElementById("saveConfig"),
    testConfig: document.getElementById("testConfig"),
    configFeedback: document.getElementById("configFeedback"),
    companyCard: document.getElementById("companyCard"),
    companyState: document.getElementById("companyState"),
    companyMeta: document.getElementById("companyMeta"),
    detectBtn: document.getElementById("detectBtn"),
    versionSelect: document.getElementById("versionSelect"),
    candidates: document.getElementById("candidates"),
    searchInput: document.getElementById("searchInput"),
    searchResults: document.getElementById("searchResults"),
    fillBtn: document.getElementById("fillBtn"),
  };

  let companyList = [];          // 后端版本公司列表（全量，含 id/isDefault）
  let selectedCompany = "";      // 当前选中公司
  let selectedVersionId = "";    // 当前选中版本 id（"" 或 ORIGIN_VERSION 或具体 id）
  let companyVersions = [];      // 当前公司的版本列表

  function setFeedback(message, isError = false) {
    els.feedback.textContent = message;
    els.feedback.classList.toggle("error", Boolean(isError));
  }

  function setConfigFeedback(message, isError = false) {
    els.configFeedback.textContent = message;
    els.configFeedback.classList.toggle("error", Boolean(isError));
  }

  function setBusy(busy) {
    els.detectBtn.disabled = Boolean(busy);
    els.fillBtn.disabled = Boolean(busy) || !selectedCompany;
    els.versionSelect.disabled = Boolean(busy) || !selectedCompany;
  }

  function markCompanyCard(state) {
    els.companyCard.classList.remove("ok", "warning");
    if (state) els.companyCard.classList.add(state);
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有可操作的当前标签页");
    return tab;
  }

  // ---------- 持久化选中状态 ----------
  async function persistSelection() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.company]: selectedCompany,
        [STORAGE_KEYS.version]: selectedVersionId,
      });
    } catch { /* 持久化失败不阻断主流程 */ }
  }

  async function restoreSelection() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.company, STORAGE_KEYS.version]);
      if (stored[STORAGE_KEYS.company]) {
        selectedCompany = stored[STORAGE_KEYS.company];
        selectedVersionId = stored[STORAGE_KEYS.version] || "";
      }
    } catch { /* 忽略 */ }
  }

  // ---------- 配置 ----------
  async function loadConfigIntoForm() {
    const cfg = await api.getConfig();
    els.baseUrl.value = cfg.baseUrl;
    els.token.value = cfg.token;
  }

  async function saveConfig() {
    await api.saveConfig({ baseUrl: els.baseUrl.value.trim(), token: els.token.value.trim() });
    setConfigFeedback("配置已保存。");
    await refreshCompanyList();
    if (selectedCompany) await loadVersionsForCompany(selectedCompany, { silent: true });
  }

  async function testConfig() {
    try {
      await api.saveConfig({ baseUrl: els.baseUrl.value.trim(), token: els.token.value.trim() });
      const list = await api.listAllVersions();
      setConfigFeedback(`连接成功，共 ${list.length} 个可用版本。`);
      await refreshCompanyList(list);
    } catch (error) {
      setConfigFeedback(String(error.message || error), true);
    }
  }

  // ---------- 公司列表缓存 ----------
  async function refreshCompanyList(provided) {
    try {
      companyList = provided || await api.listAllVersions();
    } catch (error) {
      companyList = [];
      setFeedback(`获取公司列表失败：${String(error.message || error)}（请检查配置与后端是否启动）`, true);
    }
  }

  // ---------- 识别公司 ----------
  async function detectCompany() {
    try {
      setBusy(true);
      const tab = await activeTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: detector.extractPageInfo,
      });
      const pageInfo = results?.[0]?.result || { title: "", text: "" };
      if (!companyList.length) await refreshCompanyList();
      const matched = detector.detectCompanies(pageInfo, companyList);

      if (!matched.length) {
        els.companyState.textContent = "未识别到公司";
        els.companyMeta.textContent = "页面未包含已知公司名，请用下方搜索框手动选择。";
        markCompanyCard("warning");
        renderCandidates([]);
        setFeedback("未自动识别。可手动搜索或输入公司名。");
        return;
      }
      renderCandidates(matched);
      setFeedback(`识别到 ${matched.length} 个候选公司，请确认。`);
    } catch (error) {
      setFeedback(String(error.message || error), true);
    } finally {
      setBusy(false);
    }
  }

  function renderCandidates(list) {
    els.candidates.innerHTML = "";
    if (!list.length) { els.candidates.hidden = true; return; }
    els.candidates.hidden = false;
    for (const item of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "candidate";
      btn.innerHTML = `<b>${escapeHtml(item.company)}</b><small>${escapeHtml(item.reason || "")}</small>`;
      btn.addEventListener("click", () => selectCompany(item.company));
      els.candidates.appendChild(btn);
    }
  }

  async function selectCompany(company) {
    selectedCompany = company;
    selectedVersionId = "";
    els.companyState.textContent = company;
    els.searchInput.value = company;
    els.searchResults.hidden = true;
    renderCandidates([]);
    els.candidates.hidden = true;
    markCompanyCard("ok");
    setFeedback(`已选择公司：${company}，正在加载版本…`);
    await loadVersionsForCompany(company);
    await persistSelection();
  }

  // ---------- 版本下拉 ----------
  async function loadVersionsForCompany(company, opts = {}) {
    try {
      setBusy(true);
      companyVersions = await api.fetchCompanyVersions(company);
      renderVersionOptions();
      // 若已恢复选中版本，尝试保持；否则默认选最新版
      const keep = !opts.silent && selectedVersionId ? selectedVersionId : defaultVersionId();
      selectedVersionId = keep;
      els.versionSelect.value = keep;
      updateFillState();
      if (!opts.silent) {
        const label = selectedVersionId === ORIGIN_VERSION ? "原版简历" : labelForVersion(selectedVersionId);
        setFeedback(`已选择公司：${company}；当前版本：${label}`);
      }
    } catch (error) {
      companyVersions = [];
      renderVersionOptions();
      if (!opts.silent) setFeedback(`加载「${company}」版本失败：${String(error.message || error)}`, true);
    } finally {
      setBusy(false);
    }
  }

  function defaultVersionId() {
    const def = companyVersions.find((v) => v.isDefault);
    if (def) return def.id || ORIGIN_VERSION;
    if (companyVersions[0]) return companyVersions[0].id || ORIGIN_VERSION;
    return ORIGIN_VERSION;
  }

  function labelForVersion(id) {
    if (id === ORIGIN_VERSION) return "原版简历";
    const v = companyVersions.find((x) => x.id === id);
    if (!v) return "原版简历";
    const flag = v.isDefault ? "（默认）" : "";
    const date = v.createdAt ? ` · ${String(v.createdAt).slice(0, 10)}` : "";
    return `${v.company} 版本${flag}${date}`;
  }

  function renderVersionOptions() {
    const sel = els.versionSelect;
    sel.innerHTML = "";
    const origin = document.createElement("option");
    origin.value = ORIGIN_VERSION;
    origin.textContent = "原版简历";
    sel.appendChild(origin);
    for (const v of companyVersions) {
      const opt = document.createElement("option");
      opt.value = v.id || ORIGIN_VERSION;
      const flag = v.isDefault ? "（默认）" : "";
      const date = v.createdAt ? ` · ${String(v.createdAt).slice(0, 10)}` : "";
      opt.textContent = `${v.company} 版本${flag}${date}`;
      sel.appendChild(opt);
    }
    sel.disabled = !selectedCompany;
  }

  function onVersionChange() {
    selectedVersionId = els.versionSelect.value || ORIGIN_VERSION;
    updateFillState();
    void persistSelection();
    setFeedback(`已切换版本：${labelForVersion(selectedVersionId)}`);
  }

  function updateFillState() {
    els.fillBtn.disabled = !selectedCompany;
    els.companyMeta.textContent = selectedCompany
      ? "已选择，切换版本后点击“拉取并填充”写入可变模块。"
      : "打开招聘网站表单后，点击下方按钮自动识别。";
  }

  // ---------- 搜索框（手动兜底） ----------
  function renderSearchResults(list) {
    els.searchResults.innerHTML = "";
    if (!list.length) { els.searchResults.hidden = true; return; }
    els.searchResults.hidden = false;
    for (const item of list) {
      const li = document.createElement("li");
      li.textContent = item.company;
      li.addEventListener("click", () => {
        void selectCompany(item.company);
        els.searchResults.hidden = true;
      });
      els.searchResults.appendChild(li);
    }
  }

  function onSearchInput() {
    const kw = els.searchInput.value.trim();
    if (!kw) { els.searchResults.hidden = true; return; }
    const matched = detector.fuzzyMatchCompanies(kw, companyList);
    renderSearchResults(matched);
  }

  // ---------- 拉取并填充 ----------
  async function fillWithCompany() {
    if (!selectedCompany) {
      setFeedback("请先识别或选择公司。", true);
      return;
    }
    try {
      setBusy(true);
      setFeedback(`正在拉取「${selectedCompany}」的定制简历…`);
      // 原版简历：不使用公司定制版；具体版本：按 id 拉取
      let version = null;
      let useOrigin = false;
      if (selectedVersionId && selectedVersionId !== ORIGIN_VERSION) {
        version = await api.fetchResumeVersionById(selectedCompany, selectedVersionId);
      } else {
        useOrigin = true;
        version = { variableModules: {} };
      }
      const vm = version.variableModules || {};
      if (!useOrigin) {
        const hasContent = [vm.internship, vm.project, vm.core_skills].some((v) => String(v || "").trim());
        if (!hasContent) {
          setFeedback(`「${selectedCompany}」无可变模块内容（可能仅有原版基础信息）。`, true);
          return;
        }
      }

      const tab = await activeTab();
      const response = await injector.sendMessageToTab(chrome, tab.id, {
        type: "ERA_PLUGIN_FILL",
        company: selectedCompany,
        versionId: useOrigin ? ORIGIN_VERSION : (version.versionId || selectedVersionId || null),
        variableModules: vm,
        useOrigin: useOrigin,
      });

      if (!response?.ok) throw new Error(response?.error || "页面未响应");

      const report = response.report || {};
      const filled = Number(report.filled || 0);
      const failed = Number(report.failed || 0);
      let msg = `「${selectedCompany}」填充完成：成功 ${filled} 项，跳过/失败 ${failed} 项。基本信息/学历/家庭未改动。`;
      const skippedFields = (report.results || [])
        .filter((r) => !r.ok)
        .map((r) => r.label || r.id)
        .filter(Boolean)
        .slice(0, 6);
      if (skippedFields.length) {
        msg += ` 以下字段未自动填充，请手动检查：${skippedFields.join("、")}${skippedFields.length >= 6 ? "…" : ""}`;
      }
      setFeedback(msg);
    } catch (error) {
      setFeedback(String(error.message || error), true);
    } finally {
      setBusy(false);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  // ---------- 事件绑定 ----------
  els.settingsToggle.addEventListener("click", () => {
    els.configPanel.hidden = !els.configPanel.hidden;
    if (!els.configPanel.hidden) loadConfigIntoForm();
  });
  els.saveConfig.addEventListener("click", () => void saveConfig());
  els.testConfig.addEventListener("click", () => void testConfig());
  els.detectBtn.addEventListener("click", () => void detectCompany());
  els.versionSelect.addEventListener("change", onVersionChange);
  els.searchInput.addEventListener("input", onSearchInput);
  els.fillBtn.addEventListener("click", () => void fillWithCompany());

  (async () => {
    await loadConfigIntoForm();
    await refreshCompanyList();
    await restoreSelection();
    if (selectedCompany) {
      els.companyState.textContent = selectedCompany;
      markCompanyCard("ok");
      await loadVersionsForCompany(selectedCompany, { silent: true });
    } else {
      updateFillState();
    }
  })();
})();
