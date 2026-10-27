(function initFiller(global) {
  "use strict";

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastTrustedClick = null;
  let bridgeClickId = 0;

  function normalize(value) {
    const matcher = global.EdgeResumeMatcher;
    if (matcher?.normalizeText) return matcher.normalizeText(value);
    return String(value ?? "")
      .toLowerCase()
      .replace(/请填写|请输入|请选择|必填|选填/g, "")
      .replace(/[\s\u00a0:：*＊_\-—–()（）\[\]【】/\\,.，。;；?？!！]/g, "")
      .trim();
  }

  function isConfidential(value) {
    return /保密|面议|无|不填|不写/.test(String(value || ""));
  }

  const MOKA_MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const REGION_PROVINCES = [
    ["北京市", "北京市"], ["上海市", "上海市"], ["天津市", "天津市"], ["重庆市", "重庆市"],
    ["辽宁省", "辽宁"], ["河北省", "河北"], ["山西省", "山西"], ["吉林省", "吉林"], ["黑龙江省", "黑龙江"],
    ["江苏省", "江苏"], ["浙江省", "浙江"], ["安徽省", "安徽"], ["福建省", "福建"], ["江西省", "江西"],
    ["山东省", "山东"], ["河南省", "河南"], ["湖北省", "湖北"], ["湖南省", "湖南"], ["广东省", "广东"],
    ["海南省", "海南"], ["四川省", "四川"], ["贵州省", "贵州"], ["云南省", "云南"], ["陕西省", "陕西"],
    ["甘肃省", "甘肃"], ["青海省", "青海"], ["内蒙古自治区", "内蒙古"], ["广西壮族自治区", "广西"],
    ["西藏自治区", "西藏"], ["宁夏回族自治区", "宁夏"], ["新疆维吾尔自治区", "新疆"],
    ["中国香港", "中国香港"], ["中国澳门", "中国澳门"], ["中国台湾", "中国台湾"],
  ];
  const CITY_PROVINCES = [
    ["南京市", "江苏省"],
    ["苏州市", "江苏省"],
    ["杭州市", "浙江省"],
    ["深圳市", "广东省"],
    ["深圳", "广东省"],
    ["广州市", "广东省"],
    ["泰安市", "山东省"],
    ["济南市", "山东省"],
    ["青岛市", "山东省"],
  ];

  function yearMonthParts(value) {
    const text = String(value || "");
    const match = text.match(/((?:19|20)\d{2})\D?(\d{1,2})?/);
    if (!match) return { year: "", month: "" };
    return {
      year: match[1],
      month: match[2] ? String(Number(match[2])) : "",
    };
  }

  function mokaMonthName(value) {
    const month = Number(yearMonthParts(value).month || String(value || "").match(/\d{1,2}/)?.[0]);
    return MOKA_MONTHS[month - 1] || "";
  }

  function numericEquivalent(value) {
    const text = String(value || "").trim();
    const monthIndex = MOKA_MONTHS.findIndex((month) => text.includes(month));
    if (monthIndex >= 0) return monthIndex + 1;
    const numeric = text.match(/^\D*0?(\d{1,4})\D*$/);
    if (!numeric) return null;
    return Number(numeric[1]);
  }

  function mokaLocationParts(value) {
    const text = String(value || "").replace(/\s+/g, "").trim();
    if (!text) return { province: "", city: "" };

    const match = REGION_PROVINCES.find(([source, display]) => text.includes(source) || text.includes(display));
    if (!match) return { province: text, city: "" };

    const [source, province] = match;
    const provinceIndex = text.indexOf(source) >= 0 ? text.indexOf(source) : text.indexOf(province);
    const provinceLength = text.indexOf(source) >= 0 ? source.length : province.length;
    const rest = text.slice(provinceIndex + provinceLength);
    if (["北京市", "上海市", "天津市", "重庆市"].includes(province) && !rest) {
      return { province, city: "" };
    }

    const cityMatch = rest.match(/^(.+?(?:市|地区|盟|自治州|州))/);
    return { province, city: cityMatch?.[1] || "" };
  }

  function regionSegments(value) {
    const text = String(value || "").replace(/\s+/g, "").trim();
    if (!text) return [];
    const directCity = CITY_PROVINCES.find(([city]) => text === city || text === city.replace(/市$/, ""));
    if (directCity) return [directCity[1], directCity[0]];
    const segments = [];
    const provinceMatch = text.match(/^(.+?(?:省|自治区|特别行政区|市))/);
    if (provinceMatch) segments.push(provinceMatch[1]);
    let rest = provinceMatch ? text.slice(provinceMatch[1].length) : text;
    const cityMatch = rest.match(/^(.+?(?:市|地区|盟|自治州|州))/);
    if (cityMatch) {
      segments.push(cityMatch[1]);
      rest = rest.slice(cityMatch[1].length);
    }
    const districtMatch = rest.match(/^(.+?(?:区|县|市|旗|镇|乡|街道|开发区))/);
    if (districtMatch) segments.push(districtMatch[1]);
    return Array.from(new Set(segments.filter(Boolean)));
  }

  function chooseOption(value, options) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";
    const normalizedValue = normalize(rawValue);
    const optionTexts = (options || []).map(String).filter(Boolean);
    if (!normalizedValue || !optionTexts.length) return "";
    const selectableOptionTexts = optionTexts.filter((option) => normalize(option));

    if (isConfidential(value)) {
      return selectableOptionTexts.find((option) => {
        const text = normalize(option);
        return text === normalizedValue || /保密|面议|无/.test(text);
      }) || "";
    }

    if (/^(否|无|没有|否否|no|false)$/i.test(rawValue)) {
      const negative = selectableOptionTexts.find((option) => /^(无|否|没有|no|false)$/i.test(normalize(option)));
      if (negative) return negative;
    }
    if (/^(是|有|yes|true)$/i.test(rawValue)) {
      const positive = selectableOptionTexts.find((option) => /^(有|是|yes|true)$/i.test(normalize(option)));
      if (positive) return positive;
    }
    if (/省级|省区级/.test(rawValue)) {
      const provincial = selectableOptionTexts.find((option) => /省市级|省级|省部级|省区级/.test(option));
      if (provincial) return provincial;
    }

    const exact = selectableOptionTexts.find((option) => normalize(option) === normalizedValue);
    if (exact) return exact;

    const byValueInOption = selectableOptionTexts.find((option) => normalize(option).includes(normalizedValue));
    if (byValueInOption) return byValueInOption;

    const byOptionInValue = selectableOptionTexts.find((option) => normalizedValue.includes(normalize(option)));
    if (byOptionInValue) return byOptionInValue;

    const numericValue = numericEquivalent(rawValue);
    if (numericValue !== null) {
      const byNumber = selectableOptionTexts.find((option) => numericEquivalent(option) === numericValue);
      if (byNumber) return byNumber;
    }

    const parts = rawValue.split(/[\s,，、/]+/).map(normalize).filter(Boolean);
    for (const part of parts) {
      const match = selectableOptionTexts.find((option) => normalize(option) === part || normalize(option).includes(part) || part.includes(normalize(option)));
      if (match) return match;
    }

    // Sunwz|2026-08-27|期望月薪等「数字+以上/以下」区间值：匹配含该数字的范围选项
    // 如 "15000以上" → 选下限≥15000 中最小的（最贴近，如 15000-20000）；"8000以下" → 选上限≤8000 中最大的
    const rangeMatch = rawValue.match(/(\d+)\s*(以上|以下)/);
    if (rangeMatch) {
      const num = Number(rangeMatch[1]);
      const dir = rangeMatch[2];
      const optRange = selectableOptionTexts
        .map((option) => {
          const ot = normalize(option);
          let lo = null, hi = null;
          const rng = ot.match(/(\d+)\s*[-~]\s*(\d+)/);
          if (rng) { lo = Number(rng[1]); hi = Number(rng[2]); }
          else if (/以上/.test(ot)) { lo = Number(ot.match(/(\d+)/)[1]); hi = Infinity; }
          else if (/以下/.test(ot)) { lo = 0; hi = Number(ot.match(/(\d+)/)[1]); }
          return { option, lo, hi };
        })
        .filter((o) => o.lo !== null);
      let pick = null;
      if (dir === "以上") {
        const cands = optRange.filter((o) => o.lo >= num).sort((a, b) => a.lo - b.lo);
        pick = cands[0] || optRange.filter((o) => o.hi >= num).sort((a, b) => a.hi - b.hi)[0] || null;
      } else {
        const cands = optRange.filter((o) => o.hi <= num).sort((a, b) => b.hi - a.hi);
        pick = cands[0] || null;
      }
      if (pick) return pick.option;
    }
    // Sunwz|2026-08-27|——END

    // Sunwz|2026-09-08|期望月薪等「X－Y / X~Y / X～Y」闭区间值（无"以上/以下"）：匹配选项中范围最贴合的。
    // 优先选【包含下界】的，其次选【区间重叠最大】的，再次选下界最接近值的；如 "15000－20000" → "15001～25000"。
    const valRange = rawValue.match(/(\d+)\s*[-～—－~]\s*(\d+)/);
    if (valRange) {
      const vlo = Number(valRange[1]), vhi = Number(valRange[2]);
      const scored = selectableOptionTexts
        .map((option) => {
          const ot = normalize(option);
          const rng = ot.match(/(\d+)\s*[-～—－~]\s*(\d+)/);
          if (!rng) return null;
          const olo = Number(rng[1]), ohi = Number(rng[2]);
          const overlap = Math.max(0, Math.min(vhi, ohi) - Math.max(vlo, olo));
          const containsLo = olo <= vlo && ohi >= vlo;
          return { option, olo, ohi, overlap, containsLo };
        })
        .filter(Boolean);
      if (scored.length) {
        const vmid = (vlo + vhi) / 2;
        scored.forEach((o) => { o.containsMid = o.olo <= vmid && ohi >= vmid; });
        // 优先【包含区间中点】>【包含下界】>【区间重叠最大】>【下界最接近】，使 "15000－20000" 命中 "15001～25000" 而非 "10001～15000"
        scored.sort((a, b) => (Number(b.containsMid) - Number(a.containsMid)) || (Number(b.containsLo) - Number(a.containsLo)) || (b.overlap - a.overlap) || (Math.abs(a.olo - vlo) - Math.abs(b.olo - vlo)));
        return scored[0].option;
      }
    }
    // Sunwz|2026-09-08|——END

    // Sunwz|2026-08-06|招聘来源"主动搜索/官网"等：值含"主动/官网/官方"时，回退匹配含"官网/官方"的选项（简道云渠道下拉等）
    if (/主动|官网|官方/.test(rawValue)) {
      const byKeyword = selectableOptionTexts.find((option) => normalize(option).includes(normalize("官方")) || normalize(option).includes(normalize("官网")));
      if (byKeyword) return byKeyword;
    }
    // Sunwz|2026-08-06|——END

    return "";
  }

  function formatForControl(value, type) {
    const text = String(value || "").trim();
    if (!text) return "";
    const delimitedDate = text.match(/^((?:19|20)\d{2})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    const compactDate = text.match(/^((?:19|20)\d{2})(\d{2})(\d{2})$/);
    const monthMatch = delimitedDate || compactDate || text.match(/^((?:19|20)\d{2})\D?(\d{1,2})/);
    if ((type === "month" || type === "date") && monthMatch) {
      const month = monthMatch[2].padStart(2, "0");
      if (type === "month") return `${monthMatch[1]}-${month}`;
      const day = delimitedDate?.[3] || compactDate?.[3] || "01";
      return `${monthMatch[1]}-${month}-${day.padStart(2, "0")}`;
    }
    return text;
  }

  function dispatchInput(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeValue(element, value) {
    const tag = element.tagName;
    const prototype = tag === "TEXTAREA"
      ? global.HTMLTextAreaElement?.prototype
      : global.HTMLInputElement?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    dispatchInput(element);
  }

  function optionText(element) {
    return String(element?.innerText || element?.textContent || element?.getAttribute?.("title") || "").replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function clickElement(element) {
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: global,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    };
    if (global.PointerEvent) {
      element.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
    element.dispatchEvent(new MouseEvent("mouseover", base));
    element.dispatchEvent(new MouseEvent("mousedown", base));
    element.focus?.();
    if (global.PointerEvent) {
      element.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 }));
    }
    element.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
  }

  function trustedClickPoint(element, mode = "center") {
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const x = mode === "left"
      ? rect.left + Math.min(16, Math.max(1, rect.width / 2))
      : rect.left + rect.width / 2;
    return { x, y: rect.top + rect.height / 2 };
  }

  async function trustedClickBridge(point, holdMs) {
    const doc = global.document;
    if (!doc?.documentElement?.hasAttribute?.("data-era-e2e-trusted-click")) return null;
    const id = `era-click-${Date.now()}-${bridgeClickId += 1}`;
    return new Promise((resolve) => {
      const timeout = global.setTimeout(() => {
        doc.removeEventListener("ERA_E2E_TRUSTED_CLICK_RESPONSE", onResponse);
        resolve({ ok: false, error: "e2e-click-timeout" });
      }, 3000);
      function onResponse(event) {
        if (event?.detail?.id !== id) return;
        global.clearTimeout(timeout);
        doc.removeEventListener("ERA_E2E_TRUSTED_CLICK_RESPONSE", onResponse);
        resolve(event.detail);
      }
      doc.addEventListener("ERA_E2E_TRUSTED_CLICK_RESPONSE", onResponse);
      doc.dispatchEvent(new CustomEvent("ERA_E2E_TRUSTED_CLICK", {
        detail: { id, ...point, holdMs },
      }));
    });
  }

  async function trustedClickElement(element, mode = "center", holdMs = 120) {
    if (!element) return false;
    lastTrustedClick = null;
    const point = trustedClickPoint(element, mode);
    const bridgeResponse = await trustedClickBridge(point, holdMs);
    if (bridgeResponse) {
      lastTrustedClick = bridgeResponse?.ok
        ? { ok: true, point, bridge: true }
        : { ok: false, point, bridge: true, error: bridgeResponse?.error || "e2e-click-failed" };
      if (bridgeResponse.ok) return true;
    }
    if (global.chrome?.runtime?.sendMessage) {
      try {
        const response = await new Promise((resolve) => {
          let done = false;
          const finish = (payload) => {
            if (done) return;
            done = true;
            global.clearTimeout(timeout);
            resolve(payload);
          };
          const timeout = global.setTimeout(() => finish({ ok: false, error: "trusted-click-message-timeout" }), 3000);
          const maybePromise = global.chrome.runtime.sendMessage({ type: "ERA_TRUSTED_CLICK", ...point, holdMs }, (reply) => {
            const error = global.chrome.runtime.lastError;
            finish(error ? { ok: false, error: error.message } : reply);
          });
          if (maybePromise?.then) {
            maybePromise.then(
              (reply) => finish(reply),
              (error) => finish({ ok: false, error: String(error?.message || error) }),
            );
          }
        });
        lastTrustedClick = response?.ok
          ? { ok: true, point }
          : { ok: false, point, error: response?.error || "no-response" };
        if (response?.ok) return true;
      } catch (error) {
        lastTrustedClick = { ok: false, error: String(error?.message || error || "trusted-click-exception") };
        // Fall back to synthetic events in test/sandbox environments.
      }
    } else {
      lastTrustedClick = { ok: false, error: "trusted-click-unavailable" };
    }
    clickElement(element);
    return false;
  }

  function getChoiceText(element) {
    const label = element.closest?.("label");
    if (label) return optionText(label);
    const wrapper = element.closest?.(".brick-radio-wrapper,.ant-radio-wrapper,.brick-checkbox-wrapper,.ant-checkbox-wrapper");
    return optionText(wrapper) || element.value || element.getAttribute("aria-label") || "";
  }

  async function fillRadioOrCheckbox(element, value) {
    const wanted = normalize(value);
    if (!wanted) return { ok: false, reason: "empty-value" };
    if (element.type === "checkbox") {
      const yes = /是|同意|接受|true|1|yes/.test(wanted);
      if (element.checked !== yes) clickElement(element);
      return { ok: true };
    }
    const name = element.name;
    const group = name
      ? Array.from(element.ownerDocument.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
      : Array.from(element.closest?.("div,fieldset,section")?.querySelectorAll?.('input[type="radio"]') || [element]);
    const match = group.find((radio) => {
      const text = normalize(getChoiceText(radio));
      return text === wanted || text.includes(wanted) || wanted.includes(text);
    });
    if (!match) return { ok: false, reason: "option-not-found" };
    clickElement(match);
    return { ok: true };
  }

  async function fillSelect(element, value) {
    const options = Array.from(element.options || []);
    const selected = chooseOption(value, options.map((option) => option.textContent || option.value));
    if (!selected) return { ok: false, reason: "option-not-found" };
    const option = options.find((item) => optionText(item) === selected || item.value === selected);
    if (!option) return { ok: false, reason: "option-not-found" };
    element.value = option.value;
    dispatchInput(element);
    if (!visible(element)) {
      const displayInput = Array.from(element.parentElement?.querySelectorAll?.("input:not([type='hidden'])") || [])
        .find((input) => input !== element && !input.id && !input.name && visible(input));
      if (displayInput) displayInput.value = selected;
    }
    return { ok: true, selected };
  }

  async function fillCustomRadioGroup(root, value) {
    const wanted = normalize(value);
    if (!wanted) return { ok: false, reason: "empty-value" };
    const group = root.matches?.("[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']")
      ? root
      : root.querySelector?.("[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']");
    if (!group) return { ok: false, reason: "radio-group-not-found" };
    // Sunwz|2026-08-06|只选顶层选项元素（.x-radio / [role=radio]），避免匹配到 .x-radio-group 容器或内部 .radio-text/.radio-check-icon 等子元素
    // Sunwz|2026-08-07|BOE phoenix 单选：选项类 .phoenix-radio 补充识别
    const options = Array.from(group.querySelectorAll(".x-radio,[role='radio'],.phoenix-radio,.ant-radio-wrapper,.ant-radio-button-wrapper")).filter(visible);
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-06|——END
    const match = options.find((option) => {
      const text = normalize(optionText(option));
      return text === wanted || text.includes(wanted) || wanted.includes(text);
    });
    if (!match) return { ok: false, reason: "option-not-found" };
    // Sunwz|2026-08-06|简道云等自定义单选：点击其内部 wrapper 子元素才生效（点容器本身不选中）
    // Sunwz|2026-08-07|BOE phoenix 单选：点 .phoenix-radio 本身才生效（点内部 wrapper 无效，实测）
    const clickTarget = match.classList?.contains?.("phoenix-radio") || match.matches?.(".phoenix-radio")
      ? match
      : (match.querySelector?.(".x-radio-wrapper,[class*='radio-wrapper'],.phoenix-radio__wrapper,[class*='phoenix-radio__wrapper']") || match);
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-06|——END
    clickElement(clickTarget);
    return { ok: true, selected: optionText(match) };
  }

  async function fillTextControl(element, value, record = {}) {
    const type = record.type === "date-text" ? "date" : (element.getAttribute("type") || record.type || "text");
    const formatted = formatForControl(value, type);
    if (!formatted) return { ok: false, reason: "empty-value" };
    setNativeValue(element, formatted);
    return { ok: true, value: formatted };
  }

  function fileNameFromPath(value, fallback = "resume-file") {
    const text = String(value || "").split(/[?#]/)[0].replace(/\\/g, "/");
    return text.split("/").filter(Boolean).pop() || fallback;
  }

  function mimeTypeFor(filename, blobType = "") {
    if (blobType) return blobType;
    const lower = String(filename || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (lower.endsWith(".doc")) return "application/msword";
    return "application/octet-stream";
  }

  function assetUrlFor(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^(?:https?:|data:|blob:|chrome-extension:)/i.test(text)) return text;
    const cleanPath = text.replace(/^\/+/, "");
    if (global.chrome?.runtime?.getURL) return global.chrome.runtime.getURL(cleanPath);
    return cleanPath;
  }

  async function fetchPackagedFile(value) {
    const url = assetUrlFor(value);
    if (!url || typeof global.fetch !== "function") return { file: null, reason: "file-fetch-unavailable" };
    const response = await global.fetch(url);
    if (!response?.ok) return { file: null, reason: "file-fetch-failed" };
    const blob = await response.blob();
    const filename = fileNameFromPath(value);
    const type = mimeTypeFor(filename, blob.type);
    const FileCtor = global.File || class File extends Blob {
      constructor(parts, name, options = {}) {
        super(parts, options);
        this.name = name;
        this.lastModified = options.lastModified || Date.now();
      }
    };
    return {
      file: new FileCtor([blob], filename, { type, lastModified: Date.now() }),
      reason: "",
    };
  }

  function findFileInput(root, element) {
    if (element?.tagName === "INPUT" && String(element.getAttribute?.("type") || "").toLowerCase() === "file") return element;
    return root?.querySelector?.('input[type="file"]') || null;
  }

  async function fillFileControl(record, value) {
    const root = record.root || record.element;
    const input = findFileInput(root, record.element);
    if (!input) return { ok: false, reason: "file-input-not-found" };
    if (typeof global.DataTransfer !== "function") return { ok: false, reason: "file-transfer-unavailable" };

    const { file, reason } = await fetchPackagedFile(value);
    if (!file) return { ok: false, reason };

    const transfer = new global.DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    dispatchInput(input);
    return { ok: true, filename: file.name };
  }

  // Sunwz|2026-08-06|回退选择时直接在当前打开的弹层里按文字找选项（避开 listOpenOptions 可能返回空/过期的问题）
  function findOpenOption(text) {
    const wanted = normalize(text);
    // Sunwz|2026-08-07|BOE phoenix 下拉选项类：.phoenix-selectList__listItem / .list-item-container / 地区 .area-item
    const selectors = [".x-combo-dropdown-item", "[role='option']", ".brick-select-option", ".ant-select-item-option", "[class*='option-item']", ".phoenix-selectList__listItem", ".list-item-container", ".area-item-container,[class*='area-item']"];
    // Sunwz|2026-08-07|——END
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const t = normalize(optionText(el));
        if (t === wanted || t.includes(wanted) || wanted.includes(t)) return el;
      }
    }
    return null;
  }
  // Sunwz|2026-08-06|——END

  function listOpenOptions() {
    const selectors = [
      ".brick-select-option",
      ".brick-select-dropdown [role='option']",
      ".ant-select-item-option",
      ".ant-select-dropdown [role='option']",
      // Sunwz|2026-08-15|Element Plus 下拉/级联选项补充识别（奥比中光等通用站点）
      ".el-select-dropdown__item",
      ".el-select-dropdown [role='option']",
      ".el-cascader-node",
      ".el-cascader-panel [role='option']",
      ".el-cascader-menu__item",
      // Sunwz|2026-08-15|——END
      "[role='listbox'] [role='option']",
      ".fake-options [role='option']",
      "[class*='sd-Select-common-item']",
      "[class*='sd-Menu-content-item']",
      "[class*='option-label']",
      ".x-combo-dropdown-item",
      "[class*='dropdown-item']",
      "[class*='select-option']",
      "[class*='phoenix-select'] [role='option']",
      // Sunwz|2026-08-27|奥比中光：排除 .phoenix-select__inputWrapper（每个字段自身的输入容器 li，textContent 为空），否则 41 个空选项污染列表导致 chooseOption 失效
      "[class*='phoenix-select'] li:not(.phoenix-select__inputWrapper)",
      // Sunwz|2026-08-07|BOE phoenix 下拉选项类 .phoenix-selectList__listItem 补充识别
      ".phoenix-selectList__listItem",
      "[class*='phoenix-selectList'] [role='option']",
      // Sunwz|2026-08-07|BOE 其他下拉类型：民族等 .list-item-container；籍贯/地区 .area-item-container
      ".list-item-container,.list-data-container [class*='item']",
      ".area-item-container,.area-item-name,[class*='area-item']",
      // Sunwz|2026-08-07|——END
      "[class*='dropdown'] [class*='option']",
      "[class*='dropdown'] li",
    ];
    const options = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element)) options.push(element);
      }
    }
    return Array.from(new Set(options));
  }

  function dismissOpenMenus() {
    dismissOpenMenusFor();
  }

  function keyboardEvent(type) {
    return new global.KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true, composed: true });
  }

  function dismissOpenMenusFor(element = null) {
    const doc = global.document;
    if (!doc) return;
    const targets = Array.from(new Set([element, doc.activeElement, doc.body, doc.documentElement, doc, global].filter((target) => target?.dispatchEvent)));
    for (const type of ["keydown", "keyup"]) {
      for (const target of targets) {
        target.dispatchEvent(keyboardEvent(type));
      }
    }
  }

  function mouseEvent(type, options = {}) {
    return new global.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: global,
      clientX: 1,
      clientY: 1,
      button: 0,
      buttons: type === "mouseup" || type === "click" ? 0 : 1,
      ...options,
    });
  }

  function pointerEvent(type, options = {}) {
    if (!global.PointerEvent) return null;
    return new global.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: global,
      clientX: 1,
      clientY: 1,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      ...options,
    });
  }

  function dispatchOutsideClick(target) {
    if (!target?.dispatchEvent || !global.MouseEvent) return;
    for (const event of [
      pointerEvent("pointerdown"),
      mouseEvent("mousedown"),
      pointerEvent("pointerup"),
      mouseEvent("mouseup"),
      mouseEvent("click"),
    ].filter(Boolean)) {
      target.dispatchEvent(event);
    }
  }

  function finishInteraction(element = null) {
    const doc = global.document;
    dismissOpenMenusFor(element);
    element?.blur?.();
    doc?.activeElement?.blur?.();
    const targets = Array.from(new Set([doc?.body, doc?.documentElement].filter((target) => target?.dispatchEvent)));
    for (const target of targets) dispatchOutsideClick(target);
    dismissOpenMenusFor(element);
  }

  async function settleInteraction(element = null) {
    finishInteraction(element);
    await wait(90);
    finishInteraction(element);
  }

  function customSelectTrigger(root, element) {
    const selector = [
      ".brick-select-selection",
      ".ant-select-selector",
      ".el-select",
      ".el-cascader",
      ".el-radio-group",
      ".el-checkbox-group",
      "[role='combobox']",
      ".fake-combobox",
      ".x-combo",
      ".phoenix-select",
      "[class*='combo-trigger']",
      "[class*='select-trigger']",
      "[class*='sd-Dropdown-container']",
      "[class*='sd-Select-container']",
    ].join(",");
    const found = element?.closest
      ? element.closest(selector)
      : root.matches?.(selector)
        ? root
        : root.querySelector?.(selector);
    if (!found) return null;
    // Sunwz|2026-08-06|简道云等低代码 combo：交互点在其内部 label 子元素，点击容器本身不弹下拉
    const labelChild = found.querySelector?.(".x-combo-dropdown-label,[class*='combo-label'],[class*='select-label']");
    // Sunwz|2026-08-06|——END
    return labelChild || found;
  }

  function isMokaRoot(root) {
    return !!(root?.matches?.("[class*='apply-field-']") || root?.closest?.("[class*='apply-field-']"));
  }

  function isMokaDatePicker(root) {
    // Sunwz|2026-09-08|Moka 日期控件实为 month-range-select / date_info（内含 sd-Input-input 年·月下拉），
    // 旧检测 [class*='sd-picker-input'] 在 Moka 实际不存在 → 误判非日期，落到 fillTextControl 报假 OK。
    return isMokaRoot(root) && !!root.querySelector?.("[class*='month-range-select'],[class*='date_info']");
  }

  function isMokaLocation(root) {
    return isMokaRoot(root) && !!(root.matches?.("[class*='location_info']") || root.querySelector?.("[class*='container-ukSuRKdZ3K']"));
  }

  function isMokaSelect(root) {
    return isMokaRoot(root) && !!root.querySelector?.("[class*='sd-Select-container'],[class*='sd-Dropdown-container']");
  }

  function optionClickTarget(option) {
    return option.closest?.("[class*='sd-Select-common-item'],[class*='sd-basic-year-wrapper'],[class*='sd-Tag'],button,li") || option;
  }

  function reactFiberFor(element) {
    if (!element) return null;
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    return key ? element[key] : null;
  }

  function reactOptionMatchesData(option, data) {
    const optionLabel = normalize(optionText(option));
    const candidates = [data?.name, data?.text, data?.label, data?.value, data?.code]
      .map(normalize)
      .filter(Boolean);
    if (!optionLabel || !candidates.length) return true;
    return candidates.some((candidate) => optionLabel === candidate || optionLabel.includes(candidate) || candidate.includes(optionLabel));
  }

  function findReactOptionChange(option) {
    for (let element = option; element; element = element.parentElement) {
      for (let fiber = reactFiberFor(element), depth = 0; fiber && depth < 20; fiber = fiber.return, depth += 1) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (typeof props?.onChangeCheck === "function" && props.data && reactOptionMatchesData(option, props.data)) {
          return { onChangeCheck: props.onChangeCheck, data: props.data };
        }
      }
    }
    return null;
  }

  function applyReactOptionChange(option) {
    const handler = findReactOptionChange(option);
    if (!handler) return { ok: false, reason: "react-option-handler-not-found" };
    try {
      handler.onChangeCheck(handler.data);
      return { ok: true, selected: handler.data?.name || handler.data?.text || optionText(option) };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error || "react-option-handler-failed") };
    }
  }

  async function requestMainWorldBridge() {
    if (global.document?.documentElement?.hasAttribute?.("data-era-page-react-bridge")) return true;
    if (global.chrome?.runtime?.getURL && global.document?.createElement) {
      const injected = await new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          global.clearTimeout(timeout);
          resolve(ok || global.document?.documentElement?.hasAttribute?.("data-era-page-react-bridge"));
        };
        const timeout = global.setTimeout(() => finish(false), 3000);
        try {
          const script = global.document.createElement("script");
          script.src = global.chrome.runtime.getURL("shared/page-react-bridge.js");
          script.async = false;
          script.onload = () => {
            script.remove?.();
            finish(true);
          };
          script.onerror = () => {
            script.remove?.();
            finish(false);
          };
          (global.document.head || global.document.documentElement).appendChild(script);
        } catch {
          finish(false);
        }
      });
      if (injected) return true;
    }
    if (!global.chrome?.runtime?.sendMessage) return false;
    try {
      const response = await new Promise((resolve) => {
        let done = false;
        const finish = (payload) => {
          if (done) return;
          done = true;
          global.clearTimeout(timeout);
          resolve(payload);
        };
        const timeout = global.setTimeout(() => finish({ ok: false, error: "main-world-bridge-timeout" }), 3000);
        const maybePromise = global.chrome.runtime.sendMessage({ type: "ERA_INJECT_MAIN_WORLD_BRIDGE" }, (reply) => {
          const error = global.chrome.runtime.lastError;
          finish(error ? { ok: false, error: error.message } : reply);
        });
        if (maybePromise?.then) {
          maybePromise.then(
            (reply) => finish(reply),
            (error) => finish({ ok: false, error: String(error?.message || error) }),
          );
        }
      });
      return !!response?.ok || global.document?.documentElement?.hasAttribute?.("data-era-page-react-bridge");
    } catch {
      return false;
    }
  }

  async function applyPageReactOptionChange(selectedText) {
    const text = String(selectedText || "").trim();
    if (!text) return { ok: false, reason: "page-react-empty-option" };
    if (!await requestMainWorldBridge()) return { ok: false, reason: "page-react-bridge-unavailable" };
    const id = `era-react-${Date.now()}-${bridgeClickId += 1}`;
    return new Promise((resolve) => {
      const timeout = global.setTimeout(() => {
        global.document.removeEventListener("ERA_REACT_SELECT_OPTION_RESPONSE", onResponse);
        resolve({ ok: false, reason: "page-react-bridge-timeout" });
      }, 3000);
      function onResponse(event) {
        if (event?.detail?.id !== id) return;
        global.clearTimeout(timeout);
        global.document.removeEventListener("ERA_REACT_SELECT_OPTION_RESPONSE", onResponse);
        resolve(event.detail);
      }
      global.document.addEventListener("ERA_REACT_SELECT_OPTION_RESPONSE", onResponse);
      global.document.dispatchEvent(new CustomEvent("ERA_REACT_SELECT_OPTION", {
        detail: { id, selectedText: text },
      }));
    });
  }

  function rootHasSelectedValue(root, selectedText, value) {
    const text = optionText(root);
    if (!text || /请选择|必填/.test(text)) return false;
    const normalizedText = normalize(text);
    const candidates = [selectedText, value, ...regionSegments(value)].map(normalize).filter(Boolean);
    // Sunwz|2026-08-25|综合优化：原 includes 子串匹配易假阳（如"本科"被"本科及以上"或无关文本命中）。
    // 改为精确/前缀/后缀/词边界匹配，避免"假 OK"。
    return candidates.some((candidate) =>
      normalizedText === candidate ||
      normalizedText.startsWith(candidate) ||
      normalizedText.endsWith(candidate) ||
      normalizedText.includes(" " + candidate + " ") ||
      normalizedText.includes("（" + candidate) ||
      normalizedText.includes("(" + candidate)
    );
  }

  function confirmPanelSelected(selectedText, value) {
    const panel = visibleBySelector(".right-container")[0];
    if (!panel) return false;
    const text = optionText(panel);
    if (/已选\s*0\s*\//.test(text) || /请在左侧选择内容/.test(text)) return false;
    // Sunwz|2026-08-25|综合优化：地区级联面板必须确有选中项（计数>=1）才认成功
    const countMatch = text.match(/已选\s*(\d+)\s*\//);
    if (countMatch && Number(countMatch[1]) === 0) return false;
    const normalizedText = normalize(text);
    const candidates = [selectedText, value, ...regionSegments(value)].map(normalize).filter(Boolean);
    return candidates.some((candidate) =>
      normalizedText === candidate ||
      normalizedText.startsWith(candidate) ||
      normalizedText.endsWith(candidate) ||
      normalizedText.includes(" " + candidate + " ")
    );
  }

  function findSelectConfirmButton() {
    const candidates = [
      ...visibleBySelector(".selector-footer-button .phoenix-button"),
      ...visibleBySelector(".selector-footer-button .button-container"),
      ...visibleBySelector(".selector-footer-button [class*='button']"),
    ];
    return candidates.find((button) => optionText(button) === "确定") || null;
  }

  async function confirmPhoenixPanel(root, selectedText, value) {
    const confirm = findSelectConfirmButton();
    if (!confirm) return false;
    await trustedClickElement(confirm, "center", 80);
    await wait(800);
    return rootHasSelectedValue(root, selectedText, value);
  }

  async function clickSelectOption(option, verifySelection = null, selectedText = "") {
    const target = optionClickTarget(option);
    const trusted = option.matches?.(".list-item-container,.area-item-container,[class*='area-item'],.phoenix-selectList__listItem")
      || option.closest?.(".list-data-container,.left-container,.constant-main-selector-container,[class*='phoenix-selectList']");
    let result;
    if (trusted) {
      const trustedOk = await trustedClickElement(target, "center", 160);
      await wait(900);
      result = { trusted: true, trustedOk, trustedClick: lastTrustedClick };
    } else {
      clickElement(target);
      await wait(900);
      result = { trusted: false, trustedOk: null, trustedClick: null };
    }
    // Sunwz|2026-08-25|综合优化：无论 verify 是否通过，都强制调用桥接确保 React 真正提交（解决"假 OK/UI 不刷新"）
    if (typeof verifySelection === "function") {
      const react = applyReactOptionChange(option);
      if (react.ok) await wait(550);
      result.react = react;
    }
    if (selectedText) {
      const pageReact = await applyPageReactOptionChange(selectedText);
      if (pageReact.ok) await wait(550);
      result.pageReact = pageReact;
    }
    return result;
  }

  function mokaAlreadyFilled(root, input, value) {
    const inputText = String(input?.value || "").trim();
    if (inputText) return true;
    const rootText = optionText(root);
    const wanted = String(value || "").trim();
    if (!wanted || !rootText || /暂无选项|请选择|必填项未填写/.test(rootText)) return false;
    if (normalize(rootText).includes(normalize(wanted))) return true;
    const wantedNumber = numericEquivalent(wanted);
    return wantedNumber !== null && rootText.split(/\s+/).some((part) => numericEquivalent(part) === wantedNumber);
  }

  async function fillCustomSelect(root, value, element = null, fallbackOption = "") {
    const trigger = customSelectTrigger(root, element);
    if (!trigger) return { ok: false, reason: "select-trigger-not-found" };

    const input = element?.tagName === "INPUT"
      ? element
      : trigger.querySelector?.('input[type="search"],input[role="combobox"],input:not([type="hidden"])');
    const isMoka = isMokaSelect(root);
    if (isMoka && mokaAlreadyFilled(root, input, value)) {
      finishInteraction();
      return { ok: true, selected: "already-filled" };
    }
    if (isMoka && input && String(input.value || "").trim()) {
      setNativeValue(input, "");
      await wait(120);
    }
    dismissOpenMenus();
    clickElement(trigger);
    await wait(isMoka ? 450 : 700);

    // Sunwz|2026-08-07|BOE phoenix 日期选择器被当普通下拉点开时，转交日历填充处理
    if (!isMoka && phoenixDatePickerMode()) {
      return fillPhoenixDatePicker(root, value, element);
    }
    // Sunwz|2026-08-07|——END

    // Sunwz|2026-08-06|远程搜索下拉（学校/专业等）：搜索框在打开的弹层里，触发元素内找不到，需在打开的下拉弹层中再找一次
    const popupSearchInput = Array.from(document.querySelectorAll('.content-search input,input[type="search"],input[role="combobox"],input[class*="search"],.x-combo-dropdown-wrapper input'))
      .find((el) => visible(el) && !!el.closest('.content-search,.x-combo-dropdown-wrapper,[class*="dropdown"],[class*="popup"],[class*="popper"]'));
    const searchInput = popupSearchInput || input;
    // Sunwz|2026-08-06|——END

    // Sunwz|2026-08-06|下拉选项可能异步渲染：未抓到则稍候重试至多3次
    // Sunwz|2026-08-07|BOE 可编辑 select（民族等）点击触发器偶发不弹：重试时重复点击触发器或改点其内部 input
    let options = listOpenOptions();
    for (let attempt = 0; !options.length && attempt < 4; attempt += 1) {
      await wait(500);
      const retryTarget = trigger.querySelector?.("input:not([type='hidden'])") || trigger;
      clickElement(retryTarget);
      await wait(600);
      options = listOpenOptions();
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-06|——END
    const regionPath = regionSegments(value);
    let selectedText = chooseOption(value, options.map(optionText));
    if (!selectedText && regionPath.length) {
      selectedText = chooseOption(regionPath[0], options.map(optionText));
    }
    if (!selectedText && searchInput && String(value || "").trim()) {
      // Sunwz|2026-08-07|可编辑 phoenix select（民族/籍贯等）：点击触发器不一定打开下拉，聚焦输入框输入文字唤起过滤选项更可靠
      searchInput.focus?.();
      setNativeValue(searchInput, String(value).trim());
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: String(value).trim()[0] || "Process", bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: String(value).trim()[0] || "Process", bubbles: true }));
      for (let attempt = 0; attempt < 3 && !selectedText; attempt += 1) {
        await wait(700);
        options = listOpenOptions();
        selectedText = chooseOption(value, options.map(optionText));
      }
      // Sunwz|2026-08-07|——END
    }

    if (!selectedText) {
      // Sunwz|2026-08-06|成绩排名"前40%"等百分比选项缺失时：优先回退"其他"，否则选数值最接近的前X%（并列取更优）
      if (/前\s*\d+\s*%/.test(String(value || ""))) {
        if (searchInput) { setNativeValue(searchInput, ""); }
        const wantedNum = Number(String(value).match(/\d+/)[0]);
        const fallback = options.map(optionText).find((text) => normalize(text) === normalize("其他"));
        const pickAndClick = (text) => {
          const option = findOpenOption(text);
          if (!option) return null;
          clickElement(optionClickTarget(option));
          return option;
        };
        if (fallback && pickAndClick(fallback)) {
          await wait(180);
          finishInteraction();
          return { ok: true, selected: fallback, note: "rank-fallback" };
        }
        const closest = options.map(optionText)
          .map((text) => ({ text, num: (text.match(/前\s*(\d+)\s*%/) || [])[1] ? Number(text.match(/前\s*(\d+)\s*%/)[1]) : Infinity }))
          .filter((item) => Number.isFinite(item.num))
          .sort((a, b) => Math.abs(a.num - wantedNum) - Math.abs(b.num - wantedNum) || b.num - a.num)[0];
        if (closest && pickAndClick(closest.text)) {
          await wait(180);
          finishInteraction();
          return { ok: true, selected: closest.text, note: "rank-closest" };
        }
      }
      // Sunwz|2026-08-06|成绩排名"前40%"等百分比选项缺失时：优先回退"其他"，否则选数值最接近的前X%（并列取更优）——END
      // Sunwz|2026-08-06|行业类别"计算机软件"无精确选项时，回退选择含"软件/计算机"的相关选项
      if (/计算机软件|软件/.test(String(value || ""))) {
        const related = options.map(optionText).find((text) => normalize(text).includes(normalize("软件")) || normalize(text).includes(normalize("计算机")));
        if (related) {
          const option = options.find((item) => optionText(item) === related);
          if (option) {
            clickElement(optionClickTarget(option));
            await wait(180);
            finishInteraction();
            return { ok: true, selected: related, note: "industry-fallback" };
          }
        }
      }
      // Sunwz|2026-08-06|行业类别"计算机软件"无精确选项时，回退选择含"软件/计算机"的相关选项——END
      // Sunwz|2026-08-06|奖项名称等自定义值不在预设选项时，回退选择指定的兜底选项（如"其他"）
      if (fallbackOption) {
        if (searchInput) { setNativeValue(searchInput, ""); }
        const option = findOpenOption(fallbackOption);
        if (option) {
          clickElement(optionClickTarget(option));
          await wait(180);
          finishInteraction();
          return { ok: true, selected: fallbackOption, note: "fallback-option" };
        }
      }
      // Sunwz|2026-08-06|奖项名称等自定义值不在预设选项时，回退选择指定的兜底选项（如"其他"）——END
      if (searchInput && String(value || "").trim()) {
        setNativeValue(searchInput, String(value).trim());
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        finishInteraction();
        return { ok: true, selected: String(value).trim(), note: "typed-without-option" };
      }
      finishInteraction();
      return { ok: false, reason: "option-not-found" };
    }
    const option = options.find((item) => optionText(item) === selectedText || normalize(optionText(item)).includes(normalize(selectedText)));
    if (!option) {
      finishInteraction();
      return { ok: false, reason: "option-not-found" };
    }
    // Sunwz|2026-08-09|Phoenix 常量/地区选择器需要真实鼠标事件；点选后必须看字段/右侧已选区，而不是只看选项文本
    let lastOptionClick = null;
    const verifySelectedOption = () => rootHasSelectedValue(root, selectedText, value) || confirmPanelSelected(selectedText, value);
    const clickAndVerify = async () => {
      lastOptionClick = await clickSelectOption(option, verifySelectedOption, selectedText);
      return verifySelectedOption();
    };
    const remainingRegionSegments = regionPath.filter((segment) => {
      const selected = normalize(selectedText);
      const current = normalize(segment);
      return current && selected !== current && !selected.includes(current) && !current.includes(selected);
    });
    let applied = await clickAndVerify();
    await wait(250);
    if (!applied && !remainingRegionSegments.length && !rootHasSelectedValue(root, selectedText, value)) {
      applied = await clickAndVerify();
      await wait(300);
    }
    // Sunwz|2026-08-06|——END
    // Sunwz|2026-08-09|地区级联（籍贯/生源地/户口所在地）：选完省份后继续点市、区县
    for (const segment of remainingRegionSegments) {
      const subOptions = listOpenOptions();
      const sub = subOptions.find((item) => {
        const t = optionText(item);
        return normalize(t) === normalize(segment) || normalize(t).includes(normalize(segment)) || normalize(segment).includes(normalize(t));
      });
      if (sub) {
        const verifySegment = () => rootHasSelectedValue(root, segment, value) || confirmPanelSelected(segment, value);
        lastOptionClick = await clickSelectOption(sub, verifySegment, segment);
        await wait(350);
        applied = verifySegment();
      }
    }
    // Sunwz|2026-08-09|——END
    if (findSelectConfirmButton()) {
      applied = await confirmPhoenixPanel(root, remainingRegionSegments.at(-1) || selectedText, value);
    }
    // Sunwz|2026-08-25|综合优化：桥接结果（主世界 React 真正提交）作为成功判定的权威依据之一
    const bridgeCommitted = !!(lastOptionClick?.pageReact?.ok || lastOptionClick?.react?.ok);
    if (!applied) applied = bridgeCommitted || rootHasSelectedValue(root, selectedText, value) || confirmPanelSelected(selectedText, value);
    if (!applied) {
      const trustedError = lastOptionClick?.trusted && !lastOptionClick.trustedOk
        ? (lastOptionClick.trustedClick?.error || "unknown")
        : "";
      finishInteraction();
      return {
        ok: false,
        reason: trustedError ? `trusted-click-failed:${trustedError}` : "select-not-applied",
        selected: selectedText,
        applied,
        lastOptionClick,
      };
    }
    finishInteraction();
    return { ok: applied, selected: selectedText, applied };
  }

  function visibleBySelector(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(visible);
  }

  function findVisibleText(selector, wanted, exact = true) {
    const normalizedWanted = normalize(wanted);
    return visibleBySelector(selector).find((element) => {
      const text = optionText(element);
      const normalizedText = normalize(text);
      return exact
        ? normalizedText === normalizedWanted
        : normalizedText === normalizedWanted || normalizedText.includes(normalizedWanted) || normalizedWanted.includes(normalizedText);
    });
  }

  function currentMokaYearRange() {
    const text = optionText(visibleBySelector("[class*='sd-basic-selector-year']")[0]);
    const range = text.match(/((?:19|20)\d{2})\D+((?:19|20)\d{2})/);
    if (range) return { start: Number(range[1]), end: Number(range[2]) };
    const year = text.match(/((?:19|20)\d{2})/);
    return year ? { start: Number(year[1]), end: Number(year[1]) } : null;
  }

  async function openMokaYearPanel() {
    const selector = visibleBySelector("[class*='sd-basic-selector-year']")[0];
    if (!selector) return false;
    if (/^\d{4}\s*年$/.test(optionText(selector))) {
      clickElement(selector);
      await wait(280);
    }
    return true;
  }

  async function navigateMokaYear(targetYear) {
    for (let guard = 0; guard < 8; guard += 1) {
      const yearNode = visibleBySelector("[class*='sd-basic-year-wrapper']")
        .find((element) => optionText(element) === String(targetYear) && !String(element.className || "").includes("disabled"));
      if (yearNode) return yearNode;

      const range = currentMokaYearRange();
      if (!range) return null;
      const direction = targetYear < range.start ? "left" : targetYear > range.end ? "right" : "";
      if (!direction) return null;
      const icon = visibleBySelector("[class*='sd-basic-selector-icon']")
        .find((element) => String(element.className || "").includes(direction === "left" ? "doubleLeft" : "doubleRight"));
      if (!icon) return null;
      clickElement(icon);
      await wait(280);
    }
    return null;
  }

  async function fillMokaDatePicker(root, value, element = null) {
    const parts = yearMonthParts(value);
    const targetYear = Number(parts.year);
    const monthText = mokaMonthName(value);
    if (!targetYear || !monthText) return { ok: false, reason: "invalid-date-value" };

    const input = element?.tagName === "INPUT" ? element : root.querySelector?.('input:not([type="hidden"])');
    const trigger = input?.closest?.("[class*='sd-Dropdown-container']") || input?.closest?.("label") || input;
    if (!trigger) return { ok: false, reason: "date-trigger-not-found" };
    if (mokaAlreadyFilled(root, input, value)) {
      finishInteraction();
      return { ok: true, selected: "already-filled" };
    }

    dismissOpenMenus();
    clickElement(trigger);
    await wait(320);
    if (!await openMokaYearPanel()) {
      finishInteraction();
      return { ok: false, reason: "year-panel-not-found" };
    }

    const yearNode = await navigateMokaYear(targetYear);
    if (!yearNode) {
      finishInteraction();
      return { ok: false, reason: "year-option-not-found" };
    }
    clickElement(yearNode);
    await wait(300);

    const monthNode = findVisibleText("[class*='sd-basic-year-wrapper']", monthText, true) ||
      findVisibleText("[class*='sd-basic-year-item']", monthText, true);
    if (!monthNode) {
      finishInteraction();
      return { ok: false, reason: "month-option-not-found" };
    }
    clickElement(optionClickTarget(monthNode));
    await wait(420);

    const filled = !!String(input?.value || "").trim();
    finishInteraction();
    return filled ? { ok: true, selected: `${targetYear}-${parts.month.padStart(2, "0")}` } : { ok: false, reason: "date-not-accepted" };
  }

  // Sunwz|2026-09-08|Moka 单个月份下拉（年+月）填充：给定「年」input，点击展开 → 选年 → 选月
  async function pickMokaMonth(yearInput, value) {
    const parts = yearMonthParts(value);
    const targetYear = Number(parts.year);
    const monthText = mokaMonthName(value);
    if (!targetYear || !monthText) return { ok: false, reason: "invalid-date-value" };
    if (String(yearInput?.value || "").trim()) { finishInteraction(); return { ok: true, selected: "already-filled" }; }
    const trigger = yearInput.closest?.("[class*='sd-Dropdown-container']") || yearInput.closest?.("label") || yearInput;
    if (!trigger) return { ok: false, reason: "month-trigger-not-found" };
    dismissOpenMenus();
    clickElement(trigger);
    await wait(320);
    if (!await openMokaYearPanel()) { finishInteraction(); return { ok: false, reason: "year-panel-not-found" }; }
    const yearNode = await navigateMokaYear(targetYear);
    if (!yearNode) { finishInteraction(); return { ok: false, reason: "year-option-not-found" }; }
    clickElement(yearNode);
    await wait(300);
    const monthNode = findVisibleText("[class*='sd-basic-year-wrapper']", monthText, true) ||
      findVisibleText("[class*='sd-basic-year-item']", monthText, true);
    if (!monthNode) { finishInteraction(); return { ok: false, reason: "month-option-not-found" }; }
    clickElement(optionClickTarget(monthNode));
    await wait(420);
    const filled = !!String(yearInput?.value || "").trim();
    finishInteraction();
    return filled ? { ok: true, selected: `${targetYear}-${parts.month.padStart(2, "0")}` } : { ok: false, reason: "date-not-accepted" };
  }

  // Sunwz|2026-09-08|Moka 日期区间（起止时间/就读时间）：起年·起月 + 止年·止月 + 「至今」勾选
  async function fillMokaDateRange(root, value) {
    const text = String(value || "").trim();
    // Sunwz|2026-09-08|无数据（如 profile 未配置实习/项目起止时间）直接诚实失败，不报假 OK
    if (!text) return { ok: false, reason: "no-date-data" };
    const yearInputs = Array.from(root.querySelectorAll("input[placeholder='年']"));
    const monthInputs = Array.from(root.querySelectorAll("input[placeholder='月']"));
    // 单月份选择器（毕业时间/获奖时间等，仅 年+月 两个 input）→ 复用单填逻辑
    if (yearInputs.length < 4 || monthInputs.length < 4) {
      return yearInputs[0] ? pickMokaMonth(yearInputs[0], text) : { ok: false, reason: "no-year-input" };
    }
    // 区间：DOM 顺序为 起年·起月·止年·止月
    const segs = text.split(/~|～|至|-|－/).map((s) => s.trim()).filter(Boolean);
    const startVal = segs[0] || "";
    const isUntilNow = /至今|现在|present/i.test(text);
    const endVal = isUntilNow ? (segs[1] || "").replace(/至今|现在|present/i, "").trim() : (segs[1] || "");
    const r1 = await pickMokaMonth(yearInputs[0], startVal);
    if (!r1.ok) return r1;
    if (isUntilNow || !endVal) {
      const cb = root.querySelector("input[type='checkbox']");
      if (cb && !cb.checked) { clickElement(cb); await wait(220); }
      finishInteraction();
      return { ok: true, selected: "range-until-now" };
    }
    const r2 = await pickMokaMonth(yearInputs[1], endVal);
    if (!r2.ok) return r2;
    finishInteraction();
    return { ok: true, selected: "range" };
  }

  async function fillMokaLocation(root, value, element = null) {
    const parts = mokaLocationParts(value);
    if (!parts.province) return { ok: false, reason: "invalid-location-value" };

    const input = element?.tagName === "INPUT" ? element : root.querySelector?.('input:not([type="hidden"])');
    const trigger = input?.closest?.("[class*='sd-Dropdown-container']") || input?.closest?.("label") || input;
    if (!trigger) return { ok: false, reason: "location-trigger-not-found" };
    if (mokaAlreadyFilled(root, input, value)) {
      finishInteraction();
      return { ok: true, selected: "already-filled" };
    }

    dismissOpenMenus();
    clickElement(trigger);
    await wait(450);

    const province = findVisibleText("[class*='sd-Tag-text']", parts.province, true) ||
      findVisibleText("[class*='sd-Tag-text']", parts.province, false);
    if (!province) {
      finishInteraction();
      return { ok: false, reason: "province-option-not-found" };
    }
    clickElement(optionClickTarget(province));
    await wait(520);

    let citySelected = false;
    if (parts.city) {
      const city = findVisibleText("[class*='sd-Tag-text']", parts.city, true) ||
        findVisibleText("[class*='sd-Tag-text']", parts.city.replace(/市$/, ""), false);
      if (!city) {
        finishInteraction();
        return { ok: false, reason: "city-option-not-found" };
      }
      clickElement(optionClickTarget(city));
      citySelected = true;
      await wait(520);
    }

    const confirm = findVisibleText("button,div,span", "确认", true);
    if (confirm) {
      clickElement(confirm);
      await wait(250);
    }

    const accepted = !!String(input?.value || "").trim() || normalize(optionText(root)).includes(normalize(parts.province));
    finishInteraction();
    return accepted ? { ok: true, selected: citySelected ? `${parts.province}/${parts.city}` : parts.province } : { ok: false, reason: "location-not-accepted" };
  }

  // Sunwz|2026-08-15|秋招通通用站点日期填充（奥比中光等 YYYY-MM 日期选择器等，非 phoenix/moka/feishu）
  // 策略：点击输入框 → 若弹出日历层则选日期 → 否则直接设 value 并派发 input 事件
  // 兼容格式：YYYY-MM / YYYY-MM-DD / YYYY年MM月
  function normalizeDateValue(value) {
    const text = String(value || "").trim();
    // YYYY年MM月
    let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (m) return { year: m[1], month: m[2].padStart(2, "0"), day: "", ym: `${m[1]}-${m[2].padStart(2, "0")}` };
    // YYYY-MM-DD
    m = text.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) return { year: m[1], month: m[2].padStart(2, "0"), day: m[3].padStart(2, "0"), ym: `${m[1]}-${m[2].padStart(2, "0")}` };
    // YYYY-MM
    m = text.match(/(\d{4})[-/年.](\d{1,2})/);
    if (m) return { year: m[1], month: m[2].padStart(2, "0"), day: "", ym: `${m[1]}-${m[2].padStart(2, "0")}` };
    return null;
  }
  async function fillDate(root, value, element, record = {}) {
    const input = element?.tagName === "INPUT" ? element : (root.querySelector?.("input:not([type='hidden'])") || element);
    const date = normalizeDateValue(value);
    if (!date) {
      // 无法解析：仍尝试直接设值
      if (input) { setNativeValue(input, String(value || "")); dispatchInput(input); }
      return { ok: false, reason: "date-unparseable" };
    }
    dismissOpenMenus();
    // 1) 点击输入框触发日历弹出
    if (input) { clickElement(input); input.focus?.(); await wait(400); }
    else if (root) { clickElement(root); await wait(400); }
    // Sunwz|2026-08-27|奥比中光 Phoenix 日期控件兜底：点开日历后若已识别为 Phoenix 日历
    // （如 .phoenix-calendar-month-calendar），直接转交 fillPhoenixDatePicker 真正选年/选月/选日，
    // 避免继续走下面 step3 的 setNativeValue 假 OK（React 控件未更新、UI 不刷新）。
    // Element/Ant 等日历未被 phoenixDatePickerMode 识别（返回 ""），仍走下方原逻辑，不受影响。
    if (phoenixDatePickerMode()) {
      return fillPhoenixDatePicker(root, value, element);
    }
    // 2) 检测是否弹出日历层（Element Plus / Ant Design 等）
    const calendar = Array.from(document.querySelectorAll(".el-picker-panel,.el-date-picker,.ant-picker-panel,.ant-calendar,.el-date-table,.ant-calendar-date-panel"))
      .find((el) => visible(el));
    if (calendar) {
      // Sunwz|2026-09-08|年份必须【精确匹配】实际年份格（排除表头 label），杜绝邻年/表头误点导致差一年
      const pickExact = async (sel, want) => {
        const cell = Array.from(calendar.querySelectorAll(sel))
          .find((el) => { const t = normalize(optionText(el)); return t === want || t === `${want}年` || t === `${want}月` || t === `${want}日`; });
        if (cell) { clickElement(cell); await wait(220); return true; }
        return false;
      };
      // 选年：先点表头年份 label 切到年视图，再精确点年份格（已在年视图则点了也无副作用）
      const yearLabel = Array.from(calendar.querySelectorAll(".el-date-picker__header-label,.ant-calendar-header [title]"))
        .find((el) => normalize(optionText(el)).includes(date.year));
      if (yearLabel) { clickElement(yearLabel); await wait(200); }
      let yearOk = await pickExact(".el-year-table td,.ant-calendar-year-panel-year", date.year);
      if (!yearOk && yearLabel) { clickElement(yearLabel); await wait(200); yearOk = await pickExact(".el-year-table td,.ant-calendar-year-panel-year", date.year); }
      if (yearOk) {
        // 选月（仅实际月份格，不再误匹配日格）
        const monthOk = await pickExact(".el-month-table td,.ant-calendar-month-panel-month", `${date.month}月`)
          || await pickExact(".el-month-table td,.ant-calendar-month-panel-month", String(Number(date.month)));
        // 选日（日选模式按需）
        if (date.day && monthOk) {
          await pickExact(".el-date-table td,.ant-calendar-date,.el-date-picker__cell", String(Number(date.day)))
            || await pickExact(".el-date-table td,.ant-calendar-date,.el-date-picker__cell", date.day.padStart(2, "0"));
        }
      }
      // 确认按钮（Element Plus 需点确定）
      const okBtn = Array.from(calendar.querySelectorAll("button,.el-button"))
        .find((b) => /确定|确认|OK/i.test(b.innerText || b.textContent || ""));
      if (okBtn) { clickElement(okBtn); await wait(200); }
      // Sunwz|2026-09-08|回填校验：显示值必须含目标年月；年份不符一律判失败，绝不假成功填成邻年
      const applied = input && String(input.value).includes(date.ym);
      finishInteraction();
      return { ok: Boolean(applied), selected: date.ym, applied: Boolean(applied) };
    }
    // 3) 未弹日历：直接设 value 并派发 input 事件（YYYY-MM 控件）
    const finalValue = record?.type === "date" && date.day ? `${date.ym}-${date.day}` : date.ym;
    if (input) {
      setNativeValue(input, finalValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(150);
    }
    const applied = input && String(input.value).includes(date.ym);
    finishInteraction();
    return { ok: Boolean(applied), selected: finalValue, applied: Boolean(applied) };
  }
  // Sunwz|2026-08-15|——END

  // Sunwz|2026-08-15|秋招通通用站点级联下拉填充（奥比中光籍贯/现居地 el-cascader 等）
  // 分步填：选省 → 触发 onChange → 等市列表加载 → 选市 → 等区列表加载 → 选区
  function splitRegion(value) {
    const text = String(value || "").trim();
    // 常见分隔：/ 、 空格 省/市/区后缀
    const parts = text.split(/[/、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) return { province: parts[0], city: parts[1], district: parts[2] };
    if (parts.length === 2) return { province: parts[0], city: parts[1], district: "" };
    // 兜底：按省/市/区关键字切
    const m = text.match(/(.+?(?:省|市|自治区|特别行政区))(.+?(?:市|区|县|盟|州))(.+?(?:区|县|市|旗))?/);
    if (m) return { province: m[1], city: m[2], district: m[3] || "" };
    return { province: text, city: "", district: "" };
  }
  async function fillCascader(root, value, element) {
    const trigger = root.querySelector?.(".el-cascader,.el-cascader__label,[class*='cascader']") || root;
    clickElement(trigger);
    await wait(500);
    const region = splitRegion(value);
    const cascadePanel = ".el-cascader-panel,.el-cascader-menus,[class*='cascader-panel']";
    let panel = Array.from(document.querySelectorAll(cascadePanel)).find(visible);
    if (!panel) { finishInteraction(); return { ok: false, reason: "cascader-panel-not-found" }; }
    // 第一级：省
    const pickLevel = async (levelIndex, want) => {
      const menus = Array.from(panel.querySelectorAll(".el-cascader-menu,.el-cascader-panel .el-scrollbar,[role='menu']"));
      const menu = menus[levelIndex] || panel;
      const nodes = Array.from(menu.querySelectorAll(".el-cascader-node,[role='option'],li")).filter(visible);
      const node = nodes.find((n) => {
        const t = normalize(optionText(n));
        return t === normalize(want) || t.includes(normalize(want)) || normalize(want).includes(t);
      });
      if (!node) return false;
      clickElement(node);
      await wait(450); // 等待下一级异步加载
      panel = Array.from(document.querySelectorAll(cascadePanel)).find(visible) || panel;
      return true;
    };
    let ok = true;
    if (region.province) ok = (await pickLevel(0, region.province)) && ok;
    if (region.city) ok = (await pickLevel(1, region.city)) && ok;
    if (region.district) ok = (await pickLevel(2, region.district)) && ok;
    finishInteraction();
    return { ok, selected: `${region.province}/${region.city}/${region.district}`.replace(/\/+/g, "/") };
  }
  // Sunwz|2026-08-15|——END

  // Sunwz|2026-08-07|BOE phoenix 日期选择器支持：月选（开始/结束/获奖/发布时间）与日选（出生日期）两种模式
  function phoenixDatePickerMode() {
    if (visibleBySelector(".phoenix-calendar-month-calendar,.phoenix-calendar-month-panel").length) return "month";
    if (visibleBySelector(".phoenix-calendar-date-panel,.phoenix-calendar-panel").length) return "day";
    return "";
  }

  async function readPhoenixYear() {
    const txt = optionText(visibleBySelector(".phoenix-calendar-year-select,[class*='year-select']")[0] || null);
    return Number(String(txt || "").match(/((?:19|20)\d{2})/)?.[1] || "0");
  }

  // Sunwz|2026-08-24|强制关闭任何已打开的 phoenix 日历弹层，避免上一次填充残留的日历
  // 干扰下一次 fillPhoenixDatePicker 的状态读取（奥比中光日历不随外部点击自动收起）。
  async function forceClosePhoenixCalendar() {
    let tries = 0;
    while (visibleBySelector(".phoenix-calendar-month-calendar,.phoenix-calendar-panel,.phoenix-calendar-date-panel,.phoenix-calendar-month-panel").length > 0 && tries < 5) {
      dismissOpenMenus();
      await wait(150);
      // 真实 mousedown 到页面左上角空白，触发组件外部点击收起
      try {
        const doc = global.document;
        const target = doc.documentElement;
        if (target?.dispatchEvent) {
          for (const ev of [pointerEvent("pointerdown"), mouseEvent("mousedown"), pointerEvent("pointerup"), mouseEvent("mouseup"), mouseEvent("click")].filter(Boolean)) {
            target.dispatchEvent(ev);
          }
        }
      } catch (e) { /* ignore */ }
      await wait(200);
      tries += 1;
    }
    return visibleBySelector(".phoenix-calendar-month-calendar,.phoenix-calendar-panel,.phoenix-calendar-date-panel,.phoenix-calendar-month-panel").length === 0;
  }

  async function pickPhoenixYear(targetYear) {
    const mode = phoenixDatePickerMode();
    // Sunwz|2026-08-24|奥比中光等：年份面板选中年后不会自动翻回月份视图（年面板常驻），
    // 故优先用「上一页/下一页年份按钮」逐步步进到目标年，月面板全程保持可见，更稳。
    let curYear = await readPhoenixYear();
    if (curYear) {
      if (curYear === targetYear) return true;
      const step = targetYear > curYear ? 1 : -1;
      const btnSel = step > 0 ? ".phoenix-calendar-next-year-btn" : ".phoenix-calendar-prev-year-btn";
      let guard = 0;
      while (curYear !== targetYear && guard < 40) {
        const btn = visibleBySelector(btnSel)[0];
        if (!btn) break;
        clickElement(btn);
        await wait(350);
        const now = await readPhoenixYear();
        // 步进式年份按钮以「年」为最小单位，now 必然向前推进；若某次点击无进展（停住）则退出避免死循环
        if (!now || now === curYear) {
          if (now === targetYear) { curYear = now; break; }
          // 卡住：尝试一次再判定
          guard += 1;
          if (guard >= 40) break;
          continue;
        }
        curYear = now;
        if (curYear === targetYear) break;
        guard += 1;
      }
      // 步进结束后若月面板仍可见即可直接选月；否则回退到原有年面板点选法
      if (curYear === targetYear && visibleBySelector(".phoenix-calendar-month-panel-cell").length > 0) return true;
    }
    // Sunwz|2026-08-07|回退：BOE 原有年面板点选法
    const yearTrigger = visibleBySelector(".phoenix-calendar-month-panel-year-select-content,[class*='year-select']")[0]
      || (mode === "month" ? visibleBySelector(".phoenix-calendar-month-panel-year-select-content")[0] : visibleBySelector(".phoenix-calendar-year-select")[0]);
    if (!yearTrigger) return false;
    clickElement(yearTrigger);
    await wait(500);
    let cell = findVisibleText(".phoenix-calendar-year-panel-cell", String(targetYear), true);
    let guard = 0;
    while (!cell && guard < 12) {
      const decadeEl = visibleBySelector(".phoenix-calendar-year-panel-decade-select-content")[0];
      const decade = (optionText(decadeEl) || "").match(/((?:19|20)\d{2})\s*-\s*((?:19|20)\d{2})/);
      if (!decade) break;
      const start = Number(decade[1]);
      const end = Number(decade[2]);
      const btn = targetYear < start
        ? visibleBySelector(".phoenix-calendar-year-panel-prev-decade-btn")[0]
        : targetYear > end
          ? visibleBySelector(".phoenix-calendar-year-panel-next-decade-btn")[0]
          : null;
      if (!btn) break;
      clickElement(btn);
      await wait(450);
      cell = findVisibleText(".phoenix-calendar-year-panel-cell", String(targetYear), true);
      guard += 1;
    }
    if (!cell) return false;
    clickElement(cell);
    await wait(450);
    return true;
  }

  // Sunwz|2026-08-24|带整体超时保护的 phoenix 日期填充，避免 processMappings 主循环被单个日历交互拖死
  async function fillPhoenixDatePickerWithTimeout(root, value, element) {
    const hardTimeoutMs = 15000;
    let done = false;
    let result = { ok: false, reason: "date-timeout" };
    const worker = (async () => {
      result = await fillPhoenixDatePicker(root, value, element);
      done = true;
    })();
    const start = Date.now();
    while (!done && Date.now() - start < hardTimeoutMs) {
      await wait(200);
    }
    if (!done) {
      // 超时兜底：强行收起残留日历，避免影响后续记录
      await forceClosePhoenixCalendar();
      finishInteraction();
      try { await worker; } catch (e) { /* ignore */ }
      return { ok: false, reason: "date-timeout" };
    }
    return result;
  }

  // Sunwz|2026-08-27|结束时间/毕业时间：找同段内的"至今" phoenix-checkbox（可能是祖先也可能是兄弟），
  // 若已勾选则取消。注意奥比中光点隐藏 input 不会触发 React 受控更新，必须点可见的 .phoenix-checkbox 本体，
  // 并校验 input.checked 确已变 false；勾选至今时表单会禁用结束日期，故必须先在填真实日期前取消。
  async function uncheckUntilNow(root) {
    // Sunwz|2026-08-27|奥比中光："至今"复选框与结束/毕业时间字段【不在同一 DOM 子树】（它是整个分段的兄弟节点，
    // 既不是日期框的祖先后代也不是直接兄弟），沿祖先链 querySelectorAll 永远找不到。而本表单上所有"至今"复选框
    // 都只对应实习/项目/教育的结束或毕业时间——正是用户要求"绝不勾选"的字段。故直接全文档取消所有"至今"勾选。
    const cbs = document.querySelectorAll?.(".phoenix-checkbox") || [];
    const candidates = Array.from(cbs).filter((cb) => /至今/.test(cb.textContent || ""));
    for (const cb of candidates) {
      const input = cb.querySelector("input[type=checkbox]") || cb.querySelector(".phoenix-checkbox__input");
      if (!input || !input.checked) continue;
      // Sunwz|2026-08-27|直接点真实 <input>：原生 click 能可靠触发 React 受控 checkbox 的 onChange（实测 div.click 只会视觉错位、state 不变）。
      try { input.click(); } catch (e) {}
      await wait(150);
      if (input.checked) {
        try {
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked");
          if (proto && proto.set) proto.set.call(input, false);
          input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) {}
        await wait(150);
      }
    }
  }

  // Sunwz|2026-08-27|按 label + repeatIndex 从【实时文档】重新定位日期控件。
  // 取消"至今"会触发 React 重渲染，扫描期捕获的 record.element/root 可能已被卸载，
  // 必须改从 live DOM 按标签+段序重定位，否则会在旧节点上"假 OK"或读回空值。
  // Sunwz|2026-08-27|同 findLiveDateControl：向上找本段锚字段（单位名称/项目名称/学校名称）的已填值，
  // 各分段唯一且稳定，比模块标题可靠（奥比中光低代码表单常无规范模块标题）。
  function anchorValueOf(el) {
    let node = el;
    for (let d = 0; d < 6 && node; d += 1) {
      const fields = node.querySelectorAll ? node.querySelectorAll(".form-item") : [];
      for (const f of fields) {
        const fl = f.querySelector && f.querySelector("label") ? f.querySelector("label").textContent : "";
        if (/单位名称|项目名称|学校名称|公司名称|公司/.test(fl || "")) {
          const inp = f.querySelector("input,textarea,.phoenix-select,[class*=phoenix-select],select");
          const v = inp ? (inp.value || inp.textContent || "").trim() : "";
          if (v && !/请选择/.test(v)) return v;
        }
      }
      node = node.parentElement;
    }
    return "";
  }

  function findLiveDateControl(record) {
    const label = String(record.label || "").trim();
    if (!label) return null;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped);
    const items = Array.from(document.querySelectorAll(".form-item"));
    const candidates = items.filter((it) => {
      const l = it.querySelector && it.querySelector("label") ? it.querySelector("label").textContent : "";
      return re.test(String(l || "").trim());
    });
    if (!candidates.length) return null;
    // Sunwz|2026-08-27|按锚值（单位名称/项目名称/学校名称的实时已填值）分组：各分段唯一，能精确区分
    // 实习/项目/教育；再按段内 repeatIndex 取控件。无锚则退化为全局 repeatIndex。
    const anchor = record.segAnchor || "";
    if (anchor) {
      const inSeg = candidates.filter((it) => anchorValueOf(it) === anchor);
      if (inSeg.length) {
        const idx = record.repeatIndex || 0;
        return inSeg[idx] || inSeg[inSeg.length - 1] || null;
      }
    }
    const idx = record.repeatIndex || 0;
    return candidates[idx] || null;
  }

  async function fillPhoenixDatePicker(root, value, element = null) {
    // Sunwz|2026-08-27|phoenix 月历"假 OK"重试：最多 5 次，任一次真正提交即返回成功
    let last = { ok: false, reason: "date-retry-init" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await fillPhoenixDatePickerOnce(root, value, element);
      if (last && last.ok) return last;
      await wait(350);
    }
    return last;
  }

  // Sunwz|2026-08-27|奥比中光日期稳健填充：每段开始/结束时间并存，填其一会触发 React 重渲染替换同段兄弟日期节点，
  // 导致后续填充命中游离(detached)节点而"假 OK"/落空。故每次尝试都从 live DOM 重新定位控件；对结束/毕业时间
  // 幂等取消"至今"（已取消则 input.checked=false 直接跳过、不触重渲染）。最多 4 次，任一次真正提交即返回成功。
  async function fillDateRobust(record, value) {
    const label = String(record.label || "");
    const isEnd = /结束时间|毕业时间/.test(label);
    let last = { ok: false, reason: "date-robust-init" };
    for (let t = 0; t < 4; t += 1) {
      if (isEnd) {
        try { await uncheckUntilNow(record.root || record.element); } catch (e) {}
        await wait(350);
      }
      const live = findLiveDateControl(record) || record.root || record.element;
      if (!live) { await wait(400); continue; }
      const liveTrigger = live.querySelector(".phoenix-select,[class*=phoenix-select]") || live;
      last = await fillPhoenixDatePickerWithTimeout(live, value, liveTrigger);
      if (last && last.ok) return last;
      await wait(500);
    }
    return last;
  }

  async function fillPhoenixDatePickerOnce(root, value, element = null) {
    const parsed = String(value || "").match(/((?:19|20)\d{2})\D?(\d{1,2})(?:\D?(\d{1,2}))?/);
    if (!parsed) return { ok: false, reason: "invalid-date-value" };
    const year = Number(parsed[1]);
    const month = Number(parsed[2]);
    const day = parsed[3] ? Number(parsed[3]) : 0;

    // 先强制收起上一次残留的日历弹层，保证本次从干净状态开始（奥比中光日历不随外部点击自动收起）
    await forceClosePhoenixCalendar();

    // 已填同值则跳过（避免重复交互）
    const rootText = optionText(root);
    if (!/请选择/.test(rootText) && rootText.includes(String(year)) && rootText.includes(String(month))) {
      finishInteraction();
      return { ok: true, selected: "already-filled" };
    }

    const trigger = element?.closest?.(".phoenix-select,[class*='phoenix-select'],[class*='date-picker']")
      || element
      || root.querySelector(".phoenix-select,[class*='phoenix-select'],[class*='date-picker']");
    if (!trigger) return { ok: false, reason: "date-trigger-not-found" };
    dismissOpenMenus();
    await trustedClickElement(trigger, "center", 120);
    await wait(650);

    const mode = phoenixDatePickerMode();
    if (!mode) {
      try {
        const tr = trigger;
        const ir = tr && tr.querySelector ? tr.querySelector("input,textarea") : null;
        const r = tr && tr.getBoundingClientRect ? tr.getBoundingClientRect() : null;
        console.log("[era-cal-debug] not-open cls=" + (tr && tr.className) + " tag=" + (tr && tr.tagName) + " disabled=" + (ir ? ir.disabled : (tr && tr.disabled)) + " rect=" + JSON.stringify(r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null) + " parentCls=" + (tr && tr.parentElement ? tr.parentElement.className : ""));
      } catch (e) {}
      finishInteraction();
      return { ok: false, reason: "calendar-not-open" };
    }

    if (!await pickPhoenixYear(year)) {
      finishInteraction();
      return { ok: false, reason: "year-option-not-found" };
    }

    let monthCell = null;
    if (mode === "month") {
      monthCell = findVisibleText(".phoenix-calendar-month-panel-cell", `${month}月`, true)
        || findVisibleText(".phoenix-calendar-month-panel-cell", `${month}月`, false);
    } else {
      const monthSel = visibleBySelector(".phoenix-calendar-month-select")[0];
      if (monthSel) clickElement(monthSel);
      await wait(450);
      monthCell = findVisibleText(".phoenix-calendar-month-panel-cell", `${month}月`, true)
        || findVisibleText(".phoenix-calendar-month-panel-cell", `${month}月`, false);
    }
    if (!monthCell) {
      finishInteraction();
      return { ok: false, reason: "month-option-not-found" };
    }
    clickElement(monthCell);
    await wait(450);

    // Sunwz|2026-08-07|日选模式（出生日期/获奖时间）：选完月后必须再点一个日才提交；值只有年月时默认取 1 日
    if (mode === "day") {
      const targetDay = day || 1;
      const dayCell = Array.from(document.querySelectorAll(".phoenix-calendar-cell"))
        .filter(visible)
        .find((el) => {
          const cls = String(el.className || "");
          if (/last-month-cell|next-month-btn-day/.test(cls)) return false;
          const t = optionText(el);
          return t === String(targetDay) || t === String(targetDay).padStart(2, "0");
        });
      if (!dayCell) {
        finishInteraction();
        return { ok: false, reason: "day-option-not-found" };
      }
      clickElement(dayCell);
      await wait(450);
    }
    // Sunwz|2026-08-07|——END

    const wanted = day ? `${year}-${month}-${day}` : `${year}-${month}`;
    // Sunwz|2026-08-27|读【实时】trigger 文本做回填校验：日历交互可能让 root 已卸载，optionText(root) 会读到旧节点
    // 文本而"假 OK"（把错误年份当成成功）。改为从 root 内重新定位实时 trigger；并同时校验年与月，杜绝错年/错月填入。
    const liveTrigger = root.querySelector(".phoenix-select,[class*=phoenix-select]") || root;
    const displayText = optionText(liveTrigger);
    const accepted = !/请选择/.test(displayText)
      && displayText.includes(String(year))
      && displayText.includes(String(month).padStart(2, "0"));
    finishInteraction();
    return accepted ? { ok: true, selected: wanted } : { ok: false, reason: "date-not-accepted" };
  }
  // Sunwz|2026-08-07|——END

  async function fillRecordInner(record, value) {
    const element = record.element || record.root;
    if (!element) return { ok: false, reason: "element-not-found" };
    const root = record.root || element;
    const tag = element.tagName;
    const type = (element.getAttribute?.("type") || record.type || tag || "").toLowerCase();

    // Sunwz|2026-08-06|低代码平台自定义单选组（简道云 x-radio-group 等）：按选项文字点击
    // Sunwz|2026-08-27|奥比中光：record.element 可能是 radio-group 内部子节点，故同时向上找祖先 radio-group
    const radioGroupSel = "[class*='radio-group'],[class*='radiogroup'],[role='radiogroup']";
    const radioGroupRoot = root.matches?.(radioGroupSel) ? root
      : (root.querySelector?.(radioGroupSel) || element?.closest?.(radioGroupSel) || null);
    if (radioGroupRoot) {
      return fillCustomRadioGroup(radioGroupRoot, value);
    }
    // Sunwz|2026-08-27|——END
    // Sunwz|2026-08-06|——END
    // Sunwz|2026-08-07|BOE/奥比中光 phoenix 日期选择器（开始/结束/获奖/发布时间、出生日期）
    // Sunwz|2026-08-24|奥比中光：日期控件是 .phoenix-select + 内含 .phoenix-unmodeled-layer（date-time 图标），
    // 展开后才出现 .phoenix-calendar-month-calendar；故对 month/date 类型且控件为 phoenix 日期选择器时直接路由。
    function isPhoenixDateControl(r) {
      const sel = r.querySelector?.(".phoenix-select,[class*='phoenix-select']")
        || (r.matches?.(".phoenix-select,[class*='phoenix-select']") ? r : null);
      if (!sel) return false;
      // Sunwz|2026-08-24|奥比中光：date-time 图标（id 含 date_time_picker）在未交互时未必已挂载，
      // 但凡是「month/date 类型 + 内含 .phoenix-select」的字段，必为 phoenix 日期选择器（普通下拉不会有 date/month 类型），
      // 故以类型+phoenix-select 为准，避免漏判导致走错 fillDate 分支（返回 ok 却未真正填充）。
      return true;
    }
    // Sunwz|2026-08-24|日期类 phoenix 选择器：无论 type 是 month/date 还是被误标为 select，
    // 只要标签含「时间/日期」且控件内含 .phoenix-select，就走 phoenix 日期填充（普通下拉不会有日期标签）。
    if (isPhoenixDateControl(root) && /时间|日期/.test(record.label || "")) {
      // Sunwz|2026-08-27|结束/毕业时间：先取消"至今"勾选再填真实日期（全文档取消，幂等）。
      // 必须在【本条结束时间填写前】取消：本表单"至今"是 React 受控组件，其它字段填写会触发重渲染把
      // "至今"复位成勾选并禁用结束日期；只有紧邻填写前取消、且随后无其它字段再触发重渲染，才能保持未勾。
      // 取消会触发 React 重渲染替换日期节点，故随后用 findLiveDateControl 从 live DOM 重定位。
      if (/结束时间|毕业时间/.test(record.label || "")) {
        /* Sunwz|2026-08-27|uncheck 改到 fillDateRobust 内按次幂等处理，避免此处重渲染冲掉同段兄弟日期 */
        await wait(400);
      }
      return await fillDateRobust(record, value);
    }
    if (record.type === "date" && phoenixDatePickerMode()) return fillPhoenixDatePicker(root, value, element);
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-08|飞书 ud select 搜索下拉
    if (record.type === "feishu-select") return feishuFillSelect(element, value);
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-08-08|飞书 ud__picker 日期选择器（获奖时间）
    if (record.type === "feishu-date") return feishuFillDatePicker(element, value);
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-08-15|秋招通通用站点日期填充（奥比中光 YYYY-MM 日期选择器等非 phoenix/moka/feishu）
    if ((record.type === "month" || record.type === "date") && !isMokaDatePicker(root) && !phoenixDatePickerMode()) {
      return fillDate(root, value, element, record);
    }
    // Sunwz|2026-08-15|——END
    if (tag === "SELECT") return fillSelect(element, value);
    if (type === "radio" || type === "checkbox") return fillRadioOrCheckbox(element, value);
    if (type === "file") return fillFileControl(record, value);
    if (isMokaDatePicker(root)) {
      // Sunwz|2026-09-08|区间（起止时间/就读时间 含 4 个 年·月 input）走 fillMokaDateRange，单月份走 fillMokaDatePicker
      const mokaYearCount = root.querySelectorAll("input[placeholder='年']").length;
      return mokaYearCount >= 4 ? fillMokaDateRange(root, value) : fillMokaDatePicker(root, value, element);
    }
    if (isMokaLocation(root)) return fillMokaLocation(root, value, element);
    if (isMokaSelect(root)) return fillCustomSelect(root, value, element);
    // Sunwz|2026-09-08|自由文本输入框（element 本身就是真实 INPUT/TEXTAREA 的情况）：直接写文本值。
    // 注意：北森/Beisen 用 .phoenix-select 装饰的字段绝大多数是【下拉/级联选择器】（内含 .phoenix-select__input 仅作显示/搜索框），
    // 不应在此直接写文本——必须交给下方 fillCustomSelect 打开下拉并点选项。仅 element 本身为真实输入且无 combobox 角色时才直写。
    if ((tag === "INPUT" || tag === "TEXTAREA") && element.getAttribute?.("role") !== "combobox" && (element.getAttribute?.("type") || "text").toLowerCase() !== "search") {
      return fillTextControl(element, value, record);
    }
    const customSelect = ".brick-select,.ant-select,.el-select,.el-cascader,.el-radio-group,.el-checkbox-group,.fake-combobox,.x-combo,.phoenix-select,[class*='combo-trigger'],[class*='select-trigger'],[role='combobox']";
    if (root.querySelector?.(customSelect) || root.matches?.(customSelect)) {
      // Sunwz|2026-08-15|级联下拉（el-cascader）：地理字段走 fillCascader 分步选省/市/区
      if (root.matches?.(".el-cascader") || root.querySelector?.(".el-cascader")) {
        return fillCascader(root, value, element);
      }
      // Sunwz|2026-08-15|——END
      return fillCustomSelect(root, value, element, record.fallbackOption || "");
    }
    if (element.isContentEditable) {
      element.textContent = String(value || "");
      dispatchInput(element);
      return { ok: true };
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return fillTextControl(element, value, record);
    return { ok: false, reason: "unsupported-control" };
  }

  async function fillRecord(record, value, gentle = false) {
    const element = record.element || record.root;
    try {
      return await fillRecordInner(record, value);
    } finally {
      // Sunwz|2026-08-06|datetime 月份控件与温柔模式：外部点击可能触发表单重渲染清空已填值，只 blur 不派发外部点击
      if (gentle || record.type === "month") {
        dismissOpenMenus();
        element?.blur?.();
        global.document?.activeElement?.blur?.();
      } else {
        await settleInteraction(element);
      }
      // Sunwz|2026-08-06|——END
    }
  }

  const api = {
    chooseOption,
    clickElement,
    finishInteraction,
    formatForControl,
    mokaLocationParts,
    mokaMonthName,
    setNativeValue,
    fillRecord,
    fillCustomSelect,
    fillCustomRadioGroup,
    fillFileControl,
    fillTextControl,
    // Sunwz|2026-08-07|BOE phoenix 日期选择器
    fillPhoenixDatePicker,
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-27|奥比中光：全局取消"至今"复选框（与结束/毕业时间字段不同 DOM 子树）
    uncheckUntilNow,
    // Sunwz|2026-08-27|按段(锚值)从实时 DOM 重定位日期控件，供 content.js 的 settle 兜底重填使用
    findLiveDateControl,
    // Sunwz|2028-08-27|——END
    // Sunwz|2026-08-08|飞书 ud select 填充
    feishuFillSelect,
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-08-08|飞书 ud__picker 日期选择器填充
    feishuFillDatePicker,
    // Sunwz|2026-08-08|——END
    // Sunwz|2026-09-08|Moka 日期区间（起止时间/就读时间）填充
    fillMokaDateRange,
    // Sunwz|2026-09-08|——END
  };

  function feishuSelectTrigger(el) {
    return el?.closest?.(".ud__select__selector,.ud__select,[role='combobox'],.atsx-select,.atsx-select-selection,[class*='select__']") || el;
  }

  function feishuSelectSearchInput(el) {
    const trigger = feishuSelectTrigger(el);
    if (el?.tagName === "INPUT") return el;
    return trigger?.querySelector?.("input") || null;
  }

  function feishuSelectAliases(value) {
    const rawValue = String(value || "").trim();
    const aliases = [rawValue];
    if (/博士/.test(rawValue)) aliases.push("博士");
    if (/硕士|研究生/.test(rawValue)) aliases.push("硕士");
    if (/本科|学士/.test(rawValue)) aliases.push("本科");
    if (/大专|专科/.test(rawValue)) aliases.push("大专");
    if (/高中/.test(rawValue)) aliases.push("高中");
    if (/英语|英文/.test(rawValue)) aliases.push("英语");
    if (/熟练/.test(rawValue)) aliases.push("日常会话");
    return Array.from(new Set(aliases.filter(Boolean)));
  }

  function feishuVisibleSelectOptions() {
    const selectors = [
      ".ud__select__list__item",
      "[role='option']",
      "[class*='select'] [class*='option']",
      "[class*='dropdown'] [class*='option']",
      "[class*='option']",
    ];
    const options = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const option = node.closest?.(".ud__select__list__item,[role='option']") || node;
        if (!visible(option)) continue;
        const text = optionText(option);
        if (!text || text.length > 80 || seen.has(option)) continue;
        seen.add(option);
        options.push(option);
      }
    }
    return options;
  }

  function findFeishuSelectOption(value, options = feishuVisibleSelectOptions()) {
    const optionTexts = options.map(optionText);
    for (const alias of feishuSelectAliases(value)) {
      const selectedText = chooseOption(alias, optionTexts) || alias;
      const wanted = normalize(selectedText);
      const exact = options.find((option) => normalize(optionText(option)) === wanted);
      if (exact) return { option: exact, selectedText: optionText(exact) };
      const fuzzy = options.find((option) => {
        const text = normalize(optionText(option));
        return text === wanted || text.includes(wanted) || wanted.includes(text);
      });
      if (fuzzy) return { option: fuzzy, selectedText: optionText(fuzzy) };
    }
    return null;
  }

  async function openFeishuSelect(el) {
    let options = feishuVisibleSelectOptions();
    if (options.length) return options;
    const trigger = feishuSelectTrigger(el);
    for (const target of Array.from(new Set([el, trigger].filter(Boolean)))) {
      clickElement(target);
      await wait(450);
      options = feishuVisibleSelectOptions();
      if (options.length) return options;
    }
    return options;
  }

  function setFeishuSearchValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    if (global.InputEvent) {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } else {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Sunwz|2026-08-08|飞书 ud select 填充：先点开真实选项列表，再按文本点选
  async function feishuFillSelect(el, value) {
    if (!el) return { ok: false, reason: "no-el" };
    const rawValue = String(value || "").trim();
    if (!rawValue) return { ok: false, reason: "empty-value" };
    el.focus?.();

    let options = await openFeishuSelect(el);
    let match = findFeishuSelectOption(rawValue, options);

    if (!match) {
      const searchInput = feishuSelectSearchInput(el);
      if (!searchInput) return { ok: false, reason: "no-option", val: "" };
      const searchValue = feishuSelectAliases(rawValue).find((alias) => alias !== rawValue) || rawValue;
      setFeishuSearchValue(searchInput, "");
      await wait(120);
      setFeishuSearchValue(searchInput, searchValue);
      await wait(650);
      options = feishuVisibleSelectOptions();
      match = findFeishuSelectOption(rawValue, options);
    }

    if (match) {
      clickElement(match.option);
      await wait(600);
      return { ok: true, selected: match.selectedText };
    }

    (feishuSelectSearchInput(el) || el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(400);
    return { ok: false, reason: "no-option", val: feishuSelectSearchInput(el)?.value || "" };
  }

  // Sunwz|2026-08-08|飞书 ud__picker 日期选择器填充：聚焦→清空→输入日期→Enter 提交
  async function feishuFillDatePicker(el, value) {
    if (!el) return { ok: false, reason: "no-el" };
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus();
    nativeSetter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(150);
    el.focus();
    document.execCommand("insertText", false, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(300);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(400);
    return { ok: true, val: el.value };
  }

  global.EdgeResumeFiller = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
