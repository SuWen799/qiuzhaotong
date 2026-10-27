(function initUiHelpers(global) {
  "use strict";

  function siteInfo(urlValue) {
    let url;
    try {
      url = new URL(String(urlValue || ""));
    } catch {
      return { id: "unknown", label: "当前页面不可识别", supported: false };
    }

    if (!/^https?:$/.test(url.protocol)) {
      return { id: "internal", label: "浏览器内部页", supported: false };
    }
    if (url.hostname === "talent.baidu.com" && url.pathname.includes("/jobs/resume/create")) {
      return { id: "baidu", label: "百度招聘", supported: true };
    }
    if (url.hostname.endsWith("mokahr.com")) {
      return { id: "moka", label: "Moka", supported: true };
    }
    if (url.hostname.endsWith("51job.com") && url.pathname.includes("/External/MyResume/FillInResume.aspx")) {
      return { id: "51job", label: "前程无忧", supported: true };
    }
    return { id: "generic", label: "通用网页", supported: true };
  }

  function summarizeProfile(profile) {
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const sectionValues = Object.values(sections).filter(Boolean);
    let fields = 0;

    for (const section of sectionValues) {
      if (section.values) fields += countFilledObject(section.values);
      if (Array.isArray(section.items)) {
        for (const item of section.items) fields += countFilledObject(item?.values || {});
      }
    }

    const normalizer = global.EdgeResumeProfileNormalizer;
    const candidates = normalizer?.normalizeProfile ? normalizer.normalizeProfile(profile).length : fields;
    return {
      sections: sectionValues.length,
      fields,
      candidates,
    };
  }

  function countFilledObject(values) {
    return Object.values(values || {}).filter((value) => String(value ?? "").trim()).length;
  }

  function reportSummary(report = {}, mode = "scan") {
    if (mode === "fill") {
      return `已填写 ${Number(report.filled || 0)} 项，跳过/失败 ${Number(report.failed || 0)} 项。未保存或提交。`;
    }
    return `识别 ${Number(report.records || 0)} 个控件，匹配 ${Number(report.mappings || 0)} 项，需人工处理 ${Number(report.skipped || 0)} 项。`;
  }

  function sectionLabel(section) {
    const labels = {
      basic: "基础信息",
      intent: "求职意向",
      intention: "求职意向",
      education: "教育经历",
      internship: "实习经历",
      work: "工作经历",
      project: "项目经验",
      portfolio: "作品集",
      student: "校园经历",
      awards: "获奖经历",
      language: "外语能力",
      certificates: "证书",
      attachments: "附件",
      self: "自我评价",
      other: "其他信息",
    };
    return labels[section] || section || "未分类";
  }

  const api = {
    reportSummary,
    sectionLabel,
    siteInfo,
    summarizeProfile,
  };

  global.EdgeResumeUiHelpers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
