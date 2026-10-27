(function initProfileNormalizer(global) {
  "use strict";

  const SECTION_LABELS = {
    basic: "基础信息",
    intent: "求职意向",
    intention: "求职意向",
    education: "教育经历",
    internship: "实习经历",
    work: "工作经历",
    project: "项目经验",
    portfolio: "作品集",
    student: "校园经历",
    studentOfficer: "在校职务",
    awards: "获奖经历",
    language: "外语能力",
    certificates: "证书",
    attachments: "附件",
    self: "自我评价",
    other: "其他信息",
  };

  const FIELD_MAP = {
    basic: [
      ["fullName", "姓名", "text", ["姓名", "真实姓名", "应聘人姓名"]],
      ["firstName", "名", "text", ["名"]],
      ["lastName", "姓", "text", ["姓"]],
      ["englishName", "英文名", "text", ["英文名", "英文姓名", "English Name"]],
      ["gender", "性别", "select", ["性别"]],
      ["birthDate", "出生日期", "date", ["出生日期", "出生年月", "生日"]],
      ["nationality", "国籍", "select", ["国籍", "国籍/地区", "国家或地区", "国籍（国家或地区）"]],
      ["ethnicity", "民族", "text", ["民族"]],
      ["phone", "电话", "tel", ["电话", "手机号", "手机号码", "移动电话", "联系电话"]],
      ["email", "邮箱", "email", ["邮箱", "电子邮箱", "Email", "E-mail", "常用个人邮箱"]],
      ["wechat", "微信号", "text", ["微信", "微信号"]],
      ["qq", "QQ", "text", ["QQ", "QQ号"]],
      ["idType", "证件号码类型", "select", ["证件类型", "证件号码类型"]],
      ["idNumber", "证件号码", "text", ["证件号码", "身份证号", "身份证号码"]],
      ["politicalStatus", "政治面貌", "select", ["政治面貌", "党派", "党员情况"]],
      ["maritalStatus", "婚姻状况", "select", ["婚姻状况"]],
      ["nativePlace", "籍贯", "text", ["籍贯", "生源地", "祖籍"]],
      ["currentCity", "现居住城市", "text", ["现居住城市", "现居城市", "当前城市"]],
      ["currentAddress", "现居住详细地址", "text", ["现居住地址", "现住址", "居住地址"]],
      ["mailingAddress", "通讯地址", "text", ["通讯地址", "联系地址"]],
      ["postalCode", "邮政编码", "text", ["邮政编码", "邮编"]],
      ["height", "身高", "number", ["身高"]],
      ["weight", "体重", "number", ["体重"]],
      ["health", "健康状况", "text", ["健康状况", "身体状况"]],
      ["hobbies", "兴趣爱好", "textarea", ["兴趣爱好", "爱好及专长", "特长"]],
      ["emergencyName", "紧急联系人", "text", ["紧急联系人", "紧急联系人姓名"]],
      ["emergencyPhone", "紧急联系人电话", "tel", ["紧急联系人电话", "紧急联系电话"]],
      ["emergencyRelation", "与紧急联系人关系", "text", ["紧急联系人关系", "与紧急联系人关系"]],
      ["partyJoinDate", "入党时间", "date", ["入党时间", "取得政治面貌时间"]],
      ["archiveLocation", "人事档案所在地", "text", ["人事档案所在地", "档案所在地"]],
      ["archiveOrg", "人事档案所在单位", "text", ["人事档案所在单位", "档案所在单位"]],
    ],
    intent: [
      ["targetPosition", "意向岗位", "text", ["意向岗位", "应聘岗位", "应聘职位", "目标岗位", "求职岗位", "目标职位"]],
      ["arrivalDate", "预计入职时间", "date", ["预计入职时间", "到岗时间", "可入职时间"]],
      ["currentSalary", "当前薪资", "text", ["当前薪资", "当前月薪", "目前薪资"]],
      ["targetCity", "期望工作城市", "select", ["期望工作城市", "目标工作城市", "期望城市", "意向城市", "工作地点"]],
      ["preferredCity", "期望城市首选", "select", ["期望城市首选", "首选城市", "目标工作城市"]],
      ["expectedSalary", "期望薪资", "text", ["期望薪资", "薪资要求", "期望月薪", "期望税前月薪"]],
      ["interviewCity", "面试城市", "select", ["面试城市", "可面试城市"]],
      ["offlineInterviewCity", "可线下面试城市", "select", ["可线下面试城市", "线下面试城市", "可参加线下面试城市"]],
      ["willingAdjust", "是否接受调剂", "select", ["是否接受调剂", "是否接受岗位调剂", "是否服从调配", "服从调剂"]],
    ],
    education: [
      ["startDate", "开始时间", "month", ["入学时间", "教育开始时间", "开始时间", "请选择开始时间"]],
      ["endDate", "结束时间", "month", ["毕业时间", "教育结束时间", "结束时间", "请选择结束时间"]],
      ["school", "学校", "select", ["学校", "学校名称", "毕业院校", "院校"]],
      ["major", "专业", "select", ["专业", "专业名称", "所学专业"]],
      ["studentNo", "学号", "text", ["学号"]],
      ["degree", "学位", "select", ["学位"]],
      // Sunwz|2026-08-07|学习形式（BOE 全日制/非全日制）
      ["studyType", "学习形式", "select", ["学习形式", "学习方式"]],
      // Sunwz|2026-08-07|——END
      ["educationLevel", "学历", "select", ["学历", "最高学历", "学历层次"]],
      ["college", "学院（院系）", "text", ["学院", "院系", "所在院系"]],
      ["courses", "专业课程", "textarea", ["专业课程", "主修课程", "核心课程"]],
      ["research", "研究方向", "text", ["研究方向"]],
      ["thesis", "毕业论文", "text", ["毕业论文", "毕业设计"]],
      ["score", "成绩", "text", ["成绩", "平均成绩", "综合成绩"]],
      ["rank", "专业排名", "text", ["专业排名", "成绩排名", "班级排名"]],
      ["failCount", "挂科数", "number", ["挂科数"]],
      ["gpaType", "GPA类型", "select", ["GPA类型", "绩点类型", "绩点制", "成绩类型"]],
      ["gpa", "成绩绩点", "text", ["绩点", "GPA", "GPA成绩", "成绩绩点"]],
      // Sunwz|2026-08-14|vivo 教育经历专属：导师姓名、实验室
      ["tutor", "导师姓名", "text", ["导师", "导师姓名", "指导老师"]],
      ["laboratory", "实验室", "text", ["实验室", "实验室名称"]],
      // Sunwz|2026-08-14|——END
    ],
    work: [
      ["startDate", "开始时间", "month", ["工作开始时间", "入职时间", "开始时间", "请选择开始时间"]],
      ["endDate", "结束时间", "month", ["工作结束时间", "离职时间", "结束时间", "请选择结束时间"]],
      ["company", "公司", "text", ["企业名称", "公司", "公司名称", "单位名称", "工作单位"]],
      ["department", "部门", "text", ["所在部门", "部门"]],
      ["industry", "行业", "select", ["行业类别", "行业", "所属行业"]],
      ["city", "地点", "select", ["工作地点", "工作城市", "地点"]],
      ["salary", "工资", "text", ["薪资", "月薪", "工资", "职位年薪", "年薪薪资"]],
      ["monthlySalary", "月薪", "text", ["月薪", "月薪收入"]],
      ["annualSalary", "年薪薪资", "text", ["年薪", "年薪薪资", "职位年薪"]],
      ["position", "职位", "text", ["职位名称", "职位", "岗位", "职务"]],
      ["description", "工作内容", "textarea", ["工作描述", "工作内容", "职责描述", "主要职责"]],
      ["result", "工作成果", "textarea", ["工作成果", "项目成果"]],
    ],
    internship: [
      ["startDate", "开始时间", "month", ["实习开始时间", "开始时间", "请选择开始时间"]],
      ["endDate", "结束时间", "month", ["实习结束时间", "结束时间", "请选择结束时间"]],
      // Sunwz|2026-08-24|奥比中光等"单位名称"标签兜底：原别名只覆盖"公司"相关，加入"单位名称"/"工作单位"
      ["company", "公司", "text", ["实习公司", "实习单位", "单位名称", "工作单位", "公司名称", "企业名称"]],
      ["department", "部门", "text", ["实习部门", "部门", "所在部门"]],
      ["industry", "行业", "select", ["行业类别", "行业"]],
      ["city", "地点", "select", ["实习地点", "工作地点", "地点"]],
      ["salary", "工资", "text", ["薪资", "月薪", "工资", "职位年薪", "年薪薪资"]],
      ["position", "职位", "text", ["实习岗位", "实习职位", "职位名称", "职位"]],
      ["description", "工作内容", "textarea", ["实习内容", "实习描述", "工作描述", "工作内容"]],
      ["result", "工作成果", "textarea", ["工作成果"]],
    ],
    project: [
      ["startDate", "开始时间", "month", ["项目开始时间", "开始时间", "请选择开始时间"]],
      ["endDate", "结束时间", "month", ["项目结束时间", "结束时间", "请选择结束时间"]],
      ["role", "职位", "text", ["项目职务", "项目角色", "担任角色", "职位", "角色"]],
      ["name", "项目名称", "text", ["项目名称", "课题名称"]],
      ["memberCount", "参与人数", "number", ["参与人数"]],
      ["description", "项目内容", "textarea", ["项目描述", "项目内容", "项目经验"]],
      ["responsibility", "本人职责", "textarea", ["项目职责", "本人职责", "个人职责"]],
      ["result", "项目成果", "textarea", ["项目成果"]],
      ["url", "项目链接", "url", ["项目链接", "作品链接"]],
      ["city", "项目地址", "text", ["项目地址", "项目地点", "项目城市"]],
    ],
    portfolio: [
      ["name", "作品名称", "text", ["作品名称", "作品集名称", "作品标题"]],
      ["url", "作品链接", "url", ["作品链接", "作品集链接", "作品主页", "Portfolio", "个人主页"]],
      ["description", "作品描述", "textarea", ["作品描述", "作品简介", "作品说明"]],
      ["role", "作品角色", "text", ["作品角色", "本人角色", "担任角色"]],
    ],
    // Sunwz|2026-08-24|论文/专著：别名覆盖"论文名称"/"论文题目"/"期刊"/"作者顺序"
    papers: [
      ["name", "论文名称", "text", ["论文名称", "论文题目", "名称", "paperName"]],
      ["journal", "所属期刊", "text", ["所属期刊", "期刊", "期刊名称", "会议期刊名称", "发表期刊"]],
      ["rank", "作者顺序", "text", ["作者顺序", "作者排序", "本人排名"]],
      ["date", "发表时间", "month", ["发表时间", "发布时间"]],
      ["description", "论文描述", "textarea", ["论文描述", "摘要", "成果说明"]],
    ],
    publications: [
      ["name", "出版物名称", "text", ["出版物", "出版物名称", "论著名称", "专著名称"]],
      ["date", "发表时间", "month", ["发表时间", "出版时间"]],
    ],
    student: [
      ["startDate", "开始时间", "month", ["开始时间"]],
      ["endDate", "结束时间", "month", ["结束时间"]],
      ["organization", "组织名称", "text", ["组织名称", "社团名称", "学生组织", "实践名称", "在校实践名称", "校园经历名称", "经历名称"]],
      ["role", "职位", "text", ["职位", "担任职务", "校园职务", "实践职务", "担任角色"]],
      ["description", "工作内容", "textarea", ["工作内容", "本人职责", "校园经历", "实践描述", "在校实践描述", "实践内容", "实践经历"]],
    ],
    studentOfficer: [
      ["startDate", "开始时间", "month", ["开始时间", "任职开始时间"]],
      ["endDate", "结束时间", "month", ["结束时间", "任职结束时间"]],
      ["organization", "在校职务名称", "text", ["在校职务名称", "组织名称", "学生会", "担任职务"]],
      ["description", "在校职务描述", "textarea", ["在校职务描述", "工作内容", "本人职责"]],
    ],
    awards: [
      ["date", "奖惩时间", "month", ["获奖时间", "奖惩时间", "颁发时间"]],
      // Sunwz|2026-08-24|奥比中光"获奖项"/"获奖名称"标签兜底
      ["name", "奖惩名称", "text", ["奖项名称", "获奖项", "获奖名称", "奖惩名称", "荣誉名称"]],
      ["issuer", "颁奖单位", "text", ["颁奖单位", "颁发机构", "授予单位"]],
      ["level", "奖励等级", "select", ["奖励等级", "奖项级别"]],
      ["description", "奖惩描述", "textarea", ["奖惩描述", "获奖描述", "奖项描述"]],
      ["type", "奖励类型", "select", ["奖励类型", "奖项类型", "获奖类型"]],
    ],
    language: [
      ["date", "获得时间", "month", ["获得时间", "考试时间"]],
      ["language", "外语种类", "text", ["外语种类", "语种", "语言"]],
      ["certificate", "证书名称（技能名称）", "text", ["语言证书", "证书名称", "考试类型"]],
      ["score", "成绩", "text", ["成绩", "考试成绩", "语言成绩"]],
      ["level", "掌握程度", "select", ["掌握程度", "熟练程度", "语言水平"]],
      // Sunwz|2026-08-14|vivo 语言能力专属：听说能力、读写能力
      ["listening", "听说能力", "select", ["听说能力", "口语能力", "听力口语"]],
      ["reading", "读写能力", "select", ["读写能力", "阅读写作", "阅读能力", "写作能力"]],
      ["speaking", "口语能力", "select", ["口语能力", "口语水平"]],
      ["writing", "写作能力", "select", ["写作能力", "写作水平"]],
      // Sunwz|2026-08-14|——END
    ],
    certificates: [
      ["date", "获得时间", "month", ["获得时间", "发证日期"]],
      ["name", "证书名称", "text", ["证书名称", "资格证书", "获得的证书"]],
      ["type", "证书类型", "select", ["证书类型"]],
      ["score", "成绩", "text", ["成绩", "证书成绩"]],
    ],
    attachments: [
      ["resumeFile", "个人简历文件", "file", ["个人简历文件", "简历文件", "简历附件", "上传简历", "个人简历"]],
      ["photo", "个人照片", "file", ["个人照片", "照片", "头像", "上传照片"]],
      ["idPhoto", "证件照", "file", ["证件照", "证件照片", "身份证照"]],
      ["portfolioFile", "作品集文件", "file", ["作品集文件", "作品附件", "作品集附件"]],
    ],
    // 秋招通插件新增：核心能力（由公司定制的可变模块）。整段文本写入“核心能力/专业技能”等文本域。
    coreSkills: [
      ["content", "核心能力", "textarea", ["核心能力", "专业技能", "技能特长", "专业能力", "个人技能", "技术能力", "能力特长", "核心竞争力", "核心优势", "自我评价", "自荐信", "技能标签", "擅长领域"]],
    ],
  };

  const DIRECT_VALUE_SECTIONS = {
    self: [
      ["selfDescription", "自我描述", "textarea", ["自我介绍", "自我描述", "个人简介"]],
      ["selfEvaluation", "自我评价", "textarea", ["自我评价", "个人优势"]],
    ],
    other: [
      ["noAcademic", "无学术成果", "checkbox", ["无学术成果", "学术成果"]],
      ["awardsSummary", "受到奖励/学术成果", "textarea", ["受到奖励", "学术成果"]],
      ["activitySummary", "社会/校园活动", "textarea", ["社会活动", "校园活动"]],
      ["hobbies", "爱好及专长", "textarea", ["爱好及专长", "特长"]],
      ["recruitSource", "招聘信息来源", "text", ["招聘信息来源", "招聘来源", "信息来源", "渠道来源", "渠道"]],
      ["github", "GitHub", "url", ["GitHub"]],
      ["homepage", "个人主页", "url", ["个人主页", "作品链接", "作品集链接", "Portfolio"]],
    ],
  };

  function valueOf(values, sourceKey, aliases = []) {
    if (!values) return "";
    const names = [sourceKey, ...aliases].filter(Boolean);
    for (const name of names) {
      const value = values[name];
      if (isNonEmpty(value)) return String(value).trim();
    }
    const normalizedEntries = Object.entries(values).map(([key, value]) => [String(key).replace(/\s+/g, "").toLowerCase(), value]);
    for (const name of names) {
      const normalizedName = String(name).replace(/\s+/g, "").toLowerCase();
      const entry = normalizedEntries.find(([key, value]) => key === normalizedName && isNonEmpty(value));
      if (entry) return String(entry[1]).trim();
    }
    return "";
  }

  function isNonEmpty(value) {
    return String(value || "").trim() !== "";
  }

  function createCandidate(section, repeatIndex, def, values) {
    const [key, sourceKey, type, aliases] = def;
    const value = valueOf(values, sourceKey, [key, ...(aliases || [])]);
    if (!isNonEmpty(value)) return null;
    return {
      id: `${section}:${repeatIndex}:${key}`,
      section,
      sectionLabel: SECTION_LABELS[section] || section,
      repeatIndex,
      key,
      label: sourceKey,
      aliases: Array.from(new Set([sourceKey, key, ...(aliases || [])])),
      type,
      value,
    };
  }

  function pushMappedCandidates(candidates, section, sectionData) {
    const defs = FIELD_MAP[section] || DIRECT_VALUE_SECTIONS[section];
    if (!defs || !sectionData) return;

    if (sectionData.values) {
      for (const def of defs) {
        const candidate = createCandidate(section, 0, def, sectionData.values);
        if (candidate) candidates.push(candidate);
      }
      return;
    }

    const items = Array.isArray(sectionData.items) ? sectionData.items : [];
    items.forEach((item, index) => {
      for (const def of defs) {
        const candidate = createCandidate(section, index, def, item.values || {});
        if (candidate) candidates.push(candidate);
      }
    });
  }

  function normalizeProfile(profile) {
    const sections = profile?.profileV2?.sections || profile?.sections || {};
    const candidates = [];
    const aliases = { intent: "intention", projects: "project" };

    for (const section of Object.keys(FIELD_MAP)) {
      pushMappedCandidates(candidates, section, sections[section] || sections[aliases[section]]);
    }
    pushInternshipsAsBaiduWork(candidates, sections);
    for (const section of Object.keys(DIRECT_VALUE_SECTIONS)) {
      pushMappedCandidates(candidates, section, sections[section]);
    }

    return candidates;
  }

  function pushInternshipsAsBaiduWork(candidates, sections) {
    const workCount = Array.isArray(sections?.work?.items) ? sections.work.items.length : 0;
    const internshipItems = Array.isArray(sections?.internship?.items) ? sections.internship.items : [];
    internshipItems.forEach((item, index) => {
      for (const def of FIELD_MAP.work) {
        const candidate = createCandidate("work", workCount + index, def, item.values || {});
        if (candidate) {
          candidate.sourceSection = "internship";
          candidates.push(candidate);
        }
      }
    });
  }

  function firstCandidate(candidates, section, key) {
    return candidates.find((candidate) => candidate.section === section && candidate.key === key)?.value || "";
  }

  function firstPreferredCity(value) {
    const text = String(value || "");
    for (const city of ["深圳", "上海", "北京", "广州", "成都"]) {
      if (text.includes(city)) return city;
    }
    return text.split(/[,\s，、/]+/).find(Boolean) || "";
  }

  function derivePositionCategory(position) {
    const text = String(position || "").toLowerCase();
    if (/产品|运营/.test(text)) return "产品";
    if (/销售|商务|客户/.test(text)) return "销售";
    if (/政企|政府|解决方案/.test(text)) return "政企";
    if (/人力|财务|法务|行政|综合/.test(text)) return "综合";
    return "技术";
  }

  function confidential(value) {
    return /保密|面议|无|不填|不写/.test(String(value || ""));
  }

  function salaryRange(value) {
    const text = String(value || "");
    if (!text) return "";
    if (confidential(text)) return "保密";
    const numbers = text.match(/\d+(?:\.\d+)?/g);
    if (!numbers) return "";
    const n = Number(numbers[0]);
    if (!Number.isFinite(n)) return "";
    const annual = /月|k|K/.test(text) ? n * 12 * (/k/i.test(text) ? 1000 : 1) : n;
    if (annual < 20000) return "<20,000";
    if (annual < 50000) return "20,000-50,000";
    if (annual < 100000) return "50,000-100,000";
    if (annual < 150000) return "100,000-150,000";
    if (annual < 200000) return "150,000-200,000";
    if (annual < 250000) return "200,000-250,000";
    if (annual < 300000) return "250,000-300,000";
    return ">300,000";
  }

  function deriveBaiduDefaults(profile) {
    const candidates = normalizeProfile(profile);
    const targetCity = firstPreferredCity(
      firstCandidate(candidates, "intent", "preferredCity") ||
      firstCandidate(candidates, "intent", "targetCity")
    );
    const targetPosition = firstCandidate(candidates, "intent", "targetPosition");
    const salary = firstCandidate(candidates, "work", "annualSalary") ||
      firstCandidate(candidates, "work", "salary") ||
      firstCandidate(candidates, "intent", "expectedSalary");

    return {
      targetCity,
      targetPositionType: derivePositionCategory(targetPosition),
      interviewOnlineType: "国内远程",
      salaryRange: salaryRange(salary),
    };
  }

  const api = {
    normalizeProfile,
    deriveBaiduDefaults,
    firstPreferredCity,
    confidential,
    salaryRange,
  };

  global.EdgeResumeProfileNormalizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
