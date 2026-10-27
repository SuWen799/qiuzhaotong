(function initOptions() {
  "use strict";

  const ui = window.EdgeResumeUiHelpers;
  const normalizer = window.EdgeResumeProfileNormalizer;
  const els = {
    exportProfile: document.getElementById("exportProfile"),
    feedback: document.getElementById("feedback"),
    file: document.getElementById("profileFile"),
    form: document.getElementById("profileForm"),
    overview: document.getElementById("sectionOverview"),
    profileSource: document.getElementById("profileSource"),
    profileSummary: document.getElementById("profileSummary"),
    resetProfile: document.getElementById("resetProfile"),
    saveProfile: document.getElementById("saveProfile"),
    pluginSelection: document.getElementById("pluginSelection"),
  };

  const field = (label, type = "text", aliases = []) => ({ label, type, aliases });
  const long = (label, aliases = []) => field(label, "textarea", aliases);

  const SECTION_DEFS = [
    {
      key: "attachments",
      title: "附件",
      kind: "simple",
      fields: [
        field("个人简历文件", "text", ["简历文件", "上传简历"]),
        field("个人照片", "text", ["照片", "证件照", "上传照片"]),
        field("作品集文件", "text", ["作品附件"]),
      ],
    },
    {
      key: "basic",
      title: "基础信息",
      kind: "simple",
      fields: [
        field("姓名", "text"),
        field("性别", "text"),
        field("出生日期", "date"),
        field("民族", "text"),
        field("国籍（国家或地区）", "text", ["国籍", "国籍地区"]),
        field("电话", "tel", ["手机号", "手机号码", "移动电话"]),
        field("邮箱", "email", ["电子邮箱"]),
        field("微信号", "text"),
        field("身份证号", "text", ["证件号码", "身份证号码"]),
        field("政治面貌", "text"),
        field("取得政治面貌时间", "date", ["入党时间"]),
        field("籍贯", "text"),
        field("生源地", "text"),
        field("现居住城市", "text"),
        field("现居住详细地址", "text"),
        field("通讯地址", "text"),
        field("人事档案所在地", "text"),
      ],
    },
    {
      key: "intention",
      title: "求职意向",
      kind: "repeat",
      itemLabel: "求职意向",
      fields: [
        field("意向岗位", "text", ["目标岗位", "应聘岗位"]),
        field("预计入职时间", "date"),
        field("期望工作城市", "text", ["目标工作城市"]),
        field("期望城市首选", "text", ["首选城市"]),
        field("可线下面试城市", "text", ["面试城市", "面试城市首选", "线下面试城市"]),
        field("是否接受调剂", "text", ["是否服从调配", "服从调剂"]),
        field("当前薪资", "text"),
        field("期望薪资", "text"),
      ],
    },
    {
      key: "education",
      title: "教育经历",
      kind: "repeat",
      itemLabel: "教育经历",
      fields: [
        field("开始时间", "month"),
        field("结束时间", "month"),
        field("学校", "text", ["学校名称", "毕业院校"]),
        field("专业", "text", ["专业名称"]),
        field("学历", "text"),
        field("学位", "text"),
        field("学院（院系）", "text", ["学院", "院系"]),
        field("研究方向", "text"),
        long("专业课程"),
        field("成绩", "text", ["平均成绩", "综合成绩"]),
        field("GPA类型", "text", ["绩点类型", "成绩类型"]),
        field("GPA成绩", "text", ["成绩绩点", "绩点", "GPA"]),
        field("成绩排名", "text", ["专业排名", "班级排名"]),
        field("挂科数", "number"),
      ],
    },
    {
      key: "internship",
      title: "实习经历",
      kind: "repeat",
      itemLabel: "实习经历",
      fields: [
        field("开始时间", "month"),
        field("结束时间", "month"),
        field("公司", "text", ["企业名称", "实习单位"]),
        field("部门", "text"),
        field("行业", "text"),
        field("地点", "text", ["工作地点"]),
        field("职位", "text", ["职位名称", "实习岗位"]),
        field("工资", "text", ["薪资"]),
        field("月薪", "text"),
        field("年薪薪资", "text", ["年薪", "职位年薪"]),
        long("工作内容", ["工作描述", "实习内容"]),
        long("工作成果"),
      ],
    },
    {
      key: "work",
      title: "工作经历",
      kind: "repeat",
      itemLabel: "工作经历",
      fields: [
        field("开始时间", "month"),
        field("结束时间", "month"),
        field("公司", "text", ["企业名称"]),
        field("部门", "text"),
        field("行业", "text"),
        field("地点", "text", ["工作地点"]),
        field("职位", "text", ["职位名称"]),
        field("工资", "text", ["薪资"]),
        field("月薪", "text"),
        field("年薪薪资", "text", ["年薪", "职位年薪"]),
        long("工作内容", ["工作描述"]),
        long("工作成果"),
      ],
    },
    {
      key: "project",
      title: "项目经验",
      kind: "repeat",
      itemLabel: "项目",
      fields: [
        field("开始时间", "month"),
        field("结束时间", "month"),
        field("项目名称", "text"),
        field("职位", "text", ["项目职务", "项目角色"]),
        field("参与人数", "number"),
        long("项目内容", ["项目描述"]),
        long("本人职责", ["项目职责"]),
        long("项目成果"),
        field("项目链接", "url", ["作品链接"]),
        field("项目地址", "text"),
      ],
    },
    {
      key: "awards",
      title: "获奖经历",
      kind: "repeat",
      itemLabel: "获奖",
      fields: [
        field("奖惩时间", "month", ["获奖时间", "颁发时间"]),
        field("奖惩名称", "text", ["奖项名称", "荣誉名称"]),
        field("颁奖单位", "text", ["颁发机构", "授予单位"]),
        field("奖励等级", "text", ["奖项级别"]),
        field("奖励类型", "text", ["奖项类型"]),
        long("奖惩描述", ["获奖描述", "奖项描述"]),
      ],
    },
    {
      key: "portfolio",
      title: "作品集",
      kind: "repeat",
      itemLabel: "作品",
      fields: [
        field("作品名称", "text"),
        field("作品链接", "url", ["作品集链接", "作品主页", "个人主页"]),
        field("作品角色", "text"),
        long("作品描述", ["作品简介", "作品说明"]),
      ],
    },
    {
      key: "language",
      title: "外语能力",
      kind: "repeat",
      itemLabel: "外语能力",
      fields: [
        field("获得时间", "month"),
        field("外语种类", "text"),
        field("证书名称（技能名称）", "text"),
        field("成绩", "text"),
        field("掌握程度", "text"),
      ],
    },
    {
      key: "certificates",
      title: "证书",
      kind: "repeat",
      itemLabel: "证书",
      fields: [
        field("获得时间", "month"),
        field("证书名称", "text"),
        field("证书类型", "text"),
        field("成绩", "text"),
      ],
    },
    {
      key: "student",
      title: "校园经历",
      kind: "repeat",
      itemLabel: "校园经历",
      fields: [
        field("开始时间", "month"),
        field("结束时间", "month"),
        field("组织名称", "text"),
        field("职位", "text"),
        long("工作内容"),
        long("本人职责"),
      ],
    },
    {
      key: "self",
      title: "自我评价",
      kind: "simple",
      fields: [
        long("自我描述"),
        long("自我评价"),
      ],
    },
    {
      key: "other",
      title: "其他信息",
      kind: "simple",
      fields: [
        long("受到奖励/学术成果", ["受到奖励", "学术成果"]),
        long("社会/校园活动", ["社会活动", "校园活动"]),
        long("爱好及专长", ["兴趣爱好", "特长"]),
        field("招聘信息来源", "text", ["招聘来源", "信息来源"]),
        field("GitHub", "url"),
        field("个人主页", "url", ["作品链接", "作品集链接"]),
      ],
    },
  ];

  let profile = null;
  let source = "bundled";
  let dirty = false;

  function setFeedback(message, isError = false) {
    els.feedback.textContent = message;
    els.feedback.classList.toggle("error", isError);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
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

  function normalizeLabel(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function fieldNames(def) {
    return [def.label, ...(def.aliases || [])].filter(Boolean);
  }

  function readValue(values, def) {
    for (const name of fieldNames(def)) {
      const value = values?.[name];
      if (String(value ?? "").trim()) return String(value);
    }
    const normalizedNames = new Set(fieldNames(def).map(normalizeLabel));
    const matched = Object.entries(values || {}).find(([key, value]) => normalizedNames.has(normalizeLabel(key)) && String(value ?? "").trim());
    return matched ? String(matched[1]) : "";
  }

  function sectionMap() {
    return profile?.profileV2?.sections || profile?.sections || {};
  }

  function sourceSection(key) {
    const sections = sectionMap();
    if (sections[key]) return sections[key];
    if (key === "intention" && sections.intent) return sections.intent;
    if (key === "project" && sections.projects) return sections.projects;
    return null;
  }

  function mutableSections() {
    profile.profileV2 ||= {};
    profile.profileV2.sections ||= {};
    return profile.profileV2.sections;
  }

  function existingFieldDefs(def, data) {
    const fields = [...(def.fields || [])];
    const known = new Set(fields.flatMap(fieldNames).map(normalizeLabel));
    const addExisting = (values = {}) => {
      for (const key of Object.keys(values)) {
        const normalized = normalizeLabel(key);
        if (!known.has(normalized)) {
          fields.push(field(key, guessType(key)));
          known.add(normalized);
        }
      }
    };

    if (def.kind === "repeat") {
      for (const item of data?.items || []) addExisting(item?.values);
    } else {
      addExisting(data?.values);
    }
    return fields;
  }

  function guessType(label) {
    if (/描述|内容|职责|成果|评价|课程|活动|专长|学术/.test(label)) return "textarea";
    if (/邮箱/.test(label)) return "email";
    if (/电话|手机/.test(label)) return "tel";
    if (/链接|主页|github/i.test(label)) return "url";
    if (/时间|日期/.test(label)) return "text";
    return "text";
  }

  async function loadBundledProfile() {
    const response = await fetch(chrome.runtime.getURL("data/profile.json"));
    return response.json();
  }

  async function loadProfile() {
    // Sunwz|2026-09-26|磁盘内置资料（原版简历）为唯一权威源，浏览器本地副本仅作读取失败兜底；
    // 内置资料读取成功时顺手清掉浏览器旧副本，避免旧内容再次覆盖
    try {
      profile = await loadBundledProfile();
      source = "bundled";
      try { await chrome.storage.local.remove(["profile"]); } catch {}
    } catch {
      const stored = await chrome.storage.local.get(["profile"]);
      source = stored.profile ? "storage" : "bundled";
      profile = stored.profile || await loadBundledProfile();
    }
    dirty = false;
    render();
    await renderPluginSelection();
  }

  // 只读展示 popup 当前选中的公司与版本（与插件填充目标一致）
  async function renderPluginSelection() {
    if (!els.pluginSelection) return;
    try {
      const sel = await chrome.storage.local.get(["pluginSelectedCompany", "pluginSelectedVersion"]);
      const company = sel.pluginSelectedCompany || "";
      const version = sel.pluginSelectedVersion || "";
      if (!company) {
        els.pluginSelection.textContent = "尚未选择公司。请在浏览器工具栏的插件 popup 中识别并选择公司。";
        return;
      }
      const versionLabel = !version || version === "__origin__" ? "原版简历" : `定制版本（${version}）`;
      els.pluginSelection.innerHTML = `当前公司：<b>${escapeHtml(company)}</b>；简历版本：<b>${escapeHtml(versionLabel)}</b>。`;
    } catch {
      els.pluginSelection.textContent = "读取填充目标失败。";
    }
  }

  function render() {
    const summary = ui.summarizeProfile(profile);
    els.profileSource.textContent = source === "storage" ? "本地资料" : "扩展内置资料";
    els.profileSummary.textContent = `${summary.sections} 个模块，${summary.fields} 个已填字段，${summary.candidates} 个可匹配候选项。`;
    renderOverview();
    renderForm();
    updateSaveButton();
  }

  function renderOverview() {
    const candidates = normalizer.normalizeProfile(profile);
    const counts = new Map();
    for (const candidate of candidates) {
      counts.set(candidate.section, (counts.get(candidate.section) || 0) + 1);
    }
    const sections = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, count]) => `
        <div class="section-stat">
          <strong>${escapeHtml(ui.sectionLabel(section))}</strong>
          <span>${count} 个候选字段</span>
        </div>
      `)
      .join("");
    els.overview.innerHTML = sections || `<div class="section-stat"><strong>暂无候选字段</strong><span>请先填写资料</span></div>`;
  }

  function renderForm() {
    const sourceKeys = Object.keys(sectionMap());
    const known = new Set(SECTION_DEFS.flatMap((def) => [def.key, def.key === "intention" ? "intent" : ""]));
    const extraDefs = sourceKeys
      .filter((key) => !known.has(key))
      .map((key) => ({
        key,
        title: ui.sectionLabel(key),
        kind: Array.isArray(sectionMap()[key]?.items) ? "repeat" : "simple",
        itemLabel: ui.sectionLabel(key),
        fields: [],
      }));
    els.form.innerHTML = [...SECTION_DEFS, ...extraDefs].map(renderSection).join("");
  }

  function renderSection(def) {
    const data = sourceSection(def.key) || {};
    const fields = existingFieldDefs(def, data);
    const filled = countSectionFilled(def, data, fields);
    const total = def.kind === "repeat" ? Math.max(1, data.items?.length || 1) * fields.length : fields.length;
    const body = def.kind === "repeat" ? renderRepeatSection(def, data, fields) : renderSimpleSection(def, data, fields);

    return `
      <section class="profile-section" data-profile-section="${escapeHtml(def.key)}" data-kind="${escapeHtml(def.kind)}">
        <div class="profile-section-head">
          <div>
            <h3>${escapeHtml(def.title)}</h3>
            <p>${filled}/${total} 项已填</p>
          </div>
          ${def.kind === "repeat" ? `<button type="button" data-action="add-item" data-section="${escapeHtml(def.key)}">新增${escapeHtml(def.itemLabel || def.title)}</button>` : ""}
        </div>
        ${body}
      </section>
    `;
  }

  function countSectionFilled(def, data, fields) {
    if (def.kind === "repeat") {
      return (data.items || []).reduce((sum, item) => sum + fields.filter((fieldDef) => readValue(item?.values, fieldDef).trim()).length, 0);
    }
    return fields.filter((fieldDef) => readValue(data.values, fieldDef).trim()).length;
  }

  function renderSimpleSection(def, data, fields) {
    return `<div class="field-table">${fields.map((fieldDef) => renderField(fieldDef, readValue(data.values, fieldDef))).join("")}</div>`;
  }

  function renderRepeatSection(def, data, fields) {
    const items = Array.isArray(data.items) && data.items.length
      ? data.items
      : [{ title: `${def.itemLabel || def.title} 1`, values: {} }];
    return `
      <div class="repeat-list">
        ${items.map((item, index) => `
          <article class="repeat-item" data-repeat-item>
            <div class="repeat-head">
              <input data-item-title value="${escapeHtml(item.title || `${def.itemLabel || def.title} ${index + 1}`)}" aria-label="${escapeHtml(def.itemLabel || def.title)}标题">
              <button type="button" data-action="remove-item">删除</button>
            </div>
            <div class="field-table">${fields.map((fieldDef) => renderField(fieldDef, readValue(item.values, fieldDef))).join("")}</div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function createBlankRepeatItem(def, index) {
    return { title: `${def.itemLabel || def.title} ${index + 1}`, values: {} };
  }

  function renderField(fieldDef, value = "") {
    const control = fieldDef.type === "textarea"
      ? `<textarea data-field-label="${escapeHtml(fieldDef.label)}" rows="3">${escapeHtml(value)}</textarea>`
      : `<input data-field-label="${escapeHtml(fieldDef.label)}" type="${inputType(fieldDef.type)}" value="${escapeHtml(value)}">`;
    return `
      <label class="field-row">
        <span>${escapeHtml(fieldDef.label)}</span>
        ${control}
      </label>
    `;
  }

  function inputType(type) {
    return ["date", "month", "number", "email", "tel", "url"].includes(type) ? type : "text";
  }

  function updateSaveButton() {
    els.saveProfile.textContent = dirty ? "保存资料（未保存）" : "保存资料";
  }

  function markDirty() {
    dirty = true;
    updateSaveButton();
    setFeedback("资料已修改，点击保存后生效。");
  }

  function collectProfile() {
    const next = clone(profile);
    next.profileV2 ||= {};
    next.profileV2.sections = {};

    for (const sectionEl of els.form.querySelectorAll("[data-profile-section]")) {
      const key = sectionEl.dataset.profileSection;
      const def = SECTION_DEFS.find((item) => item.key === key) || {
        key,
        title: ui.sectionLabel(key),
        kind: sectionEl.dataset.kind || "simple",
      };
      if (def.kind === "repeat") {
        const items = Array.from(sectionEl.querySelectorAll("[data-repeat-item]"))
          .map((itemEl, index) => collectItem(itemEl, def, index))
          .filter((item) => Object.keys(item.values).length > 0);
        next.profileV2.sections[key] = { key, title: def.title, kind: "repeat", items };
      } else {
        const values = collectValues(sectionEl);
        next.profileV2.sections[key] = { key, title: def.title, kind: "simple", values };
      }
    }

    if (next.profileV2.sections.intention) {
      delete next.profileV2.sections.intent;
    }
    next.profileV2.updatedAt = new Date().toISOString();
    return next;
  }

  function collectItem(itemEl, def, index) {
    const title = itemEl.querySelector("[data-item-title]")?.value.trim() || `${def.itemLabel || def.title} ${index + 1}`;
    return { title, values: collectValues(itemEl) };
  }

  function collectValues(scope) {
    const values = {};
    for (const control of scope.querySelectorAll("[data-field-label]")) {
      const label = control.dataset.fieldLabel;
      const value = String(control.value ?? "").trim();
      if (label && value) values[label] = value;
    }
    return values;
  }

  async function saveProfile() {
    try {
      const next = collectProfile();
      await chrome.storage.local.set({ profile: next });
      profile = next;
      source = "storage";
      dirty = false;
      render();
      // Sunwz|2026-09-26|同时写回磁盘 data/profile.json（原版简历权威源），后端同步 resume_base；失败不阻断
      let diskMsg = "";
      try {
        const cfg = await globalThis.EdgeResumePluginApi.getConfig();
        const url = `${cfg.baseUrl}/plugin/profile?token=${encodeURIComponent(cfg.token)}`;
        const response = await globalThis.EdgeResumePluginApi.backendFetch(url, "PUT", { profile: next });
        const body = await response.json().catch(() => null);
        diskMsg = response.ok && body?.success
          ? "，并已写回原版简历文件"
          : "；⚠️ 写回原版简历文件失败（后端未启动？）";
      } catch (e) {
        diskMsg = `；⚠️ 写回原版简历文件失败：${String(e.message || e)}`;
      }
      setFeedback(`资料已保存到浏览器本地存储${diskMsg}。`);
    } catch (error) {
      setFeedback(`保存失败：${String(error.message || error)}`, true);
    }
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file) {
    const next = JSON.parse(await file.text());
    await chrome.storage.local.set({ profile: next });
    profile = next;
    source = "storage";
    dirty = false;
    render();
    setFeedback("备份已导入并保存。");
  }

  async function resetProfile() {
    if (!confirm("恢复内置资料？这会移除浏览器本地导入的资料副本。")) return;
    await chrome.storage.local.remove(["profile"]);
    profile = await loadBundledProfile();
    source = "bundled";
    dirty = false;
    render();
    setFeedback("已恢复使用扩展内置资料。");
  }

  els.form.addEventListener("input", markDirty);
  els.form.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const sectionEl = button.closest("[data-profile-section]");
    if (!sectionEl) return;

    if (button.dataset.action === "add-item") {
      const key = sectionEl.dataset.profileSection;
      const def = SECTION_DEFS.find((item) => item.key === key);
      const section = mutableSections()[key] ||= { key, title: def?.title || key, kind: "repeat", items: [] };
      section.items = Array.isArray(section.items) ? section.items : [];
      section.items.push(createBlankRepeatItem(def || { itemLabel: key, title: key }, section.items.length));
      markDirty();
      render();
      return;
    }

    if (button.dataset.action === "remove-item") {
      const itemEl = button.closest("[data-repeat-item]");
      const key = sectionEl.dataset.profileSection;
      const section = sourceSection(key);
      if (itemEl && section?.items) {
        const items = Array.from(sectionEl.querySelectorAll("[data-repeat-item]"));
        const index = items.indexOf(itemEl);
        if (index >= 0) section.items.splice(index, 1);
      }
      markDirty();
      render();
      return;
    }
  });
  els.saveProfile.addEventListener("click", () => void saveProfile());
  els.exportProfile.addEventListener("click", () => downloadJson("edge-resume-profile-backup.json", collectProfile()));
  els.resetProfile.addEventListener("click", () => void resetProfile());
  els.file.addEventListener("change", async () => {
    const file = els.file.files?.[0];
    if (!file) return;
    try {
      await importFile(file);
    } catch (error) {
      setFeedback(`导入失败：${String(error.message || error)}`, true);
    } finally {
      els.file.value = "";
    }
  });

  loadProfile().catch((error) => setFeedback(String(error.message || error), true));
})();
