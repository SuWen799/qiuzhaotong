(function initEdgeResumeAutofill() {
  "use strict";

  const VERSION = "0.21.17";
  if (window.__EDGE_RESUME_AUTOFILL__ === VERSION) return;
  window.__EDGE_RESUME_AUTOFILL__ = VERSION;

  const normalizer = window.EdgeResumeProfileNormalizer;
  const matcher = window.EdgeResumeMatcher;
  const filler = window.EdgeResumeFiller;
  const recordWaiter = window.EdgeResumeRecordWaiter;
  const ORIGIN_VERSION = "__origin__";
  const runtime = {
    lastProfile: null,
    lastMappings: [],
    lastReport: null,
    detectedCompany: null,
    detectedReason: null,
    companyVersions: [],
    selectedVersionId: "",
    selectedVersionLabel: "",
  };

  function isBaiduResumeCreate() {
    return location.hostname === "talent.baidu.com" && location.pathname.includes("/jobs/resume/create");
  }

  function is51jobResumeFill() {
    return location.hostname.endsWith("51job.com") && location.pathname.includes("/External/MyResume/FillInResume.aspx");
  }

  function ensureBaiduDevFlag() {
    if (!isBaiduResumeCreate()) return false;
    const url = new URL(location.href);
    if (url.searchParams.get("dev") === "0") return false;
    url.searchParams.set("dev", "0");
    location.replace(url.toString());
    return true;
  }

  if (ensureBaiduDevFlag()) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function showStatus(title, body, kind = "info") {
    setPanelNotice(`${title}：${body}`, kind);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[char]);
  }

  async function loadDefaultProfile() {
    const response = await fetch(chrome.runtime.getURL("data/profile.json"));
    return response.json();
  }

  function profileFromMessage(message) {
    return message.profile || null;
  }

  async function loadStoredProfile() {
    // Sunwz|2026-09-26|磁盘 data/profile.json（原版简历）为唯一权威源，chrome.storage 旧副本仅作读取失败兜底
    try {
      return await loadDefaultProfile();
    } catch {
      // 扩展内置文件读取失败（异常环境）才回退浏览器旧副本
    }
    try {
      const stored = await chrome.storage?.local?.get?.(["profile"]);
      if (stored?.profile) return stored.profile;
    } catch {
      // Some injected test environments provide only runtime APIs.
    }
    return loadDefaultProfile();
  }

  function siteId() {
    if (isBaiduResumeCreate()) return "baidu";
    if (location.hostname.endsWith("mokahr.com")) return "moka";
    if (location.hostname === "campus.boe.com" || location.hostname.endsWith(".boe.com") || location.hostname.endsWith(".zhiye.com") || location.hostname === "hr-campus.vivo.com") return "boe";
    // Sunwz|2026-08-07|AIRCAS（中科院空天院招聘系统，Bootstrap 表单）
    if (location.hostname.includes("aircas.ac.cn")) return "aircas";
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-07|飞书招聘（Lark jobs，ud-formily 表单）
    if (location.hostname.includes("jobs.feishu.cn")) return "feishu";
    if (location.hostname.endsWith("hotjob.cn") && location.pathname.includes("/pb/resumeOperation.html")) return "hotjob";
    if (is51jobResumeFill()) return "51job";
    // Sunwz|2026-08-07|——END
    return "generic";
  }

  function siteLabel() {
    // Sunwz|2026-08-14|vivo 校招（北森 UI）
    if (location.hostname === "hr-campus.vivo.com") return "vivo校招";
    const labels = {
      baidu: "百度招聘",
      moka: "Moka",
      generic: "通用网页",
      aircas: "空天院招聘",
      feishu: "飞书招聘",
      hotjob: "Hotjob招聘",
      "51job": "前程无忧",
    };
    return labels[siteId()] || "当前网页";
  }

  function isTopFrame() {
    return window.top === window;
  }

  function setPanelBusy(busy) {
    const panel = document.getElementById("era-panel");
    panel?.querySelectorAll?.("[data-era-action]")?.forEach((button) => {
      button.disabled = Boolean(busy);
    });
  }

  function setPanelNotice(message, kind = "info") {
    if (!isTopFrame()) return;
    const panel = ensurePageUi();
    if (!panel) return;
    const summary = panel.querySelector("[data-era-summary]");
    if (!summary) return;
    summary.textContent = message;
    summary.dataset.kind = kind;
  }

  function reportStats(report = {}) {
    return {
      records: Number(report.records || 0),
      mappings: Number(report.mappings || 0),
      manual: Number((report.skipped ?? 0) || (report.failed ?? 0) || 0),
      filled: report.filled == null ? null : Number(report.filled || 0),
    };
  }

  function reportSummary(report = {}, mode = "scan") {
    const stats = reportStats(report);
    if (mode === "fill" || stats.filled !== null) {
      return `识别 ${stats.records} 个控件，匹配 ${stats.mappings} 项，已填写 ${stats.filled || 0} 项，需人工处理 ${stats.manual} 项。`;
    }
    return `识别 ${stats.records} 个控件，匹配 ${stats.mappings} 项，需人工处理 ${stats.manual} 项。`;
  }

  function ensurePageUi() {
    if (!isTopFrame()) return null;

    let launcher = document.getElementById("era-launcher");
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.id = "era-launcher";
      launcher.type = "button";
      launcher.title = "简历快填";
      launcher.textContent = "填";
      launcher.addEventListener("click", () => togglePanel(true));
      document.documentElement.appendChild(launcher);
    }

    let panel = document.getElementById("era-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "era-panel";
      panel.hidden = true;
      panel.innerHTML = `
        <div class="era-panel-head">
          <div class="era-panel-title">
            <strong>简历快填</strong>
            <span data-era-site></span>
          </div>
          <button class="era-panel-close" type="button" data-era-action="close" title="收起">×</button>
        </div>
        <div class="era-panel-stats">
          <div class="era-stat"><b data-era-records>0</b><span>控件</span></div>
          <div class="era-stat"><b data-era-mappings>0</b><span>匹配</span></div>
          <div class="era-stat"><b data-era-manual>0</b><span>人工</span></div>
        </div>
        <div class="era-panel-version">
          <label for="era-version-select">在线简历</label>
          <select id="era-version-select" disabled>
            <option value="">请先识别公司</option>
          </select>
        </div>
        <div class="era-panel-actions">
          <button type="button" data-era-action="scan">检测</button>
          <button type="button" data-era-action="fill" data-primary="true">填写</button>
          <button type="button" data-era-action="clear">清除</button>
          <button type="button" data-era-action="options" title="资料设置">设置</button>
        </div>
        <div class="era-panel-body">
          <p class="era-panel-summary" data-era-summary>尚未检测。</p>
          <div class="era-panel-list" data-era-list></div>
        </div>
      `;
      panel.addEventListener("click", (event) => {
        const action = event.target?.closest?.("[data-era-action]")?.dataset?.eraAction;
        if (!action) return;
        void handlePanelAction(action);
      });
      const versionSelect = panel.querySelector("#era-version-select");
      if (versionSelect) {
        versionSelect.addEventListener("change", () => void handleVersionSelectChange());
      }
      document.documentElement.appendChild(panel);
    }

    panel.querySelector("[data-era-site]").textContent = siteLabel();
    launcher.dataset.state = panel.hidden ? "idle" : "active";
    return panel;
  }

  function togglePanel(open = null) {
    const panel = ensurePageUi();
    if (!panel) return null;
    const shouldOpen = open === null ? panel.hidden : Boolean(open);
    panel.hidden = !shouldOpen;
    const launcher = document.getElementById("era-launcher");
    if (launcher) launcher.dataset.state = shouldOpen ? "active" : "idle";
    if (shouldOpen) {
      renderPanel(runtime.lastReport);
      void refreshVersionSelector();
    }
    return panel;
  }

  function renderPanel(report = runtime.lastReport, mode = "scan") {
    const panel = ensurePageUi();
    if (!panel) return null;

    panel.querySelector("[data-era-site]").textContent = siteLabel();
    const stats = reportStats(report || {});
    panel.querySelector("[data-era-records]").textContent = String(stats.records);
    panel.querySelector("[data-era-mappings]").textContent = String(stats.mappings);
    panel.querySelector("[data-era-manual]").textContent = String(stats.manual);

    const summary = panel.querySelector("[data-era-summary]");
    const list = panel.querySelector("[data-era-list]");
    const detectSuffix = runtime.detectedCompany ? `｜已识别「${runtime.detectedCompany}」` : "";
    if (!report) {
      summary.textContent = `尚未检测。${detectSuffix}`.trim();
      summary.dataset.kind = "info";
      list.innerHTML = "";
      return panel;
    }

    const versionSuffix = runtime.selectedVersionLabel && runtime.selectedVersionLabel !== "原版简历"
      ? `｜使用「${runtime.selectedVersionLabel}」`
      : "";
    summary.textContent = `${reportSummary(report, mode)}${detectSuffix}${versionSuffix}`;
    summary.dataset.kind = report.error ? "error" : "info";
    list.innerHTML = (report.items || []).slice(0, 30).map((item) => {
      const badge = item.skipReason ? "人工" : `${item.confidence}%`;
      const kind = item.skipReason ? "skip" : "ok";
      const context = item.context ? ` · ${escapeHtml(item.context)}` : "";
      const hint = item.manualHint ? `<i class="era-panel-hint">⚠️ ${escapeHtml(item.manualHint)}</i>` : "";
      return `<div class="era-panel-item"><span>${escapeHtml(item.label || "未命名字段")}${context}${hint}</span><b data-kind="${kind}">${escapeHtml(badge)}</b></div>`;
    }).join("");
    return panel;
  }

  // ===================== 版本选择器 =====================
  function versionStorageKey(company) {
    // 识别到公司：按公司名持久化；未识别：按当前域名持久化，保证不同站点可分别记忆手动选择
    return `eraSelectedVersion:${company || location.hostname || "_none"}`;
  }

  async function loadSelectedVersion(company) {
    try {
      const stored = await chrome.storage.local.get(versionStorageKey(company));
      return stored[versionStorageKey(company)] || "";
    } catch {
      return "";
    }
  }

  async function persistSelectedVersion(company, versionId) {
    try {
      await chrome.storage.local.set({ [versionStorageKey(company)]: versionId || "" });
    } catch {
      // ignore
    }
  }

  async function loadVersionsForCompany(company) {
    const api = getPluginApi();
    if (!api || !company) return [];
    try {
      const all = await api.listAllVersions();
      const target = String(company || "").trim();
      return all
        .filter((v) => v.company === target)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    } catch {
      return [];
    }
  }

  function renderVersionSelector(company, versions, selectedId) {
    const sel = document.getElementById("era-version-select");
    if (!sel) return;
    sel.innerHTML = "";

    // 原版简历：永远置顶
    const originOpt = document.createElement("option");
    originOpt.value = ORIGIN_VERSION;
    originOpt.textContent = "原版简历";
    sel.appendChild(originOpt);

    let effectiveSelected = selectedId;
    if (!effectiveSelected) {
      if (!company) {
        // 未识别到公司：手动模式默认用原版简历
        effectiveSelected = ORIGIN_VERSION;
      } else {
        // 默认选该公司的默认/最新版本；没有则保留原版
        const def = versions.find((v) => v.isDefault);
        const latest = versions[0];
        effectiveSelected = def?.id ? String(def.id) : (latest?.id ? String(latest.id) : ORIGIN_VERSION);
      }
    }

    let found = false;
    for (const v of versions) {
      const opt = document.createElement("option");
      const vid = String(v.id || "");
      opt.value = vid;
      const date = v.createdAt ? String(v.createdAt).slice(0, 10) : "";
      const defMark = v.isDefault ? "（默认）" : "";
      const job = v.jobTitle ? ` · ${v.jobTitle}` : "";
      opt.textContent = `${v.company}${job}${defMark}${date ? " · " + date : ""}`;
      sel.appendChild(opt);
      if (vid && vid === effectiveSelected) found = true;
    }

    sel.value = found ? effectiveSelected : ORIGIN_VERSION;
    sel.disabled = false;
    runtime.selectedVersionId = sel.value;
    runtime.selectedVersionLabel = sel.selectedOptions?.[0]?.textContent || "原版简历";
  }

  async function handleVersionSelectChange() {
    const sel = document.getElementById("era-version-select");
    if (!sel) return;
    const versionId = sel.value || ORIGIN_VERSION;
    runtime.selectedVersionId = versionId;
    runtime.selectedVersionLabel = sel.selectedOptions?.[0]?.textContent || "原版简历";
    // 识别到公司按公司名持久化；未识别按当前域名持久化（手动选择记忆）
    await persistSelectedVersion(runtime.detectedCompany, versionId);
    setPanelNotice(`已切换简历版本：${runtime.selectedVersionLabel}`, "info");
    renderPanel(runtime.lastReport);
  }

  async function refreshVersionSelector() {
    const company = runtime.detectedCompany;
    if (company) {
      const versions = await loadVersionsForCompany(company);
      runtime.companyVersions = versions;
      const stored = await loadSelectedVersion(company);
      renderVersionSelector(company, versions, stored);
    } else {
      // 手动模式：重新拉取全部版本并列出
      const api = getPluginApi();
      if (!api) return;
      const versions = await api.listAllVersions().catch(() => []);
      runtime.companyVersions = versions
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const stored = await loadSelectedVersion(null);
      renderVersionSelector(null, runtime.companyVersions, stored);
    }
  }

  async function handlePanelAction(action) {
    if (action === "close") {
      togglePanel(false);
      return;
    }
    if (action === "options") {
      chrome.runtime.sendMessage({ type: "ERA_OPEN_OPTIONS" });
      return;
    }
    if (action === "clear") {
      clearMarks();
      runtime.lastReport = null;
      clearDetectedCompany();
      renderPanel(null);
      return;
    }

    const profile = runtime.lastProfile || await loadStoredProfile();
    setPanelBusy(true);
    try {
      if (action === "scan") {
        setPanelNotice("正在检测...", "info");
        const report = await scan(profile);
        renderPanel(report, "scan");
      }
      if (action === "fill") {
        setPanelNotice("正在填写...", "info");
        const report = await fill(profile);
        renderPanel(report, "fill");
      }
    } catch (error) {
      const message = String(error.message || error);
      runtime.lastReport = { records: 0, mappings: 0, skipped: 0, items: [], error: message };
      renderPanel(runtime.lastReport);
      setPanelNotice(message, "error");
    } finally {
      setPanelBusy(false);
    }
  }

  function getSectionText(element) {
    let current = element;
    for (let depth = 0; depth < 7 && current; depth += 1, current = current.parentElement) {
      const heading = current.querySelector?.(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,.brick-form-section-title,.section-title");
      const text = clean(heading?.innerText || heading?.textContent);
      if (text) return text;
      // Sunwz|2026-08-24|奥比中光：模块标题是 <div id="xxx">，与 _addButton 同 id 前缀；
      // addButton 通常在 form-part 外面（同模块 footer），所以要在更广范围查找：当前层、子层、整个祖先链中找一次
      const addBtn = current.querySelector?.("[id$='_addButton']");
      if (addBtn) {
        const modId = (addBtn.id || "").replace(/_addButton$/, "");
        const titleEl = modId ? document.getElementById(modId) : null;
        const t = clean(titleEl?.innerText || titleEl?.textContent);
        if (t) return t;
      }
    }
    return "";
  }
  // Sunwz|2026-08-24|奥比中光：form-part 的 addButton 是同级兄弟（在 form 容器内），向上找 form 根后回查兄弟
  function getSectionTextByForm(element) {
    let current = element;
    for (let depth = 0; depth < 14 && current; depth += 1, current = current.parentElement) {
      if (current.tagName === "FORM" || (current.querySelector && current.querySelector(".form-part"))) {
        // 找到 form 根，找里面所有 _addButton
        const addBtn = current.querySelector("[id$='_addButton']");
        if (addBtn) {
          const modId = (addBtn.id || "").replace(/_addButton$/, "");
          const titleEl = modId ? document.getElementById(modId) : null;
          const t = clean(titleEl?.innerText || titleEl?.textContent);
          if (t) return t;
        }
        // 继续向上找（嵌套 form）
      }
    }
    return "";
  }

  function nearestBaiduHeading(element) {
    const targetTop = element.getBoundingClientRect().top + window.scrollY;
    let best = "";
    let bestTop = -Infinity;
    const terms = ["基础信息", "个人信息", "求职意向", "教育经历", "工作经历", "项目经验", "获奖信息", "获奖经历", "奖惩情况", "作品集", "附件上传", "附件"];
    for (const node of document.querySelectorAll("h1,h2,h3,h4,div,span")) {
      if (!visible(node)) continue;
      const text = clean(node.innerText || node.textContent);
      if (!terms.includes(text)) continue;
      const top = node.getBoundingClientRect().top + window.scrollY;
      if (top <= targetTop + 2 && top > bestTop) {
        bestTop = top;
        best = text;
      }
    }
    return best;
  }

  function inferBaiduSection(field, label) {
    const className = String(field.className || "");
    const loweredClass = className.toLowerCase();
    const normalizedLabel = matcher.normalizeText(label);
    if (/个人简历文件|简历文件|上传简历|简历附件|个人照片|证件照|上传照片/.test(normalizedLabel)) return "附件";
    if (/招聘信息来源/.test(normalizedLabel)) return "其他信息";
    if (/可线下面试城市|是否接受调剂|目标工作城市|目标职位类别|可面试方式|期望薪资|预计入职时间/.test(normalizedLabel)) return "求职意向";
    if (/姓名|性别|移动电话|电子邮箱|国籍地区|身份证号|身份证号码|证件号码/.test(normalizedLabel)) return "基础信息";
    if (/学校|学历|专业|gpa|绩点|成绩排名|专业排名|班级排名/.test(normalizedLabel)) return "教育经历";
    if (/企业名称|行业类别|所在部门|职位名称|职位年薪|工作地点|工作描述/.test(normalizedLabel)) return "工作经历";
    if (/获奖|奖惩|荣誉|颁奖|奖励/.test(normalizedLabel)) return "获奖经历";
    if (/作品集|作品名称|作品链接|作品描述/.test(normalizedLabel)) return "作品集";
    if (/项目名称|项目职务|项目描述|项目职责/.test(normalizedLabel)) return "项目经验";
    if (/(?:^|\s)field-\d+-(?:name|sex|gender|mobile|email|country|idnumber)(?:\s|$)/.test(loweredClass)) return "基础信息";
    if (/targetcity|targetpositiontype|interviewonlinetype|offlineinterviewcity|adjust/.test(loweredClass)) return "求职意向";
    if (/resumefile|photofile|attachment|upload/.test(loweredClass)) return "附件";
    if (/school|academic|major|gpatype|gpascore|scorerank|rank/.test(loweredClass)) return "教育经历";
    if (/companyname|industrytype|department|positionname|postpay|workin|workdesc/.test(loweredClass)) return "工作经历";
    if (/award|honou?r|prize/.test(loweredClass)) return "获奖经历";
    if (/portfolio|workcollection/.test(loweredClass)) return "作品集";
    if (/subjectname|subjectdesc|positiondesc|subjectdate/.test(loweredClass)) return "项目经验";

    const heading = nearestBaiduHeading(field) || getSectionText(field);
    const text = matcher.normalizeText(`${heading} ${label}`);
    if (text.includes("项目")) return "项目经验";
    if (text.includes("作品")) return "作品集";
    if (text.includes("获奖") || text.includes("奖惩") || text.includes("荣誉")) return "获奖经历";
    if (text.includes("工作")) return "工作经历";
    if (text.includes("求职") || text.includes("调剂") || text.includes("面试城市")) return "求职意向";
    if (text.includes("教育") || text.includes("学校") || text.includes("学历")) return "教育经历";
    if (text.includes("附件") || text.includes("上传") || text.includes("照片")) return "附件";
    if (text.includes("基础") || text.includes("目标")) return "基础信息";
    return getSectionText(field) || "基础信息";
  }

  function repeatIndexFrom(field) {
    const source = `${field.className || ""} ${field.querySelector?.("input,textarea")?.name || ""}`;
    const match = source.match(/(?:school|academic|major|gpaType|gpaScore|scoreRank|rank|companyName|industryType|department|positionName|postPay|workIn|workDesc|awardName|awardIssuer|awardDesc|subjectName|subjectDesc|positionDesc|portfolioName|portfolioUrl|portfolioDesc|position)(\d+)/i) ||
      source.match(/field-\d+-[a-z_-]+(\d+)/i);
    if (match) return Number(match[1]);
    // Sunwz|2026-08-06|百度重复经历行无数字后缀时，按同区域内同标签字段出现顺序推算行号，防止两条经历都填成第一行数据
    const label = baiduFieldLabel(field);
    if (label) {
      const section = inferBaiduSection(field, label);
      const siblings = Array.from(document.querySelectorAll(".brick-field"))
        .filter((candidate) => {
          if (!visible(candidate)) return false;
          const candidateLabel = baiduFieldLabel(candidate);
          return candidateLabel === label && inferBaiduSection(candidate, candidateLabel) === section;
        });
      const index = siblings.indexOf(field);
      if (index >= 0) return index;
    }
    // Sunwz|2026-08-06|百度重复经历行无数字后缀时，按同区域内同标签字段出现顺序推算行号，防止两条经历都填成第一行数据——END
    return 0;
  }

  function baiduFieldLabel(field) {
    const label = field.querySelector(".brick-field-label");
    return clean(label?.innerText || label?.textContent).replace(/^\*+/, "").trim();
  }

  function controlTypeFor(field, element) {
    // Sunwz|2026-08-15|秋招通通用站点字段类型智能识别（奥比中光等第三方组件）
    // <select> 原生 → select
    if (element?.tagName === "SELECT") return "select";
    // 自定义组件：.el-select/.ant-select/.el-cascader → select；(单选组 → radio)
    if (field.querySelector(".el-select,.ant-select,.el-cascader,[class*='select-trigger'],[class*='combo-trigger'],[role='combobox']")) return "select";
    if (field.querySelector(".el-radio-group,[class*='radio-group'],[role='radiogroup']")) return "radio";
    if (field.querySelector(".el-checkbox-group")) return "checkbox";
    if (field.querySelector(".el-date-picker,.ant-picker,[class*='date-picker'],[class*='datepicker']") || element?.type === "date") return "date";
    // Sunwz|2026-08-15|——END
    if (field.querySelector(".brick-select,.ant-select")) return "select";
    if (element?.type === "radio") return "radio";
    if (element?.type === "checkbox") return "checkbox";
    if (element?.tagName === "TEXTAREA") return "textarea";
    if (element?.type === "month") return "month";
    if (element?.type === "date") return "date";
    return element?.type || "text";
  }

  // Sunwz|2026-08-27|分段锚（按值）：向上找本段「单位名称/项目名称/学校名称」等锚字段的已填值，
  // 该值在各分段唯一且稳定，比模块标题更可靠（奥比中光低代码表单常无规范模块标题）。
  // 用于日期/重复字段在 fill 时按「锚值+段序」精确定位，避免实习/项目 repeatIndex 同为 0 起算导致的错位。
  function anchorValueOf(el) {
    let node = el;
    for (let d = 0; d < 12 && node; d += 1) {
      // Sunwz|2026-08-27|优先读 processMappings 填写成功后打在容器上的段锚/段序（比读字段值更稳）
      if (node.getAttribute) {
        const anchored = node.getAttribute("data-era-seg-anchor");
        if (anchored && anchored !== "__pending__") return anchored;
      }
      const fields = node.querySelectorAll ? node.querySelectorAll(".form-item") : [];
      for (const f of fields) {
        const fl = f.querySelector && f.querySelector("label") ? f.querySelector("label").textContent : "";
        if (/单位名称|项目名称|学校名称|公司名称|公司|组织名称|在校职务名称/.test(fl || "")) {
          const inp = f.querySelector("input,textarea,.phoenix-select,[class*=phoenix-select],select");
          const v = inp ? (inp.value || inp.textContent || "").trim() : "";
          if (v && !/请选择/.test(v)) return v;
        }
      }
      node = node.parentElement;
    }
    return "";
  }
  // Sunwz|2026-08-27|从 profile 取某段的标准锚值（单位名称/项目名称/学校名称/组织名称）
  function profileAnchorForSection(profile, section, idx) {
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const item = sections[section]?.items?.[idx];
    if (!item) return "";
    const v = item.values || {};
    if (section === "internship" || section === "work") return v["公司"] || "";
    if (section === "project") return v["项目名称"] || v["项目"] || "";
    if (section === "education") return v["学校"] || v["学校名称"] || "";
    if (section === "student") return v["组织名称"] || v["社团名称"] || v["实践名称"] || "";
    if (section === "studentOfficer") return v["在校职务名称"] || "";
    return "";
  }

  function makeRecord(partial) {
    return {
      id: `era_${partial.index}`,
      index: partial.index,
      label: partial.label,
      context: partial.context || "",
      repeatIndex: partial.repeatIndex || 0,
      segAnchor: partial.element ? anchorValueOf(partial.element) : "",
      type: partial.type || "text",
      placeholder: partial.element?.getAttribute?.("placeholder") || "",
      name: partial.element?.getAttribute?.("name") || "",
      element: partial.element || null,
      root: partial.root || partial.element || null,
    };
  }

  function scanBaiduRecords() {
    const records = [];
    const fields = Array.from(document.querySelectorAll(".brick-field")).filter(visible);
    let index = 0;

    for (const field of fields) {
      const label = baiduFieldLabel(field);
      if (!label) continue;
      if (/我已阅读|申请须知/.test(clean(field.innerText))) continue;

      const context = inferBaiduSection(field, label);
      const repeatIndex = repeatIndexFrom(field);
      const fileInput = field.querySelector("input[type='file']");
      if (fileInput || /个人简历文件|简历文件|上传简历|简历附件|个人照片|证件照|上传照片/.test(matcher.normalizeText(label))) {
        records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: "file", element: fileInput || field, root: field }));
        continue;
      }
      const textInputs = Array.from(field.querySelectorAll("input:not([type='hidden']):not([type='file']), textarea")).filter(visible);
      const radio = textInputs.find((element) => element.type === "radio");
      const checkbox = textInputs.find((element) => element.type === "checkbox");

      if (label === "起止时间") {
        const start = textInputs.find((element) => /开始/.test(element.placeholder || ""));
        const end = textInputs.find((element) => /结束/.test(element.placeholder || ""));
        if (start) records.push(makeRecord({ index: index += 1, label: "开始时间", context, repeatIndex, type: "month", element: start, root: field }));
        if (end) records.push(makeRecord({ index: index += 1, label: "结束时间", context, repeatIndex, type: "month", element: end, root: field }));
        continue;
      }

      if (radio) {
        records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: "radio", element: radio, root: field }));
        continue;
      }

      if (checkbox) {
        records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: "checkbox", element: checkbox, root: field }));
        continue;
      }

      // Sunwz|2026-08-06|证件号码实际是文本输入，但百度字段内部带了 brick-select 结构会被误判为下拉框，强制按文本填
      if (/证件号码|身份证号|证件号/.test(matcher.normalizeText(label)) && textInputs.length) {
        records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: "text", element: textInputs[0], root: field }));
        continue;
      }
      // Sunwz|2026-08-06|证件号码实际是文本输入，但百度字段内部带了 brick-select 结构会被误判为下拉框，强制按文本填——END

      if (field.querySelector(".brick-select,.ant-select")) {
        const element = field.querySelector("input[role='combobox'],input[type='search'],.brick-select-selection,.ant-select-selector") || field;
        records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: "select", element, root: field }));
        continue;
      }

      const element = textInputs[0] || field.querySelector("[contenteditable='true']");
      if (!element) continue;
      records.push(makeRecord({ index: index += 1, label, context, repeatIndex, type: controlTypeFor(field, element), element, root: field }));
    }

    // Sunwz|2026-08-06|百度"无学术成果/无工作经历/无获奖信息"勾选框不在 .brick-field 内，单独识别（无学术成果需勾选）
    for (const labelEl of document.querySelectorAll("label.brick-checkbox")) {
      const text = clean(labelEl.querySelector(".brick-checkbox-label")?.innerText || labelEl.innerText || "");
      if (!/无学术成果|无工作经历|无获奖信息/.test(text)) continue;
      const input = labelEl.querySelector('input[type="checkbox"]');
      if (!input || !visible(input)) continue;
      records.push(makeRecord({ index: index += 1, label: clean(text), context: "其他信息", repeatIndex: 0, type: "checkbox", element: input, root: labelEl }));
    }
    // Sunwz|2026-08-06|百度"无学术成果/无工作经历/无获奖信息"勾选框不在 .brick-field 内，单独识别（无学术成果需勾选）——END

    return records;
  }

  function associatedLabel(element) {
    const pieces = [];
    if (element.labels) pieces.push(...Array.from(element.labels).map((label) => label.innerText || label.textContent));
    pieces.push(
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.id,
      element.getAttribute("title")
    );
    const label = element.closest?.("label");
    if (label) pieces.push(label.innerText || label.textContent);
    // Sunwz|2026-08-07|优先 .form-item（BOE 等表单容器），避免 closest 先匹配到控件内部的 li/span 等子结构
    const formItem = element.closest?.(".form-item");
    const row = formItem || element.closest?.(".form-group,.ant-form-item,.el-form-item,.brick-field,fieldset,tr,li,section");
    const rowLabel = row?.querySelector?.("label,.ant-form-item-label,.el-form-item__label,.brick-field-label,legend,th,.form-item__text");
    if (rowLabel) pieces.push(rowLabel.innerText || rowLabel.textContent);

    // Sunwz|2026-08-06|低代码表单（简道云等）标签与输入框无标准关联：子表单单元格按表头列匹配，普通字段向上找 .field-name/.field-label
    const hasAnyText = pieces.filter(Boolean).some((text) => {
      const t = String(text || "").trim();
      if (/^请选择|^请输入|^请填写|^请上传/.test(t) && t.length < 10) return false;
      return /[一-龥A-Za-z]/.test(t);
    });
    if (!hasAnyText) {
      let found = false;
      const cell = element.closest?.(".subform-cell");
      if (cell) {
        const row = cell.parentElement;
        const cells = Array.from(row?.querySelectorAll?.(":scope > .subform-cell") || []);
        const index = cells.indexOf(cell);
        const subform = row?.closest?.(".fx-subform") || element.closest?.(".fx-subform");
        const headTitles = subform ? Array.from(subform.querySelectorAll(".subform-head .subform-cell .subform-title")) : [];
        const title = headTitles[index];
        if (title) {
          const text = clean(title.innerText || title.textContent);
          if (/[一-龥A-Za-z]/.test(text) && text.length < 40) {
            pieces.push(text);
            found = true;
          }
        }
      }
      if (!found) {
        let cursor = element;
        for (let depth = 0; depth < 8 && cursor; depth += 1, cursor = cursor.parentElement) {
          const nameEl = cursor.querySelector?.(".field-name,[class*='field-name']") ||
            cursor.querySelector?.(".field-label,[class*='field-label'],.form-label,.input-label,.form-item__text,[class*='form-item__title']");
          if (nameEl) {
            const text = clean(nameEl.innerText || nameEl.textContent);
            if (/[一-龥A-Za-z]/.test(text) && text.length < 40) {
              pieces.push(text);
              break;
            }
          }
        }
      }
    }
    // Sunwz|2026-08-06|——END

    return clean(pieces.filter(Boolean).join(" ")).slice(0, 180);
  }

  // Sunwz|2026-08-06|子表单列名 → 资料分区（简道云等低代码平台通用）
  function subformSectionName(titles) {
    const text = titles.join(" ");
    if (/获奖类型|奖项名称|获奖大赛|赛事级别/.test(text)) return "获奖经历";
    if (/社团名称|社团干部/.test(text)) return "校园经历";
    if (/学校|学历|学号|专业|院校/.test(text)) return "教育经历";
    if (/项目名称|项目内容|项目职责/.test(text)) return "项目经历";
    if (/公司|职位|工作描述|工作类型/.test(text)) return "工作经历";
    return "";
  }
  // Sunwz|2026-08-06|——END

  // Sunwz|2026-08-15|秋招通通用站点：repeat 子表单共同父容器边界识别（奥比中光等 .el-form-item/.ant-row 等）
  // 每个 repeat 段应有共同父容器，同一父容器内字段算同一段（比单纯 label 计数更稳）
  function nearestRepeatContainer(element) {
    const CONTAINER_SELECTOR = ".form-item-group,.el-form-item,.ant-row,.fx-subform,.fx-subform-row,.repeat-item,.repeat-block,[class*='form-group'],[class*='repeat'],[class*='subform'],[class*='card-item'],[data-repeat]";
    let cur = element;
    for (let i = 0; i < 10 && cur; i += 1, cur = cur.parentElement) {
      if (cur.matches?.(CONTAINER_SELECTOR)) return cur;
    }
    return null;
  }
  // 取字段所属分区标题（教育经历/实习经历/在校职务等），用于段内 repeatIndex 计数
  function segmentSectionKey(element) {
    let cur = element;
    for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
      const heads = cur.querySelectorAll?.("h1,h2,h3,h4,h5,h6,[class*='section-title'],[class*='form-title'],[class*='section-title'],legend");
      for (const h of heads) {
        const t = clean(h.innerText || "");
        if (t && t.length < 16 && /教育|实习|工作|获奖|职务|论文|专著|附加|信息/.test(t)) return t;
      }
    }
    // 兜底：用最近的 repeat 容器 class 作为段标识（奥比中光等无分区标题时）
    const container = nearestRepeatContainer(element);
    if (container) return container.className || "repeat";
    return "";
  }
  // Sunwz|2026-08-15|——END

  function scanGenericRecords() {
    const records = [];
    const seen = new Set();
    const labelCounts = {};
    const push = (record) => {
      if (record && record.label && !seen.has(record.element)) {
        // Sunwz|2026-08-15|通用站点 repeatIndex 边界识别：计数键包含最近的 repeat 容器边界，
        // 同一容器内的同名标签顺序计段，跨容器（不同实习段）独立计数，避免第2段内容错填第3段
        if (record.repeatIndex === 0) {
          const sectionKey = segmentSectionKey(record.element);
          const box = nearestRepeatContainer(record.element);
          const boxKey = box ? `${box.tagName}.${box.className}` : "";
          const key = boxKey + "::" + sectionKey + "::" + record.label;
          const count = labelCounts[key] || 0;
          record.repeatIndex = count;
          labelCounts[key] = count + 1;
        }
        // Sunwz|2026-08-15|——END
        seen.add(record.element);
        records.push(record);
      }
    };

    const selector = [
      "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image'])",
      "textarea",
      "select",
      "[contenteditable='true']",
    ].join(",");
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (element.type === "file" || !visible(element)) continue;
      if (element.closest("#era-status")) continue;
      // Sunwz|2026-08-07|phoenix-select（BOE 下拉）的内部 input 由下拉处理，不单独扫成文本，避免重复记录
      if (element.closest?.(".phoenix-select,[class*='phoenix-select']")) continue;
      // Sunwz|2026-08-07|——END
      // Sunwz|2026-08-06|子表单单元格：按行号分配 repeatIndex、按表头推断分区上下文（否则多行都匹配到第一行数据）
      const subformRow = element.closest(".fx-subform-row");
      let repeatIndex = 0;
      let context = getSectionText(element) || getSectionTextByForm(element);
      if (subformRow) {
        const rows = Array.from(subformRow.parentElement.querySelectorAll(":scope > .fx-subform-row"));
        repeatIndex = rows.indexOf(subformRow);
        const subform = subformRow.closest(".fx-subform");
        const titles = Array.from(subform.querySelectorAll(".subform-head .subform-cell .subform-title")).map((t) => clean(t.innerText || t.textContent));
        context = subformSectionName(titles) || context;
      }
      // Sunwz|2026-08-06|——END
      const elementLabel = associatedLabel(element);
      // Sunwz|2026-08-06|独立字段"本科学校/本科专业/研究生毕业时间"等：本科→教育经历第2条(repeatIndex 1)，研究生/硕士→第1条(0)
      if (!subformRow && /^(本科|研究生|硕士)/.test(elementLabel) && /学校|专业|毕业|排名|学历|学位/.test(elementLabel)) {
        repeatIndex = /^本科/.test(elementLabel) ? 1 : 0;
      }
      // Sunwz|2026-08-06|——END
      // Sunwz|2026-08-06|低代码平台 datetime 控件（简道云 x-datetime 等）：按 month 类型填 YYYY-MM（直接填完整日期会被组件拒收）
      const isDateTime = !!element.closest?.(".x-datetime,[class*='datetime'],[class*='date-input'],[class*='date-picker']");
      // Sunwz|2026-08-06|——END
      push(makeRecord({
        index: records.length + 1,
        label: elementLabel,
        context,
        repeatIndex,
        type: isDateTime ? "month" : controlTypeFor(element.closest(".brick-field") || element, element),
        element,
        root: element.closest(".subform-cell,.brick-field,.ant-form-item,.el-form-item,.form-item,label,.fx-field,[class*='form-field']") || element,
      }));
    }

    // Sunwz|2026-08-06|低代码平台（简道云等）自定义下拉触发器：点开式 combo，非原生 select；也覆盖 [role='combobox']
    for (const trigger of document.querySelectorAll(".x-combo,.phoenix-select,[class*='combo-trigger'],[class*='select-trigger'],[class*='select-selection'],[role='combobox']")) {
      if (!visible(trigger)) continue;
      if (trigger.closest("#era-status")) continue;
      const root = trigger.closest(".subform-cell,.fx-field,[class*='form-field'],[class*='field'],.form-item,label,.ant-form-item,.el-form-item") || trigger;
      // Sunwz|2026-08-06|子表单 combo 单元格：同样按行号/表头推断 repeatIndex 与分区
      const subformRow = trigger.closest(".fx-subform-row");
      let repeatIndex = 0;
      let context = getSectionText(root) || getSectionTextByForm(root);
      if (subformRow) {
        const rows = Array.from(subformRow.parentElement.querySelectorAll(":scope > .fx-subform-row"));
        repeatIndex = rows.indexOf(subformRow);
        const subform = subformRow.closest(".fx-subform");
        const titles = Array.from(subform.querySelectorAll(".subform-head .subform-cell .subform-title")).map((t) => clean(t.innerText || t.textContent));
        context = subformSectionName(titles) || context;
      }
      // Sunwz|2026-08-06|独立 combo 字段"本科学校/研究生学校/本科成绩排名"等：本科→repeatIndex 1，研究生/硕士→0
      const comboLabel = associatedLabel(root.querySelector?.("input,textarea") || trigger);
      if (!subformRow && /^(本科|研究生|硕士)/.test(comboLabel) && /学校|专业|毕业|排名|学历|学位/.test(comboLabel)) {
        repeatIndex = /^本科/.test(comboLabel) ? 1 : 0;
      }
      // Sunwz|2026-08-06|——END
      // Sunwz|2026-08-24|日期类 phoenix-select（开始/结束时间等）扫描时即标记 month，避免被当普通下拉走 select 路径
      const isDateCombo = /开始时间|结束时间|获得时间|奖惩时间|获奖时间|毕业时间|入学时间|发证日期|获取时间|发布时间|出生日期/.test(comboLabel);
      push(makeRecord({
        index: records.length + 1,
        label: comboLabel,
        context,
        repeatIndex,
        type: isDateCombo ? "month" : "select",
        element: trigger,
        root,
      }));
    }

    // Sunwz|2026-08-06|低代码平台自定义单选组（简道云 x-radio-group 等）
    for (const group of document.querySelectorAll("[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']")) {
      if (!visible(group)) continue;
      if (group.closest("#era-status")) continue;
      // Sunwz|2026-08-06|跳过嵌套的内层 radio-group（外层容器已包含所有选项），避免同一单选组生成重复记录
      if (group.parentElement?.closest?.("[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']")) continue;
      // Sunwz|2026-08-06|——END
      const options = Array.from(group.querySelectorAll("[class*='radio'],[role='radio']")).filter(visible);
      if (!options.length) continue;
      const root = group.closest(".fx-field,[class*='form-field'],[class*='field'],.form-item,label,.ant-form-item,.el-form-item") || group;
      // Sunwz|2026-08-06|radio 标签取 group 本身（group 在 .fx-field 内，向上能找到 field-name；传 root 反而找不到）
      const labelEl = root.querySelector?.(".field-name,[class*='field-name']") || group;
      // Sunwz|2026-08-06|——END
      push(makeRecord({
        index: records.length + 1,
        label: associatedLabel(labelEl),
        context: getSectionText(root),
        type: "radio",
        element: options[0],
        root,
      }));
    }
    // Sunwz|2026-08-06|——END

    return records;
  }

  function mokaKnownLabel(field) {
    const text = clean(field.innerText || field.textContent);
    const labels = [
      "本人郑重承诺已确认声明",
      "同步更新在线简历",
      "应聘者本人签名",
      "出生日期 (年龄)",
      "出生日期",
      "最近毕业专业",
      "上传简历",
      "上传附件",
      "手机号码",
      "最高学历",
      "毕业学校",
      "毕业院校",
      "毕业时间",
      "姓名",
      "邮箱",
      "性别",
      "籍贯",
      "声明",
      "日期",
      // Sunwz|2026-08-12|Moka 补充字段：目前所在地、工作经验、最近公司、期望城市、获奖等
      "目前所在地",
      "工作经验",
      "最近公司",
      "最近职位",
      "期望城市",
      "当前薪资",
      "期望薪资",
      "到岗时间",
      "微信",
      "就读时间",
      "学校名称",
      "专业名称",
      "公司名称",
      "职位名称",
      "工作职责",
      "奖项名称",
      "起止时间",
      "推荐码",
      // Sunwz|2026-08-12|——END
    ];
    return labels.find((label) => text.includes(label)) || "";
  }

  function scanMokaRecords() {
    const records = [];
    const fields = Array.from(document.querySelectorAll("[class*='apply-field-']")).filter(visible);
    // Sunwz|2026-09-08|Moka 字段扫描兜底：未命中已知 label 但有可写控件时，仍生成记录让通用 matcher 匹配项目/实习等内容字段
    const labelCounts = {};
    const getBlockKey = (field) => {
      const block = field.closest("[class*='apply-block-']");
      if (!block) return "";
      const title = block.querySelector("[class*='blockTitle']");
      return title ? String(title.innerText).trim().replace(/\n.*/, "") : "";
    };
    let index = 0;
    for (const field of fields) {
      let label = mokaKnownLabel(field);
      const blockKey = getBlockKey(field);
      const context = blockKey || clean(field.closest("[class*='apply-section'],[class*='apply-form']")?.querySelector("h2,h3,[class*='title']")?.innerText || "");

      if (!label || /扫码签名/.test(label)) {
        const textInputs = Array.from(field.querySelectorAll("input:not([type='hidden']):not([type='file']):not([type='checkbox']),textarea,[contenteditable='true']")).filter(visible);
        const element = textInputs[0] || field.querySelector("[contenteditable='true']");
        if (!element) continue;
        label = clean(field.innerText || field.textContent).slice(0, 30);
        if (!label) continue;
        const countKey = blockKey + "::" + label;
        const repeatIndex = labelCounts[countKey] || 0;
        labelCounts[countKey] = repeatIndex + 1;
        records.push(makeRecord({
          index: index += 1,
          label,
          context: context || "个人信息",
          repeatIndex,
          type: controlTypeFor(field, element),
          element,
          root: field,
        }));
        continue;
      }

      const inputs = Array.from(field.querySelectorAll("input:not([type='hidden']):not([type='file']),textarea")).filter(visible);
      if (/上传/.test(label)) {
        const fileInput = field.querySelector("input[type='file']");
        records.push(makeRecord({ index: index += 1, label, context: "附件", type: "file", element: fileInput || field, root: field }));
        continue;
      }
      const checkbox = inputs.find((input) => input.type === "checkbox");
      const textInputs = inputs.filter((input) => input.type !== "checkbox");

      if (label === "手机号码") {
        const phone = textInputs.find((input) => /手机号/.test(input.placeholder || "")) || textInputs[textInputs.length - 1];
        if (phone) records.push(makeRecord({ index: index += 1, label, context: context || "个人信息", type: "text", element: phone, root: field }));
        continue;
      }

      if (label === "毕业时间") {
        const year = textInputs.find((input) => input.placeholder === "年");
        const month = textInputs.find((input) => input.placeholder === "月");
        if (year) records.push(makeRecord({ index: index += 1, label: "毕业时间-年", context: context || "个人信息", type: "select", element: year, root: field }));
        if (month) records.push(makeRecord({ index: index += 1, label: "毕业时间-月", context: context || "个人信息", type: "select", element: month, root: field }));
        continue;
      }

      if (checkbox) {
        records.push(makeRecord({ index: index += 1, label, context: /声明/.test(label) ? "声明" : context, type: "checkbox", element: checkbox, root: field }));
        continue;
      }

      const element = textInputs[0] || field.querySelector("[contenteditable='true']");
      if (!element) continue;
      // Sunwz|2026-08-12|Moka 下拉识别补充：出生日期、工作经验、期望城市、目前所在地、最高学历、毕业院校等
      const isSelect = field.querySelector("[class*='sd-Select-container'],[class*='sd-Dropdown-container']") && /请选择|请输入最近毕业专业|年|月|籍贯|出生日期|年龄|经验|城市|所在地|学历|院校|专业|学位/.test(element.placeholder || label);
      // Sunwz|2026-08-12|——END
      // Sunwz|2026-08-12|Moka 奖项重复字段：按 block+label 计数分配 repeatIndex
      const countKey = blockKey + "::" + label;
      const repeatIndex = labelCounts[countKey] || 0;
      labelCounts[countKey] = repeatIndex + 1;
      // Sunwz|2026-08-12|——END
      records.push(makeRecord({
        index: index += 1,
        label,
        context: context || "个人信息",
        repeatIndex,
        type: isSelect ? "select" : controlTypeFor(field, element),
        element,
        root: field,
      }));
    }
    return records;
  }

  // Sunwz|2026-08-12|Moka：点击获奖经历区域的"添加"按钮，补足奖项条目数
  function mokaAwardsAddButton() {
    // 找所有"添加 / Add"按钮，返回第一个在"获奖经历"标题之后的
    const addBtns = Array.from(document.querySelectorAll("button")).filter((b) => clean(b.innerText || "") === "添加 / Add" && visible(b));
    const allText = String(document.body.innerText || "");
    const awardsIdx = allText.indexOf("获奖经历");
    if (awardsIdx < 0) return addBtns[addBtns.length - 1] || null;
    // 找"获奖经历"之后第一个"添加"按钮（通过比较在页面中的位置）
    for (const btn of addBtns) {
      const btnRect = btn.getBoundingClientRect();
      // 简单策略：返回最后一个"添加"按钮（获奖经历通常在页面最下方）
    }
    return addBtns[addBtns.length - 1] || null;
  }

  function mokaCountAwardFields() {
    return Array.from(document.querySelectorAll("[class*='apply-field-']")).filter((el) => {
      const text = clean(el.innerText || "");
      return text.includes("奖项名称") && visible(el);
    }).length;
  }
  // Sunwz|2026-08-12|——END

  // Sunwz|2026-08-07|BOE（phoenix UI）专用扫描器：按 .form-part 行分组确定行类型与 repeatIndex，
  // 日期选择器识别为 date 类型、单选组识别为 radio、phoenix 下拉识别为 select，避免通用扫描的错配
  function boeFieldLabel(fi) {
    const title = fi.querySelector(".form-item__title .form-item__text, .form-item__title, label, legend, th");
    return clean(title?.innerText || title?.textContent || "").replace(/^\*+/, "").trim();
  }

  function boeSectionTypeFromText(text) {
    const value = clean(text);
    // Sunwz|2026-08-14|snowman/vivo 分区标题补充：求职意向/家庭/项目/语言/其他/附件/证书/计算机/自我评价
    if (/求职意向|应聘岗位|期望工作城市/.test(value)) return "intent";
    if (/家庭情况|家庭成员|添加家庭/.test(value)) return "family";
    if (/主要项目|任务经历|项目经历|添加主要项目|添加项目/.test(value)) return "project";
    if (/语言能力|添加语言/.test(value)) return "language";
    if (/其他信息|添加其他/.test(value)) return "other";
    if (/简历附件|附件上传/.test(value)) return "attachments";
    if (/证书|添加证书/.test(value)) return "certificates";
    if (/计算机|添加计算机/.test(value)) return "computer";
    if (/自我评价|添加自我评价/.test(value)) return "self";
    // Sunwz|2026-08-14|——END
    if (/教育经历|添加教育经历/.test(value)) return "education";
    if (/实习经历|添加实习经历/.test(value)) return "internship";
    if (/工作经历|添加工作经历/.test(value)) return "work";
    if (/获奖情况|获奖经历|添加获奖情况/.test(value)) return "awards";
    if (/在校职务|添加在校职务/.test(value)) return "studentOfficer";
    if (/在校实践|校园经历|社团经历|添加在校实践|添加校园经历|添加社团经历/.test(value)) return "student";
    if (/亲属声明|亲属信息|添加亲属声明/.test(value)) return "relative";
    return "";
  }

  function boePartAncestorType(part) {
    for (let current = part?.parentElement; current && current !== document.body; current = current.parentElement) {
      const directHeading = clean(current.querySelector?.(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,:scope > .form-title,:scope > .section-title")?.innerText || "");
      const headingType = boeSectionTypeFromText(directHeading);
      if (headingType) return headingType;

      const text = clean(current.innerText || current.textContent);
      // Sunwz|2026-08-14|vivo 添加按钮文本补充：证书/计算机能力/自我评价
      const addPhrases = Array.from(new Set(text.match(/添加(?:教育经历（按最高学历倒序）|教育经历|实习经历|工作经历|主要项目(?:\/任务经历)?|项目经历|获奖情况|在校职务|在校实践|校园经历|社团经历|语言能力|家庭情况|其他信息|亲属声明|证书|计算机能力|自我评价)/g) || []));
      // Sunwz|2026-08-14|——END
      if (addPhrases.length === 1) {
        const type = boeSectionTypeFromText(addPhrases[0]);
        if (type) return type;
      }
    }
    return "";
  }

  function boePartType(part) {
    const labels = Array.from(part.querySelectorAll(".form-item"))
      .map(boeFieldLabel)
      .filter(Boolean)
      .join(" ");
    // Sunwz|2026-08-13|snowman/vivo 分区识别：优先精确匹配，避免误判
    // 家庭情况（含"姓名"字段但不是 basic）
    if (/与本人关系|家庭情况/.test(labels)) return "family";
    // 求职意向
    if (/应聘岗位|期望从事职业|期望工作城市|期望月薪|期望年薪|求职状态|预计报到|是否接受岗位调剂/.test(labels)) return "intent";
    // 教育经历（含"学习形式"）
    if (/学校名称|毕业学校|学历|学位|专业名称|学院名称|GPA|成绩.*排名/.test(labels)) return "education";
    // 项目经历
    if (/项目名称|项目描述|项目职务|项目职责|项目角色/.test(labels)) return "project";
    // 计算机能力（vivo: 编程语言+掌握程度，区别于语言能力）
    if (/编程语言/.test(labels)) return "computer";
    // 语言能力（不含编程语言）
    if (/语言类型|听说能力|读写能力|听说|读写|外语种类|语言类别/.test(labels)) return "language";
    // 英语证书（vivo: 英语证书名称+成绩+获得时间）
    if (/英语证书名称|英语证书/.test(labels)) return "certificates";
    // 证书（通用：证书名称+获得时间，不含英语证书）
    if (/证书名称|证书描述/.test(labels)) return "certificates";
    // 其他信息
    if (/兴趣爱好|特长|何处得知招聘信息|获奖信息|职称及职业资格证书|其他外语水平/.test(labels)) return "other";
    // 自我评价（vivo: 评价内容）
    if (/评价内容|自我评价/.test(labels)) return "self";
    // 附件
    if (/简历附件|附件|上传简历/.test(labels)) return "attachments";
    // Sunwz|2026-08-13|——END

    if (/亲属|关系|单位和职务/.test(labels)) return "relative";

    const ancestorType = boePartAncestorType(part);
    if (ancestorType) return ancestorType;

    if (/在校职务|职务名称|级别/.test(labels)) return "studentOfficer";
    if (/实践名称|实践描述|社团名称|工作内容/.test(labels)) return "student";
    if (/实习地点|实习内容/.test(labels)) return "internship";
    // Sunwz|2026-08-14|vivo: work 正则排除"意向工作地点"等误触发词
    if (/所属行业|职业类别|工作性质|所在部门|部门|公司.*职位|工作描述/.test(labels)) return "work";
    if (/单位名称|职位名称|公司名称/.test(labels)) return "work";
    if (/奖项|获奖级别/.test(labels)) return "awards";
    if (/所属期刊/.test(labels)) return "papers";
    // Sunwz|2026-08-13|basic 兜底：只有真正的基础信息字段（含姓名/性别/出生日期等）才归 basic
    if (/姓名|性别|出生日期|证件照|证件号码|最高学历|最高学位|毕业时间|现居住地|户口所在地|生源地|籍贯|国籍|政治面貌|民族|通讯地址|第一志愿|第二志愿|英语等级|身高|面试地点/.test(labels)) return "basic";
    return "basic";
  }

  function boeRecordFor(fi, label, type, repeatIndex, index) {
    // Sunwz|2026-08-14|vivo 新分区：certificates/computer/self
    const section = { education: "教育经历", internship: "实习经历", work: "工作经历", studentOfficer: "在校职务", student: "在校实践", awards: "获奖经历", relative: "亲属声明", papers: "论文", project: "项目经历", intent: "求职意向", family: "家庭情况", language: "语言能力", other: "其他信息", attachments: "附件", certificates: "证书", computer: "计算机能力", self: "自我评价", basic: "" }[type] || "";
    // Sunwz|2026-08-14|——END
    const fileInput = fi.querySelector("input[type='file']");
    if (fileInput) {
      return makeRecord({ index, label, context: section, repeatIndex, type: "file", element: fileInput, root: fi });
    }
    // 月选/日选日期：开始/结束/获奖/发布时间（月），出生日期（日）
    if (/^(开始时间|结束时间|获奖时间|发布时间)$/.test(label) || label === "出生日期") {
      const trigger = fi.querySelector(".phoenix-select,[class*='phoenix-select'],[class*='date-picker']") || fi;
      return makeRecord({ index, label, context: section, repeatIndex, type: "date", element: trigger, root: fi });
    }
    const radioGroup = fi.querySelector("[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']");
    if (radioGroup) {
      const option = radioGroup.querySelector(".phoenix-radio,.x-radio,[role='radio']") || radioGroup;
      return makeRecord({ index, label, context: section, repeatIndex, type: "radio", element: option, root: fi });
    }
    const phoenixSelect = fi.querySelector(".phoenix-select,[class*='phoenix-select'],[class*='select-selection'],[role='combobox']");
    if (phoenixSelect) {
      return makeRecord({ index, label, context: section, repeatIndex, type: "select", element: phoenixSelect, root: fi });
    }
    const nativeSelect = fi.querySelector("select");
    if (nativeSelect) return makeRecord({ index, label, context: section, repeatIndex, type: "select", element: nativeSelect, root: fi });
    const checkbox = fi.querySelector("input[type='checkbox']");
    if (checkbox) return makeRecord({ index, label, context: section, repeatIndex, type: "checkbox", element: checkbox, root: fi });
    // Sunwz|2026-08-13|snowman 富文本编辑器（自我评价等）：phoenix-richeditor 内的 contenteditable div
    const richEditor = fi.querySelector("[contenteditable='true'],.edui-body-container,[class*='richeditor'] [contenteditable]");
    if (richEditor) {
      return makeRecord({ index, label, context: section, repeatIndex, type: "textarea", element: richEditor, root: fi });
    }
    // Sunwz|2026-08-13|——END
    const input = fi.querySelector("input:not([type='hidden']):not([type='file']):not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']");
    if (input) {
      return makeRecord({ index, label, context: section, repeatIndex, type: input.tagName === "TEXTAREA" ? "textarea" : (input.getAttribute?.("type") || "text"), element: input, root: fi });
    }
    return null;
  }

  function boeScanRecords() {
    const records = [];
    const seenElements = new Set();
    const seenFis = new Set();
    const rowCounts = {};
    const push = (record) => {
      if (record && !seenElements.has(record.element)) {
        seenElements.add(record.element);
        records.push(record);
      }
    };

    // 第一步：按 .form-part 行分组扫描
    let lastNonBasicType = "";
    let lastRepeatIndex = 0;
    for (const part of Array.from(document.querySelectorAll(".form-part"))) {
      if (!visible(part)) continue;
      const items = Array.from(part.querySelectorAll(".form-item")).filter(visible);
      if (!items.length) continue;
      const type = boePartType(part);
      // Sunwz|2026-08-14|vivo 单字段 part 续接：项目描述/实习内容/职务描述/证书描述/证书名称 复用上一个 part 的 repeatIndex
      const isContinuation = type === lastNonBasicType && items.length === 1 && /项目描述|实习内容|职务描述|证书描述|证书名称|工作职责|工作描述|工作内容/.test(boeFieldLabel(items[0]));
      const repeatIndex = isContinuation ? lastRepeatIndex : (type === "basic" ? 0 : (rowCounts[type] || 0));
      if (type !== "basic" && !isContinuation) {
        rowCounts[type] = repeatIndex + 1;
        lastNonBasicType = type;
        lastRepeatIndex = repeatIndex;
      }
      // Sunwz|2026-08-13|——END
      let index = records.length + 1;
      for (const fi of items) {
        seenFis.add(fi);
        const label = boeFieldLabel(fi);
        if (!label) continue;
        const record = boeRecordFor(fi, label, type, repeatIndex, index += 1);
        if (record) push(record);
      }
    }

    // 第二步：兜底扫描不在 .form-part 内的 .form-item（基本信息等散落字段）
    for (const fi of Array.from(document.querySelectorAll(".form-item"))) {
      if (!visible(fi) || seenFis.has(fi)) continue;
      const label = boeFieldLabel(fi);
      if (!label) continue;
      const record = boeRecordFor(fi, label, "basic", 0, records.length + 1);
      if (record) push(record);
    }

    return records;
  }
  // Sunwz|2026-08-07|——END

  // Sunwz|2026-08-07|AIRCAS（中科院空天院，Bootstrap form-horizontal）专属扫描器：
  // 中文标签在 .form-title DIV（控件 .form-info 的前一个兄弟），与输入框无 label/for 关联
  function aircasFieldLabel(el) {
    const info = el.closest(".form-info,[class*='form-info']");
    if (info) {
      const sibling = info.previousElementSibling;
      if (sibling && /form-title/.test(String(sibling.className || ""))) {
        return clean(sibling.innerText || sibling.textContent).replace(/^\*+/, "").replace(/[:：]\s*$/, "").trim();
      }
      const row = info.parentElement;
      const title = row?.querySelector(".form-title");
      if (title) return clean(title.innerText || title.textContent).replace(/^\*+/, "").replace(/[:：]\s*$/, "").trim();
    }
    return "";
  }

  function aircasScanRecords() {
    const records = [];
    const seen = new Set();
    const push = (record) => { if (record && !seen.has(record.element)) { seen.add(record.element); records.push(record); } };
    let index = 0;

    // radio 组（按 name 合并为一个记录）
    const radioGroups = new Map();
    for (const radio of Array.from(document.querySelectorAll("input[type='radio']"))) {
      if (!visible(radio) || radio.closest("#era-status")) continue;
      const name = radio.name || "";
      if (!name) continue;
      const label = aircasFieldLabel(radio);
      if (!radioGroups.has(name)) {
        radioGroups.set(name, { element: radio, root: radio.closest(".form-info,[class*='form-info'],.form-group,[class*='form-group'],.row,[class*='row']") || radio, label });
      }
    }
    for (const group of radioGroups.values()) {
      if (group.label) push(makeRecord({ index: index += 1, label: group.label, context: "基本信息", repeatIndex: 0, type: "radio", element: group.element, root: group.root }));
    }

    // 其他控件
    const selector = "input:not([type='hidden']):not([type='radio']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), textarea, select";
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (el.type === "file" || !visible(el)) continue;
      if (el.closest("#era-status")) continue;
      // checkbox 无 form-title（承诺/隐私协议区），按 name 识别
      if (el.type === "checkbox") {
        // Sunwz|2026-08-27|奥比中光：日期字段旁的"至今"复选框是日期的元控件（勾选则禁用结束日期），
        // 它位于日期 form-item 内、会被继承标签误标成"结束时间/毕业时间"并当成值字段勾上。
        // 绝不能把它当作值记录去勾选——交给 filler 的 uncheckUntilNow 在填真实日期前取消即可。
        const cbText = (el.closest(".phoenix-checkbox")?.textContent || el.parentElement?.textContent || "");
        if (/至今/.test(cbText)) continue;
        const cbLabel = el.name === "isPromise" ? "本人承诺信息属实" : el.name === "isPrivacyAgreement" ? "同意隐私协议" : aircasFieldLabel(el);
        if (!cbLabel) continue;
        push(makeRecord({ index: index += 1, label: cbLabel, context: "基本信息", repeatIndex: 0, type: "checkbox", element: el, root: el.closest("label,.form-info,[class*='form-info'],.row,[class*='row'],.txt-s,[class*='txt-s']") || el }));
        continue;
      }
      const label = aircasFieldLabel(el);
      if (!label) continue;
      const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.getAttribute?.("type") || "text");
      push(makeRecord({ index: index += 1, label, context: "基本信息", repeatIndex: 0, type, element: el, root: el.closest(".form-info,[class*='form-info'],.form-group,[class*='form-group'],.row,[class*='row']") || el }));
    }

    return records;
  }
  // Sunwz|2026-08-07|——END

  // Sunwz|2026-08-07|AIRCAS 可重复表格（教育经历等，RuoYi bootstrap-table）：
  // 表格无渲染"新增"按钮，直接调框架 $.modal.open 打开新增弹窗（iframe），填表后点确定提交
  function aircasWaitForModalIframe(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        if (typeof window.$ === "undefined" || !window.$.modal) return resolve(null);
        const fr = document.querySelector("iframe[id^='layui-layer-iframe'],iframe[id^='layui-layer']");
        if (fr && fr.contentDocument) {
          const doc = fr.contentDocument;
          if (doc.querySelector("input:not([type='hidden']),select,textarea")) return resolve(fr);
        }
        if (Date.now() - started > (timeoutMs || 15000)) return resolve(null);
        setTimeout(poll, 400);
      };
      poll();
    });
  }

  function aircasSetIframeField(doc, name, value) {
    const el = doc.querySelector(`[name="${name}"]`);
    if (!el) return false;
    if (el.tagName === "SELECT") {
      const option = Array.from(el.options).find((o) => (o.textContent || "").trim() === String(value).trim());
      if (option) { el.value = option.value; }
      else { el.value = String(value || ""); }
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) descriptor.set.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function aircasClickModalConfirm() {
    const btn = document.querySelector(".layui-layer-btn0");
    if (!btn) return false;
    const rect = btn.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: rect.left + 10, clientY: rect.top + 10, button: 0, buttons: 1 };
    btn.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1 }));
    btn.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, buttons: 0 }));
    btn.dispatchEvent(new MouseEvent("mousedown", base));
    btn.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    btn.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
    return true;
  }

  async function aircasFillEducationTable(profile) {
    if (siteId() !== "aircas" || typeof window.$ === "undefined" || !window.$.modal) return 0;
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const items = sections.education?.items || [];
    if (!items.length) return 0;
    const table = document.querySelector("#educationTableId");
    if (!table) return 0;
    const existing = new Set(
      Array.from(table.querySelectorAll("tbody tr")).map((tr) => clean(tr.querySelector("td")?.innerText || ""))
    );
    let added = 0;
    for (const item of items) {
      const v = item.values || {};
      const school = v["学校"] || "";
      if (!school || existing.has(school)) continue;
      // 清理可能残留的弹窗
      try { window.$(".layui-layer-close,layui-layer-close1").trigger("click"); } catch (e) {}
      await wait(400);
      window.$.modal.open("添加教育经历", "/system/edution/add");
      const fr = await aircasWaitForModalIframe(20000);
      if (!fr) { document.querySelector(".layui-layer-close,.layui-layer-btn1")?.click?.(); continue; }
      const doc = fr.contentDocument;
      aircasSetIframeField(doc, "educationBackground", v["学历"] || "硕士");
      aircasSetIframeField(doc, "startTime", v["开始时间"] || "");
      aircasSetIframeField(doc, "endTime", v["结束时间"] || "");
      aircasSetIframeField(doc, "graduationHome", school);
      aircasSetIframeField(doc, "major", v["专业"] || "");
      aircasSetIframeField(doc, "eduDegree", v["学位"] || "");
      aircasSetIframeField(doc, "teacher", v["导师"] || v["导师姓名"] || "");
      aircasSetIframeField(doc, "tel", v["导师电话"] || "");
      await wait(600);
      if (typeof console !== "undefined") console.log("[era-aircas] edu add:", school, "teacher=", v["导师姓名"], "ifrFields=", !!doc);
      aircasClickModalConfirm();
      // 等待表格刷新，确认该行真的出现才算成功
      let ok = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await wait(800);
        const nowRows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => clean(tr.querySelector("td")?.innerText || ""));
        if (nowRows.includes(school)) { ok = true; break; }
      }
      if (ok) { existing.add(school); added += 1; }
    }
    return added;
  }

  // AIRCAS 家庭信息表格：按 profile 的 family 条目（父亲/母亲…）逐条弹窗新增
  async function aircasFillFamilyTable(profile) {
    if (siteId() !== "aircas" || typeof window.$ === "undefined" || !window.$.modal) return 0;
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const items = sections.family?.items || [];
    if (!items.length) return 0;
    const table = document.querySelector("#familyTableId,[id*='family']");
    if (!table) return 0;
    // 用 bootstrapTable 数据判断已有成员（避免 DOM 时序/暂无数据行干扰）
    const tableRows = () => (window.$ ? (window.$(table).bootstrapTable("getData") || []) : []);
    const existingNames = new Set(tableRows().map((r) => String(r.userName || "")));
    let added = 0;
    for (const item of items) {
      const v = item.values || {};
      const relation = v["与本人关系"] || "";
      const name = v["姓名"] || "";
      const workUnit = v["工作单位"] || "";
      const tel = v["联系电话"] || "";
      if (!name || !workUnit) continue;
      if (existingNames.has(name)) continue;
      try { window.$(".layui-layer-close,layui-layer-close1").trigger("click"); } catch (e) {}
      await wait(400);
      window.$.modal.open("添加家庭信息", "/system/family/add");
      const fr = await aircasWaitForModalIframe(20000);
      if (typeof console !== "undefined") console.log("[era-aircas] fam:", name, workUnit, "ifr=", !!fr);
      if (!fr) continue;
      const doc = fr.contentDocument;
      aircasSetIframeField(doc, "relation", relation || "父亲");
      aircasSetIframeField(doc, "userName", name);
      aircasSetIframeField(doc, "workUnit", workUnit);
      aircasSetIframeField(doc, "tel", tel);
      await wait(600);
      aircasClickModalConfirm();
      let ok = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await wait(900);
        if (tableRows().some((r) => String(r.userName || "") === name)) { ok = true; break; }
      }
      if (ok) { existingNames.add(name); added += 1; }
    }
    if (typeof console !== "undefined") console.log("[era-aircas] fam added:", added);
    return added;
  }
  // Sunwz|2026-08-07|——END

  const FEISHU_CONTROL_SELECTOR = "input:not([type='hidden']):not([type='radio']):not([type='submit']):not([type='button']), textarea, select, [role='combobox']";
  const FEISHU_FIELD_ROOT_QUERY = ".ud-formily-item,[class*='formily-item'],.atsx-form-item,[class*='atsx-form-item'],.resume-field,[class*='resume-field'],[class*='field-item'],[class*='form-item'],[data-form-field-i18n-name],[data-cy]";
  const FEISHU_MODULE_QUERY = ".applyFormModuleWrapper,[class*='applyFormModuleWrapper'],.createFormSection-container,[class*='createFormSection-container'],[class*='createFormSection__'],[class*='resumeEditForm-'],.resume-section,[class*='resume-section'],[data-module],[data-section],section,fieldset";
  const FEISHU_CARD_QUERY = ".apply-form-array-card,[class*='apply-form-array-card'],.resumeEditForm-item,[class*='resumeEditForm-item'],.resume-array-item,[class*='resume-array-item'],[class*='array-card'],[class*='array-item'],[data-repeat-item],[data-array-item],article";
  const FEISHU_TITLE_QUERY = ".applyFormModuleWrapper-title,[class*='applyFormModuleWrapper-title'],[class*='ModuleWrapper-title'],.createFormSection-title,[class*='createFormSection-title'],.resume-section-title,[class*='section-title'],[class*='module-title'],[class*='form-section-title'],legend,h1,h2,h3,h4";
  const FEISHU_ADD_SELECTOR = "button,[role='button'],a,.createFormSection-addBtn,.formOperate-addBtn,[class*='addMore']";
  const FEISHU_MODULE_TITLE_RE = /个人信息|基本信息|求职意向|教育经历|教育背景|实习经历|实习经验|工作经历|项目经历|项目经验|项目实践|实践经历|获奖|奖项|奖惩|荣誉|语言能力|外语能力|校园经历|社团经历|在校职务|亲属|家庭|自我评价|附件|证件照|简历/i;
  const FEISHU_COUNT_ANCHORS = {
    education: [/学校|院校/, /学历/, /专业/],
    internship: [/公司|单位|企业/, /职位|岗位/],
    project: [/项目名称|课题名称/, /项目角色|项目职务|担任角色/],
    awards: [/获奖名称|奖项名称|奖惩名称|荣誉名称/, /获奖时间|奖惩时间/],
    language: [/语言|语种|外语种类/],
  };

  function feishuCleanLabel(value) {
    return clean(value).replace(/^[*＊]+/, "").replace(/[:：*＊\s]+$/, "");
  }

  function feishuFieldRoot(el) {
    return el?.closest?.(FEISHU_FIELD_ROOT_QUERY) || null;
  }

  function feishuSectionKeyFromTitle(title) {
    const text = clean(title || "");
    if (/教育|学校|学历|院校/.test(text)) return "education";
    if (/实习/.test(text)) return "internship";
    if (/项目|课题|实践/.test(text)) return "project";
    if (/获奖|奖项|奖惩|荣誉/.test(text)) return "awards";
    if (/语言|外语/.test(text)) return "language";
    return "";
  }

  // Sunwz|2026-08-07|飞书招聘（Lark jobs，ud-formily）专属扫描器：
  // 兼容旧 ud-formily 类名，以及新版语义 wrapper（resume-section / resume-field 等）。
  function feishuFieldLabel(el) {
    const directI18n = el?.getAttribute?.("data-form-field-i18n-name");
    if (directI18n) return clean(directI18n);

    const id = el?.id || "";
    if (id) {
      const escapedId = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(id)
        : String(id).replace(/["\\]/g, "\\$&");
      const labelFor = document.querySelector(`label[for="${escapedId}"]`);
      const labelText = feishuCleanLabel(labelFor?.innerText || labelFor?.textContent || "");
      if (labelText) return labelText;
    }

    let item = feishuFieldRoot(el);
    while (item) {
      const ii = item.getAttribute("data-form-field-i18n-name");
      if (ii) return clean(ii);
      const label = item.querySelector([
        ":scope > .ud-formily-item-label",
        ":scope > [class*='formily-item-label']",
        ":scope > .atsx-form-item-label",
        ":scope > [class*='atsx-form-item-label']",
        ":scope > .customResumeForm-fieldName",
        ":scope > [class*='customResumeForm-fieldName']",
        ":scope > .resume-field-label",
        ":scope > [class*='field-label']",
        ":scope > label",
      ].join(","));
      const labelText = feishuCleanLabel(label?.innerText || label?.textContent || "");
      if (labelText) return labelText;
      const ariaText = feishuCleanLabel(item.getAttribute("aria-label") || item.getAttribute("title") || "");
      if (ariaText) return ariaText;
      item = item.parentElement?.closest?.(FEISHU_FIELD_ROOT_QUERY);
    }

    const wrapperLabel = feishuCleanLabel(el?.closest?.("label")?.innerText || "");
    if (wrapperLabel) return wrapperLabel;
    return feishuCleanLabel(el?.getAttribute?.("aria-label") || el?.getAttribute?.("placeholder") || "");
  }

  // Sunwz|2026-08-08|字段所在卡片的分区（教育/实习/项目/获奖/语言），按卡片内的关键字段判断
  function feishuCardSection(el) {
    const moduleTitle = feishuModuleTitle(feishuOwnerModule(el));
    if (moduleTitle) return moduleTitle;
    const card = feishuOwnerCard(el);
    if (!card) return "";
    const text = clean(card.innerText || "");
    if (/公司名称/.test(text)) return "实习经历";
    if (/项目名称/.test(text)) return "项目经历";
    if (/获奖名称/.test(text)) return "获奖";
    if (/学校名称/.test(text)) return "教育经历";
    // 语言卡片无上述关键字段，但含"语言"或"精通程度"标签
    if (/语言|精通程度/.test(text)) return "语言能力";
    return "";
  }
  // Sunwz|2026-08-08|——END

  // Sunwz|2026-08-08|获取元素在其分区所有卡片中的索引（找最内层含该卡片的模块，避免嵌套重复结构导致 indexOf 错位）
  function feishuModuleTitle(module) {
    if (!module) return "";
    const explicit = feishuCleanLabel(module.getAttribute("data-title") || module.getAttribute("aria-label") || "");
    if (explicit && FEISHU_MODULE_TITLE_RE.test(explicit)) return explicit;
    const headings = Array.from(module.querySelectorAll(FEISHU_TITLE_QUERY));
    for (const heading of headings) {
      const text = feishuCleanLabel(heading.innerText || heading.textContent || "");
      if (text && FEISHU_MODULE_TITLE_RE.test(text)) return text;
    }
    return "";
  }

  function feishuIsModuleRoot(element) {
    if (!element?.matches?.(FEISHU_MODULE_QUERY)) return false;
    const cls = String(element.className || "");
    if (/applyFormModuleWrapper-(?:left|right|title|text)\b/.test(cls)) return false;
    if (/createFormSection-(?:left|right|title|text|formList)\b/.test(cls)) return false;
    const title = feishuModuleTitle(element);
    if (!title) return false;
    return Boolean(element.querySelector(FEISHU_CONTROL_SELECTOR) || element.querySelector(FEISHU_ADD_SELECTOR));
  }

  function feishuOwnerModule(element) {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      if (feishuIsModuleRoot(current)) return current;
    }
    return null;
  }

  function feishuAllModules() {
    const modules = Array.from(new Set(Array.from(document.querySelectorAll(FEISHU_MODULE_QUERY)).filter(feishuIsModuleRoot)));
    return modules.filter((module) => {
      const title = feishuModuleTitle(module);
      return !modules.some((other) => (
        other !== module &&
        module.contains(other) &&
        feishuModuleTitle(other) === title
      ));
    });
  }

  function feishuIsCardRoot(element) {
    if (!element?.matches?.(FEISHU_CARD_QUERY)) return false;
    const classes = Array.from(element.classList || []);
    if (classes.some((cls) => cls === "apply-form-array-card" || /^apply-form-array-card__/.test(cls))) return true;
    if (element.matches(FEISHU_FIELD_ROOT_QUERY) || feishuIsModuleRoot(element)) return false;
    return feishuCardControls(element).length > 0;
  }

  function feishuOwnerCard(element) {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      if (feishuIsCardRoot(current)) return current;
    }
    return null;
  }

  function feishuCardControls(card) {
    return Array.from(card.querySelectorAll(FEISHU_CONTROL_SELECTOR))
      .filter((control) => !control.closest("#era-status") && visible(control));
  }

  function feishuCardsForModule(module, onlyFillable = false) {
    return Array.from(module.querySelectorAll(FEISHU_CARD_QUERY))
      .filter(feishuIsCardRoot)
      .filter((card) => feishuOwnerModule(card) === module)
      .filter((card) => !onlyFillable || feishuCardControls(card).length > 0);
  }

  function feishuModuleFieldEntries(module) {
    const entries = [];
    const seenLabelsByRoot = new WeakMap();
    for (const el of Array.from(module?.querySelectorAll?.(FEISHU_CONTROL_SELECTOR) || [])) {
      if (el.closest("#era-status")) continue;
      const cls = String(el.className || "");
      if (el.tagName === "INPUT" && cls.includes("atsx-select-search__field")) continue;
      if (!visible(el)) continue;
      const label = feishuFieldLabel(el);
      if (!label) continue;
      const root = feishuFieldRoot(el) || el;
      let labels = seenLabelsByRoot.get(root);
      if (!labels) {
        labels = new Set();
        seenLabelsByRoot.set(root, labels);
      }
      if (labels.has(label)) continue;
      labels.add(label);
      entries.push({ label, root, element: el });
    }
    return entries;
  }

  function feishuCountUnclassifiedRepeatItems(module) {
    const sectionKey = feishuSectionKeyFromTitle(feishuModuleTitle(module));
    const anchors = FEISHU_COUNT_ANCHORS[sectionKey] || [];
    const entries = feishuModuleFieldEntries(module);
    for (const pattern of anchors) {
      const roots = new Set(entries
        .filter((entry) => pattern.test(entry.label))
        .map((entry) => entry.root));
      if (roots.size) return roots.size;
    }
    const counts = new Map();
    for (const entry of entries) {
      if (/起止时间|开始时间|结束时间|描述|内容|职责/.test(entry.label)) continue;
      counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    }
    return Math.max(0, ...counts.values());
  }

  function feishuCardIndex(el) {
    const card = feishuOwnerCard(el);
    if (!card) return 0;
    // 飞书 DOM 里模块嵌套重复：从卡片向上，先遇到内层模块（直接祖先），后遇到外层重复模块
    // 必须取第一个（最内层）模块，否则外层模块 querySelectorAll 会找到重复卡片导致 indexOf 错位
    const module = feishuOwnerModule(card);
    if (!module) return 0;
    const fillableCards = feishuCardsForModule(module, true);
    const fillableIndex = fillableCards.indexOf(card);
    if (fillableIndex >= 0) return fillableIndex;
    const allCards = feishuCardsForModule(module, false);
    const index = allCards.indexOf(card);
    return index >= 0 ? index : 0;
  }
  // Sunwz|2026-08-08|——END

  function feishuScanRecords() {
    const records = [];
    const seen = new Set();
    let index = 0;
    const feishuTimeCounts = new WeakMap();
    const fallbackRepeatCounts = new Map();
    const fallbackRootIndexes = new WeakMap();
    const moduleIndexes = new Map(feishuAllModules().map((module, idx) => [module, idx]));
    const fallbackRepeatIndex = ({ module, section, label, root, perControl = false }) => {
      const moduleIndex = moduleIndexes.has(module) ? moduleIndexes.get(module) : -1;
      const key = `${moduleIndex}::${section || ""}::${label || ""}`;
      if (!perControl && root && fallbackRootIndexes.has(root)) return fallbackRootIndexes.get(root);
      const value = fallbackRepeatCounts.get(key) || 0;
      fallbackRepeatCounts.set(key, value + 1);
      if (!perControl && root) fallbackRootIndexes.set(root, value);
      return value;
    };
    const push = (record) => { if (record && !seen.has(record.element)) { seen.add(record.element); records.push(record); } };

    // 单选组（推荐方式 无/内推 等）：按字段容器合并为一个记录
    const radioItems = Array.from(document.querySelectorAll(FEISHU_FIELD_ROOT_QUERY))
      .filter((item) => item.querySelector("input[type='radio']") && visible(item));
    for (const item of radioItems) {
      const label = feishuFieldLabel(item.querySelector("input[type='radio']"));
      if (!label) continue;
      const section = feishuCardSection(item);
      const firstRadio = item.querySelector("input[type='radio']");
      const module = feishuOwnerModule(item);
      const card = feishuOwnerCard(item);
      const repeatIndex = card ? feishuCardIndex(item) : fallbackRepeatIndex({ module, section, label, root: item });
      push(makeRecord({ index: index += 1, label, context: section, repeatIndex, type: "radio", element: firstRadio, root: item }));
    }

    // 其余控件（按元素去重，标签取 i18n-name 或 formily-item-label）
    for (const el of Array.from(document.querySelectorAll(FEISHU_CONTROL_SELECTOR))) {
      if (el.closest("#era-status")) continue;
      const cls = String(el.className || "");
      if (el.tagName === "INPUT" && cls.includes("atsx-select-search__field")) continue;
      if (!visible(el)) continue;
      const label = feishuFieldLabel(el);
      if (!label) continue;
      let type = "text";
      if (el.type === "checkbox") type = "checkbox";
      else if (el.tagName === "SELECT") type = "select";
      else if (el.type === "search" || el.getAttribute("role") === "combobox" || cls.includes("ud__select") || cls.includes("atsx-select-selection")) type = "feishu-select";
      else if (el.tagName === "TEXTAREA") type = "textarea";
      else if (cls.includes("ud__picker-input")) type = "feishu-date"; // Sunwz|2026-08-08|飞书日期选择器
      const section = feishuCardSection(el);
      const card = feishuOwnerCard(el);
      const module = feishuOwnerModule(el);
      const root = feishuFieldRoot(el) || el;
      const isRangeTime = /起止时间|时间范围|开始.*结束/.test(label);
      let ri;
      if (card) {
        const cardIndex = feishuCardIndex(el);
        const timeIndex = card ? (feishuTimeCounts.get(card) || 0) : 0;
        if (isRangeTime) feishuTimeCounts.set(card, timeIndex + 1);
        ri = isRangeTime ? cardIndex * 2 + timeIndex : cardIndex;
      } else {
        ri = fallbackRepeatIndex({ module, section, label, root, perControl: isRangeTime });
      }
      push(makeRecord({ index: index += 1, label, context: section, repeatIndex: ri, type, element: el, root }));
    }

    return records;
  }
  // Sunwz|2026-08-08|飞书扫描器 repeatIndex 策略——END

  // Sunwz|2026-08-08|飞书：点一次"添加"→扫描填一张→再点添加→再填一张（交替进行）
  // 飞书特殊行为：第1次点添加出有输入框卡片，第2次点出空占位卡片，需交替进行
  // 只找模块自身标题下的"添加"按钮（避免 DOM 重复结构导致点到外层重复模块的按钮）
  async function feishuClickAddOne(module) {
    const btn = Array.from(module.querySelectorAll(FEISHU_ADD_SELECTOR)).find((b) => {
      const cls = String(b.className || "");
      const text = clean(b.innerText || b.textContent || b.getAttribute("aria-label") || b.getAttribute("title") || "");
      if (!visible(b)) return false;
      if (/删除|移除|收起|展开|取消|编辑/.test(text)) return false;
      if (!(/ud__button--text/.test(cls) || /add|append|create|plus/i.test(cls) || /^(?:\+\s*)?(添加|新增|Add)|添加.+经历|新增.+经历$/i.test(text))) return false;
      // 确保按钮属于当前模块，而不是嵌套/重复模块里的按钮
      return feishuOwnerModule(b) === module;
    });
    if (!btn) return false;
    if (filler?.clickElement) filler.clickElement(btn);
    else btn.click();
    await wait(1500);
    return true;
  }

  function feishuModuleMatches(module, target) {
    const title = feishuModuleTitle(module);
    const aliases = target.titles || [target.title];
    return aliases.some((alias) => title.includes(alias) || alias.includes(title));
  }

  function feishuFindModule(target) {
    return feishuAllModules().find((module) => feishuModuleMatches(module, target));
  }

  function feishuHasFormControls() {
    if (siteId() !== "feishu") return false;
    const controls = document.querySelector(`${FEISHU_CONTROL_SELECTOR},input[type='radio'],input[type='checkbox']`);
    if (!controls) return false;
    if (document.querySelector(`${FEISHU_FIELD_ROOT_QUERY},${FEISHU_MODULE_QUERY}`)) return true;
    return FEISHU_MODULE_TITLE_RE.test(clean(document.body?.innerText || ""));
  }

  function shouldHandleMessageInThisFrame(message) {
    if (isTopFrame()) return true;
    if (siteId() !== "feishu") return false;
    if (!["ERA_SCAN", "ERA_FILL", "ERA_GET_PAGE_STATE"].includes(message?.type)) return false;
    return feishuHasFormControls();
  }

  // Sunwz|2026-08-08|飞书：计算模块内全部卡片数（含折叠/空占位），用于判断是否需要点"添加"
  function feishuCountCardsWithInputs(module) {
    return feishuCardsForModule(module, true).length || feishuCountUnclassifiedRepeatItems(module);
  }
  // Sunwz|2026-08-08|——END

  // Sunwz|2026-08-08|飞书各分区"添加"按钮补足卡片（教育/实习/项目/获奖/语言/自我），对应 profile 条目数
  // 实测：每次点"添加"→+4 卡（2 张有输入 + 2 张空占位），所以只需点到"有输入框卡片数 ≥ profile 条目数"即可
  async function feishuClickAdd(profile) {
    if (siteId() !== "feishu") return;
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const targets = [
      { title: "教育经历", titles: ["教育经历", "教育背景"], count: sections.education?.items?.length || 0 },
      { title: "实习经历", titles: ["实习经历", "实习经验"], count: sections.internship?.items?.length || 0 },
      { title: "项目经历", titles: ["项目经历", "项目经验"], count: sections.project?.items?.length || 0 },
      { title: "获奖", titles: ["获奖", "奖项", "荣誉"], count: sections.awards?.items?.length || 0 },
      { title: "语言能力", titles: ["语言能力", "外语能力"], count: sections.language?.items?.length || 0 },
      { title: "自我评价", titles: ["自我评价", "个人评价"], count: 1 },
    ];
    for (const target of targets) {
      if (target.count < 1 && target.title !== "自我评价") continue;
      let module = feishuFindModule(target);
      if (!module) continue;
      const targetCount = target.title === "自我评价" ? 1 : target.count;
      let guard = 0;
      while (feishuCountCardsWithInputs(module) < targetCount && guard < 15) {
        guard += 1;
        if (!(await feishuClickAddOne(module))) break;
        module = feishuFindModule(target) || module;
      }
    }
  }
  // Sunwz|2026-08-08|——END

  // Hotjob / wecruit resumeOperation: React + Ant Design resume template.
  const HOTJOB_CONTROL_SELECTOR = [
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image'])",
    "textarea",
    "select",
    "[contenteditable='true']",
    ".ant-select-selection",
    ".ant-select-selector",
    "[role='combobox']",
  ].join(",");

  function hotjobSectionTypeFromTitle(title) {
    const text = clean(title || "");
    if (/教育|学校|学历|院校/.test(text)) return "education";
    if (/实习/.test(text)) return "internship";
    if (/工作/.test(text)) return "work";
    if (/项目|课题|实践项目|科研/.test(text)) return "project";
    if (/获奖|奖项|奖惩|荣誉/.test(text)) return "awards";
    if (/获得证书|证书情况|证书名称/.test(text)) return "certificates";
    if (/英语|语言|外语/.test(text)) return "language";
    if (/计算机技能|技能类别|专业技能/.test(text)) return "computer";
    if (/家庭|亲属|社会关系/.test(text)) return "family";
    if (/健康状况|病史|精神疾病|传染性/.test(text)) return "health";
    if (/自我评价|评价内容/.test(text)) return "self";
    if (/在校职务|学生干部/.test(text)) return "studentOfficer";
    if (/校内外社会实践|校园|社团|在校实践/.test(text)) return "student";
    if (/附件|简历|证件照|照片|上传/.test(text)) return "attachments";
    if (/求职意向|应聘意向|期望/.test(text)) return "intent";
    if (/基本信息|个人信息/.test(text)) return "basic";
    return "";
  }

  function hotjobSectionTitle(section) {
    if (!section) return "";
    const direct = clean(section.getAttribute("data-title") || section.getAttribute("aria-label") || "");
    if (hotjobSectionTypeFromTitle(direct)) return direct;
    const heading = section.querySelector(":scope h1,:scope h2,:scope h3,:scope h4,:scope .form-cell-title,:scope .resume-item-header,:scope [class*='title']");
    const text = clean(heading?.innerText || heading?.textContent || "");
    if (hotjobSectionTypeFromTitle(text)) return text;
    const fallback = clean((section.innerText || section.textContent || "").split("\n").slice(0, 3).join(" "));
    if (hotjobSectionTypeFromTitle(fallback)) return fallback;
    return "";
  }

  function hotjobSectionForElement(element) {
    const selector = ".resume-operation-wrap .form-cell,.form-cell,section,[data-section],[data-module]";
    let section = element?.closest?.(selector) || null;
    while (
      section &&
      (
        /form-cell-(inner|left|right)|form-item/.test(String(section.className || "")) ||
        (
          section.matches?.("[data-module]") &&
          !section.matches?.(".form-cell,section,[data-section]") &&
          !hotjobSectionTypeFromTitle(clean(section.getAttribute("data-title") || section.getAttribute("aria-label") || "")) &&
          !section.querySelector?.(":scope h1,:scope h2,:scope h3,:scope h4,:scope .form-cell-title,:scope .resume-item-header")
        ) ||
        (!hotjobSectionTypeFromTitle(hotjobSectionTitle(section)) && section.parentElement?.closest?.(selector))
      )
    ) {
      section = section.parentElement?.closest?.(selector) || null;
    }
    return section;
  }

  function hotjobFieldRoot(element) {
    const direct = element?.closest?.(".ant-form-item,.form-item,[data-label],[data-form-field-i18n-name]");
    if (direct) return direct;
    let node = element?.parentElement || null;
    while (node && node !== document.body) {
      const cls = String(node.className || "");
      if (/form-item/.test(cls) && !/form-item-(control|children|label|wrapper)/.test(cls)) return node;
      node = node.parentElement;
    }
    return element;
  }

  function hotjobFieldLabel(element) {
    const root = hotjobFieldRoot(element);
    const direct = clean(root?.getAttribute?.("data-label") || root?.getAttribute?.("data-form-field-i18n-name") || "");
    if (direct) return direct;
    const label = root?.querySelector?.(".ant-form-item-label label,.ant-form-item-label,[class*='form-item-label'] label,[class*='field-label'],label");
    const labelText = clean(label?.innerText || label?.textContent || label?.getAttribute?.("title") || "");
    if (labelText) return labelText.replace(/^[*：:\s]+|[*：:\s]+$/g, "");
    return clean(element?.getAttribute?.("aria-label") || element?.getAttribute?.("placeholder") || element?.getAttribute?.("name") || "");
  }

  function hotjobRepeatIndex(element) {
    const section = hotjobSectionForElement(element);
    const card = element?.closest?.(".form-cell-inner,[class*='form-cell-inner'],[data-repeat],[data-array-item],[data-repeat-item]");
    if (!section || !card) return 0;
    const cards = Array.from(section.querySelectorAll(".form-cell-inner,[class*='form-cell-inner'],[data-repeat],[data-array-item],[data-repeat-item]"))
      .filter((candidate) => visible(candidate) && hotjobSectionForElement(candidate) === section);
    const index = cards.indexOf(card);
    return index >= 0 ? index : 0;
  }

  function hotjobContext(element) {
    const section = hotjobSectionForElement(element);
    return hotjobSectionTitle(section) || getSectionText(element) || "";
  }

  function hotjobControlType(element, root, label) {
    const tag = element?.tagName || "";
    const type = String(element?.getAttribute?.("type") || "").toLowerCase();
    const cls = String(element?.className || root?.className || "");
    if (type === "file") return "file";
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    if (tag === "SELECT") return "select";
    if (tag === "TEXTAREA") return "textarea";
    if (element?.isContentEditable) return "textarea";
    if (/ant-select|select-selection|select-selector/.test(cls) || element?.getAttribute?.("role") === "combobox") return "select";
    if (/date|time|picker/.test(cls) || /日期|时间/.test(label)) return "month";
    return type || "text";
  }

  function hotjobDisplayLabel(root, element, label) {
    if (!/起止时间|时间范围/.test(label)) return label;
    const controls = Array.from(root?.querySelectorAll?.("input:not([type='hidden']):not([type='file']),textarea,select,[role='combobox'],.ant-select-selection,.ant-select-selector") || [])
      .filter(visible);
    const index = controls.indexOf(element);
    if (index === 0) return "开始时间";
    if (index === 1) return "结束时间";
    return label;
  }

  function hotjobScanRecords() {
    const records = [];
    const seen = new Set();
    let index = 0;
    const push = (record) => {
      if (!record || !record.label || !record.element || seen.has(record.element)) return;
      seen.add(record.element);
      records.push(record);
    };

    const formRoot = document.querySelector(".resume-operation-wrap") || document;
    for (const element of Array.from(formRoot.querySelectorAll(HOTJOB_CONTROL_SELECTOR))) {
      if (!visible(element)) continue;
      if (element.closest("#era-panel,#era-launcher,#era-status")) continue;
      const cls = String(element.className || "");
      if (element.tagName === "INPUT" && /ant-select-search__field/.test(cls)) continue;
      const root = hotjobFieldRoot(element);
      const rawLabel = hotjobFieldLabel(element);
      if (!rawLabel) continue;
      const label = hotjobDisplayLabel(root, element, rawLabel);
      push(makeRecord({
        index: index += 1,
        label,
        context: hotjobContext(element),
        repeatIndex: hotjobRepeatIndex(element),
        type: hotjobControlType(element, root, label),
        element,
        root,
      }));
    }

    return records;
  }

  function hotjobAllSections() {
    const root = document.querySelector(".resume-operation-wrap") || document;
    return Array.from(root.querySelectorAll(".form-cell,section,[data-section],[data-module]"))
      .filter((section) => visible(section) && hotjobSectionTypeFromTitle(hotjobSectionTitle(section)));
  }

  function hotjobFindSection(target) {
    return hotjobAllSections().find((section) => hotjobSectionTypeFromTitle(hotjobSectionTitle(section)) === target.type) || null;
  }

  function hotjobCountRows(section) {
    if (!section) return 0;
    const cards = Array.from(section.querySelectorAll(".form-cell-inner,[class*='form-cell-inner'],[data-repeat],[data-array-item],[data-repeat-item]"))
      .filter((card) => visible(card) && hotjobSectionForElement(card) === section);
    if (cards.length) return cards.length;
    return Array.from(section.querySelectorAll(".ant-form-item,.form-item,[class*='form-item']"))
      .filter((field) => visible(field) && field.querySelector("input,textarea,select,[role='combobox'],.ant-select-selection,.ant-select-selector"))
      .length ? 1 : 0;
  }

  async function hotjobClickAddOne(section) {
    const addTextRe = /\u6dfb\u52a0|\u65b0\u589e|\+/;
    const button = Array.from(section.querySelectorAll(".add-more-btn,.add-more,[data-add],button,a,[role='button']"))
      .map((el) => {
        if (!visible(el)) return false;
        const text = clean(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        const cls = String(el.className || "");
        if (/\u5220\u9664|\u79fb\u9664|\u53d6\u6d88|\u4fdd\u5b58|\u63d0\u4ea4|\u9884\u89c8/.test(text)) return false;
        if (!/\u6dfb\u52a0|\u65b0\u589e/.test(text) && /\+/.test(text) && /upload|file|ant-upload/i.test(cls)) return false;
        const isClickableAdd =
          el.matches("button,a,[role='button'],[data-add]") ||
          /add|plus|create/i.test(cls) ||
          (addTextRe.test(text) && text.length <= 40);
        if (!isClickableAdd) return false;
        if (!(addTextRe.test(text) || /add|plus|create/i.test(cls) || el.hasAttribute("data-add"))) return false;
        if (!(hotjobSectionForElement(el) === section || section.contains(el))) return false;
        const rect = el.getBoundingClientRect();
        const rank = el.matches(".add-more-btn,[data-add]") ? 0
          : el.matches(".add-more") ? 1
            : el.matches("button,a,[role='button']") ? 2
              : 3;
        return { el, rank, area: rect.width * rect.height, textLength: text.length };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || a.area - b.area || a.textLength - b.textLength)[0]?.el;
    if (!button) return false;
    if (filler?.clickElement) filler.clickElement(button);
    else button.click();
    await wait(650);
    return true;
  }

  async function hotjobClickAdd(profile) {
    if (siteId() !== "hotjob") return;
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const targets = [
      { type: "education", count: sections.education?.items?.length || 0 },
      { type: "internship", count: sections.internship?.items?.length || 0 },
      { type: "work", count: sections.work?.items?.length || 0 },
      { type: "project", count: sections.project?.items?.length || 0 },
      { type: "awards", count: sections.awards?.items?.length || 0 },
      { type: "certificates", count: sections.certificates?.items?.length || 0 },
      { type: "studentOfficer", count: sections.studentOfficer?.items?.length || 0 },
      { type: "student", count: sections.student?.items?.length || 0 },
      { type: "family", count: sections.family?.items?.length || 0 },
      { type: "language", count: sections.language?.items?.length || 0 },
    ];
    for (const target of targets) {
      if (target.count <= 1) continue;
      const section = hotjobFindSection(target);
      if (!section) continue;
      for (let guard = 0; hotjobCountRows(section) < target.count && guard < 12; guard += 1) {
        if (!await hotjobClickAddOne(section)) break;
      }
    }
  }

  // 51job xyz External resume fill page: legacy ASP.NET form rendered as #container > h1 + dl/dt/dd.
  const JOB51_CONTROL_SELECTOR = [
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image'])",
    "textarea",
    "select",
    "[contenteditable='true']",
  ].join(",");

  function job51SectionTitle() {
    const activeNav = clean(document.querySelector(".leftli2 .lispan,.leftli2")?.innerText || "");
    const heading = clean(document.querySelector("#container h1,h1")?.innerText || "");
    return heading || activeNav || getSectionText(document.querySelector("#container") || document.body) || "";
  }

  function job51FieldRoot(element) {
    return element?.closest?.("dl,tr,.form-item,.field,.item") || element;
  }

  function job51FieldLabel(element) {
    if (!element) return "";
    if (element.id === "sPhoneNumber") return "";
    if (element.id === "sIDCard") return "证件号码类型";
    const cname = clean(element.getAttribute?.("cname") || "");
    if (cname) return cname;
    const root = job51FieldRoot(element);
    const dt = clean(root?.querySelector?.("dt,th,.label,.field-label")?.innerText || root?.querySelector?.("dt,th,.label,.field-label")?.textContent || "");
    if (dt) return dt.replace(/^[*：:\s]+|[*：:\s]+$/g, "").replace(/\s*\*$/, "");
    return clean(element.getAttribute?.("placeholder") || element.getAttribute?.("name") || element.id || "");
  }

  function job51RepeatIndex(element, label = "") {
    if (/本科/.test(label)) return 1;
    if (/硕士|研究生/.test(label)) return 0;
    const source = `${element?.id || ""} ${element?.name || ""}`;
    const match = source.match(/_(\d+)(?:\s|$)/g)?.pop()?.match(/\d+/);
    const number = Number(match?.[0] || 1);
    return Number.isFinite(number) && number > 0 ? number - 1 : 0;
  }

  function job51ControlType(element, label) {
    const tag = element?.tagName || "";
    const type = String(element?.getAttribute?.("type") || "").toLowerCase();
    const dateHint = `${label || ""} ${element?.id || ""} ${element?.name || ""} ${element?.getAttribute?.("inputcolname") || ""} ${element?.getAttribute?.("onfocus") || ""}`;
    if (type === "file") return "file";
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    if (/时间|日期|date|setday/i.test(dateHint)) return "date-text";
    if (tag === "SELECT") return "select";
    if (tag === "TEXTAREA" || element?.isContentEditable) return "textarea";
    return type || "text";
  }

  function job51VisibleControl(element) {
    if (visible(element)) return true;
    if (element?.tagName !== "SELECT") return false;
    const root = job51FieldRoot(element);
    return root && root !== element && visible(root);
  }

  function job51SelectDisplayInput(element) {
    if (element?.tagName !== "INPUT") return false;
    if (element.id || element.name || element.getAttribute?.("cname") || element.getAttribute?.("inputcolname")) return false;
    const root = job51FieldRoot(element);
    return !!root?.querySelector?.("select[cname],select[inputcolname]");
  }

  function job51ScanRecords() {
    const records = [];
    const seen = new Set();
    let index = 0;
    const formRoot = document.querySelector("#container") || document.querySelector("#form1") || document;
    const context = job51SectionTitle();

    for (const element of Array.from(formRoot.querySelectorAll(JOB51_CONTROL_SELECTOR))) {
      if (!job51VisibleControl(element)) continue;
      if (job51SelectDisplayInput(element)) continue;
      if (element.closest("#era-panel,#era-launcher,#era-status")) continue;
      if (seen.has(element)) continue;
      const label = job51FieldLabel(element);
      if (!label) continue;
      const root = job51FieldRoot(element);
      seen.add(element);
      records.push(makeRecord({
        index: index += 1,
        label,
        context,
        repeatIndex: job51RepeatIndex(element, label),
        type: job51ControlType(element, label),
        element,
        root,
      }));
    }

    return records;
  }

  function scanRecords() {
    if (siteId() === "baidu") return scanBaiduRecords();
    if (siteId() === "moka") return scanMokaRecords();
    if (siteId() === "boe") return boeScanRecords();
    if (siteId() === "aircas") return aircasScanRecords();
    if (siteId() === "feishu") return feishuScanRecords();
    if (siteId() === "hotjob") return hotjobScanRecords();
    if (siteId() === "51job") return job51ScanRecords();
    return scanGenericRecords();
  }

  function countProfileItems(profile, section) {
    return profile?.profileV2?.sections?.[section]?.items?.length || 0;
  }

  function countBaiduRows(kind) {
    const labels = {
      education: "学校",
      work: "企业名称",
      project: "项目名称",
      awards: "奖项名称",
      portfolio: "作品名称",
    };
    return Array.from(document.querySelectorAll(".brick-field"))
      .filter(visible)
      .filter((field) => baiduFieldLabel(field) === labels[kind])
      .length;
  }

  function findClickableText(text) {
    const exact = [];
    const partial = [];
    for (const element of document.querySelectorAll("button,[role='button'],div,span")) {
      if (!visible(element)) continue;
      const body = clean(element.innerText || element.textContent);
      if (body === text) exact.push(element);
      else if (body.includes(text) && body.length <= text.length + 8) partial.push(element);
    }
    return exact[0] || partial[0] || null;
  }

  async function clickText(text) {
    const element = findClickableText(text);
    if (!element) return false;
    element.click();
    await wait(450);
    return true;
  }

  async function ensureBaiduRows(profile) {
    if (siteId() !== "baidu") return;

    // Sunwz|2026-08-06|简历类型改选"校招"（原逻辑：有实习经历就点"实习生简历"，不符合用户需求）
    if (!await clickText("校招简历")) {
      await clickText("校招");
    }
    // Sunwz|2026-08-06|简历类型改选"校招"（原逻辑：有实习经历就点"实习生简历"，不符合用户需求）——END

    // Sunwz|2026-08-06|经历行数上限由3提到6，容纳智路巡后4条项目经验、3条工作经历
    const wanted = {
      education: Math.min(6, countProfileItems(profile, "education")),
      work: Math.min(6, countProfileItems(profile, "work") + countProfileItems(profile, "internship")),
      project: Math.min(6, countProfileItems(profile, "project")),
      awards: Math.min(6, countProfileItems(profile, "awards")),
      portfolio: Math.min(6, countProfileItems(profile, "portfolio")),
    };
    // Sunwz|2026-08-06|经历行数上限由3提到6，容纳智路巡后4条项目经验、3条工作经历——END
    const addButtons = {
      education: "添加教育经历",
      work: "添加工作经历",
      project: "添加项目经验",
      awards: "添加获奖信息",
      portfolio: "添加作品集",
    };

    for (const [kind, count] of Object.entries(wanted)) {
      // Sunwz|2026-08-06|添加按钮点击次数放宽到8次，配合行数上限提升
      for (let guard = 0; countBaiduRows(kind) < count && guard < 8; guard += 1) {
        const clicked = await clickText(addButtons[kind]);
        if (!clicked) break;
      }
      // Sunwz|2026-08-06|添加按钮点击次数放宽到8次，配合行数上限提升——END
    }
  }

  // Sunwz|2026-08-06|低代码平台子表单（简道云等）：按表头列判断对应资料分区，点"添加"补足行数，随后通用扫描器按表头标签填单元格
  function genericSubformTarget(subform, profile) {
    const titles = Array.from(subform.querySelectorAll(".subform-head .subform-cell .subform-title"))
      .map((t) => clean(t.innerText || t.textContent));
    const text = titles.join(" ");
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    if (/获奖类型|奖项名称|获奖大赛|赛事级别/.test(text)) return sections.awards?.items?.length || 0;
    if (/社团名称|社团干部/.test(text)) return sections.student?.items?.length || 0;
    if (/学校|学历|专业|学号|院校/.test(text)) return sections.education?.items?.length || 0;
    if (/项目名称|项目内容|项目职责/.test(text)) return sections.project?.items?.length || 0;
    if (/公司|职位|工作描述|工作类型/.test(text)) return (sections.work?.items?.length || 0) + (sections.internship?.items?.length || 0);
    return 0;
  }

  // Sunwz|2026-08-15|秋招通通用站点（奥比中光等）：识别"添加"按钮并补足子表单行数
  // 特征：文案 +添加实习经历 / + 添加获奖情况 / + 添加在校实践 / 添加 / 新增 / Add，且带 + 符号或 icon-plus class
  function genericAddButtonToSection(text, profile) {
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    if (/教育经历|添加教育/.test(text)) return sections.education?.items?.length || 0;
    if (/实习经历|添加实习/.test(text)) return sections.internship?.items?.length || 0;
    if (/工作经历|添加工作/.test(text)) return (sections.work?.items?.length || 0) + (sections.internship?.items?.length || 0);
    if (/项目经历|添加项目/.test(text)) return sections.project?.items?.length || 0;
    if (/获奖情况|获奖经历|添加获奖/.test(text)) return sections.awards?.items?.length || 0;
    if (/在校实践|校园经历|社团经历|添加在校实践|添加校园经历|添加社团/.test(text)) return sections.student?.items?.length || 0;
    if (/在校职务|添加在校职务/.test(text)) return sections.studentOfficer?.items?.length || 0;
    if (/证书|添加证书/.test(text)) return sections.certificates?.items?.length || 0;
    if (/语言|添加语言/.test(text)) return sections.language?.items?.length || 0;
    if (/自我评价|添加自我评价/.test(text)) return sections.self?.items?.length || 0;
    if (/计算机|添加计算机/.test(text)) return sections.computer?.items?.length || 0;
    return 0;
  }
  function isGenericAddButton(btn) {
    if (!visible(btn)) return false;
    const text = clean(btn.innerText || btn.textContent || "");
    const cls = (btn.className || "").toString();
    const btnId = (btn.id || "").toString();
    // Sunwz|2026-08-24|奥比中光等"简道云外"低代码表单：添加按钮是 <div id="..._addButton">，className 不含 add/plus，但 id 后缀是 _addButton
    const isIdAddBtn = /_addButton$/.test(btnId);
    const hasPlus = /\+\s*(添加|新增|Add)|添加|新增|Add/i.test(text) || /\+/i.test(text) || /icon-plus|el-icon-plus|anticon-plus|plus/i.test(cls) || isIdAddBtn;
    if (!hasPlus) return false;
    // 排除提交/上传类按钮
    if (/提交|上传|保存|发送/.test(text)) return false;
    return true;
  }
    // Sunwz|2026-08-15|——END

    // Sunwz|2026-08-27|段数统计辅助：奥比中光这一版"添加"按钮 id 是 UUID（无 _addButton 后缀），
    // 旧 moduleSegCount 靠 id 反查模块标题失败 → 段数恒错。改为：按按钮文案定位模块，用"锚字段"出现次数统计真实段数。
    function sectionFromAddButtonText(text) {
      if (/实习/.test(text)) return "internship";
      if (/项目/.test(text)) return "project";
      if (/在校实践|校园经历|社团/.test(text)) return "student";
      if (/教育/.test(text)) return "education";
      if (/获奖|奖励/.test(text)) return "awards";
      if (/在校职务/.test(text)) return "studentOfficer";
      if (/语言/.test(text)) return "language";
      if (/证书/.test(text)) return "certificates";
      return "";
    }
    function countSegmentsByAnchor(section) {
      const anchorRe = {
        internship: /单位名称|公司名称|公司/,
        project: /项目名称/,
        student: /组织名称|实践名称|社团名称/,
        education: /学校|院校名称|院校/,
        awards: /奖项|奖惩名称|奖励名称/,
        studentOfficer: /在校职务名称|职务名称/,
        language: /语言类型|外语种类|语种/,
        certificates: /证书名称/,
      }[section];
      if (!anchorRe) return 0;
      let n = 0;
      // Sunwz|2026-08-27|精确 .form-item，避免 [class*=form-item] 误匹配 form-item__title 等子元素导致段数虚高
      const items = document.querySelectorAll(".form-item");
      for (const it of items) {
        const lbl = (it.querySelector && it.querySelector("label") ? it.querySelector("label").textContent : "") || "";
        if (anchorRe.test((lbl || "").trim())) n += 1;
      }
      return n;
    }

    async function syncGenericSubforms(profile) {
    if (!profile) return;
    // 1) 原有简道云 .fx-field 子表单
    for (const field of document.querySelectorAll(".fx-field")) {
      const subform = field.querySelector(".fx-subform");
      if (!subform) continue;
      const target = genericSubformTarget(subform, profile);
      if (!target) continue;
      const existing = subform.querySelectorAll(".fx-subform-row").length;
      const addBtn = Array.from(field.querySelectorAll("button,[class*='add'],[class*='Add']"))
        .find((b) => /添加/.test(b.innerText || b.textContent || ""));
      for (let i = existing; i < target && addBtn; i += 1) {
        filler.clickElement?.(addBtn);
        await wait(350);
      }
    }
    // Sunwz|2026-08-15|2) 通用站点（奥比中光等非简道云）：扫描全页"添加"按钮，按分区文案补足行数
    // Sunwz|2026-08-24|奥比中光：添加按钮是 <div id="xxx_addButton">，className 不含 add/plus，按 id 后缀兜底；
    // 模块根 = btn.id 去 _addButton 后对应的标题元素的 form 祖先，form-part 数即该模块当前段数
    const addButtons = Array.from(document.querySelectorAll("button,a,[role='button'],[class*='add'],[class*='Add'],[class*='plus'],[data-add],div[id$='_addButton']"))
      .filter(isGenericAddButton);
    for (const btn of addButtons) {
      const text = clean(btn.innerText || btn.textContent || "");
      const target = genericAddButtonToSection(text, profile);
      if (!target) continue;
      // Sunwz|2026-08-27|按按钮文案定位模块（奥比中光 UUID 按钮无 _addButton 后缀），用锚字段统计真实段数
      const section = sectionFromAddButtonText(text);
      // Sunwz|2026-08-27|直接以"锚字段"出现次数作为当前已渲染段数（奥比中光无 .form-part，
      // 旧 moduleSegCount 靠 UUID id 反查 moduleTitleEl 恒为 null → 返回 -1 → 段数误判为 0，导致永远补不出第 3 段）
      let cur = countSegmentsByAnchor(section);
      if (cur < 0) cur = 0;
      // Sunwz|2026-08-24|目标驱动：反复点击 addButton 直到实际渲染段数 >= target，
      // 不再用「点击次数 = target-existing」计数（React 渲染延迟会导致少点一段而永久缺口）。
      // 安全上限 30 次；若连续 3 次点击段数不增长则判定已达上限/不可再加，退出。
      // Sunwz|2026-08-24|关键修复：React 在每次添加段后会重渲染模块，原始 btn 引用可能失活/被替换，
      // 故每轮重新按 id 取最新 addButton 元素再 click（手动实测 2→3→4 成功，但复用旧引用只到 2）。
      const addBtnId = btn.id || "";
      let safety = 0;
      let noProgress = 0;
      while (cur < target && safety < 30) {
        let liveBtn = addBtnId ? document.getElementById(addBtnId) : btn;
        if (!liveBtn) liveBtn = btn;
        if (liveBtn && typeof liveBtn.click === "function") liveBtn.click();
        else if (typeof btn.click === "function") btn.click();
        await wait(800);
        const now = countSegmentsByAnchor(section);
        if (now > cur) { cur = now; noProgress = 0; }
        else { noProgress += 1; if (noProgress >= 3) break; }
        safety += 1;
      }
    }
    // Sunwz|2026-08-15|——END
  }
  // Sunwz|2026-08-06|——END

  // Sunwz|2026-08-07|BOE（Phoenix UI）：点击"添加教育经历/实习经历/获奖情况/在校职务"补足分段行数，先数当前段数只补差额
  async function clickBoeAddButtons(profile) {
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const targets = [
      // Sunwz|2026-08-13|snowman 添加按钮文本（与 BOE 不同）
      { text: "添加教育经历（按最高学历倒序）", label: "学校名称", count: sections.education?.items?.length || 0 },
      { text: "添加教育经历", label: "学校名称", count: sections.education?.items?.length || 0 },
      { text: "添加实习经历", label: "单位名称", count: sections.internship?.items?.length || 0 },
      { text: "添加主要项目/任务经历", label: "项目名称", count: sections.project?.items?.length || 0 },
      { text: "添加在校职务", label: "在校职务名称", count: sections.studentOfficer?.items?.length || 0 },
      { text: "添加在校实践", label: "实践名称", count: sections.student?.items?.length || 0 },
      { text: "添加校园经历", label: "社团名称", count: sections.student?.items?.length || 0 },
      { text: "添加社团经历", label: "社团名称", count: sections.student?.items?.length || 0 },
      { text: "添加语言能力", label: "语言类型", count: sections.language?.items?.length || 0 },
      { text: "添加获奖情况", label: "奖项", count: sections.awards?.items?.length || 0 },
      // Sunwz|2026-08-13|——END
    ];
    const countSegments = (type) => Array.from(document.querySelectorAll(".form-part"))
      .filter((part) => visible(part) && boePartType(part) === type)
      .length;
    for (const target of targets) {
      if (target.count <= 1) continue;
      const targetType = boeSectionTypeFromText(target.text);
      const current = countSegments(targetType);
      for (let i = current; i < target.count; i += 1) {
        const btn = Array.from(document.querySelectorAll("span,div,a,button"))
          .find((el) => {
            if (!visible(el)) return false;
            const t = clean(el.innerText || el.textContent || "");
            if (t !== target.text) return false;
            return !Array.from(el.children).some((child) => visible(child) && clean(child.innerText || child.textContent) === t);
          });
        if (!btn) break;
        filler.clickElement?.(btn);
        await wait(700);
      }
    }
  }
  // Sunwz|2026-08-07|——END

  function serializeMapping(mapping) {
    return {
      id: mapping.record.id,
      label: mapping.record.label,
      context: mapping.record.context,
      repeatIndex: mapping.record.repeatIndex,
      type: mapping.record.type,
      valuePreview: mapping.skipReason ? "" : String(mapping.value || "").slice(0, 24),
      confidence: Math.round((mapping.confidence || 0) * 100),
      skipReason: mapping.skipReason || "",
      manualHint: mapping.manualHint || "",
      key: mapping.candidate?.key || "",
      section: mapping.candidate?.section || "",
    };
  }

  function clearMarks() {
    document.querySelectorAll(".era-mark,.era-mark-skip,.era-mark-filled,.era-mark-failed").forEach((element) => {
      element.classList.remove("era-mark", "era-mark-skip", "era-mark-filled", "era-mark-failed");
      delete element.dataset.eraLabel;
    });
  }

  function markMappings(mappings, results = []) {
    clearMarks();
    const byId = new Map(results.map((result) => [result.id, result]));
    for (const mapping of mappings) {
      const root = mapping.record.root || mapping.record.element;
      if (!root?.classList) continue;
      const result = byId.get(mapping.record.id);
      root.classList.add("era-mark");
      root.classList.toggle("era-mark-skip", Boolean(mapping.skipReason));
      root.classList.toggle("era-mark-filled", Boolean(result?.ok));
      root.classList.toggle("era-mark-failed", Boolean(result && !result.ok && !mapping.skipReason));
      root.dataset.eraLabel = mapping.record.label || "";
    }
  }

  function renderAssistant(report = runtime.lastReport) {
    return renderPanel(report);
  }

  async function handleAssistantAction(action) {
    return handlePanelAction(action);
  }

  async function scan(profile) {
    await wait(document.readyState === "loading" ? 800 : 80);
    const activeProfile = profile || await loadDefaultProfile();
    runtime.lastProfile = activeProfile;
    // Sunwz|2026-08-25|检测按钮：先识别公司（不弹窗），再补齐子表单段数，再扫描
    await identifyCompany();
    // Sunwz|2026-08-06|通用站点先补齐子表单行数，再扫描单元格（否则单元格输入框不存在）
    if (siteId() !== "baidu" && siteId() !== "moka") {
      await syncGenericSubforms(activeProfile);
    }
    // Sunwz|2026-08-06|——END
    // Sunwz|2026-08-07|BOE：先点击"添加教育经历/实习经历"等补足分段，再扫描
    if (siteId() === "boe") {
      await clickBoeAddButtons(activeProfile);
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-08|飞书：先点各分区"添加"补足卡片，再扫描
    if (siteId() === "feishu") {
      await feishuClickAdd(activeProfile);
    }
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-08-09|Hotjob/Wecruit：Ant Design 简历页先补齐教育/实习/项目等重复卡片，再扫描字段
    if (siteId() === "hotjob") {
      await hotjobClickAdd(activeProfile);
    }
    // Sunwz|2026-08-09|——END
    // Sunwz|2026-08-12|Moka：补足获奖经历条目数（默认1条，按 profile 奖项数点击"添加"）
    if (siteId() === "moka") {
      const awardItems = activeProfile?.profileV2?.sections?.awards?.items || activeProfile?.sections?.awards?.items || [];
      const targetCount = awardItems.length;
      console.log("[era-moka] awards target:", targetCount, "current:", mokaCountAwardFields());
      if (targetCount > 0) {
        let guard = 0;
        while (mokaCountAwardFields() < targetCount && guard < 10) {
          const addBtn = mokaAwardsAddButton();
          console.log("[era-moka] add btn found:", !!addBtn, "guard:", guard);
          if (!addBtn) break;
          filler.clickElement?.(addBtn);
          await wait(1000);
          guard += 1;
        }
        console.log("[era-moka] final award fields:", mokaCountAwardFields());
      }
    }
    // Sunwz|2026-08-12|——END
    const candidates = normalizer.normalizeProfile(activeProfile);
    let records = [];
    try { records = scanRecords(); console.log("[era] scan ok:", records.length); } catch (e) { console.log("[era] scan err:", e.message, e.stack); }
    const mappings = matcher.matchFields(records, candidates, {
      site: siteId(),
      profile: activeProfile,
      baiduDefaults: normalizer.deriveBaiduDefaults(activeProfile),
    });
    runtime.lastMappings = mappings;
    runtime.lastReport = {
      site: siteId(),
      records: records.length,
      mappings: mappings.length,
      skipped: mappings.filter((mapping) => mapping.skipReason).length,
      items: mappings.map(serializeMapping),
    };
    markMappings(mappings);
    renderPanel(runtime.lastReport, "scan");
    return runtime.lastReport;
  }

  async function fill(profile, options = {}) {
    const baseProfile = profile || await loadDefaultProfile();
    await ensureBaiduRows(baseProfile);
    // Sunwz|2026-08-25|填写按钮：先识别公司（若 scan 期间未识别），再尝试拉取对应公司简历版本；
    // 命中时把该版本的 baseSnapshot 覆盖到本地基础数据之上，并把 variableModules 注入实习/项目/核心能力。
    // 这样基本信息/教育/获奖等不变（保留 profile.json 全量），实习项目等用对应公司定制版。
    await identifyCompany();
    const detectedCompany = runtime.detectedCompany;
    let activeProfile = baseProfile;
    // 选定版本 id：手动选择或自动识别后的默认值；「原版简历」= ORIGIN_VERSION
    const selectedVersionId = runtime.selectedVersionId || await loadSelectedVersion(detectedCompany);
    // 强制用原版母本（popup 点选「原版简历」）或下拉选「原版简历」：直接用本地 profile，不拉取
    const useOrigin = options.useOrigin || selectedVersionId === ORIGIN_VERSION;
    if (!useOrigin) {
      const api = getPluginApi();
      if (api) {
        try {
          let version;
          if (selectedVersionId) {
            // 手动/自动选定了某公司版本：从已加载版本列表里取公司名，再按 id 拉取
            // （未识别到公司也能用——用户手动选了哪份就用哪份）
            const chosen = runtime.companyVersions?.find((v) => String(v.id) === String(selectedVersionId));
            const companyForFetch = (chosen && chosen.company) || detectedCompany || "";
            if (companyForFetch) {
              version = await api.fetchResumeVersionById(companyForFetch, selectedVersionId);
            }
          } else if (detectedCompany) {
            version = await api.fetchResumeVersion(detectedCompany);
          }
          activeProfile = version ? mergeCompanyVersion(baseProfile, version) : baseProfile;
        } catch (err) {
          setPanelNotice(`拉取「${detectedCompany || "所选"}」版本失败：${String(err.message || err)}，已回退本地资料。`, "warn");
        }
      }
    }
    const report = await scan(activeProfile);
    const results = [];
    const filledIds = new Set();
    // Sunwz|2026-08-06|抽成可复用的处理函数，第二遍补填时复用；只对已填成功的记录去重，失败的重试
    const elementsFilled = [];
    const processMappings = async (mappings, force = false) => {
      for (const mapping of mappings) {
        // Sunwz|2026-08-06|去重键用元素引用而非序号 id：分步表单选学历后字段插入会改变序号，id 会撞车导致新字段被误跳过
        const dedupeKey = mapping.record.element || mapping.record.id;
        // Sunwz|2026-08-06|——END
        if (!force && filledIds.has(dedupeKey)) continue;
        if (mapping.skipReason || !String(mapping.value || "").trim()) {
          results.push({ id: mapping.record.id, ok: false, reason: mapping.skipReason || "empty-value" });
          filledIds.add(dedupeKey);
          filler.finishInteraction?.(mapping.record.element || mapping.record.root);
          continue;
        }
        try {
          const result = await filler.fillRecord(mapping.record, mapping.value);
          try { console.log('[era-result] ' + JSON.stringify({ label: mapping.record.label, ok: !!(result && result.ok), reason: result && result.reason, anchor: mapping.record.segAnchor || "" })); } catch (e) {}
          results.push({ id: mapping.record.id, label: mapping.record.label, ...result });
          if (result.ok) {
            filledIds.add(dedupeKey);
            elementsFilled.push(mapping.record.element);
            // Sunwz|2026-08-27|非日期锚字段填写成功后，把段锚/段序打到父容器上，
            // 供同一段内的日期字段第二遍扫描时读取，解决低代码表单日期字段 ri 全局累加导致的错位。
            const sec = mapping.record.section;
            const riSeg = mapping.record.repeatIndex;
            if (sec && riSeg != null) {
              const anchorVal = profileAnchorForSection(activeProfile, sec, riSeg);
              if (anchorVal) {
                const container = nearestRepeatContainer(mapping.record.element || mapping.record.root);
                if (container) {
                  container.setAttribute("data-era-seg-anchor", anchorVal);
                  container.setAttribute("data-era-seg-idx", String(riSeg));
                }
              }
            }
          }
          await wait(80);
        } catch (error) {
          results.push({ id: mapping.record.id, label: mapping.record.label, ok: false, reason: String(error.message || error).slice(0, 120) });
          filledIds.add(dedupeKey);
        }
      }
    };
    // Sunwz|2026-08-06|——END
    // Sunwz|2026-08-27|两遍填写：先只填非日期字段，让"单位名称/项目名称/学校名称"先落库；
    // 随后重扫（此时锚值已存在），日期字段凭锚值+段序精确定位到正确分段，避免实习/项目 repeatIndex
    // 同为 0 起算、或 moduleTitleOf 检测不到模块标题导致的错位（实测 示例公司E段曾被错填成示例公司A/示例平台A 的值）。
    const isDateMapping = (m) => /开始时间|结束时间|毕业时间|入学时间|获奖时间|出生日期/.test(m.record.label || "");
    // Sunwz|2026-08-27|先填非日期，让"单位名称/项目名称/学校名称"锚值落库
    await processMappings(runtime.lastMappings.filter((m) => !isDateMapping(m)));
    await wait(900);
    await scan(activeProfile);
    // Sunwz|2026-08-27|日期两遍 + 段分组 + settle 兜底：
    // ① 全局取消所有"至今"（幂等）：使随后逐条 uncheck 变为空操作、不再触发重渲染冲掉同段兄弟日期；
    // ② 按段(segAnchor)分组，段内 end/毕业 先于 start 填（end 的 uncheck 已无操作→不重渲染），保证 start 不被冲掉；
    // ③ 末轮 settle：重扫把仍空的日期（含"假OK"被冲掉者）强制再填一遍。
    const dateMappings = runtime.lastMappings.filter(isDateMapping);
    try {
      const anyRec = (dateMappings[0] || {}).record;
      if (anyRec) await filler.uncheckUntilNow(anyRec.root || anyRec.element);
    } catch (e) {}
    await wait(500);
    const groups = new Map();
    for (const m of dateMappings) {
      const a = m.record.segAnchor || "__seg_none__";
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(m);
    }
    const endWeight = (m) => (/结束时间|毕业时间/.test(m.record.label || "") ? 1 : 0);
    for (const [, ms] of groups) {
      ms.sort((a, b) => endWeight(a) - endWeight(b));
      await processMappings(ms);
      await wait(200);
    }
    // ③ settle：多轮重扫，把仍空的日期强制再填（捕获假OK/被重渲染冲掉的值；fillDateRobust 每轮重定位 live 节点）
    for (let s = 0; s < 3; s += 1) {
      await wait(900);
      await scan(activeProfile);
      const settleMappings = runtime.lastMappings.filter(isDateMapping).filter((m) => {
        const live = filler.findLiveDateControl ? filler.findLiveDateControl(m.record) : (m.record.root || m.record.element);
        if (!live) return false;
        const trig = live.querySelector(".phoenix-select,[class*=phoenix-select]") || live;
        const txt = trig ? (trig.textContent || "") : "";
        return !/20\d\d/.test(txt);
      });
      if (!settleMappings.length) break;
      try { await filler.uncheckUntilNow((settleMappings[0] || {}).record); } catch (e) {}
      await wait(400);
      await processMappings(settleMappings, true);
    }
    // Sunwz|2026-08-08|飞书：多轮扫描→填充→等待卡片展开→再扫描（卡片初始折叠，填完日期选择器后异步展开露出文本输入）
    if (siteId() === "feishu") {
      const feishuCandidates = normalizer.normalizeProfile(activeProfile);
      for (let round = 0; round < 5; round += 1) {
        await wait(2500); // 等待卡片展开
        const newRecords = scanRecords();
        // 只取上一轮未填充过的新元素
        const newMappings = matcher.matchFields(newRecords, feishuCandidates, { site: siteId(), profile: activeProfile })
          .filter((m) => !filledIds.has(m.record.element || m.record.id));
        if (newMappings.length === 0) break; // 没有新字段，结束循环
        await processMappings(newMappings);
      }
    } else if (siteId() !== "baidu" && siteId() !== "moka") {
      // Sunwz|2026-08-06|分步表单（简道云等）：第一遍填完可见字段后，第二遍只重扫并填新出现字段
      await wait(1800);
      const secondCandidates = normalizer.normalizeProfile(activeProfile);
      const secondRecords = scanRecords();
      const secondMappings = matcher.matchFields(secondRecords, secondCandidates, { site: siteId(), profile: activeProfile });
      await processMappings(secondMappings);
      await wait(800);
    }
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-08-07|AIRCAS 可重复表格（教育经历/家庭信息）：打开新增弹窗逐条填
    let tableAdded = 0;
    let familyAdded = 0;
    if (siteId() === "aircas") {
      tableAdded = await aircasFillEducationTable(activeProfile);
      familyAdded = await aircasFillFamilyTable(activeProfile);
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-08|飞书：多轮添加+填充（第1次点添加出有输入框卡片，第2次出空占位，需交替）
    if (siteId() === "feishu") {
      const sections = activeProfile?.profileV2?.sections || activeProfile?.sections || {};
      const targets = [
        { title: "实习经历", titles: ["实习经历", "实习经验"], items: sections.internship?.items || [] },
        { title: "项目经历", titles: ["项目经历", "项目经验"], items: sections.project?.items || [] },
        { title: "获奖", titles: ["获奖", "奖项", "荣誉"], items: sections.awards?.items || [] },
      ];
      for (let round = 0; round < 8; round += 1) {
        let needMore = false;
        for (const target of targets) {
          if (target.items.length <= 1) continue;
          const module = feishuFindModule(target);
          if (!module) continue;
          const cardsWithInputs = feishuCountCardsWithInputs(module);
          if (cardsWithInputs < target.items.length) {
            needMore = true;
            try { await feishuClickAddOne(module); } catch (e) { console.log("[era] add one err", e.message); }
          }
        }
        if (!needMore) break;
        await wait(1500);
        try {
          const secondCandidates = normalizer.normalizeProfile(activeProfile);
          const secondRecords = scanRecords();
          const secondMappings = matcher.matchFields(secondRecords, secondCandidates, { site: siteId(), profile: activeProfile });
          await processMappings(secondMappings);
        } catch (e) { console.log("[era] round err", e.message); break; }
      }
    }
    // Sunwz|2026-08-08|——END
    const filled = results.filter((result) => result.ok).length;
    const failed = results.length - filled;
    filler.finishInteraction?.();
    markMappings(runtime.lastMappings, results);
    runtime.lastReport = { ...report, filled, failed, results, tableAdded, familyAdded };
    // Sunwz|2026-08-24|诊断：把 lastReport 复制到 window 方便测试脚本 dump（无副作用）
    try { globalThis.__eraLastReport = runtime.lastReport; } catch (e) {}
    renderPanel(runtime.lastReport, "fill");
    window.__eraFillDone = true;
    return runtime.lastReport;
  }

  // 秋招通插件新增：把后端 variableModules 转成仅含可变模块的临时 profile。
  // 由于匹配器只为“有候选值的字段”生成填充映射，basic/education/家庭等不变模块在临时 profile 中
  // 没有候选值，因此不会被触碰——天然满足“只替换可变模块”。
  function pluginVariableToItems(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      // 按条目拆分：优先按编号条目（1. 2. 一、）或空行，否则整段作为一条
      const byNumber = text.split(/\n\s*(?=\d+[.、]|[一二三四五六七八九十]+[.、])/).map((s) => s.trim()).filter(Boolean);
      if (byNumber.length > 1) return byNumber;
      return text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }

  function splitPeriod(period) {
    if (!period) return { start: "", end: "" };
    const parts = String(period).split(/[~\-～]/).map((s) => s.trim());
    return { start: parts[0] || "", end: parts[1] || "" };
  }

  function joinLines(arr) {
    if (!Array.isArray(arr)) return "";
    return arr.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n");
  }

  function buildInternshipFromObject(intern) {
    const values = {};
    values["公司"] = intern.company || "";
    values["职位"] = intern.role || "";
    const period = splitPeriod(intern.period);
    values["开始时间"] = period.start;
    values["结束时间"] = period.end;
    const projTexts = [];
    const highlights = [];
    (intern.projects || []).forEach((p) => {
      const parts = [];
      if (p.name) parts.push(`【${p.name}】`);
      if (p.description) parts.push(p.description);
      if (p.techStack) parts.push(`技术栈：${p.techStack}`);
      if (Array.isArray(p.highlights) && p.highlights.length) {
        parts.push("亮点：" + p.highlights.join("；"));
        highlights.push(...p.highlights);
      }
      if (parts.length) projTexts.push(parts.join("\n"));
    });
    values["工作内容"] = projTexts.join("\n\n");
    values["工作成果"] = joinLines(highlights);
    return { values };
  }

  function buildProjectFromObject(p) {
    const values = {};
    values["项目名称"] = p.name || "";
    values["职位"] = p._role || p.role || "";
    const period = splitPeriod(p._period || "");
    values["开始时间"] = period.start;
    values["结束时间"] = period.end;
    values["项目内容"] = p.description || "";
    values["本人职责"] = p.techStack || "";
    values["项目成果"] = joinLines(p.highlights);
    return { values };
  }

  function buildVariableProfile(variableModules) {
    const vm = variableModules || {};
    const sections = {};

    // internship：优先按结构化对象数组解析；回退旧版字符串/字符串数组
    if (Array.isArray(vm.internship) && vm.internship.length && typeof vm.internship[0] === "object") {
      sections.internship = {
        key: "internship",
        title: "实习经历",
        kind: "repeat",
        items: vm.internship.map(buildInternshipFromObject),
      };
    } else {
      const internships = pluginVariableToItems(vm.internship);
      if (internships.length) {
        sections.internship = {
          key: "internship",
          title: "实习经历",
          kind: "repeat",
          items: internships.map((text) => ({ values: { "工作内容": text } })),
        };
      }
    }

    // project：优先按结构化对象数组解析；回退旧版字符串/字符串数组
    if (Array.isArray(vm.project) && vm.project.length && typeof vm.project[0] === "object") {
      sections.project = {
        key: "project",
        title: "项目经验",
        kind: "repeat",
        items: vm.project.map(buildProjectFromObject),
      };
    } else {
      const projects = pluginVariableToItems(vm.project);
      if (projects.length) {
        sections.project = {
          key: "project",
          title: "项目经验",
          kind: "repeat",
          items: projects.map((text) => ({ values: { "项目内容": text } })),
        };
      }
    }

    // core_skills：对象 {technical[], soft[]} 或字符串/数组
    let coreSkills = "";
    if (vm.core_skills && typeof vm.core_skills === "object" && !Array.isArray(vm.core_skills)) {
      const tech = joinLines(vm.core_skills.technical);
      const soft = joinLines(vm.core_skills.soft);
      coreSkills = [tech ? `技术能力：\n${tech}` : "", soft ? `软技能：\n${soft}` : ""].filter(Boolean).join("\n\n");
    } else if (typeof vm.core_skills === "string") {
      coreSkills = vm.core_skills.trim();
    } else if (Array.isArray(vm.core_skills)) {
      coreSkills = vm.core_skills.map((s) => String(s)).join("\n").trim();
    }
    if (coreSkills) {
      sections.coreSkills = {
        key: "coreSkills",
        title: "核心能力",
        kind: "simple",
        values: { "核心能力": coreSkills },
      };
    }

    // self（自我评价/自我描述）：按公司定制版覆盖（流二产物可能含 re-summarized 自评）
    if (vm.self && typeof vm.self === "object" && !Array.isArray(vm.self)) {
      const sd = String(vm.self["自我描述"] || "").trim();
      const se = String(vm.self["自我评价"] || "").trim();
      if (sd || se) {
        sections.self = {
          key: "self",
          title: "自我评价",
          kind: "simple",
          values: { "自我描述": sd, "自我评价": se },
        };
      }
    }

    return { profileV2: { sections } };
  }

  // 把后端公司版本的 baseSnapshot 内容按字段平铺到本地 profileV2.sections 上。
  // baseSnapshot 的结构与 profileV2 sections 等价（key → { kind, items, values }），这里做浅合并：
  // 1) baseSnapshot 提供的目标字段非空时，覆盖本地对应字段（解决某些公司版本只存 "原版"基础数据的问题）
  // 2) 本地已存在的同名字段且本地为 null/空数组时，才覆盖（避免把已有数据清空）
  function applyBaseSnapshot(localSections, baseSnapshot) {
    if (!baseSnapshot || typeof baseSnapshot !== "object") return localSections;
    const out = localSections || {};
    // baseSnapshot 可能是 {sections:{basic:...,intention:...,education:{items:[...]},...}} 或平整字段列表
    const incoming = baseSnapshot.sections || baseSnapshot.profileV2?.sections || baseSnapshot;
    for (const [key, val] of Object.entries(incoming || {})) {
      if (!val || typeof val !== "object") continue;
      const local = out[key];
      // 数组 items（教育/internship/project/awards/student/certificates/language/work/portfolio）
      const items = Array.isArray(val.items) ? val.items : (Array.isArray(val) ? val : null);
      if (items && local && Array.isArray(local.items)) {
        const localEmpty = local.items.every((it) => !it || !it.values || Object.values(it.values || {}).every((v) => !v || (Array.isArray(v) && v.length === 0)));
        if (localEmpty && items.length) {
          out[key] = { ...local, ...val, items };
        }
      } else if (items && !local) {
        out[key] = { ...val, items };
      } else if (val.values && (!local || !local.values || Object.keys(local.values).length === 0)) {
        out[key] = { ...(local || {}), ...val, values: { ...(local?.values || {}), ...(val.values || {}) } };
      }
    }
    return out;
  }

  // 把对应公司的 baseSnapshot + variableModules 合并到本地 profile。
  // 合并后填一份临时 profile 供本次 fill() 使用，不写入 chrome.storage（保持原 profile 不变）。
  function mergeCompanyVersion(baseProfile, version) {
    if (!version) return baseProfile;
    const sections = JSON.parse(JSON.stringify(baseProfile?.profileV2?.sections || {}));
    if (version.baseSnapshot) {
      const merged = applyBaseSnapshot(sections, version.baseSnapshot);
      sections.basic = merged.basic || sections.basic;
      sections.education = merged.education || sections.education;
      sections.intention = merged.intention || sections.intention;
      sections.work = merged.work || sections.work;
      sections.awards = merged.awards || sections.awards;
      sections.student = merged.student || sections.student;
      sections.certificates = merged.certificates || sections.certificates;
      sections.language = merged.language || sections.language;
    }
    // variableModules：实习/项目/核心能力/自评 以该公司的定制版为准（key by section）
    if (version.variableModules) {
      const variableProfile = buildVariableProfile(version.variableModules);
      const vSec = variableProfile.profileV2?.sections || {};
      for (const k of ["internship", "project", "coreSkills", "self"]) {
        if (vSec[k]) sections[k] = vSec[k];
      }
    }
    return { profileV2: { sections } };
  }

  // ===================== 秋招通：识别公司，不弹窗 =====================
  // 改写自旧的 autoDetectCompany：保留 detectCompanies 识别逻辑，
  // 但不再创建悬浮标签/「立即填充」按钮，识别结果只写入 runtime.detectedCompany，
  // 由 panel 的「检测」「填写」按钮读取来分别展示和用对应简历版本填表。
  const PLUGIN_STORAGE_KEYS = {
    selectedCompany: "pluginSelectedCompany",
    selectedVersion: "pluginSelectedVersion",
  };

  function getPluginApi() { return window.EdgeResumePluginApi; }
  function getCompanyDetector() { return window.EdgeResumeCompanyDetector; }

  // 同步识别当前页面所属公司（仅查询 /plugin/versions 列表里已有的公司，并只在该公司在后端有版本时返回）。
  // 不在页面展示任何 UI 元素，被 detect() 和 fill() 共用。
  async function identifyCompany() {
    if (!isTopFrame()) return null;
    const detector = getCompanyDetector();
    const api = getPluginApi();
    if (!detector || !api) return null;
    try {
      const pageInfo = detector.extractPageInfo();
      const versions = await api.listAllVersions().catch(() => []);
      if (!versions.length) return null;
      const matched = detector.detectCompanies(pageInfo, versions);
      const top = matched.length ? matched[0] : null;
      if (top && versions.some((v) => v.company === top.company)) {
        runtime.detectedCompany = top.company;
        runtime.detectedReason = top.reason;
        // 识别成功后加载该公司的在线简历版本到下拉框
        runtime.companyVersions = versions
          .filter((v) => v.company === top.company)
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        const storedVersion = await loadSelectedVersion(top.company);
        renderVersionSelector(top.company, runtime.companyVersions, storedVersion);
        return top;
      }
      // 未识别到对应公司版本：进入手动选择模式，下拉框列出「原版简历」+全部可用版本
      runtime.detectedCompany = null;
      runtime.detectedReason = null;
      runtime.companyVersions = versions
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const storedVersion = await loadSelectedVersion(null);
      renderVersionSelector(null, runtime.companyVersions, storedVersion);
      return null;
    } catch {
      return null;
    }
  }

  function clearDetectedCompany() {
    runtime.detectedCompany = null;
    runtime.detectedReason = null;
  }

  if (isTopFrame()) {
    // 仅识别（不再弹窗），把结果写入 runtime.detectedCompany
    const startAutoDetect = () => setTimeout(() => void identifyCompany(), 1200);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startAutoDetect, { once: true });
    } else {
      startAutoDetect();
    }
  }
  // ===================== 秋招通自动识别 END =====================

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !["ERA_SCAN", "ERA_FILL", "ERA_GET_PAGE_STATE", "ERA_CLEAR_MARKS", "ERA_TOGGLE_ASSISTANT", "ERA_OPEN_PANEL", "ERA_PLUGIN_FILL"].includes(message.type)) return false;
      // Sunwz|2026-08-08|默认只允许顶层 frame；飞书真实表单有时在 iframe 内，允许该类表单 frame 响应扫描/填写。
      if (!shouldHandleMessageInThisFrame(message)) return false;
      // Sunwz|2026-08-08|——END
      (async () => {
        const profile = profileFromMessage(message) || await loadStoredProfile();
        if (message.type === "ERA_GET_PAGE_STATE") {
          const records = recordWaiter?.waitForRecords
            ? await recordWaiter.waitForRecords(scanRecords, { attempts: 10, delayMs: 220 })
            : scanRecords();
          return {
            ok: true,
            report: {
              site: siteId(),
              siteLabel: siteLabel(),
              records: records.length || runtime.lastReport?.records || 0,
              lastReport: runtime.lastReport,
              panelOpen: Boolean(document.getElementById("era-panel") && !document.getElementById("era-panel").hidden),
            },
          };
        }
        if (message.type === "ERA_CLEAR_MARKS") {
          clearMarks();
          runtime.lastReport = null;
          renderPanel(null);
          return { ok: true, report: runtime.lastReport };
        }
        if (message.type === "ERA_OPEN_PANEL") {
          runtime.lastProfile = profile;
          togglePanel(true);
          return { ok: true, report: { panelOpen: true } };
        }
        if (message.type === "ERA_TOGGLE_ASSISTANT") {
          runtime.lastProfile = profile;
          const panel = togglePanel(null);
          return { ok: true, report: { panelOpen: Boolean(panel && !panel.hidden) } };
        }
        if (message.type === "ERA_SCAN") {
          const report = await scan(profile);
          return { ok: true, report };
        }
        // 秋招通插件新增：仅用后端可变模块填充（识别公司后拉取）。basicide/学历/家庭保持不动。
        if (message.type === "ERA_PLUGIN_FILL") {
          if (!message.variableModules) {
            return { ok: false, error: "缺少可变模块数据（variableModules）" };
          }
          let variableProfile;
          if (message.useOrigin) {
            // popup 选择「原版简历」：强制使用本地母本，不再拉取页面识别到的公司定制版
            variableProfile = await loadDefaultProfile();
          } else {
            variableProfile = buildVariableProfile(message.variableModules);
          }
          const report = await fill(variableProfile, { useOrigin: message.useOrigin });
          report.company = message.company || "";
          report.versionId = message.versionId || null;
          report.onlyVariable = true;
          return { ok: true, report };
        }
        const report = await fill(profile);
        return { ok: true, report };
      })().then(sendResponse).catch((error) => {
        showStatus("简历快填失败", String(error.message || error), "error");
        sendResponse({ ok: false, error: String(error.message || error) });
      });
      return true;
    });
  }

  if (isTopFrame()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => ensurePageUi(), { once: true });
    } else {
      ensurePageUi();
    }
  }
})();
