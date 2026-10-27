(function initPageReactBridge(global) {
  "use strict";

  if (global.__ERA_PAGE_REACT_BRIDGE__ === "1") return;
  global.__ERA_PAGE_REACT_BRIDGE__ = "1";

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/请选择|请输入|必填|选填/g, "")
      .replace(/[\s\u00a0:：;；\-—–()（）[\]【】\\,.，。/、]/g, "")
      .trim();
  }

  function optionText(element) {
    return String(element?.innerText || element?.textContent || element?.getAttribute?.("title") || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = global.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
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
      for (let fiber = reactFiberFor(element), depth = 0; fiber && depth < 24; fiber = fiber.return, depth += 1) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (typeof props?.onChangeCheck === "function" && props.data && reactOptionMatchesData(option, props.data)) {
          return { onChangeCheck: props.onChangeCheck, data: props.data };
        }
      }
    }
    return null;
  }

  function visibleOptions() {
    const selectors = [
      ".list-item-container",
      ".area-item-container",
      "[class*='area-item']",
      ".phoenix-selectList__listItem",
      "[role='option']",
    ];
    const seen = new Set();
    const options = [];
    for (const selector of selectors) {
      for (const element of global.document.querySelectorAll(selector)) {
        const option = element.closest?.(".list-item-container,.area-item-container,.phoenix-selectList__listItem,[role='option']") || element;
        if (!visible(option) || seen.has(option)) continue;
        seen.add(option);
        options.push(option);
      }
    }
    return options;
  }

  function findOption(text) {
    const wanted = normalize(text);
    if (!wanted) return null;
    return visibleOptions().find((option) => {
      const candidate = normalize(optionText(option));
      return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
    }) || null;
  }

  function applyReactOption(text) {
    const option = findOption(text);
    if (!option) return { ok: false, reason: "page-react-option-not-found" };
    const handler = findReactOptionChange(option);
    if (!handler) return { ok: false, reason: "page-react-handler-not-found", optionText: optionText(option) };
    try {
      handler.onChangeCheck(handler.data);
      return {
        ok: true,
        selected: handler.data?.name || handler.data?.text || optionText(option),
      };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error || "page-react-handler-failed") };
    }
  }

  global.document.documentElement?.setAttribute("data-era-page-react-bridge", "1");
  global.document.addEventListener("ERA_REACT_SELECT_OPTION", (event) => {
    const detail = event.detail || {};
    const result = applyReactOption(detail.selectedText || detail.text || detail.value || "");
    global.document.dispatchEvent(new CustomEvent("ERA_REACT_SELECT_OPTION_RESPONSE", {
      detail: { id: detail.id, ...result },
    }));
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
