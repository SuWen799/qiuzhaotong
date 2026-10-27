// 秋招通插件：公司识别模块
// 职责：
//  1) extractPageInfo() —— 在页面上下文（通过 chrome.scripting 注入）执行，提取 title 与可见文本。
//  2) detectCompanies(pageInfo, companyList) —— 把页面文本与后端版本公司列表做包含匹配，返回候选公司。
// 所有说明与注释均为中文。
(function initCompanyDetector(global) {
  "use strict";

  // 在页面主世界执行的提取函数（不依赖扩展 API，纯 DOM）。
  // 返回 { title, text }，text 为去重后的可见正文片段。
  function extractPageInfo() {
    const title = document.title || "";
    // 收集可见文本：标题、h1~h3、含“招聘/校招/投递”等关键字的段落、以及页面输入框附近的公司名线索
    const textPieces = [title];
    const push = (value) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (text) textPieces.push(text);
    };
    push(document.querySelector("h1")?.innerText);
    push(document.querySelector("h2")?.innerText);
    push(document.querySelector("h3")?.innerText);
    // 招聘站点常见公司名容器
    document.querySelectorAll("[class*='company'],[class*='brand'],[class*='logo'],[class*='employer'],[data-company],[id*='company']").forEach((el) => push(el.getAttribute("title") || el.getAttribute("alt") || el.innerText));
    // 通用可见文本（限制长度，避免过长）
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    textPieces.push(bodyText.slice(0, 4000));
    const text = textPieces.join(" \n ").replace(/\s+/g, " ").trim();
    return { title, text };
  }

  // 从页面文本中找出包含在公司列表里的公司名
  // pageInfo: {title, text}
  // companyList: [{company, jobId, createdAt}]
  // 返回候选列表（按匹配可信度排序）：[{company, score, reason}]
  function detectCompanies(pageInfo, companyList) {
    const title = String(pageInfo?.title || "");
    const text = String(pageInfo?.text || "");
    const haystackTitle = title.toLowerCase();
    const haystackText = text.toLowerCase();
    const results = [];

    for (const item of companyList || []) {
      const company = String(item.company || "").trim();
      if (!company) continue;
      const lower = company.toLowerCase();
      let score = 0;
      let reason = "";
      // title 命中权重最高
      if (haystackTitle.includes(lower)) {
        score = Math.max(score, 1.0);
        reason = "页面标题命中";
      }
      // 正文命中
      if (haystackText.includes(lower)) {
        const textScore = title.includes(company) ? 0.9 : 0.7;
        if (textScore > score) { score = textScore; reason = title.includes(company) ? "标题与正文命中" : "页面正文命中"; }
      }
      // 针对“xx招聘/xx校园招聘”这种 title 含公司名但公司列表是简称的情况，做反向包含：
      // 例如 title=“字节跳动校园招聘”，公司列表有“字节”→ 也视为命中
      if (score === 0 && (haystackTitle.includes(lower) || haystackText.includes(lower))) {
        score = 0.7; reason = "页面文本命中";
      }
      // 反向：公司名是页面某段的子串（已在上面覆盖）。再补充：公司名出现在“投递/申请/应聘 <公司>”语句
      if (score === 0) {
        const applyPattern = new RegExp(`(投递|申请|应聘|报名|加入|校园招聘|招聘)\\s*${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
        if (applyPattern.test(text) || applyPattern.test(title)) {
          score = 0.8; reason = "投递/申请语境命中";
        }
      }
      if (score > 0) results.push({ company, jobId: item.jobId || "", createdAt: item.createdAt || "", score, reason });
    }

    results.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
    return results;
  }

  // 输入时做模糊匹配（搜索框下拉）：公司名包含关键字，或关键字包含公司名
  function fuzzyMatchCompanies(keyword, companyList, limit = 20) {
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return (companyList || []).slice(0, limit);
    return (companyList || [])
      .filter((item) => {
        const company = String(item.company || "").toLowerCase();
        return company.includes(kw) || kw.includes(company);
      })
      .slice(0, limit);
  }

  const api = {
    extractPageInfo,
    detectCompanies,
    fuzzyMatchCompanies,
  };

  global.EdgeResumeCompanyDetector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
