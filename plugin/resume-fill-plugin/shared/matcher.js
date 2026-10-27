(function initMatcher(global) {
  "use strict";

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/请填写|请输入|请选择|必填|选填/g, "")
      .replace(/[\s\u00a0:：*＊_\-—–()（）\[\]【】/\\,.，。;；?？!！]/g, "")
      .trim();
  }

  function includesAny(haystack, needles) {
    return needles.some((needle) => haystack.includes(normalizeText(needle)));
  }

  function contextSection(record) {
    const text = normalizeText(`${record.context || ""} ${record.label || ""}`);
    if (includesAny(text, ["附件", "上传简历", "简历文件", "个人照片", "证件照"])) return "attachments";
    if (includesAny(text, ["作品集", "作品链接", "作品名称", "作品描述"])) return "portfolio";
    if (includesAny(text, ["获奖", "奖惩", "荣誉", "颁奖"])) return "awards";
    if (includesAny(text, ["项目", "课题"])) return "project";
    // 秋招通插件新增：核心能力（可变模块）
    if (includesAny(text, ["核心能力", "专业技能", "技能特长", "专业能力", "个人技能", "技术能力", "能力特长", "核心竞争力", "核心优势", "技能标签", "擅长领域", "技术栈", "专业特长"])) return "coreSkills";
    // Sunwz|2026-08-07|在校职务（学生会/自律会）独立分区，区别于校园经历（社团）
    if (includesAny(text, ["学生会", "自律会", "在校职务"])) return "studentOfficer";
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-06|子表单"校园经历/社团干部"分区（简道云等通用）
    if (includesAny(text, ["社团", "干部", "校园", "学生组织", "在校实践", "校园实践"])) return "student";
    // Sunwz|2026-08-06|——END
    if (includesAny(text, ["实习"])) return "internship";
    if (includesAny(text, ["工作经历", "企业", "职位年薪", "所在部门", "行业类别", "工作描述"])) return "work";
    if (includesAny(text, ["教育", "学校", "学历", "专业", "gpa", "绩点", "成绩排名"])) return "education";
    if (includesAny(text, ["求职意向", "目标工作城市", "目标职位类别", "可面试方式", "可线下面试城市", "是否接受调剂"])) return "intent";
    if (includesAny(text, ["招聘信息来源", "信息来源"])) return "other";
    if (includesAny(text, ["基础信息", "姓名", "移动电话", "电子邮箱", "性别", "身份证号", "证件号码"])) return "basic";
    return "";
  }

  // Sunwz|2026-08-27|奥比中光：日期类字段（开始/结束时间）的 label 只是"开始时间"，context 取到的常是邻近字段标签
  // （如"单位名称"）而非模块标题，导致 contextSection 返回 ""、读不到对应模块的时间值。改为从 record.element 向上
  // 找模块标题（含 实习/项目/教育/获奖/校园/工作 等关键词）来判定所属 section，更可靠。
  // 注意：实习常被包在"工作经历"容器内，故优先匹配 实习/项目/教育 等具体词，且同时检查元素自身 textContent
  // （部分框架模块标题不在 heading/aria 里，只在容器文本中，如"实习经历""教育经历"）。
  function sectionFromDom(record) {
    let el = record && record.element;
    while (el && el !== document.body && el.parentElement) {
      const h = el.querySelector ? el.querySelector("[class*=title],[class*=Title],[class*=heading],h1,h2,h3,h4") : null;
      const ht = h ? (h.textContent || "").trim() : "";
      const txt = (el.getAttribute && (el.getAttribute("data-title") || el.getAttribute("aria-label") || el.getAttribute("title") || "")) || "";
      // Sunwz|2026-08-27|必须含"经历/经验/背景"等模块标题特征词，严禁只匹配"实习/教育/项目"子串——
      // 否则整棵表单树的高层祖先（含"实习经历""教育经历"模块文本或"AI应用开发实习生"职位标题）会被误判，
      // 导致实习/项目结束时间被错读成 education 段（如把本科毕业时间 2021-06 误填进实习结束时间）。
      if (/实习经历|实习经验/.test(ht)) return "internship";
      if (/项目经历|项目经验/.test(ht)) return "project";
      if (/工作经历/.test(ht)) return "work";
      if (/教育经历|教育背景|教育信息/.test(ht)) return "education";
      if (/校园经历|社会实践|在校实践/.test(ht)) return "student";
      if (/获奖经历|获奖情况/.test(ht)) return "awards";
      if (/实习经历|实习经验/.test(txt)) return "internship";
      if (/项目经历|项目经验/.test(txt)) return "project";
      if (/工作经历/.test(txt)) return "work";
      if (/教育经历|教育背景|教育信息/.test(txt)) return "education";
      if (/校园经历|社会实践|在校实践/.test(txt)) return "student";
      if (/获奖经历|获奖情况/.test(txt)) return "awards";
      el = el.parentElement;
    }
    return "";
  }

  // 判断一个字段是否属于「证书」模块（区别于教育模块的成绩/GPA，避免证书成绩被错填成 3.48/4）
  function isCertRecord(record) {
    if (sectionFromDom(record) === "certificates") return true;
    if (contextSection(record) === "certificates") return true;
    // 兜底：向上遍历祖先，若同模块内出现"证书名称/证书类型/外语证书"即为证书分区
    let el = record && record.element;
    while (el && el !== document.body && el.parentElement) {
      if (/证书名称|证书类型|外语证书/.test(el.textContent || "")) return true;
      el = el.parentElement;
    }
    return false;
  }

  function aliasesForCandidate(candidate) {
    return [candidate.label, candidate.key, ...(candidate.aliases || [])].map(normalizeText).filter(Boolean);
  }

  const REPEATABLE_SECTIONS = new Set([
    "education",
    "internship",
    "work",
    "awards",
    "studentOfficer",
    "student",
    "project",
    "portfolio",
    "language",
    "relative",
  ]);

  function normalizedRepeatIndex(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function repeatIndexCompatible(record, candidate) {
    const section = contextSection(record);
    if (REPEATABLE_SECTIONS.has(section) && candidate.section !== section) return false;
    if (!REPEATABLE_SECTIONS.has(candidate.section)) return true;
    if (section && section !== candidate.section) return true;
    const recordIndex = normalizedRepeatIndex(record.repeatIndex);
    return normalizedRepeatIndex(candidate.repeatIndex) === recordIndex;
  }

  function baseScore(record, candidate) {
    const label = normalizeText(record.label || "");
    const context = normalizeText(record.context || "");
    const recordText = normalizeText(`${record.label || ""} ${record.context || ""} ${record.name || ""} ${record.placeholder || ""}`);
    let score = 0;

    for (const alias of aliasesForCandidate(candidate)) {
      if (!alias) continue;
      if (label === alias) score = Math.max(score, 1);
      if (label.includes(alias) || alias.includes(label)) score = Math.max(score, 0.82);
      if (recordText.includes(alias)) score = Math.max(score, 0.72);
    }

    const section = contextSection(record);
    if (section && candidate.section === section) score += 0.18;
    if (section && candidate.section !== section) score -= 0.2;
    // Sunwz|2026-08-06|子表单/多行经历：记录行号与候选 repeatIndex 一致加分（避免多行都匹配第一行）
    if (record.repeatIndex === candidate.repeatIndex) score += 0.08;
    // Sunwz|2026-08-06|——END
    if (context.includes("第2") && candidate.repeatIndex === 1) score += 0.08;
    if (!context.includes("第2") && candidate.repeatIndex === 0) score += 0.04;

    return score;
  }

  function findCandidate(candidates, section, key, repeatIndex = 0) {
    const index = normalizedRepeatIndex(repeatIndex);
    const exact = candidates.find((candidate) => candidate.section === section && candidate.key === key && normalizedRepeatIndex(candidate.repeatIndex) === index);
    if (exact) return exact;
    if (REPEATABLE_SECTIONS.has(section) && index > 0) return null;
    return candidates.find((candidate) => candidate.section === section && candidate.key === key);
  }

  function firstValue(candidates, section, keys, repeatIndex = 0) {
    for (const key of keys) {
      const candidate = findCandidate(candidates, section, key, repeatIndex);
      if (candidate?.value) return { candidate, value: candidate.value };
    }
    return { candidate: null, value: "" };
  }

  function provinceFor(value) {
    const text = String(value || "");
    const pairs = [
      ["北京市", ["北京"]], ["上海市", ["上海"]], ["广东省", ["广东", "深圳", "广州"]],
      ["江苏省", ["江苏", "南京", "苏州"]], ["辽宁省", ["辽宁", "沈阳", "大连"]],
      ["浙江省", ["浙江", "杭州"]], ["四川省", ["四川", "成都"]], ["天津市", ["天津"]],
    ];
    for (const [province, terms] of pairs) {
      if (terms.some((term) => text.includes(term))) return province;
    }
    return text;
  }

  // Sunwz|2026-08-15|秋招通通用站点：典型 select 枚举字段兜底映射（奥比中光等第三方组件下拉）
  // 命中这些字段且值为枚举之一时，走 chooseOption 枚举匹配而非 text 设值
  const SELECT_ENUM_MAP = {
    证书类型: ["外语证书", "职业资格证书", "计算机证书", "其他"],
    外语种类: ["英语", "日语", "韩语", "其他"],
    学位: ["学士", "硕士", "博士", "其他"],
    学历: ["本科", "硕士研究生", "博士研究生", "其他"],
    奖励等级: ["国家级", "省级", "校级", "院级"],
    奖励类型: ["竞赛获奖", "荣誉称号", "论文专利", "其他"],
    投递状态: ["已投递", "未投递", "其他"],
  };
  const SELECT_ENUM_LABELS = Object.keys(SELECT_ENUM_MAP);
  function isEnumSelectLabel(label) {
    const t = normalizeText(label || "");
    return SELECT_ENUM_LABELS.some((k) => t.includes(normalizeText(k)));
  }
  // 论文/期刊/论著/专著类字段：只从 papers/publications 取，绝不 fallback 到 basic.学校
  const PAPER_LABEL_PATTERNS = [
    /论文名称/, /论文题目/, /论文/, /期刊名称/, /期刊/, /论著/, /专著名称/, /专著/, /发表文章/, /出版物/,
  ];
  // 通过 context（模块标题/段落）也能识别论文模块，避免 label 仅为"名称"时漏判
  const PAPER_CONTEXT_PATTERNS = [
    /论文\s*[\/／]\s*专著/, /^\s*论文\s*[\/／]?\s*专著\s*$/, /^\s*论著\s*$/, /^\s*学术成果\s*$/, /^\s*科研成果\s*$/,
  ];
  function isPaperContext(context) {
    const text = normalizeText(context || "");
    if (!text) return false;
    return PAPER_CONTEXT_PATTERNS.some((re) => re.test(text));
  }
  function isPaperLabel(label, context) {
    if (PAPER_LABEL_PATTERNS.some((re) => re.test(label || ""))) return true;
    if (isPaperContext(context)) return true; // Sunwz|2026-08-24|在论文/专著模块里，所有字段都视作论文字段，绝不 fallback 到 basic.学校
    return false;
  }
  function paperValue(candidates, repeatIndex) {
    // candidates 是 normalizeProfile 返回的数组（{section,key,value,repeatIndex}）；
    // 论文只从 papers / publications 取，绝不 fallback 到 basic.学校
    return firstValue(candidates, "papers", ["name", "title", "论文名称", "论文题目"], repeatIndex).value
      || firstValue(candidates, "publications", ["name", "title", "论文名称", "论文题目"], repeatIndex).value;
  }
  // Sunwz|2026-08-15|——END

  function baiduIndustryFor(value) {
    const text = String(value || "");
    if (/工业软件|软件|saas|平台/.test(text.toLowerCase())) return "计算机软件";
    if (/自动驾驶|汽车|车载/.test(text)) return "汽车/摩托车（制造/维护/配件/销售/服务）";
    if (/互联网|电商|电子商务/.test(text)) return "互联网/电子商务";
    if (/仪表|工业自动化|自动化/.test(text)) return "仪表仪器/工业自动化";
    if (/通信|电信|网络设备/.test(text)) return "通信/电信/网络设备";
    return text;
  }

  function baiduOverride(record, candidates, options) {
    const label = normalizeText(record.label || "");
    const context = normalizeText(record.context || "");
    const defaults = options.baiduDefaults || {};

    // Sunwz|2026-08-06|百度快捷勾选"无工作经历/无获奖信息"不应勾选；"无学术成果"勾选后论文明细字段留空
    if (/无工作经历|无获奖信息/.test(label)) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "keep-unchecked" };
    }
    if (/会议期刊名称|会议期刊档位|论文名称|作者排序|论文链接|上传论文/.test(label)) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-academic-output" };
    }
    // Sunwz|2026-08-06|——END

    const direct = [
      [["个人简历文件", "简历文件", "上传简历", "简历附件"], "attachments", "resumeFile"],
      [["个人照片", "照片", "证件照", "上传照片"], "attachments", "photo"],
      [["姓名"], "basic", "fullName"],
      [["移动电话", "手机号码"], "basic", "phone"],
      [["电子邮箱", "个人邮箱"], "basic", "email"],
      [["性别"], "basic", "gender"],
      // Sunwz|2026-08-06|补证件类型下拉（百度先选身份证才允许填号码）与"证件号"标签变体
      [["证件类型", "证件号码类型"], "basic", "idType"],
      [["身份证号", "身份证号码", "证件号码", "证件号"], "basic", "idNumber"],
      // Sunwz|2026-08-06|补证件类型下拉（百度先选身份证才允许填号码）与"证件号"标签变体——END
      [["学校"], "education", "school"],
      [["专业"], "education", "major"],
      [["学历"], "education", "educationLevel"],
      [["GPA类型", "绩点类型", "成绩类型"], "education", "gpaType"],
      [["GPA成绩", "成绩绩点", "绩点"], "education", "gpa"],
      [["成绩排名", "专业排名", "班级排名"], "education", "rank"],
      [["企业名称"], "work", "company"],
      [["所在部门"], "work", "department"],
      [["职位名称"], "work", "position"],
      [["工作描述"], "work", "description"],
      [["奖惩时间", "获奖时间", "颁发时间"], "awards", "date"],
      [["奖惩名称", "获奖名称", "荣誉名称"], "awards", "name"],
      [["颁奖单位", "颁发机构", "授予单位"], "awards", "issuer"],
      [["奖励等级", "奖项级别"], "awards", "level"],
      [["奖惩描述", "获奖描述", "奖项描述", "奖项说明"], "awards", "description"],
      [["奖励类型", "奖项类型", "获奖类型"], "awards", "type"],
      [["项目名称"], "project", "name"],
      [["项目职务"], "project", "role"],
      [["项目描述"], "project", "description"],
      [["项目职责"], "project", "responsibility"],
      [["作品名称", "作品集名称"], "portfolio", "name"],
      [["作品链接", "作品集链接", "作品主页"], "portfolio", "url"],
      [["作品描述", "作品简介"], "portfolio", "description"],
    ];

    for (const [terms, section, key] of direct) {
      if (terms.some((term) => label.includes(normalizeText(term)))) {
        const candidate = findCandidate(candidates, section, key, record.repeatIndex || 0);
        if (candidate) return { candidate, value: candidate.value, confidence: 0.98 };
      }
    }

    // Sunwz|2026-08-06|奖项名称是远程搜索下拉，自定义奖项名不在预设列表时回退选"其他"，具体奖项名写入奖项说明
    if (label.includes(normalizeText("奖项名称"))) {
      const candidate = findCandidate(candidates, "awards", "name", record.repeatIndex || 0);
      if (candidate) {
        record.fallbackOption = "其他";
        return { candidate, value: candidate.value, confidence: 0.98 };
      }
    }
    // Sunwz|2026-08-06|——END

    if (label.includes(normalizeText("行业类别"))) {
      const candidate = findCandidate(candidates, "work", "industry", record.repeatIndex || 0);
      if (candidate) return { candidate, value: baiduIndustryFor(candidate.value), confidence: 0.98 };
    }

    if (label.includes(normalizeText("目标工作城市"))) {
      const source = firstValue(candidates, "intent", ["preferredCity", "targetCity"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: defaults.targetCity || source.value, confidence: 0.99 };
    }

    if (label.includes(normalizeText("招聘信息来源"))) {
      const source = firstValue(candidates, "other", ["recruitSource"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.96 };
    }

    if (label.includes(normalizeText("可线下面试城市"))) {
      const source = firstValue(candidates, "intent", ["offlineInterviewCity", "interviewCity", "preferredCity", "targetCity"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.96 };
    }

    if (label.includes(normalizeText("是否接受调剂")) || label.includes(normalizeText("服从调剂"))) {
      const source = firstValue(candidates, "intent", ["willingAdjust"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.96 };
    }

    if (label.includes(normalizeText("目标职位类别"))) {
      const source = firstValue(candidates, "intent", ["targetPosition"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: defaults.targetPositionType || "技术", confidence: 0.94 };
    }

    if (label.includes(normalizeText("可面试方式"))) {
      return { candidate: null, value: defaults.interviewOnlineType || "国内远程", confidence: 0.92 };
    }

    if (label.includes(normalizeText("职位年薪"))) {
      const source = firstValue(candidates, "work", ["annualSalary", "salary", "monthlySalary"], record.repeatIndex || 0);
      if (!defaults.salaryRange) {
        return { candidate: source.candidate, value: "", confidence: 0.9, skipReason: "confidential-salary" };
      }
      return { candidate: source.candidate, value: defaults.salaryRange, confidence: 0.9 };
    }

    if (label.includes(normalizeText("工作地点"))) {
      const source = firstValue(candidates, "work", ["city"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: provinceFor(source.value), confidence: 0.88 };
    }

    if (label.includes(normalizeText("开始时间")) || label.includes(normalizeText("结束时间"))) {
      let section = "education";
      if (context.includes(normalizeText("工作"))) section = "work";
      if (context.includes(normalizeText("项目"))) section = "project";
      const key = label.includes(normalizeText("开始")) ? "startDate" : "endDate";
      const candidate = findCandidate(candidates, section, key, record.repeatIndex || 0);
      if (candidate) return { candidate, value: candidate.value, confidence: 0.86 };
    }

    return null;
  }

  function mokaOverride(record, candidates, options) {
    const label = normalizeText(record.label || "");
    const context = normalizeText(record.context || "");
    if (label.includes(normalizeText("职位关键字")) || label.includes(normalizeText("搜索职位")) || context.includes(normalizeText("导航"))) {
      return { ignore: true };
    }
    if (
      label.includes(normalizeText("本人郑重承诺")) ||
      label.includes(normalizeText("同步更新在线简历")) ||
      label.includes(normalizeText("应聘者本人签名")) ||
      label === normalizeText("日期")
    ) {
      return { candidate: null, value: "", confidence: 0.99, skipReason: "requires-user-confirmation" };
    }

    const direct = [
      [["姓名"], "basic", "fullName"],
      [["手机号码", "手机号"], "basic", "phone"],
      [["邮箱"], "basic", "email"],
      [["性别"], "basic", "gender"],
      [["出生日期年龄", "出生日期"], "basic", "birthDate"],
      [["最高学历"], "education", "educationLevel"],
      [["毕业学校"], "education", "school"],
      [["最近毕业专业", "毕业专业"], "education", "major"],
      [["籍贯"], "basic", "nativePlace"],
    ];

    for (const [terms, section, key] of direct) {
      if (terms.some((term) => label.includes(normalizeText(term)))) {
        const candidate = findCandidate(candidates, section, key, record.repeatIndex || 0);
        if (candidate) return { candidate, value: candidate.value, confidence: 0.98 };
      }
    }

    if (label.includes(normalizeText("毕业时间年"))) {
      const candidate = findCandidate(candidates, "education", "endDate", record.repeatIndex || 0);
      return { candidate, value: String(candidate?.value || "").slice(0, 4), confidence: 0.95 };
    }

    if (label.includes(normalizeText("毕业时间月"))) {
      const candidate = findCandidate(candidates, "education", "endDate", record.repeatIndex || 0);
      const month = (String(candidate?.value || "").match(/\d{4}\D?(\d{1,2})/) || [])[1] || "";
      return { candidate, value: month.padStart(2, "0"), confidence: 0.95 };
    }

    // Sunwz|2026-08-12|Moka 专属补充映射：目前所在地、工作经验、最近公司、期望城市、获奖名称
    if (label.includes(normalizeText("目前所在地"))) {
      const source = firstValue(candidates, "basic", ["mailingAddress", "currentCity", "currentAddress"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.95 };
    }

    if (label.includes(normalizeText("工作经验"))) {
      return { candidate: null, value: "2年", confidence: 0.95 };
    }

    if (label.includes(normalizeText("最近公司"))) {
      const source = firstValue(candidates, "internship", ["company"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.95 };
    }

    if (label.includes(normalizeText("期望城市"))) {
      const source = firstValue(candidates, "intent", ["preferredCity", "targetCity"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.95 };
    }

    if (label.includes(normalizeText("奖项名称"))) {
      const source = firstValue(candidates, "awards", ["name"], record.repeatIndex || 0);
      return { candidate: source.candidate, value: source.value, confidence: 0.95 };
    }
    // Sunwz|2026-09-08|Moka 补充映射：实习工作职责、教育字段、日期区间
    // 实习「工作职责/工作内容/实习内容/实习描述」→ internship.description（profile 用「工作内容」key，旧逻辑仅靠 baseScore 别名匹配「工作职责」失败）
    if (label.includes(normalizeText("工作职责")) || label.includes(normalizeText("工作内容")) || label.includes(normalizeText("实习内容")) || label.includes(normalizeText("实习描述"))) {
      const source = firstValue(candidates, "internship", ["description", "result"], record.repeatIndex || 0);
      if (source.value) return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }
    // 教育：学校名称/专业名称/学历（Moka 标签 vs profile 候选 key=school/major/educationLevel）
    if (label.includes(normalizeText("学校名称")) || label.includes(normalizeText("毕业院校"))) {
      const source = firstValue(candidates, "education", ["school"], record.repeatIndex || 0);
      if (source.value) return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }
    if (label.includes(normalizeText("专业名称")) || label.includes(normalizeText("所学专业"))) {
      const source = firstValue(candidates, "education", ["major"], record.repeatIndex || 0);
      if (source.value) return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }
    if (label.includes(normalizeText("学历")) && !label.includes(normalizeText("最高学历"))) {
      let v = String(firstValue(candidates, "education", ["educationLevel"], record.repeatIndex || 0).value || "").trim();
      // Moka 教育条目「学历」下拉选项为 硕士/本科/博士（不含"研究生"后缀），需归一
      if (/硕士/.test(v)) v = "硕士"; else if (/本科/.test(v)) v = "本科"; else if (/博士/.test(v)) v = "博士"; else if (/专科|大专/.test(v)) v = "专科";
      if (v) return { candidate: null, value: v, confidence: 0.98 };
    }
    // 日期：毕业时间/就读时间（教育区间）/获奖时间/起止时间（实习·项目区间）
    const mokaSections = options.profile?.profileV2?.sections || options.profile?.sections || {};
    const mokaItem = (sec, ri) => (mokaSections[sec]?.items || [])[ri || 0]?.values || {};
    if (label.includes(normalizeText("毕业时间"))) {
      const v = String(mokaItem("education", record.repeatIndex || 0)["结束时间"] || "").trim();
      if (v) return { candidate: null, value: v, confidence: 0.96 };
    }
    if (label.includes(normalizeText("就读时间")) || /入学时间|教育开始/.test(label)) {
      const it = mokaItem("education", record.repeatIndex || 0);
      const s = String(it["开始时间"] || "").trim();
      const e = String(it["结束时间"] || "").trim();
      if (s && e) return { candidate: null, value: s + " ~ " + e, confidence: 0.96 };
      if (s) return { candidate: null, value: s, confidence: 0.96 };
    }
    if (label.includes(normalizeText("获奖时间")) || label.includes(normalizeText("奖惩时间"))) {
      const it = mokaItem("awards", record.repeatIndex || 0);
      const v = String(it["奖惩时间"] || it["date"] || "").trim();
      if (v) return { candidate: null, value: v, confidence: 0.96 };
    }
    if (label.includes(normalizeText("起止时间"))) {
      const sec = /项目/.test(context) ? "project" : "internship";
      const it = mokaItem(sec, record.repeatIndex || 0);
      const s = String(it["开始时间"] || it["startDate"] || "").trim();
      const e = String(it["结束时间"] || it["endDate"] || "").trim();
      if (s && e) return { candidate: null, value: s + " ~ " + e, confidence: 0.96 };
      if (s && (/至今|现在|present/i.test(e) || !e)) return { candidate: null, value: s + " ~ 至今", confidence: 0.96 };
      if (s) return { candidate: null, value: s, confidence: 0.96 };
    }
    // Sunwz|2026-09-08|——END
    // Sunwz|2026-08-12|——END

    return null;
  }

  // Sunwz|2026-08-07|BOE phoenix 表单期望税前月薪档位映射（15000以上 → 15000－20000 等）
  function phoenixSalaryRange(value) {
    const text = String(value || "");
    const num = Number((text.match(/\d{4,}/) || [])[0]);
    if (!Number.isFinite(num)) return "";
    if (num <= 10000) return "5000－10000";
    if (num < 15000) return "10000－15000";
    if (num <= 20000) return "15000－20000";
    if (num <= 25000) return "20000－25000";
    if (num <= 30000) return "25000－30000";
    return "30000以上";
  }
  // Sunwz|2026-08-07|——END

  function ebscnSkillSummary() {
    return "熟悉 JavaScript/TypeScript、Vue3/React、Java/Spring Boot、Python/FastAPI、PostGIS/GIS 可视化、RAG/MCP/Agent 工程化。";
  }

  // Sunwz|2026-08-07|BOE 专属映射：修正错误匹配与按用户确认的取值
  function boeOverride(record, candidates, options) {
    const label = normalizeText(record.label || "");
    const context = normalizeText(record.context || "");
    const repeatIndex = record.repeatIndex || 0;
    const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
    const ebscnRegion = "示例城市A茌平区";
    const graduationDate = "2026-06-01";

    const isRelativeContext = context.includes(normalizeText("亲属声明")) ||
      context.includes(normalizeText("亲属信息")) ||
      context.includes(normalizeText("亲属情况"));
    if (isRelativeContext) {
      if (/是否|有无|亲属|亲戚|亲友|应聘单位工作/.test(label)) {
        return { record, candidate: null, value: "否", confidence: 0.98 };
      }
      return { record, candidate: null, value: "", confidence: 0.98, skipReason: "no-relative-info" };
    }

    // Sunwz|2026-09-08|到岗时间：用户手动填，插件跳过（bestechnic/boe 走此路径；之前填固定日期会触发北森日期选择器卡死）
    // 注意：此前误放在 aircasOverride 导致 boe 未生效，本次移入 boeOverride 正确路径。
    if (label.includes(normalizeText("到岗时间")) || label.includes(normalizeText("预计到岗时间")) || label.includes(normalizeText("预计报到时间"))) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "manual-到岗时间" };
    }
    // Sunwz|2026-09-08|工作经历分区直接用实习经历数据填充（用户要求：本人在读无正式工作经历，3 段实习直接填进工作经历）
    // 路由到 profile 的 internship 分区，按 repeatIndex 取对应段（第1/2/3段实习 → 第1/2/3段工作）
    if (context.includes(normalizeText("工作经历")) && !context.includes(normalizeText("实习"))) {
      if (/单位名称|公司名称|企业名称|公司/.test(label)) {
        const source = firstValue(candidates, "internship", ["company"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/职位名称|岗位名称|职务名称|职位/.test(label)) {
        const source = firstValue(candidates, "internship", ["position"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/部门/.test(label)) {
        const source = firstValue(candidates, "internship", ["department"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/工作内容|工作描述|工作职责|职责|业绩|实习内容|实习描述/.test(label)) {
        const source = firstValue(candidates, "internship", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/城市|地点|工作地点|所在城市/.test(label)) {
        const source = firstValue(candidates, "internship", ["city"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/开始时间|起始时间|入职时间|实习开始/.test(label)) {
        const source = firstValue(candidates, "internship", ["startDate", "开始时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      if (/结束时间|截止时间|离职时间|实习结束/.test(label)) {
        const source = firstValue(candidates, "internship", ["endDate", "结束时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.97 };
      }
      // 工作经历其余字段（行业类别、证明人等）本人在读无数据，留空跳过
      return { record, candidate: null, value: "", confidence: 0.9, skipReason: "work-from-internship-unmapped" };
    }
    // Sunwz|2026-09-08|——END

    if (context.includes(normalizeText("\u6559\u80b2\u7ecf\u5386"))) {
      if (label.includes(normalizeText("\u5b66\u6821"))) {
        const source = firstValue(candidates, "education", ["school"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("\u5b66\u5386"))) {
        const source = firstValue(candidates, "education", ["educationLevel"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("\u5b66\u4f4d"))) {
        const source = firstValue(candidates, "education", ["degree"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("\u4e13\u4e1a"))) {
        const source = firstValue(candidates, "education", ["major"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }

    // Sunwz|2026-08-09|光大证券 Zhiye 页面明确值
    if (label.includes(normalizeText("证件照"))) {
      const source = firstValue(candidates, "attachments", ["idPhoto"]);
      return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }
    if (label.includes(normalizeText("毕业时间"))) {
      if (label.includes(normalizeText("年")) && !label.includes(normalizeText("月")) && !label.includes(normalizeText("日"))) {
        return { record, candidate: null, value: "2026", confidence: 0.98 };
      }
      if (label.includes(normalizeText("月"))) {
        return { record, candidate: null, value: "06", confidence: 0.98 };
      }
      if (label.includes(normalizeText("日"))) {
        return { record, candidate: null, value: "01", confidence: 0.98 };
      }
      return { record, candidate: null, value: graduationDate, confidence: 0.98 };
    }
    if (/现居住地|现居住城市|现居城市|户口所在地|户籍所在地|生源地|籍贯/.test(label)) {
      return { record, candidate: null, value: ebscnRegion, confidence: 0.98 };
    }
    if (label.includes(normalizeText("民族"))) {
      return { record, candidate: null, value: "汉族", confidence: 0.98 };
    }
    if (/第一志愿.*(工作地|工作城市|城市)|一志愿.*(工作地|工作城市|城市)/.test(label)) {
      return { record, candidate: null, value: "深圳", confidence: 0.98 };
    }
    if (/第二志愿.*(工作地|工作城市|城市)|二志愿.*(工作地|工作城市|城市)/.test(label)) {
      return { record, candidate: null, value: "上海", confidence: 0.98 };
    }
    if (label.includes(normalizeText("身高"))) {
      const source = firstValue(candidates, "basic", ["height"]).value || "185";
      return { record, candidate: null, value: (String(source).match(/\d+/) || ["185"])[0], confidence: 0.98 };
    }
    if (/亲属|亲戚|亲友|应聘单位工作/.test(label)) {
      if (/姓名|单位|职务|电话|联系方式|关系|说明/.test(label) && !/是否|有无/.test(label)) {
        return { record, candidate: null, value: "", confidence: 0.98, skipReason: "no-relative-info" };
      }
      return { record, candidate: null, value: "否", confidence: 0.98 };
    }
    if (label.includes(normalizeText("兴趣爱好")) || label === normalizeText("兴趣")) {
      return { record, candidate: null, value: "编程、羽毛球", confidence: 0.98 };
    }
    if (label === normalizeText("特长") || label.includes(normalizeText("专业特长"))) {
      return { record, candidate: null, value: "AI编程、Agent开发、RAG工程、全栈开发、GIS可视化、技术文档写作", confidence: 0.98 };
    }
    if (label.includes(normalizeText("专业技能")) || label.includes(normalizeText("技能特长"))) {
      return { record, candidate: null, value: ebscnSkillSummary(), confidence: 0.98 };
    }
    if (/实习地点|实习城市/.test(label) || (context.includes(normalizeText("实习经历")) && /工作地点|地点|城市/.test(label))) {
      const source = firstValue(candidates, "internship", ["city"], repeatIndex);
      return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }
    if (context.includes(normalizeText("实习经历"))) {
      if (/单位名称|公司名称|企业名称/.test(label)) {
        const source = firstValue(candidates, "internship", ["company"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/职位名称|岗位名称|实习岗位|实习职位/.test(label)) {
        const source = firstValue(candidates, "internship", ["position"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/部门/.test(label)) {
        const source = firstValue(candidates, "internship", ["department"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/工作内容|实习内容|实习描述|职责/.test(label)) {
        const source = firstValue(candidates, "internship", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      // Sunwz|2026-08-24|实习起止时间：开始时间→startDate，结束时间→endDate
      if (/开始时间|起始时间|入职时间|实习开始/.test(label)) {
        const source = firstValue(candidates, "internship", ["startDate", "开始时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/结束时间|截止时间|实习结束/.test(label)) {
        const source = firstValue(candidates, "internship", ["endDate", "结束时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }
    if (context.includes(normalizeText("在校职务"))) {
      if (/开始时间|起始时间|任职开始/.test(label)) {
        const source = firstValue(candidates, "studentOfficer", ["startDate"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/结束时间|截止时间|任职结束/.test(label)) {
        const source = firstValue(candidates, "studentOfficer", ["endDate"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/职务名称|在校职务名称|担任职务|组织名称/.test(label)) {
        const source = firstValue(candidates, "studentOfficer", ["organization"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/在校职务类别|职务类别|类别/.test(label)) {
        return { record, candidate: null, value: "学生干部", confidence: 0.98 };
      }
      if (/级别/.test(label)) {
        const source = firstValue(candidates, "studentOfficer", ["organization"], repeatIndex);
        const value = /院学生会|学院|院/.test(String(source.value || "")) ? "院级" : "校级";
        return { candidate: source.candidate, value, confidence: 0.98 };
      }
      if (/描述|工作内容|本人职责|职责/.test(label)) {
        const source = firstValue(candidates, "studentOfficer", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }
    if (context.includes(normalizeText("在校实践")) || context.includes(normalizeText("校园经历")) || context.includes(normalizeText("社团"))) {
      if (/开始时间|起始时间/.test(label)) {
        const source = firstValue(candidates, "student", ["startDate"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/结束时间|截止时间/.test(label)) {
        const source = firstValue(candidates, "student", ["endDate"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/社团名称|组织名称|实践名称|活动名称/.test(label)) {
        const source = firstValue(candidates, "student", ["organization"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/职务|职位|角色/.test(label)) {
        const source = firstValue(candidates, "student", ["role"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/工作内容|本人职责|描述|实践内容/.test(label)) {
        const source = firstValue(candidates, "student", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }
    // Sunwz|2026-08-09|——END

    // 论文区（无发表论文）整体跳过，禁止"名称"被误填成姓名
    if (/论文|期刊|作者顺序|期次|发布/.test(context)) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-papers" };
    }

    // 推荐人/内推码/导师：资料没有 → 留空
    if (/推荐人|内推码/.test(label)) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-referrer-info" };
    }
    if (label === normalizeText("导师")) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-tutor-info" };
    }

    // 其他语言能力及等级/分数：英语已由"英语等级+英语等级成绩"表达 → 留空
    if (label.includes(normalizeText("其他语言"))) {
      return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-other-language" };
    }

    // 专业细分方向 → 硕士研究方向（卫星定位与导航）
    if (label.includes(normalizeText("专业细分方向"))) {
      const research = firstValue(candidates, "education", ["research"], 0).value;
      return { record, candidate: null, value: research || "卫星定位与导航", confidence: 0.95 };
    }

    // 本科毕业院校 → 本科（第2条教育经历）学校
    if (label.includes(normalizeText("本科毕业院校"))) {
      const school = firstValue(candidates, "education", ["school"], 1).value;
      return { record, candidate: null, value: school, confidence: 0.95 };
    }

    // 英语等级 → 四级；英语等级成绩 → 语言成绩 466
    if (label.includes(normalizeText("英语等级")) && !label.includes(normalizeText("其他"))) {
      if (label.includes(normalizeText("成绩")) || label.includes(normalizeText("分数"))) {
        const score = firstValue(candidates, "language", ["score"]).value ||
          firstValue(candidates, "certificates", ["score"]).value || "466";
        return { record, candidate: null, value: score, confidence: 0.95 };
      }
      return { record, candidate: null, value: "四级", confidence: 0.95 };
    }

    // 学院名称 → 教育经历 college（按行号对应硕士/本科）
    if (label.includes(normalizeText("学院名称"))) {
      const college = firstValue(candidates, "education", ["college"], repeatIndex).value;
      if (college) return { record, candidate: null, value: college, confidence: 0.95 };
    }

    // 获奖级别：值映射（省级→省市级、校级→院校级）
    if (label.includes(normalizeText("获奖级别")) || label.includes(normalizeText("奖励等级"))) {
      const level = firstValue(candidates, "awards", ["level"], repeatIndex).value;
      return { record, candidate: null, value: String(level || "").replace("省级", "省市级").replace("校级", "院校级"), confidence: 0.95 };
    }

    // 期望税前月薪：15000以上 → 15000－20000 档
    if (label.includes(normalizeText("期望税前月薪")) || label.includes(normalizeText("期望月薪"))) {
      const salary = firstValue(candidates, "intent", ["expectedSalary"]).value;
      return { record, candidate: null, value: phoenixSalaryRange(salary), confidence: 0.95 };
    }

    // 招聘渠道/信息来源 → 官网（用户规则：以后类似问题一律选官网）；备注栏留空
    if (/渠道|信息来源|招聘来源/.test(label)) {
      if (label.includes(normalizeText("备注"))) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "channel-remark" };
      }
      return { record, candidate: null, value: "BOE官网/ BOE招聘官方微信公众号", confidence: 0.95 };
    }

    // 在读专业类别 → 电子类（用户确认）
    if (label.includes(normalizeText("专业类别"))) {
      return { record, candidate: null, value: "电子类", confidence: 0.95 };
    }

    // 海外院校毕业 → 否
    if (label.includes(normalizeText("海外院校")) || label.includes(normalizeText("海外"))) {
      return { record, candidate: null, value: "否", confidence: 0.95 };
    }

    // 色盲/色弱 → 无
    if (label.includes(normalizeText("色盲")) || label.includes(normalizeText("色弱"))) {
      return { record, candidate: null, value: "无", confidence: 0.95 };
    }

    // 第二志愿岗位 → 研发类（用户确认）
    if (label.includes(normalizeText("第二志愿城市"))) {
      return { record, candidate: null, value: "上海", confidence: 0.95 };
    }
    if (label.includes(normalizeText("第二志愿岗位"))) {
      return { record, candidate: null, value: "研发类", confidence: 0.95 };
    }

    // 毕业时间（年）/（月）→ 从硕士结束时间拆出
    if (label.includes(normalizeText("毕业时间")) && (label.includes(normalizeText("年")) || label.includes(normalizeText("月")))) {
      const endDate = firstValue(candidates, "education", ["endDate"], 0).value;
      const parts = String(endDate || "").match(/((?:19|20)\d{2})\D?(\d{1,2})?/);
      if (parts && parts[1]) {
        if (label.includes(normalizeText("年")) && !label.includes(normalizeText("月"))) {
          return { record, candidate: null, value: parts[1], confidence: 0.95 };
        }
        if (label.includes(normalizeText("月")) && parts[2]) {
          return { record, candidate: null, value: String(Number(parts[2])), confidence: 0.95 };
        }
      }
    }

    // Sunwz|2026-08-13|snowman.zhiye.com（北森/Beisen 平台）专属字段映射
    // 个人信息：身高(厘米)/体重(公斤) 等 snowman 专属标签
    if (label.includes(normalizeText("身高"))) {
      const source = firstValue(candidates, "basic", ["height"]).value;
      return { record, candidate: null, value: (String(source).match(/\d+/) || ["185"])[0], confidence: 0.98 };
    }
    if (label.includes(normalizeText("体重"))) {
      const source = firstValue(candidates, "basic", ["weight"]).value;
      return { record, candidate: null, value: (String(source).match(/\d+/) || [""])[0], confidence: 0.95 };
    }
    if (label.includes(normalizeText("工作年限"))) {
      // Sunwz|2026-08-13|snowman 工作年限：默认应届
      const source = firstValue(candidates, "basic", ["workYears"]).value || "应届";
      return { record, candidate: null, value: source, confidence: 0.95 };
    }

    // 家庭情况分区
    // Sunwz|2026-08-13|snowman 家庭情况默认值（用户确认：孙法忠/父亲/务农/陶桥村，杨俊英/母亲/务农/陶桥村）
    if (context.includes(normalizeText("家庭"))) {
      const familyDefaults = [
        { name: "孙法忠", relation: "父亲", workUnit: "务农", position: "务农", location: "示例城市A茌平区胡屯镇陶桥村" },
        { name: "杨俊英", relation: "母亲", workUnit: "务农", position: "务农", location: "示例城市A茌平区胡屯镇陶桥村" },
      ];
      const fam = familyDefaults[repeatIndex] || familyDefaults[0];
      if (label.includes(normalizeText("姓名"))) {
        const source = firstValue(candidates, "family", ["name"], repeatIndex);
        return { candidate: source.candidate, value: source.value || fam.name, confidence: 0.98 };
      }
      if (label.includes(normalizeText("与本人关系"))) {
        const source = firstValue(candidates, "family", ["relation"], repeatIndex);
        return { candidate: source.candidate, value: source.value || fam.relation, confidence: 0.98 };
      }
      if (label.includes(normalizeText("工作单位"))) {
        const source = firstValue(candidates, "family", ["workUnit"], repeatIndex);
        return { candidate: source.candidate, value: source.value || fam.workUnit, confidence: 0.98 };
      }
      if (label.includes(normalizeText("职务")) && !/在校职务|职位描述/.test(label)) {
        const source = firstValue(candidates, "family", ["position"], repeatIndex);
        return { candidate: source.candidate, value: source.value || fam.position, confidence: 0.95 };
      }
      if (label.includes(normalizeText("所在地"))) {
        const source = firstValue(candidates, "family", ["location"], repeatIndex);
        return { candidate: source.candidate, value: source.value || fam.location, confidence: 0.95 };
      }
    }
    // Sunwz|2026-08-13|——END

    // 求职意向分区
    if (context.includes(normalizeText("意向")) || context.includes(normalizeText("应聘"))) {
      if (label.includes(normalizeText("应聘岗位"))) {
        const source = firstValue(candidates, "intent", ["targetPosition", "position"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("期望从事职业"))) {
        const source = firstValue(candidates, "intent", ["targetPosition", "position"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (label.includes(normalizeText("期望工作城市"))) {
        const source = firstValue(candidates, "intent", ["preferredCity", "targetCity"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/期望月薪|税前月薪/.test(label)) {
        const salary = firstValue(candidates, "intent", ["expectedSalary"]).value;
        return { record, candidate: null, value: phoenixSalaryRange(salary), confidence: 0.95 };
      }
      if (label.includes(normalizeText("期望年薪"))) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "confidential-salary" };
      }
      if (label.includes(normalizeText("求职状态"))) {
        return { record, candidate: null, value: "应届生", confidence: 0.95 };
      }
      if (label.includes(normalizeText("预计报到时间"))) {
        // Sunwz|2026-08-13|snowman 预计报到时间默认值（用户确认：一周内）
        const source = firstValue(candidates, "intent", ["arrivalDate", "startDate"]).value;
        return { candidate: source.candidate, value: source.value || "一周内", confidence: 0.95 };
      }
      if (/是否接受岗位调剂|服从调剂/.test(label)) {
        const source = firstValue(candidates, "intent", ["willingAdjust"]).value;
        return { record, candidate: null, value: source, confidence: 0.95 };
      }
      if (label.includes(normalizeText("出差出国意向"))) {
        return { record, candidate: null, value: "否", confidence: 0.95 };
      }
    }

    // Sunwz|2026-08-14|vivo 教育经历：学校名称/专业名称/成绩(GPA)/学习形式/导师/实验室/学院名称
    if (context.includes(normalizeText("教育"))) {
      if (label.includes(normalizeText("学校名称"))) {
        const source = firstValue(candidates, "education", ["school"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("专业名称"))) {
        const source = firstValue(candidates, "education", ["major"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("成绩")) && label.includes(normalizeText("GPA"))) {
        const source = firstValue(candidates, "education", ["gpa"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (label.includes(normalizeText("学习形式"))) {
        const source = firstValue(candidates, "education", ["studyType", "studyForm"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/导师|导师姓名/.test(label)) {
        const source = firstValue(candidates, "education", ["tutor", "导师", "导师姓名"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/实验室/.test(label)) {
        const source = firstValue(candidates, "education", ["laboratory", "实验室", "实验室名称"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/学院名称|所在院系|院系/.test(label)) {
        const source = firstValue(candidates, "education", ["college", "学院", "所在院系"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      // Sunwz|2026-08-24|教育学制起止时间：开始时间→入学，结束时间→毕业
      if (/开始时间|起始时间|入学时间/.test(label)) {
        const source = firstValue(candidates, "education", ["startDate", "入学时间", "开始时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/结束时间|截止时间|毕业时间/.test(label)) {
        const source = firstValue(candidates, "education", ["endDate", "毕业时间", "结束时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }
    // Sunwz|2026-08-14|——END

    // 实习经历：snowman 用"单位名称/实习内容"
    if (context.includes(normalizeText("实习"))) {
      if (label.includes(normalizeText("单位名称"))) {
        const source = firstValue(candidates, "internship", ["company"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("实习内容"))) {
        const source = firstValue(candidates, "internship", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }

    // 项目经历：snowman/vivo 用"项目名称/项目描述/项目职责/职务"；profile 字段：项目名称/项目内容/本人职责/职位
    if (context.includes(normalizeText("项目"))) {
      if (label.includes(normalizeText("项目名称"))) {
        const source = firstValue(candidates, "project", ["name", "项目名称"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("项目描述")) || label.includes(normalizeText("项目职责"))) {
        const source = firstValue(candidates, "project", ["description", "项目内容", "本人职责"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("职务")) && !/在校职务|职位描述/.test(label)) {
        const source = firstValue(candidates, "project", ["role", "职位"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      // Sunwz|2026-08-24|项目起止时间
      if (/开始时间|起始时间|项目开始/.test(label)) {
        const source = firstValue(candidates, "project", ["startDate", "开始时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/结束时间|截止时间|项目结束/.test(label)) {
        const source = firstValue(candidates, "project", ["endDate", "结束时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      // Sunwz|2026-09-08|项目参与人数：profile project.memberCount（bestechnic 项目卡"添加项目"后渲染的字段）
      if (/参与人数|项目人数|团队规模|项目人数规模/.test(label)) {
        const source = firstValue(candidates, "project", ["memberCount", "参与人数"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
    }

    // 在校职务：snowman 用"职务名称/职务描述"
    if (context.includes(normalizeText("在校职务"))) {
      if (label.includes(normalizeText("职务描述"))) {
        const source = firstValue(candidates, "studentOfficer", ["description"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }

    // 语言能力：snowman 用"语言类型/掌握程度/听说/读写"
    if (context.includes(normalizeText("语言"))) {
      // Sunwz|2026-08-13|snowman 语言能力默认值（用户确认：良好）
      if (label.includes(normalizeText("语言类型")) || label.includes(normalizeText("外语种类"))) {
        const source = firstValue(candidates, "language", ["language"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (label.includes(normalizeText("掌握程度"))) {
        const source = firstValue(candidates, "language", ["proficiency"], repeatIndex);
        return { candidate: source.candidate, value: source.value || "良好", confidence: 0.95 };
      }
      if (label.includes(normalizeText("听说"))) {
        const source = firstValue(candidates, "language", ["listening", "speaking"], repeatIndex);
        return { candidate: source.candidate, value: source.value || "良好", confidence: 0.95 };
      }
      if (label.includes(normalizeText("读写"))) {
        const source = firstValue(candidates, "language", ["reading", "writing"], repeatIndex);
        return { candidate: source.candidate, value: source.value || "良好", confidence: 0.95 };
      }
      // Sunwz|2026-08-13|——END
    }

    // 其他信息：snowman 用"兴趣爱好/特长/何处得知招聘信息/自我评价"等
    if (context.includes(normalizeText("其他"))) {
      if (label.includes(normalizeText("兴趣爱好"))) {
        const source = firstValue(candidates, "basic", ["hobbies"]).value || firstValue(candidates, "other", ["hobbies"]).value;
        return { record, candidate: null, value: source || "编程、羽毛球", confidence: 0.95 };
      }
      if (label === normalizeText("特长") || label.includes(normalizeText("特长"))) {
        return { record, candidate: null, value: "AI编程、Agent开发、RAG工程、全栈开发、GIS可视化、技术文档写作", confidence: 0.95 };
      }
      if (label.includes(normalizeText("何处得知招聘信息"))) {
        return { record, candidate: null, value: "人才网站（智联、boss、猎聘等）", confidence: 0.95 };
      }
      if (label.includes(normalizeText("自我评价"))) {
        const source = firstValue(candidates, "self", ["selfEvaluation", "selfDescription"]).value;
        return { record, candidate: null, value: source, confidence: 0.95 };
      }
      if (label.includes(normalizeText("获奖信息"))) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "awards-in-other-section" };
      }
      if (label.includes(normalizeText("职称及职业资格证书"))) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-certificate-title" };
      }
      if (label.includes(normalizeText("其他外语水平"))) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-other-language" };
      }
    }

    // 附件分区
    if (context.includes(normalizeText("附件"))) {
      if (label.includes(normalizeText("简历附件"))) {
        const source = firstValue(candidates, "attachments", ["resumeFile"]);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }
    // Sunwz|2026-08-13|——END

    // Sunwz|2026-08-14|vivo-campus.vivo.com 专属字段映射
    // 证书分区（英语证书名称/成绩/获得时间 或 证书名称/获得时间）
    if (context.includes(normalizeText("证书")) || context.includes(normalizeText("英语证书"))) {
      if (/证书名称|英语证书名称/.test(label)) {
        const source = firstValue(candidates, "certificates", ["name", "证书名称"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/成绩|分数/.test(label)) {
        const source = firstValue(candidates, "certificates", ["score", "成绩"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/获得时间|发证日期|获取时间/.test(label)) {
        const source = firstValue(candidates, "certificates", ["date", "获得时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/证书类型/.test(label)) {
        const source = firstValue(candidates, "certificates", ["type", "证书类型"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/证书描述|描述/.test(label)) {
        return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-cert-description" };
      }
    }

    // 计算机能力分区（编程语言+掌握程度）
    if (context.includes(normalizeText("计算机"))) {
      if (/编程语言|语言/.test(label)) {
        const source = firstValue(candidates, "computer", ["language", "编程语言", "name"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/掌握程度|熟练程度/.test(label)) {
        const source = firstValue(candidates, "computer", ["proficiency", "掌握程度", "level"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
    }

    // 自我评价分区（vivo: 评价内容）
    if (context.includes(normalizeText("自我评价"))) {
      if (/评价内容|自我评价|描述/.test(label)) {
        const source = firstValue(candidates, "self", ["selfEvaluation", "自我评价", "selfDescription"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
    }

    // 获奖经历分区（vivo: 奖项名称/获奖时间/获奖级别/颁奖单位）
    if (context.includes(normalizeText("获奖"))) {
      if (/奖项名称|奖惩名称|获奖名称|获奖项/.test(label)) {
        const source = firstValue(candidates, "awards", ["name", "奖项名称", "奖惩名称"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.98 };
      }
      if (/获奖时间|奖惩时间|获得时间/.test(label)) {
        const source = firstValue(candidates, "awards", ["date", "获奖时间", "奖惩时间"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/获奖级别|奖励等级/.test(label)) {
        const source = firstValue(candidates, "awards", ["level", "获奖级别", "奖励等级"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/颁奖单位|授予单位/.test(label)) {
        const source = firstValue(candidates, "awards", ["issuer", "颁奖单位"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
      if (/获奖描述|奖惩描述|描述/.test(label)) {
        const source = firstValue(candidates, "awards", ["description", "获奖描述", "奖惩描述"], repeatIndex);
        return { candidate: source.candidate, value: source.value, confidence: 0.95 };
      }
    }
    // Sunwz|2026-08-14|——END

    return null;
  }
  // Sunwz|2026-08-07|——END

  // Sunwz|2026-08-07|AIRCAS（空天院招聘，Bootstrap 表单）专属映射
  function aircasOverride(record, candidates, options) {
    const label = normalizeText(record.label || "");
    const name = String(record.name || "");

    // 协议/承诺 checkbox → 勾选（提交所需）
    if (/本人承诺|承诺属实|信息属实/.test(label)) return { record, candidate: null, value: "是", confidence: 0.95 };
    if (/同意隐私|隐私协议|隐私政策/.test(label)) return { record, candidate: null, value: "是", confidence: 0.95 };

    // 户口类型 → 家庭户（用户确认）；户口所在地 → 户籍
    if (label.includes(normalizeText("户口类型"))) return { record, candidate: null, value: "家庭户", confidence: 0.95 };
    if (label.includes(normalizeText("户口所在地"))) {
      const place = firstValue(candidates, "basic", ["nativePlace"]).value;
      return { record, candidate: null, value: place, confidence: 0.95 };
    }

    // 是否有留学/海外经历 → 否
    if (/留学|海外学习|海外工作/.test(label)) return { record, candidate: null, value: "否", confidence: 0.95 };

    // 期望薪水 → 期望月薪（避免误取实习薪资"保密"）
    if (label.includes(normalizeText("期望薪水")) || label.includes(normalizeText("期望薪资"))) {
      const v = firstValue(candidates, "intent", ["expectedSalary"]).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 论文/专利相关计数 → 0（资料无论文无专利）
    if (/发表文章|SCI|EI|核心期刊|作者排名|专利|篇数|个数|排名/.test(label)) {
      return { record, candidate: null, value: "0", confidence: 0.95 };
    }

    // 是否有亲戚或朋友在科学院 → 否
    if (/亲戚|科学院/.test(label)) return { record, candidate: null, value: "否", confidence: 0.95 };

    // 招聘来源 → 网络（用户确认，无官网选项）
    if (label.includes(normalizeText("来源"))) return { record, candidate: null, value: "网络", confidence: 0.95 };

    // Sunwz|2026-09-08|到岗时间：用户手动填，插件跳过（之前填固定日期会触发北森日期选择器卡死）
    if (label.includes(normalizeText("到岗时间"))) return { record, candidate: null, value: "", confidence: 0.95, skipReason: "manual-到岗时间" };

    // 猎码 → 留空；职业定位 → Agent开发工程师（用户确认）；其他 → 留空
    if (/猎码/.test(label)) return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-hunt-code" };
    if (/职业定位/.test(label)) return { record, candidate: null, value: "Agent开发工程师", confidence: 0.95 };
    if (label === normalizeText("其他")) return { record, candidate: null, value: "", confidence: 0.95, skipReason: "no-other-info" };

    // 两个"介绍信息"：获奖情况（winJieShao）→ 获奖汇总；项目情况（complateJieShao）→ 项目经历汇总
    if (label.includes(normalizeText("介绍信息"))) {
      const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
      if (name === "winJieShao") {
        const awards = (sections.awards?.items || []).map((item) => {
          const v = item.values || {};
          const t = v["奖惩名称"] || v["奖项名称"] || "";
          const d = v["奖惩时间"] || v["获奖时间"] || "";
          return d ? `${t}（${d}）` : t;
        }).filter(Boolean);
        return { record, candidate: null, value: awards.join("；"), confidence: 0.95 };
      }
      if (name === "complateJieShao") {
        const projects = (sections.project?.items || []).map((item) => {
          const v = item.values || {};
          const n = v["项目名称"] || "";
          const s = v["开始时间"] || "";
          const e = v["结束时间"] || "";
          const desc = v["项目内容"] || v["项目成果"] || "";
          const period = s && e ? `${s}~${e}` : s || e;
          const head = period ? `${n}（${period}）` : n;
          return desc ? `${head}：${desc}` : head;
        }).filter(Boolean);
        return { record, candidate: null, value: projects.join("\n"), confidence: 0.95 };
      }
    }

    return null;
  }
  // Sunwz|2026-08-07|——END

  // Sunwz|2026-08-07|飞书招聘（ud-formily）专属映射
  function feishuOverride(record, candidates, options) {
    const label = normalizeText(record.label || "");
    const context = normalizeText(record.context || "");
    const rawContext = String(record.context || "");
    const hasContext = (text) => rawContext.includes(text) || context.includes(normalizeText(text));
    const isInternshipContext = hasContext("\u5b9e\u4e60");
    const isWorkContext = hasContext("\u5de5\u4f5c") && !isInternshipContext;
    const isProjectContext = hasContext("\u9879\u76ee") || hasContext("\u8bfe\u9898");
    const isAwardContext = hasContext("\u83b7\u5956") || hasContext("\u5956\u9879") || hasContext("\u5956\u60e9") || hasContext("\u8363\u8a89");
    const skipWorkExperience = () => ({ record, candidate: null, value: "", confidence: 0.95, skipReason: "no-work-experience" });

    // 推荐方式 → 无（资料无内推码）
    if (label.includes(normalizeText("推荐方式"))) return { record, candidate: null, value: "无", confidence: 0.95 };

    // 没有工作经历 checkbox → 勾选（应届生）
    if (label.includes(normalizeText("没有工作经历"))) return { record, candidate: null, value: "是", confidence: 0.95 };

    // 隐私/承诺 checkbox → 勾选（提交所需）
    if (/隐私|同意|承诺/.test(label)) return { record, candidate: null, value: "是", confidence: 0.95 };

    const ri = record.repeatIndex || 0;
    const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
    const workField = [
      "\u516c\u53f8\u540d\u79f0",
      "\u4f01\u4e1a\u540d\u79f0",
      "\u5355\u4f4d\u540d\u79f0",
      "\u804c\u4f4d\u540d\u79f0",
      "\u5c97\u4f4d\u540d\u79f0",
      "\u8d77\u6b62\u65f6\u95f4",
      "\u63cf\u8ff0",
    ].some((text) => label.includes(normalizeText(text)));
    if (isWorkContext && workField) return skipWorkExperience();

    // 公司名称 → internship.company[ri]
    if (label.includes(normalizeText("公司名称"))) {
      const v = firstValue(candidates, "internship", ["company"], ri).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 职位名称 → internship.position[ri]
    if (label.includes(normalizeText("职位名称"))) {
      const v = firstValue(candidates, "internship", ["position"], ri).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 项目名称 → project.name[ri]
    if (label.includes(normalizeText("项目名称"))) {
      const v = firstValue(candidates, "project", ["name"], ri).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 项目角色 → project.role[ri]
    if (label.includes(normalizeText("项目角色"))) {
      const v = firstValue(candidates, "project", ["role"], ri).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 获奖名称 → awards.name[ri]
    if (label.includes(normalizeText("获奖名称"))) {
      const v = firstValue(candidates, "awards", ["name"], ri).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // 意向城市 → 期望城市首选（深圳）
    if (label.includes(normalizeText("意向城市"))) {
      const city = firstValue(candidates, "intent", ["preferredCity"]).value ||
        firstValue(candidates, "intent", ["targetCity"]).value;
      return { record, candidate: null, value: city, confidence: 0.95 };
    }

    // 起止时间：repeatIndex = 卡片序号 * 2 + 卡片内开始/结束序号
    if (label.includes(normalizeText("起止时间"))) {
      let section = "education";
      if (/实习/.test(record.context || "")) section = "internship";
      else if (/项目/.test(record.context || "")) section = "project";
      else if (/获奖/.test(record.context || "")) section = "awards";
      const items = sections[section]?.items || [];
      const itemIdx = Math.floor(ri / 2);
      const item = items[itemIdx]?.values || {};
      const key = ri % 2 === 0 ? "开始时间" : "结束时间";
      return { record, candidate: null, value: item[key] || "", confidence: 0.95 };
    }

    // 描述（实习/项目/获奖通用）→ 对应分区的 description[ri]
    if (label.includes(normalizeText("描述"))) {
      const context = record.context || "";
      let section = "internship";
      if (/项目/.test(context)) section = "project";
      else if (/获奖/.test(context)) section = "awards";
      const items = sections[section]?.items || [];
      const item = items[ri]?.values || {};
      const desc = item["描述"] || item["工作内容"] || item["项目内容"] || item["项目描述"] || item["奖惩描述"] || item["获奖描述"] || "";
      return { record, candidate: null, value: desc, confidence: 0.95 };
    }

    // 获奖时间 → awards.date[ri]
    if (label.includes(normalizeText("获奖时间"))) {
      const items = sections.awards?.items || [];
      const item = items[ri]?.values || {};
      return { record, candidate: null, value: item["获奖时间"] || item["奖惩时间"] || "", confidence: 0.95 };
    }

    if (context.includes(normalizeText("\u6559\u80b2\u7ecf\u5386")) && label.includes(normalizeText("\u5b66\u4f4d"))) {
      const source = firstValue(candidates, "education", ["degree"], repeatIndex);
      return { candidate: source.candidate, value: source.value, confidence: 0.98 };
    }

    // 学历 → educationLevel（硕士/本科）；由 feishuFillSelect 处理
    if (label.includes(normalizeText("学历"))) {
      const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
      const items = sections.education?.items || [];
      const idx = record.repeatIndex || 0;
      const item = items[idx]?.values || {};
      return { record, candidate: null, value: item["学历"] || "", confidence: 0.95 };
    }

    // 自我评价 → selfDescription
    if (label.includes(normalizeText("自我评价"))) {
      const v = firstValue(candidates, "self", ["selfDescription"]).value;
      return { record, candidate: null, value: v, confidence: 0.95 };
    }

    // Sunwz|2026-08-08|语言能力 → language 条目（按 repeatIndex）
    // 飞书语言卡片有两个下拉："语言"（语种）和"精通程度"（掌握程度），分别映射
    if (label.includes(normalizeText("语言")) || label.includes(normalizeText("语种"))) {
      const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
      const items = sections.language?.items || [];
      const idx = record.repeatIndex || 0;
      const item = items[idx]?.values || {};
      const lang = item["外语种类"] || item["语言"] || "";
      return { record, candidate: null, value: lang, confidence: 0.95 };
    }
    if (label.includes(normalizeText("精通程度")) || label.includes(normalizeText("掌握程度"))) {
      const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
      const items = sections.language?.items || [];
      const idx = record.repeatIndex || 0;
      const item = items[idx]?.values || {};
      const level = item["掌握程度"] || item["精通程度"] || "";
      return { record, candidate: null, value: level, confidence: 0.95 };
    }
    // Sunwz|2026-08-08|——END

    return null;
  }
  // Sunwz|2026-08-07|——END

  // Sunwz|2026-08-09|Hotjob/Wecruit（hotjob.cn）通用简历页：按分区和重复行号精确映射
  function hotjobOverride(record, candidates, options) {
    const rawLabel = String(record.label || "");
    const rawContext = String(record.context || "");
    const label = normalizeText(rawLabel);
    const context = normalizeText(rawContext);
    const ri = record.repeatIndex || 0;

    const labelHas = (terms) => terms.some((term) => rawLabel.includes(term) || label.includes(normalizeText(term)));
    const contextHas = (terms) => terms.some((term) => rawContext.includes(term) || context.includes(normalizeText(term)));
    const pick = (section, keys, confidence = 0.96) => {
      const source = firstValue(candidates, section, keys, ri);
      if (!source.value) return null;
      return { candidate: source.candidate, value: source.value, confidence };
    };
    const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
    const directValue = (section, keys, repeatIndex = ri) => {
      const item = (sections[section]?.items || [])[repeatIndex];
      const values = item?.values || {};
      for (const key of keys) {
        const value = values[key];
        if (String(value || "").trim()) return String(value).trim();
      }
      return "";
    };
    const directCandidate = (section, keys, confidence = 0.96, repeatIndex = ri) => {
      const value = directValue(section, keys, repeatIndex);
      if (!value) return null;
      return { candidate: null, value, confidence };
    };
    const hotjobAdjustCandidate = () => {
      const source = firstValue(candidates, "intent", ["willingAdjust"], ri);
      const raw = String(source.value || "").trim();
      if (!raw) return null;
      const value = /^(否|不|no|false|0)$/i.test(raw) || /不接受|不服从/.test(raw) ? "不接受" : "接受";
      return { candidate: source.candidate, value, confidence: 0.98 };
    };

    if (labelHas(["隐私", "同意", "承诺", "信息真实", "本人声明"])) {
      return { candidate: null, value: "是", confidence: 0.95 };
    }

    let section = "";
    if (contextHas(["教育", "学校", "学历", "院校"])) section = "education";
    else if (contextHas(["实习"])) section = "internship";
    else if (contextHas(["工作"])) section = "work";
    else if (contextHas(["项目", "课题", "实践项目", "科研"])) section = "project";
    else if (contextHas(["获奖", "奖项", "奖惩", "荣誉"])) section = "awards";
    else if (contextHas(["获得证书", "证书情况", "证书名称"])) section = "certificates";
    else if (contextHas(["英语", "语言", "外语"])) section = "language";
    else if (contextHas(["计算机技能", "技能类别", "专业技能"])) section = "computer";
    else if (contextHas(["家庭", "亲属", "社会关系"])) section = "family";
    else if (contextHas(["健康状况", "病史", "精神疾病", "传染性"])) section = "health";
    else if (contextHas(["自我评价", "评价内容"])) section = "self";
    else if (contextHas(["在校职务", "学生干部"])) section = "studentOfficer";
    else if (contextHas(["校内外社会实践", "校园", "社团", "在校实践"])) section = "student";
    else if (contextHas(["求职意向", "应聘意向", "期望"])) section = "intent";
    else if (contextHas(["基本信息", "个人信息"])) section = "basic";

    if (section === "work" && labelHas(["公司", "企业", "单位", "职位", "岗位", "部门", "行业", "地点", "城市", "工作描述", "工作内容", "职责", "开始", "结束", "起止"])) {
      return { candidate: null, value: "", confidence: 0.95, skipReason: "no-work-experience" };
    }

    if (section === "education") {
      if (labelHas(["学校", "院校", "毕业院校"])) return pick("education", ["school"], 0.98);
      if (labelHas(["学历", "学历层次", "最高学历"])) return pick("education", ["educationLevel"], 0.98);
      if (labelHas(["学位"])) return pick("education", ["degree"], 0.98);
      // Sunwz|2026-08-25|奥比中光：教育经历里有"学习形式/学习方式/全日制/非全日制"独立控件，
      // 旧逻辑只命中"是否全日制"门控，没覆盖"学习形式"独立 select
      if (labelHas(["学习形式", "学习方式", "全日制"])) {
        const direct = pick("education", ["studyType"], 0.98);
        if (direct) return direct;
        return { candidate: null, value: /非全|否/.test(String(direct?.value || "")) ? "否" : "是", confidence: 0.95, skipReason: "no-study-type" };
      }
      if (labelHas(["专业", "所学专业"])) return pick("education", ["major"], 0.98);
      if (labelHas(["学院", "院系", "所在院系"])) return pick("education", ["college"], 0.96);
      if (labelHas(["研究方向", "研究课题", "课题方向"])) return pick("education", ["research"], 0.94);
      if (labelHas(["专业课程", "主修课程", "核心课程", "课程"])) return pick("education", ["courses"], 0.94);
      if (labelHas(["毕业论文", "毕业设计", "毕设"])) return pick("education", ["thesis"], 0.92);
      if (labelHas(["学号"])) return pick("education", ["studentNo"], 0.94);
      if (labelHas(["导师", "导师姓名", "指导老师"])) return pick("education", ["tutor"], 0.94);
      if (labelHas(["实验室"])) return pick("education", ["laboratory"], 0.94);
      if (labelHas(["成绩", "GPA", "绩点"])) return pick("education", ["gpa", "score"], 0.94);
      if (labelHas(["排名"])) return pick("education", ["rank"], 0.94);
      if (labelHas(["挂科数", "挂科"])) return pick("education", ["failCount"], 0.94);
      if (labelHas(["GPA类型", "绩点类型"])) return pick("education", ["gpaType"], 0.94);
      if (labelHas(["开始", "入学"])) return pick("education", ["startDate"], 0.98);
      if (labelHas(["结束", "毕业"])) return pick("education", ["endDate"], 0.98);
      // Sunwz|2026-08-25|独立字段"本科毕业时间/研究生毕业时间/本科学校/研究生学校"等上下文携带学历级别的，按 level 选 repeatIndex
      if (/^(本科|研究生|硕士)/.test(rawLabel)) {
        const levelIdx = /^本科/.test(rawLabel) ? 1 : 0;
        const item = sections.education?.items?.[levelIdx]?.values || {};
        if (/开始|入学/.test(label)) return { record, candidate: null, value: item["开始时间"] || "", confidence: 0.98 };
        if (/结束|毕业/.test(label)) return { record, candidate: null, value: item["结束时间"] || "", confidence: 0.98 };
        if (/学校|院校/.test(label)) return { record, candidate: null, value: item["学校"] || "", confidence: 0.98 };
        if (/专业/.test(label)) return { record, candidate: null, value: item["专业"] || "", confidence: 0.98 };
        if (/学历/.test(label)) return { record, candidate: null, value: item["学历"] || "", confidence: 0.98 };
        if (/学位/.test(label)) return { record, candidate: null, value: item["学位"] || "", confidence: 0.98 };
        if (/排名/.test(label)) return { record, candidate: null, value: item["专业排名"] || item["成绩排名"] || "", confidence: 0.98 };
      }
    }

    if (section === "internship") {
      if (labelHas(["公司", "企业", "单位"])) return pick("internship", ["company"], 0.98);
      if (labelHas(["职位", "岗位", "职务"])) return pick("internship", ["position"], 0.98);
      if (labelHas(["证明人姓名"])) return directCandidate("internship", ["证明人姓名"], 0.98);
      if (labelHas(["证明人联系方式", "证明人电话", "证明人联系"])) return directCandidate("internship", ["证明人联系方式"], 0.98);
      if (labelHas(["部门"])) return pick("internship", ["department"], 0.95);
      if (labelHas(["地点", "城市"])) return pick("internship", ["city"], 0.95);
      if (labelHas(["行业"])) return pick("internship", ["industry"], 0.94);
      if (labelHas(["开始", "入职"])) return pick("internship", ["startDate"], 0.98);
      if (labelHas(["结束", "离职"])) return pick("internship", ["endDate"], 0.98);
      if (labelHas(["描述", "内容", "职责", "业绩", "成果"])) return pick("internship", ["description", "result"], 0.98);
    }

    if (section === "project") {
      if (labelHas(["项目名称", "课题名称", "名称"])) return pick("project", ["name"], 0.98);
      if (labelHas(["项目角色", "项目职务", "担任角色", "职位", "角色"])) return pick("project", ["role"], 0.98);
      if (labelHas(["参与人数", "人数"])) return pick("project", ["memberCount"], 0.94);
      if (labelHas(["开始"])) return pick("project", ["startDate"], 0.98);
      if (labelHas(["结束"])) return pick("project", ["endDate"], 0.98);
      if (labelHas(["本人职责", "项目职责", "个人职责"])) return pick("project", ["responsibility"], 0.98);
      if (labelHas(["项目成果", "成果"])) return pick("project", ["result"], 0.96);
      if (labelHas(["项目描述", "项目内容", "项目经历", "描述", "内容"])) return pick("project", ["description"], 0.98);
      if (labelHas(["项目链接", "作品链接", "链接"])) return pick("project", ["url"], 0.94);
      if (labelHas(["项目地点", "项目地址", "城市"])) return pick("project", ["city"], 0.94);
    }

    if (section === "awards") {
      if (labelHas(["获奖时间", "奖惩时间", "时间", "日期"])) return pick("awards", ["date"], 0.96);
      if (labelHas(["获奖名称", "奖项名称", "荣誉名称", "名称"])) return pick("awards", ["name"], 0.96);
      if (labelHas(["颁奖单位", "颁发机构", "授予单位", "单位"])) return pick("awards", ["issuer"], 0.95);
      if (labelHas(["等级", "级别"])) return pick("awards", ["level"], 0.95);
      if (labelHas(["类型"])) return pick("awards", ["type"], 0.94);
      if (labelHas(["描述", "说明"])) return pick("awards", ["description"], 0.95);
    }

    if (section === "language") {
      if (labelHas(["获得时间", "考试时间", "时间", "日期"])) return pick("language", ["date"], 0.95);
      if (labelHas(["证书", "考试类型", "名称"])) return pick("language", ["certificate"], 0.95);
      if (labelHas(["成绩", "分数"])) return pick("language", ["score"], 0.95);
      if (labelHas(["外语", "语言", "语种"])) return pick("language", ["language"], 0.95);
      if (labelHas(["掌握程度", "熟练程度", "水平", "精通程度"])) return pick("language", ["level"], 0.95);
    }

    if (section === "certificates") {
      if (labelHas(["证书名称", "名称"])) return pick("certificates", ["name"], 0.96) || pick("language", ["certificate"], 0.94);
      if (labelHas(["获得时间", "发证日期", "时间", "日期"])) return pick("certificates", ["date"], 0.96) || pick("language", ["date"], 0.94);
      if (labelHas(["级别", "成绩", "分数"])) return pick("certificates", ["score", "type"], 0.95) || pick("language", ["score"], 0.94);
      if (labelHas(["发证单位", "颁发机构", "授予单位"])) return { candidate: null, value: "", confidence: 0.95, skipReason: "no-certificate-issuer" };
      if (labelHas(["证书编号", "编号"])) return { candidate: null, value: "", confidence: 0.95, skipReason: "no-certificate-number" };
    }

    if (section === "computer") {
      if (labelHas(["掌握程度", "熟练程度", "水平", "精通程度"])) {
        return { candidate: null, value: "熟练", confidence: 0.95 };
      }
      return null;
    }

    if (section === "family") {
      if (labelHas(["姓名"])) return directCandidate("family", ["姓名"], 0.98);
      if (labelHas(["称谓", "关系", "与本人关系"])) return directCandidate("family", ["与本人关系"], 0.98);
      if (labelHas(["工作单位", "单位"])) return directCandidate("family", ["工作单位"], 0.96);
      if (labelHas(["职位", "职务"])) return directCandidate("family", ["职位", "职务"], 0.96) || { candidate: null, value: "", confidence: 0.95, skipReason: "no-family-position" };
      if (labelHas(["政治面貌"])) return directCandidate("family", ["政治面貌"], 0.96) || { candidate: null, value: "", confidence: 0.95, skipReason: "no-family-political-status" };
      if (labelHas(["联系电话", "电话", "联系方式"])) return directCandidate("family", ["联系电话"], 0.96);
    }

    if (section === "health") {
      if (labelHas(["简要病史", "病史"])) return { candidate: null, value: "", confidence: 0.96, skipReason: "no-health-history" };
      if (labelHas(["精神疾病", "传染性疾病", "疾病"])) return { candidate: null, value: "无", confidence: 0.96 };
      if (labelHas(["健康状况"])) return pick("basic", ["health"], 0.95);
    }

    if (section === "self") {
      if (labelHas(["评价内容", "自我评价", "自我描述"])) return pick("self", ["selfDescription", "selfEvaluation"], 0.95);
    }

    if (section === "studentOfficer" || section === "student") {
      const target = section;
      if (labelHas(["开始", "任职开始", "加入"])) return pick(target, ["startDate"], 0.95);
      if (labelHas(["结束", "任职结束", "离开"])) return pick(target, ["endDate"], 0.95);
      if (labelHas(["组织", "社团", "组织名称", "社团名称", "学生组织", "实践名称"])) return pick(target, ["organization"], 0.95);
      if (labelHas(["职位", "职务", "角色", "担任"])) return pick(target, ["role", "position"], 0.95);
      if (labelHas(["工作内容", "职责", "描述", "内容"])) return pick(target, ["description", "responsibility"], 0.95);
    }

    if (section === "intent") {
      if (labelHas(["意向岗位", "岗位", "职位", "应聘岗位"])) return pick("intention", ["意向岗位", "targetPosition"], 0.95);
      if (labelHas(["入职", "到岗"])) return pick("intent", ["arrivalDate"], 0.95);
      if (labelHas(["城市", "地点", "工作城市"])) return pick("intent", ["preferredCity", "targetCity", "interviewCity"], 0.95);
      if (labelHas(["年薪"])) return pick("internship", ["annualSalary", "salary"], 0.95) || pick("work", ["annualSalary", "salary"], 0.95);
      // Sunwz|2026-08-25|期望月薪/期望薪资/期望税前月薪：奥比中光多个相同概念字段，按"年薪"在前避免冲突
      if (labelHas(["期望月薪", "期望税前月薪", "税前月薪", "期望薪资"])) {
        const direct = pick("intention", ["期望薪资", "expectedSalary"], 0.96);
        if (direct) return direct;
        return pick("internship", ["年薪薪资", "annualSalary", "salary"], 0.92);
      }
      if (labelHas(["调剂"])) return hotjobAdjustCandidate() || pick("intent", ["willingAdjust"], 0.95);
      // 期望行业/职能类型
      if (labelHas(["行业", "职能"])) return pick("intention", ["期望行业", "targetIndustry"], 0.92) || pick("intention", ["期望职能", "expectedFunction"], 0.92);
    }

    if (section === "basic" || !section) {
      if (labelHas(["接受调剂", "是否接受调剂", "服从调剂"])) return hotjobAdjustCandidate() || pick("intent", ["willingAdjust"], 0.96);
      if (labelHas(["最高学历", "学历"])) return pick("education", ["educationLevel"], 0.96);
      if (labelHas(["学位"])) return pick("education", ["degree"], 0.96);
      if (labelHas(["毕业时间"])) return pick("education", ["endDate"], 0.96);
      if (labelHas(["毕业院校"])) return pick("education", ["school"], 0.96);
      if (labelHas(["专业"])) return pick("education", ["major"], 0.96);
      if (labelHas(["姓名"])) return pick("basic", ["fullName"], 0.95);
      if (labelHas(["手机号", "联系电话", "移动电话", "电话"])) return pick("basic", ["phone"], 0.95);
      if (labelHas(["邮箱", "电子邮件", "Email", "E-mail"])) return pick("basic", ["email"], 0.95);
      if (labelHas(["性别"])) return pick("basic", ["gender"], 0.95);
      if (labelHas(["出生日期", "出生年月", "生日"])) return pick("basic", ["birthDate"], 0.95);
      if (labelHas(["证件类型"])) return pick("basic", ["idType"], 0.95);
      if (labelHas(["身份证", "证件号码", "证件号"])) return pick("basic", ["idNumber"], 0.95);
      if (labelHas(["民族"])) return pick("basic", ["ethnicity"], 0.94);
      if (labelHas(["户口所在地", "出生地", "籍贯", "生源地", "户籍"])) return pick("basic", ["nativePlace"], 0.94);
      if (labelHas(["现居城市", "当前城市"])) return pick("basic", ["currentCity"], 0.94);
      if (labelHas(["通信地址", "联系地址", "通讯地址", "现住址", "详细地址"])) return pick("basic", ["mailingAddress", "currentAddress"], 0.94);
    }

    return null;
  }
  // Sunwz|2026-08-09|——END

  // Sunwz|2026-08-09|51job/前程无忧 External 简历页：老式 ASP.NET 字段用 cname/inputcolname 标注，按当前步骤可见字段映射
  function job51Override(record, candidates, options) {
    const rawLabel = String(record.label || "");
    const label = normalizeText(rawLabel);
    const idName = normalizeText(`${record.name || ""} ${record.id || ""}`);
    const ri = record.repeatIndex || 0;
    const labelHas = (terms) => terms.some((term) => rawLabel.includes(term) || label.includes(normalizeText(term)));
    const pick = (section, keys, confidence = 0.97) => {
      const source = firstValue(candidates, section, keys, ri);
      if (!source.value) return null;
      return { candidate: source.candidate, value: source.value, confidence };
    };
    const job51FullTimeCandidate = () => {
      const source = firstValue(candidates, "education", ["studyType"], ri);
      if (!source.value) return null;
      return { candidate: source.candidate, value: /非全|否/.test(String(source.value)) ? "否" : "是", confidence: 0.98 };
    };
    const job51RankCandidate = () => {
      const source = firstValue(candidates, "education", ["rank", "score"], ri);
      const value = String(source.value || "").trim();
      if (!value) return null;
      let percent = null;
      const percentMatch = value.match(/前?\s*(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) percent = Number(percentMatch[1]);
      const ratioMatch = value.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (percent === null && ratioMatch) percent = Number(ratioMatch[1]) / Number(ratioMatch[2]) * 100;
      if (Number.isFinite(percent)) {
        if (percent <= 5) return { candidate: source.candidate, value: "前5%", confidence: 0.98 };
        if (percent <= 20) return { candidate: source.candidate, value: "前20%", confidence: 0.98 };
        if (percent <= 50) return { candidate: source.candidate, value: "前50%", confidence: 0.98 };
      }
      if (/前5/.test(value)) return { candidate: source.candidate, value: "前5%", confidence: 0.98 };
      if (/前20/.test(value)) return { candidate: source.candidate, value: "前20%", confidence: 0.98 };
      if (/前50|前30|前40/.test(value)) return { candidate: source.candidate, value: "前50%", confidence: 0.98 };
      return { candidate: source.candidate, value: "其他", confidence: 0.95 };
    };
    const job51EnglishLevelCandidate = () => {
      const source = firstValue(candidates, "language", ["certificate", "level", "language"], ri);
      const fallback = firstValue(candidates, "certificates", ["name"], ri);
      const value = String(source.value || fallback.value || "").trim();
      if (!value) return null;
      if (/CET\s*-?\s*6|六级/i.test(value)) return { candidate: source.candidate || fallback.candidate, value: "大学英语六级（CET6）", confidence: 0.98 };
      if (/CET\s*-?\s*4|四级|英语/i.test(value)) return { candidate: source.candidate || fallback.candidate, value: "大学英语四级（CET4）", confidence: 0.98 };
      if (/雅思|IELTS/i.test(value)) return { candidate: source.candidate || fallback.candidate, value: "雅思（IELTS）", confidence: 0.98 };
      if (/托福|TOEFL/i.test(value)) return { candidate: source.candidate || fallback.candidate, value: "托福（TOEFL）", confidence: 0.98 };
      return { candidate: source.candidate || fallback.candidate, value: "其他", confidence: 0.95 };
    };

    if (labelHas(["固定电话"])) {
      return { candidate: null, value: "", confidence: 0.98, skipReason: "no-fixed-phone" };
    }
    if (labelHas(["手机号码地区", "手机号地区"])) {
      return { candidate: null, value: "中国大陆（+86）", confidence: 0.98 };
    }
    if (labelHas(["证件号码类型", "证件类型"]) || idName.includes("sidcard")) {
      return pick("basic", ["idType"], 0.98);
    }
    if (labelHas(["英文名", "英文姓名"])) return pick("basic", ["englishName"], 0.98);
    if (labelHas(["婚姻状况"])) return pick("basic", ["maritalStatus"], 0.98);
    if (labelHas(["政治面貌"])) return pick("basic", ["politicalStatus"], 0.98);
    if (labelHas(["户口所在地", "户籍所在地", "户籍"])) return pick("basic", ["nativePlace"], 0.98);
    if (labelHas(["目前居住地", "现居住地", "现居城市"])) return pick("basic", ["currentCity"], 0.98);
    if (labelHas(["是否为全日制", "是否全日制"])) return job51FullTimeCandidate();
    if (labelHas(["学习成绩排名", "成绩排名", "排名"])) return job51RankCandidate();
    if (labelHas(["英语水平", "英语等级"])) return job51EnglishLevelCandidate();
    if (labelHas(["分数", "成绩"]) && /语言|外语/.test(record.context || "")) return pick("language", ["score"], 0.98);
    if (labelHas(["其他外语"])) return { candidate: null, value: "", confidence: 0.98, skipReason: "no-other-language" };
    if (labelHas(["紧急联系人姓名", "紧急联系人"])) return pick("basic", ["emergencyName"], 0.98);
    if (labelHas(["紧急联系方式", "紧急联系电话"])) return pick("basic", ["emergencyPhone"], 0.98);
    if (labelHas(["邮政编码", "邮编"])) return pick("basic", ["postalCode"], 0.98);

    return hotjobOverride(record, candidates, options);
  }
  // Sunwz|2026-08-09|——END

  // Sunwz|2026-08-27|奥比中光/通用站点：下拉·单选·级联字段定向取值
  // 痛点：扁平 candidates 对"学历/学位/籍贯/期望月薪"等不可靠（实测 79 字段里这些全空）。
  // 这里绕过 candidates，直接从 options.profile.profileV2.sections 取数，返回 {value,type,fallbackOption}。
  // 命中则返回；未命中/无数据返回 null（交给下游通用循环，通常不填，符合"不强行填错值"预期）。
  function genericExtraValue(record, options) {
    const label = record.label || "";
    const labelN = normalizeText(label);
    const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
    const basic = sections.basic?.values || {};
    const ri = normalizedRepeatIndex(record.repeatIndex);
    const educationItems = sections.education?.items || [];
    const awardsItems = sections.awards?.items || [];
    const internshipItems = sections.internship?.items || [];
    const certificatesItems = sections.certificates?.items || [];
    const intentionValues = sections.intention?.items?.[0]?.values || {};

    const valOf = (items, key, idx) => {
      const item = items[idx];
      const v = item?.values?.[key];
      return v != null ? String(v).trim() : "";
    };

    // —— 性别（radio）
    if (labelN.includes("性别")) {
      const v = String(basic["性别"] || "").trim();
      if (v) return { value: v, type: "radio", fallbackOption: "" };
    }
    // —— 出生日期（date → month）
    if (labelN.includes("出生日期")) {
      const v = String(basic["出生日期"] || "").trim();
      if (v) return { value: v, type: "month", fallbackOption: "" };
    }
    // —— 地理级联：籍贯 / 现居住城市 / 生源地（value 传完整地址串，filler 内部 regionSegments 拆分）
    if (labelN.includes("籍贯")) {
      const v = String(basic["籍贯"] || "").trim();
      if (v) return { value: v, type: "select", fallbackOption: "" };
    }
    if (labelN.includes("现居住城市") || labelN.includes("现居地") || labelN.includes("现居住地")) {
      const v = String(basic["现居住城市"] || "").trim();
      if (v) return { value: v, type: "select", fallbackOption: "" };
    }
    if (labelN.includes("生源地")) {
      const v = String(basic["生源地"] || "").trim();
      if (v) return { value: v, type: "select", fallbackOption: "" };
    }
    // —— 最高学历（取 education.items[0]）
    if (labelN === "最高学历" || labelN.includes("最高学历")) {
      const v = valOf(educationItems, "学历", 0);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 学历（按 education repeatIndex，排除"最高学历/学位"）
    if (labelN.includes("学历") && !labelN.includes("最高学历") && !labelN.includes("学位")) {
      const v = valOf(educationItems, "学历", ri);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 学位（按 education repeatIndex）= 硕士/学士/博士，注意区别于"学科门类"
    if (labelN.includes("学位") && !labelN.includes("学历")) {
      const v = valOf(educationItems, "学位", ri);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 学习形式：用户要求统一填"全国普通高等院校全日制"
    if (labelN.includes("学习形式")) {
      return { value: "全国普通高等院校全日制", type: "select", fallbackOption: "其他" };
    }
    // —— 获奖级别（按 awards repeatIndex）
    if (labelN.includes("获奖级别") || labelN.includes("奖励等级") || labelN.includes("获奖等级")) {
      const v = valOf(awardsItems, "奖励等级", ri);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 实习地点（按 internship repeatIndex）
    if (labelN.includes("实习地点") || (labelN.includes("地点") && contextSection(record) === "internship")) {
      const v = valOf(internshipItems, "地点", ri);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 证书种类（按 certificates repeatIndex）
    if (labelN.includes("证书种类") || labelN.includes("证书类型")) {
      const v = valOf(certificatesItems, "证书类型", ri);
      if (v) return { value: v, type: "select", fallbackOption: "其他" };
    }
    // —— 期望月薪(税前)（select，区间模糊匹配 + fallback "其他"）
    if (labelN.includes("期望月薪") || labelN.includes("期望薪资") || labelN.includes("月薪")) {
      const raw = String(intentionValues["期望薪资"] || intentionValues["期望月薪"] || "").trim();
      if (raw) return { value: raw, type: "select", fallbackOption: "其他" };
    }
    // —— 意向工作地点（级联，取第一个城市；filler 会按 regionSegments 拆分）
    if (labelN.includes("意向工作地点") || labelN.includes("期望工作城市") || (labelN.includes("工作地点") && contextSection(record) === "intent")) {
      const raw = String(intentionValues["期望工作城市"] || "").trim();
      if (raw) {
        const first = raw.split(/[\s,，、/]+/).filter(Boolean)[0] || raw;
        return { value: first, type: "select", fallbackOption: "" };
      }
    }
    // —— 应届/往届（由最高学历结束时间推导）：表单为 .phoenix-radio-group 自定义单选，故 type=radio
    if (labelN.includes("应届") || labelN.includes("往届") || labelN === "是否应届") {
      const endTime = String(educationItems[0]?.values?.["结束时间"] || "").trim();
      const year = Number(String(endTime).slice(0, 4));
      const currentYear = new Date().getFullYear();
      const v = Number.isFinite(year) && year >= currentYear ? "应届" : "往届";
      return { value: v, type: "radio", fallbackOption: "" };
    }
    // —— 面试站点 / 就读城市：无数据 → 返回 null（skip）
    if (labelN.includes("面试站点") || labelN.includes("就读城市")) return null;
    // —— 证书成绩（按 certificates repeatIndex；区别于 education 成绩/GPA，避免错填 3.48/4）
    if (labelN.includes("成绩") && isCertRecord(record)) {
      const v = valOf(certificatesItems, "成绩", ri);
      if (v) return { value: v, type: "text", fallbackOption: "" };
    }
    // —— 开始/结束时间（按 record 所属模块 repeatIndex 取对应 items 的时间）
    // Sunwz|2026-08-27|奥比中光强化：sectionFromDom/contextSection 在"结束时间"标签（context 多为"单位名称"）
    // 常解析失败返回 ""，导致 map[""] 为空被跳过、结束时间永远空。故增加多级兜底：
    //  1) 优先 sectionFromDom/contextSection/record.section；
    //  2) 遍历可重复模块，找 repeatIndex 命中且含该 key 的非空项；
    //  3) 再退一步：本模块任意一项含该 key 非空也填（避免 ri 越界/错位导致整段空）。
    if (/开始时间|结束时间|毕业时间|入学时间/.test(label)) {
      const key = /结束时间|毕业时间/.test(label) ? "结束时间" : "开始时间";
      // Sunwz|2026-08-27|段锚优先（v2：不再依赖 record.section）。
      // 奥比中光低代码表单里日期字段的 section 常解析为 ""，导致上一版锚匹配被整段跳过、退回全局累加 ri 串段
      // （实测 示例公司E段被填成示例公司A值、本科毕业被填成硕士值）。改法：直接用已正确填入的段锚
      // （单位名称/项目名称/学校名称/组织名称）在所有可重复模块里反查「section + idx」，完全绕开 ri。
      const anchor = String(record.segAnchor || "").trim();
      const anchorCandidates = [
        { items: educationItems, aKeys: ["学校", "学校名称"] },
        { items: internshipItems, aKeys: ["公司", "单位名称"] },
        { items: sections.work?.items || [], aKeys: ["公司", "单位名称"] },
        { items: sections.project?.items || [], aKeys: ["项目名称", "项目"] },
        { items: sections.student?.items || [], aKeys: ["组织名称", "社团名称", "实践名称"] },
        { items: sections.studentOfficer?.items || [], aKeys: ["在校职务名称", "组织名称"] },
      ];
      let found = null;
      if (anchor) {
        for (const c of anchorCandidates) {
          const arr = c.items || [];
          for (let i = 0; i < arr.length; i += 1) {
            const vals = arr[i]?.values || {};
            let hit = false;
            for (const ak of c.aKeys) {
              const av = String(vals[ak] || "").trim();
              if (av && (av === anchor || anchor.includes(av) || av.includes(anchor))) { hit = true; break; }
            }
            if (hit) { found = { items: arr, idx: i }; break; }
          }
          if (found) break;
        }
      }
      // 锚未命中（段锚为空或没匹配上）：退回 section/ri 多级兜底，尽量不空着
      if (!found) {
        const section = sectionFromDom(record) || contextSection(record) || record.section || record.contextSection || "";
        const map = {
          education: educationItems,
          internship: internshipItems,
          work: sections.work?.items || [],
          project: sections.project?.items || [],
          student: sections.student?.items || [],
          studentOfficer: sections.studentOfficer?.items || [],
          awards: awardsItems,
        };
        const order = ["internship", "project", "work", "education", "student", "studentOfficer", "awards"];
        let items = (map[section] && map[section].length) ? map[section] : [];
        if (!items.length) {
          for (const s of order) {
            const arr = map[s] || [];
            if (arr[ri] && String(arr[ri].values?.[key] || "").trim()) { items = arr; break; }
          }
        }
        if (items.length) found = { items, idx: ri };
      }
      if (found) {
        const { items, idx } = found;
        try { console.log("[era-date-match] label=" + label + " anchor=" + JSON.stringify(anchor) + " idx=" + idx + " key=" + key); } catch (e) {}
        let v = valOf(items, key, idx);
        // 保守兜底：仅当 idx 越界/该条无值时，取本段首个有值项；不再无脑其它段，防错填
        if (!v && (idx >= items.length || items[idx] == null)) {
          for (let i = 0; i < items.length; i += 1) {
            const t = valOf(items, key, i);
            if (t) { v = t; break; }
          }
        }
        if (v) return { value: v, type: "month", fallbackOption: "" };
      }
    }
    return null;
  }
  // Sunwz|2026-08-27|——END

  function matchOne(record, candidates, options = {}) {
    if (options.site === "baidu") {
      const override = baiduOverride(record, candidates, options);
      if (override) return { record, ...override };
    }
    if (options.site === "moka") {
      const override = mokaOverride(record, candidates, options);
      if (override?.ignore) return null;
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-07|BOE 专属映射
    if (options.site === "boe") {
      const override = boeOverride(record, candidates, options);
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-07|AIRCAS 专属映射
    if (options.site === "aircas") {
      const override = aircasOverride(record, candidates, options);
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-07|飞书专属映射
    if (options.site === "feishu") {
      const override = feishuOverride(record, candidates, options);
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-07|——END
    // Sunwz|2026-08-09|Hotjob/Wecruit 专属映射
    if (options.site === "hotjob") {
      const override = hotjobOverride(record, candidates, options);
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-09|——END
    // Sunwz|2026-08-09|51job/前程无忧专属映射
    if (options.site === "51job") {
      const override = job51Override(record, candidates, options);
      if (override) return { record, ...override };
    }
    // Sunwz|2026-08-09|——END

    // Sunwz|2026-08-27|奥比中光/通用站点：下拉·单选·级联字段定向取值（直接读 profileV2.sections，置于"是否有X经历"门控之前以抢占 /^学位$/ 误判为学科门类）
    const extra = genericExtraValue(record, options);
    if (extra) {
      if (extra.type && record.type !== extra.type) record.type = extra.type;
      record.fallbackOption = extra.fallbackOption != null ? extra.fallbackOption : (record.fallbackOption || "");
      return { record, candidate: null, value: extra.value, confidence: 0.95, fallbackOption: extra.fallbackOption };
    }
    // Sunwz|2026-08-27|——END

    // Sunwz|2026-08-06|"是否有X经历/是否内推"单选门控（低代码表单通用）：按资料是否含对应经历推导 是/否
    if (options.site !== "baidu" && options.site !== "moka") {
      const gateLabel = normalizeText(record.label || "");
      const gateMatch = gateLabel.match(/是否有(.+)经历/);
      if (gateMatch) {
        const sections = options.profile?.profileV2?.sections || options.profile?.sections || {};
        let yes = false;
        const key = gateMatch[1];
        if (/获奖/.test(key)) yes = (sections.awards?.items?.length || 0) > 0;
        else if (/实习/.test(key)) yes = (sections.work?.items?.length || 0) + (sections.internship?.items?.length || 0) > 0;
        else if (/社团|干部/.test(key)) yes = (sections.student?.items?.length || 0) > 0;
        return { record, candidate: null, value: yes ? "是" : "否", confidence: 0.9 };
      }
      if (/是否内推/.test(gateLabel)) {
        return { record, candidate: null, value: "否", confidence: 0.9 };
      }
      // Sunwz|2026-08-06|意向岗位大类：按目标岗位推导（AI/研发/开发/技术/工程师 → 研发类）
      if (/意向岗位大类|岗位大类/.test(gateLabel)) {
        const position = String(options.profile?.profileV2?.sections?.intention?.items?.[0]?.values?.["意向岗位"]
          || options.profile?.profileV2?.sections?.intent?.items?.[0]?.values?.["意向岗位"] || "");
        return { record, candidate: null, value: /AI|研发|开发|技术|算法|工程师|软件/.test(position) ? "研发类" : "其他", confidence: 0.9 };
      }
      // Sunwz|2026-08-06|学位（学科门类）：按最高学历专业推导（测绘/工程/计算机等 → 工学）
      if (/^学位$/.test(gateLabel)) {
        const major = String(options.profile?.profileV2?.sections?.education?.items?.[0]?.values?.["专业"] || "");
        return { record, candidate: null, value: /测绘|工程|网络|计算机|软件|机械|电子|电气|信息|材料|土木|建筑|自动化|通信/.test(major) ? "工学" : "理学", confidence: 0.9 };
      }
      // Sunwz|2026-08-06|本科/研究生"成绩排名"：直接映射到对应学历的排名（避免被"成绩"别名抢走，错填成 GPA）
      if (/^(本科|研究生|硕士)/.test(gateLabel) && /排名/.test(gateLabel)) {
        const sections = options.profile?.profileV2?.sections || {};
        const idx = /^本科/.test(gateLabel) ? 1 : 0;
        const item = sections.education?.items?.[idx];
        return { record, candidate: null, value: String(item?.values?.["专业排名"] || item?.values?.["成绩排名"] || ""), confidence: 0.9 };
      }
      // Sunwz|2026-08-06|——END
    }
    // Sunwz|2026-08-06|——END

    // Sunwz|2026-08-15|秋招通通用站点：枚举 select / 论文 / 日期 / 地理 字段定向处理（奥比中光等第三方组件）
    const labelN = normalizeText(record.label || "");

    // —— 第2/3类：论文/期刊/论著/专著字段：只取 papers/publications，绝不 fallback 到 basic.学校；无值则标注需人工
    if (isPaperLabel(record.label, record.context)) {
      const pv = paperValue(candidates, record.repeatIndex || 0);
      if (pv && String(pv).trim()) {
        return { record, candidate: null, value: String(pv).trim(), confidence: 0.95 };
      }
      // profile 无论文数据：返回 needManual，让 popup 显示"⚠️ 论文需手动填"
      return { record, candidate: null, value: "", confidence: 0, skipReason: "need-manual-publications", manualHint: "论文/专著模块需人工填写（当前 profile 未配置 papers/publications）" };
    }

    // —— 第1类：典型枚举 select 字段（证书类型/学位/奖励等级等）：value 命中枚举则强制走 select 路径
    if (isEnumSelectLabel(record.label)) {
      const enumValues = SELECT_ENUM_LABELS
        .filter((k) => labelN.includes(normalizeText(k)))
        .flatMap((k) => SELECT_ENUM_MAP[k]);
      // 从 profile 取得对应值
      const source = firstValue(candidates, "certificates", ["type", "证书类型"], record.repeatIndex || 0).value
        || firstValue(candidates, "awards", ["level", "获奖级别", "奖励等级", "type", "奖励类型"], record.repeatIndex || 0).value
        || firstValue(candidates, "education", ["degree", "学位", "educationLevel", "学历"], record.repeatIndex || 0).value;
      const val = String(source || record.fallbackValue || "").trim();
      if (val) {
        // 命中枚举之一 → 强制 select 控件填充
        if (enumValues.some((e) => normalizeText(e) === normalizeText(val) || normalizeText(val).includes(normalizeText(e)))) {
          if (record.type !== "select") record.type = "select";
          record.enumOptions = enumValues;
          return { record, candidate: null, value: val, confidence: 0.95, fallbackOption: enumValues.includes("其他") ? "其他" : "" };
        }
        // 值不在枚举但字段本身是 select：仍按 select 走，并回退"其他"
        if (record.type !== "select") record.type = "select";
        record.enumOptions = enumValues;
        return { record, candidate: null, value: val, confidence: 0.9, fallbackOption: enumValues.includes("其他") ? "其他" : "" };
      }
      // 无值但字段明确是 select：修正控件类型，避免被当 text
      if (record.type === "text") record.type = "select";
      record.enumOptions = enumValues;
    }

    // —— 第7类：日期字段（开始/结束/获得/奖惩时间）→ 走 fillDate/phoenix 路径
    // Sunwz|2026-08-24|奥比中光日期控件被扫描成 select/phoenix-select，故日期标签无论原 type 一律归一为 month
    if (/开始时间|结束时间|获得时间|奖惩时间|获奖时间|毕业时间|入学时间|发证日期|获取时间|发布时间|出生日期/.test(record.label || "")) {
      if (record.type === "text" || record.type === "select") record.type = "month";
    }

    // —— 第8类：籍贯/现居地/生源地/工作地点等地理字段 → 级联或 select
    if (/籍贯|现居住城市|现居地|生源地|工作地点|所在城市|户口所在地|家庭住址|居住地/.test(record.label || "")) {
      if (record.type !== "select" && record.type !== "text") record.type = "select";
    }
    // Sunwz|2026-08-15|——END

    // Sunwz|2026-08-06|修复通用匹配器：用原始得分比较而非封顶后的置信度，否则多个候选同分封顶时最后一个反而胜出（如"姓名"错填成紧急联系人）
    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      if (!repeatIndexCompatible(record, candidate)) continue;
      const score = baseScore(record, candidate);
      if (score > 0.62 && score > bestScore) {
        bestScore = score;
        best = { record, candidate, value: candidate.value, confidence: Math.min(0.99, score) };
      }
    }
    // Sunwz|2026-08-06|修复通用匹配器：用原始得分比较而非封顶后的置信度，否则多个候选同分封顶时最后一个反而胜出——END
    // Sunwz|2026-08-06|获奖类型：自定义奖项类型不在预设列表（奖学金/竞赛获奖/其他）时回退"其他"
    if (best?.candidate?.section === "awards" && best.candidate.key === "type") {
      best.record.fallbackOption = "其他";
    }
    // Sunwz|2026-08-06|——END
    return best;
  }

  function matchFields(records, candidates, options = {}) {
    const normalizer = global.EdgeResumeProfileNormalizer;
    const baiduDefaults = options.baiduDefaults ||
      (options.site === "baidu" && normalizer?.deriveBaiduDefaults && options.profile
        ? normalizer.deriveBaiduDefaults(options.profile)
        : {});
    return records
      .map((record) => matchOne(record, candidates, { ...options, baiduDefaults }))
      .filter(Boolean);
  }

  const api = {
    normalizeText,
    matchFields,
    matchOne,
    contextSection,
    provinceFor,
    baiduIndustryFor,
    phoenixSalaryRange,
  };

  global.EdgeResumeMatcher = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

