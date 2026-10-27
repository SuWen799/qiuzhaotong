(function initRecordWaiter(global) {
  "use strict";

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForRecords(scanRecords, options = {}) {
    const attempts = Math.max(1, options.attempts ?? 8);
    const delayMs = Math.max(0, options.delayMs ?? 250);
    let lastRecords = [];

    for (let index = 0; index < attempts; index += 1) {
      lastRecords = scanRecords() || [];
      if (lastRecords.length > 0) return lastRecords;
      if (index < attempts - 1) await wait(delayMs);
    }

    return lastRecords;
  }

  const api = { waitForRecords };

  global.EdgeResumeRecordWaiter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
