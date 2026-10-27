(function initContentInjector(global) {
  "use strict";

  const DEFAULT_CSS_FILES = ["content/content.css"];
  const DEFAULT_SCRIPT_FILES = [
    "shared/profile-normalizer.js",
    "shared/matcher.js",
    "shared/filler.js",
    "shared/record-waiter.js",
    "content/content.js",
  ];
  const DEFAULT_MAIN_WORLD_FILES = ["shared/page-react-bridge.js"];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isMissingReceiverError(error) {
    return /receiving end does not exist|could not establish connection/i.test(String(error?.message || error || ""));
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "");
    if (/cannot access contents|extensions gallery|chrome:|edge:|browser page/i.test(message)) {
      return new Error("当前页面不允许扩展运行，请打开招聘表单网页后再试。");
    }
    if (isMissingReceiverError(error)) {
      return new Error("页面脚本没有响应，已尝试注入；请刷新当前招聘页面或重新加载扩展后再试。");
    }
    return error instanceof Error ? error : new Error(message || "页面通信失败");
  }

  async function injectContentScripts(chromeApi, tabId, options = {}) {
    if (!tabId) throw new Error("没有可操作的当前标签页");
    if (!chromeApi?.scripting?.executeScript) {
      throw new Error("当前浏览器不支持脚本注入，请确认已启用开发者模式并重新加载扩展。");
    }

    const target = options.allFrames ? { tabId, allFrames: true } : { tabId };
    const cssFiles = options.cssFiles || DEFAULT_CSS_FILES;
    const scriptFiles = options.scriptFiles || DEFAULT_SCRIPT_FILES;

    if (chromeApi.scripting.insertCSS && cssFiles.length) {
      await chromeApi.scripting.insertCSS({ target, files: cssFiles });
    }
    await chromeApi.scripting.executeScript({ target, files: scriptFiles });
  }

  async function injectMainWorldBridge(chromeApi, tabId, options = {}) {
    if (!tabId || !chromeApi?.scripting?.executeScript) return { ok: false, error: "main-world-injection-unavailable" };
    const target = options.allFrames ? { tabId, allFrames: true } : { tabId };
    const files = options.mainWorldFiles || DEFAULT_MAIN_WORLD_FILES;
    await chromeApi.scripting.executeScript({ target, files, world: "MAIN" });
    return { ok: true };
  }

  async function sendRawMessage(chromeApi, tabId, message, options = {}) {
    if (!chromeApi?.tabs?.sendMessage) throw new Error("当前浏览器不支持标签页通信。");
    if (Number.isFinite(options.frameId)) {
      return chromeApi.tabs.sendMessage(tabId, message, { frameId: options.frameId });
    }
    return chromeApi.tabs.sendMessage(tabId, message);
  }

  async function retryMessage(chromeApi, tabId, message, options = {}) {
    const attempts = options.retryAttempts ?? 8;
    const delayMs = options.retryDelayMs ?? 300;
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await sendRawMessage(chromeApi, tabId, message, options);
      } catch (error) {
        lastError = error;
        if (!isMissingReceiverError(error)) throw error;
        await wait(delayMs);
      }
    }
    throw lastError || new Error("页面脚本没有响应");
  }

  function recordsInResponse(response) {
    const value = response?.report?.records ?? response?.report?.lastReport?.records;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function shouldTryFormFrame(response, message) {
    if (!["ERA_SCAN", "ERA_FILL", "ERA_GET_PAGE_STATE"].includes(message?.type)) return false;
    if (response?.ok === false) return false;
    if (response?.report?.site !== "feishu") return false;
    return recordsInResponse(response) === 0;
  }

  async function probeFormFrames(chromeApi, tabId) {
    if (!chromeApi?.scripting?.executeScript) return [];
    let results = [];
    try {
      results = await chromeApi.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const q = (selector) => document.querySelectorAll(selector).length;
          const bodyText = document.body?.innerText || "";
          const textHints = /[\u6559\u80b2\u7ecf\u5386\u5b9e\u4e60\u7ecf\u5386\u9879\u76ee\u7ecf\u5386\u83b7\u5956\u7b80\u5386\u6295\u9012]/.test(bodyText) ? 1 : 0;
          return {
            href: location.href,
            controls: q("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, select"),
            formHints: q("[data-form-field-i18n-name],.ud-formily-item,[class*='formily-item'],.applyFormModuleWrapper,[class*='applyFormModuleWrapper'],.apply-form-array-card,[class*='apply-form-array-card'],.resume-section,[class*='resume-section'],.resume-field,[class*='resume-field'],.resume-array-item,[class*='resume-array-item'],[data-module],[data-section]") + textHints,
            hasAutofill: Boolean(window.__EDGE_RESUME_AUTOFILL__),
          };
        },
      });
    } catch {
      return [];
    }
    return results
      .map((entry) => ({ frameId: entry.frameId, ...(entry.result || {}) }))
      .filter((entry) => Number.isFinite(entry.frameId) && entry.frameId !== 0 && Number(entry.controls || 0) > 0)
      .sort((a, b) => ((b.formHints || 0) * 100 + (b.controls || 0)) - ((a.formHints || 0) * 100 + (a.controls || 0)));
  }

  async function sendMessageToBestFormFrame(chromeApi, tabId, message, options = {}) {
    const frames = await probeFormFrames(chromeApi, tabId);
    for (const frame of frames) {
      const frameOptions = { ...options, frameId: frame.frameId };
      try {
        const response = await sendRawMessage(chromeApi, tabId, message, frameOptions);
        if (!shouldTryFormFrame(response, message)) return response;
      } catch (error) {
        if (!isMissingReceiverError(error)) continue;
        try {
          await injectMainWorldBridge(chromeApi, tabId, { ...options, allFrames: true }).catch(() => null);
          await injectContentScripts(chromeApi, tabId, { ...options, allFrames: true });
          const response = await retryMessage(chromeApi, tabId, message, frameOptions);
          if (!shouldTryFormFrame(response, message)) return response;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  async function rerouteIfNeeded(chromeApi, tabId, message, response, options = {}) {
    if (!shouldTryFormFrame(response, message)) return response;
    const frameResponse = await sendMessageToBestFormFrame(chromeApi, tabId, message, options);
    return frameResponse || response;
  }

  async function sendMessageToTab(chromeApi, tabId, message, options = {}) {
    try {
      await injectMainWorldBridge(chromeApi, tabId, options).catch(() => null);
      const response = await sendRawMessage(chromeApi, tabId, message);
      return await rerouteIfNeeded(chromeApi, tabId, message, response, options);
    } catch (error) {
      if (!isMissingReceiverError(error)) throw friendlyError(error);
      try {
        await injectContentScripts(chromeApi, tabId, options);
        const response = await retryMessage(chromeApi, tabId, message, options);
        return await rerouteIfNeeded(chromeApi, tabId, message, response, options);
      } catch (nextError) {
        throw friendlyError(nextError);
      }
    }
  }

  const api = {
    DEFAULT_CSS_FILES,
    DEFAULT_MAIN_WORLD_FILES,
    DEFAULT_SCRIPT_FILES,
    friendlyError,
    injectContentScripts,
    injectMainWorldBridge,
    isMissingReceiverError,
    sendMessageToTab,
  };

  global.EdgeResumeContentInjector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
