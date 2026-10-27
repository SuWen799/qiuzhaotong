// 秋招通 · 简历智能填充插件 —— 后台 Service Worker (Manifest V3)
// 移植自原版「Edge简历智能填充助手」background.js，按新版插件实际消息契约裁剪：
//   新版插件实际只会发送 ERA_OPEN_OPTIONS / ERA_TRUSTED_CLICK / ERA_INJECT_MAIN_WORLD_BRIDGE，
//   以及 manifest 中声明的两个快捷键命令（era-fill-page / era-toggle-assistant）。
//   原版的 ERA_OPEN_BAIDU / ERA_OPEN_MOKA 分支已移除（新版不再使用）。
importScripts("shared/content-injector.js");

const injector = self.EdgeResumeContentInjector;
const DEBUGGER_TIMEOUT_MS = 2500;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ERA_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage(() => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true });
    });
    return true;
  }

  if (message?.type === "ERA_TRUSTED_CLICK") {
    trustedClick(sender.tab?.id, message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "trusted-click-failed") }));
    return true;
  }

  if (message?.type === "ERA_INJECT_MAIN_WORLD_BRIDGE") {
    injectMainWorldBridge(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "main-world-bridge-failed") }));
    return true;
  }

  // 秋招通：content script 在 https 页面直接 fetch http://127.0.0.1 会被混合内容拦截；
  // 改由 background service worker 代发（SW 不受混合内容限制），再把结果回传。
  if (message?.type === "ERA_FETCH") {
    handleBackendFetch(message, sendResponse);
    return true;
  }

  return false;
});

// 代 content script / popup 发起后端 HTTP 请求（绕过 https 页面的混合内容限制）。
function handleBackendFetch(message, sendResponse) {
  (async () => {
    try {
      const url = String(message?.url || "");
      if (!url) return sendResponse({ ok: false, error: "缺少 url" });
      const method = (message?.method || "GET").toUpperCase();
      // Sunwz|2026-09-26|PUT/POST JSON 请求体透传
      const hasBody = message?.body != null;
      const resp = await fetch(url, {
        method,
        headers: hasBody
          ? { Accept: "application/json", "Content-Type": "application/json" }
          : { Accept: "application/json" },
        ...(hasBody ? { body: JSON.stringify(message.body) } : {}),
      });
      const text = await resp.text().catch(() => "");
      sendResponse({ ok: true, status: resp.status, text });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
}

chrome.commands?.onCommand.addListener((command) => {
  if (command === "era-fill-page") {
    void sendToActiveTab("ERA_FILL");
  }
  if (command === "era-toggle-assistant") {
    void sendToActiveTab("ERA_TOGGLE_ASSISTANT");
  }
});

function openTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url }, (tab) => {
      resolve({ ok: true, tabId: tab?.id || null });
    });
  });
}

async function sendToActiveTab(type) {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await injector.sendMessageToTab(chrome, tab.id, { type });
  } catch {
    // Keyboard shortcuts have no visible surface; popup shows detailed errors.
  }
}

function activeTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab || null));
  });
}

function injectMainWorldBridge(tabId) {
  return new Promise((resolve) => {
    if (!tabId || !chrome.scripting?.executeScript) {
      resolve({ ok: false, error: "main-world-injection-unavailable" });
      return;
    }
    const payload = {
      target: { tabId },
      files: ["shared/page-react-bridge.js"],
      world: "MAIN",
    };
    try {
      const maybePromise = chrome.scripting.executeScript(payload, () => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, error: error.message } : { ok: true });
      });
      if (maybePromise?.then) {
        maybePromise.then(
          () => resolve({ ok: true }),
          (error) => resolve({ ok: false, error: String(error?.message || error) }),
        );
      }
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error) });
    }
  });
}

function debuggerCall(target, method, params = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `${method}-timeout` }), DEBUGGER_TIMEOUT_MS);
    try {
      chrome.debugger.sendCommand(target, method, params, () => {
        const error = chrome.runtime.lastError;
        finish(error ? { ok: false, error: error.message } : { ok: true });
      });
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
    }
  });
}

function attachDebugger(target) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "debugger-attach-timeout" }), DEBUGGER_TIMEOUT_MS);
    try {
      chrome.debugger.attach(target, "1.3", () => {
        const error = chrome.runtime.lastError;
        finish(error ? { ok: false, error: error.message } : { ok: true });
      });
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
    }
  });
}

function detachDebugger(target) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "debugger-detach-timeout" }), DEBUGGER_TIMEOUT_MS);
    try {
      chrome.debugger.detach(target, () => finish({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message || "" }));
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error) });
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function trustedClick(tabId, message) {
  if (!tabId || !Number.isFinite(message?.x) || !Number.isFinite(message?.y)) {
    return { ok: false, error: "invalid-click-target" };
  }
  const target = { tabId };
  const attached = await attachDebugger(target);
  if (!attached.ok) return attached;
  try {
    const x = Number(message.x);
    const y = Number(message.y);
    const holdMs = Math.max(20, Math.min(500, Number(message.holdMs || 120)));
    const pressed = await debuggerCall(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    if (!pressed.ok) return pressed;
    await wait(holdMs);
    return await debuggerCall(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  } finally {
    await detachDebugger(target);
  }
}
