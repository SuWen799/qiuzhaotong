<script setup>
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, CollectionTag, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import {
  getPluginProfile,
  updatePluginProfile,
  getPluginToken,
  getPluginResumeVersion,
  getCompanyResumeStatus,
} from '@/api/plugin'
import { getResumeVersions, getResumeVersion } from '@/api/resume'

// ---- SECTION_DEFS（照旧插件 options.js 抄录 14 个模块）----
const field = (label, type = 'text', aliases = []) => ({ label, type, aliases })
const long = (label, aliases = []) => field(label, 'textarea', aliases)

const SECTION_DEFS = [
  {
    key: 'attachments',
    title: '附件',
    kind: 'simple',
    fields: [
      field('个人简历文件', 'text', ['简历文件', '上传简历']),
      field('个人照片', 'text', ['照片', '证件照', '上传照片']),
      field('作品集文件', 'text', ['作品附件']),
    ],
  },
  {
    key: 'basic',
    title: '基础信息',
    kind: 'simple',
    fields: [
      field('姓名', 'text'),
      field('性别', 'text'),
      field('出生日期', 'date'),
      field('民族', 'text'),
      field('国籍（国家或地区）', 'text', ['国籍', '国籍地区']),
      field('电话', 'tel', ['手机号', '手机号码', '移动电话']),
      field('邮箱', 'email', ['电子邮箱']),
      field('微信号', 'text'),
      field('身份证号', 'text', ['证件号码', '身份证号码']),
      field('政治面貌', 'text'),
      field('取得政治面貌时间', 'date', ['入党时间']),
      field('籍贯', 'text'),
      field('生源地', 'text'),
      field('现居住城市', 'text'),
      field('现居住详细地址', 'text'),
      field('通讯地址', 'text'),
      field('人事档案所在地', 'text'),
    ],
  },
  {
    key: 'intention',
    title: '求职意向',
    kind: 'repeat',
    itemLabel: '求职意向',
    fields: [
      field('意向岗位', 'text', ['目标岗位', '应聘岗位']),
      field('预计入职时间', 'date'),
      field('期望工作城市', 'text', ['目标工作城市']),
      field('期望城市首选', 'text', ['首选城市']),
      field('可线下面试城市', 'text', ['面试城市', '面试城市首选', '线下面试城市']),
      field('是否接受调剂', 'text', ['是否服从调配', '服从调剂']),
      field('当前薪资', 'text'),
      field('期望薪资', 'text'),
    ],
  },
  {
    key: 'education',
    title: '教育经历',
    kind: 'repeat',
    itemLabel: '教育经历',
    fields: [
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      field('学校', 'text', ['学校名称', '毕业院校']),
      field('专业', 'text', ['专业名称']),
      field('学历', 'text'),
      field('学位', 'text'),
      field('学院（院系）', 'text', ['学院', '院系']),
      field('研究方向', 'text'),
      long('专业课程'),
      field('成绩', 'text', ['平均成绩', '综合成绩']),
      field('GPA类型', 'text', ['绩点类型', '成绩类型']),
      field('GPA成绩', 'text', ['成绩绩点', '绩点', 'GPA']),
      field('成绩排名', 'text', ['专业排名', '班级排名']),
      field('挂科数', 'number'),
    ],
  },
  {
    key: 'internship',
    title: '实习经历',
    kind: 'repeat',
    itemLabel: '实习经历',
    fields: [
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      field('公司', 'text', ['企业名称', '实习单位']),
      field('部门', 'text'),
      field('行业', 'text'),
      field('地点', 'text', ['工作地点']),
      field('职位', 'text', ['职位名称', '实习岗位']),
      field('工资', 'text', ['薪资']),
      field('月薪', 'text'),
      field('年薪薪资', 'text', ['年薪', '职位年薪']),
      long('工作内容', ['工作描述', '实习内容']),
      long('工作成果'),
    ],
  },
  {
    key: 'work',
    title: '工作经历',
    kind: 'repeat',
    itemLabel: '工作经历',
    fields: [
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      field('公司', 'text', ['企业名称']),
      field('部门', 'text'),
      field('行业', 'text'),
      field('地点', 'text', ['工作地点']),
      field('职位', 'text', ['职位名称']),
      field('工资', 'text', ['薪资']),
      field('月薪', 'text'),
      field('年薪薪资', 'text', ['年薪', '职位年薪']),
      long('工作内容', ['工作描述']),
      long('工作成果'),
    ],
  },
  {
    key: 'project',
    title: '项目经验',
    kind: 'repeat',
    itemLabel: '项目',
    fields: [
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      field('项目名称', 'text'),
      field('职位', 'text', ['项目职务', '项目角色']),
      field('参与人数', 'number'),
      long('项目内容', ['项目描述']),
      long('本人职责', ['项目职责']),
      long('项目成果'),
      field('项目链接', 'url', ['作品链接']),
      field('项目地址', 'text'),
    ],
  },
  {
    key: 'awards',
    title: '获奖经历',
    kind: 'repeat',
    itemLabel: '获奖',
    fields: [
      field('奖惩时间', 'month', ['获奖时间', '颁发时间']),
      field('奖惩名称', 'text', ['奖项名称', '荣誉名称']),
      field('颁奖单位', 'text', ['颁发机构', '授予单位']),
      field('奖励等级', 'text', ['奖项级别']),
      field('奖励类型', 'text', ['奖项类型']),
      long('奖惩描述', ['获奖描述', '奖项描述']),
    ],
  },
  {
    key: 'portfolio',
    title: '作品集',
    kind: 'repeat',
    itemLabel: '作品',
    fields: [
      field('作品名称', 'text'),
      field('作品链接', 'url', ['作品集链接', '作品主页', '个人主页']),
      field('作品角色', 'text'),
      long('作品描述', ['作品简介', '作品说明']),
    ],
  },
  {
    key: 'language',
    title: '外语能力',
    kind: 'repeat',
    itemLabel: '外语能力',
    fields: [
      field('获得时间', 'month'),
      field('外语种类', 'text'),
      field('证书名称（技能名称）', 'text'),
      field('成绩', 'text'),
      field('掌握程度', 'text'),
    ],
  },
  {
    key: 'certificates',
    title: '证书',
    kind: 'repeat',
    itemLabel: '证书',
    fields: [
      field('获得时间', 'month'),
      field('证书名称', 'text'),
      field('证书类型', 'text'),
      field('成绩', 'text'),
    ],
  },
  {
    key: 'student',
    title: '校园经历',
    kind: 'repeat',
    itemLabel: '校园经历',
    fields: [
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      field('组织名称', 'text'),
      field('职位', 'text'),
      long('工作内容'),
      long('本人职责'),
    ],
  },
  {
    key: 'studentOfficer',
    title: '在校职务',
    kind: 'repeat',
    itemLabel: '在校职务',
    fields: [
      field('在校职务名称', 'text'),
      field('开始时间', 'month'),
      field('结束时间', 'month'),
      long('在校职务描述'),
    ],
  },
  {
    key: 'self',
    title: '自我评价',
    kind: 'simple',
    fields: [
      long('自我描述'),
      long('自我评价'),
    ],
  },
  {
    key: 'other',
    title: '其他信息',
    kind: 'simple',
    fields: [
      long('受到奖励/学术成果', ['受到奖励', '学术成果']),
      long('社会/校园活动', ['社会活动', '校园活动']),
      long('爱好及专长', ['兴趣爱好', '特长']),
      field('招聘信息来源', 'text', ['招聘来源', '信息来源']),
      field('GitHub', 'url'),
      field('个人主页', 'url', ['作品链接', '作品集链接']),
    ],
  },
]

// ---- 表单状态 ----
// form[key] =
//   kind simple  -> { values: {字段label: 值} }
//   kind repeat  -> { items: [{ title, values: {字段label: 值} }] }
const form = reactive({})

function initEmptyForm() {
  SECTION_DEFS.forEach((def) => {
    if (def.kind === 'simple') {
      form[def.key] = { values: {} }
    } else {
      form[def.key] = { items: [] }
    }
  })
}

// 关键：必须在 setup 同步阶段（模板首次渲染前）初始化 form 结构，
// 否则模板访问 form[def.key].values 时 form[def.key] 为 undefined 会抛错导致整页白屏。
initEmptyForm()

function loadFromSections(sections) {
  // sections: { key: { kind, values?|items? } }
  SECTION_DEFS.forEach((def) => {
    const src = sections ? sections[def.key] : null
    if (def.kind === 'simple') {
      const values = {}
      if (src && src.values) {
        def.fields.forEach((f) => {
          if (Object.prototype.hasOwnProperty.call(src.values, f.label)) {
            values[f.label] = src.values[f.label]
          }
        })
      }
      form[def.key] = { values }
    } else {
      const items = []
      if (src && Array.isArray(src.items)) {
        src.items.forEach((it) => {
          const values = {}
          def.fields.forEach((f) => {
            if (it.values && Object.prototype.hasOwnProperty.call(it.values, f.label)) {
              values[f.label] = it.values[f.label]
            }
          })
          items.push({ title: it.title || '', values })
        })
      }
      form[def.key] = { items }
    }
  })
}

// ---- 简历版本列表（左侧菜单）----
// 菜单项：{ index, label, company, latestId }
// original 为原版简历；ver:<id> 为某公司按 JD 优化版本
const resumeMenus = ref([
  { index: 'original', label: '原版简历', company: '', latestId: '' },
])

const activeMenu = ref('original')
const isAsideCollapsed = ref(false)
function toggleAside() {
  isAsideCollapsed.value = !isAsideCollapsed.value
}
const loadingVersion = ref(false)
// 流二：插件访问令牌（用于读取「按公司在线简历」文件状态 / 走 /plugin/resume-version 加载文件版）
const pluginToken = ref('')

// 工具：把字符串数组用换行拼接
function joinLines(arr) {
  if (!Array.isArray(arr)) return ''
  return arr.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join('\n')
}

// 兜底清洗：剥离可能残留的 markdown / 特殊符号（** 【】 ` #），保证面板不出现任何标记符号。
// DB 版 variable_modules（flow-1）的 highlights/description 中可能仍带 **，文件版已清洗，这里再兜一层。
function cleanSymbols(s) {
  if (s === undefined || s === null) return s
  return String(s)
    .replace(/\*\*/g, '')
    .replace(/【|】/g, '')
    .replace(/`/g, '')
    .replace(/#/g, '')
    .trim()
}

// 深拷贝一个对象（用于保留原版非动态字段）
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// 名称归一化：统一全/半角、CJK 兼容字符、多余空格，便于名称略有差异时仍能匹配
function normalizeName(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .trim()
    .toLowerCase()
}

// 判断两个名称是否匹配（允许子串和归一化差异）
function isNameMatch(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return na.includes(nb) || nb.includes(na)
}

// 计算两个归一化名称的相似度（基于最长公共子序列 LCS），用于项目名称差异较大时模糊匹配
function nameSimilarity(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const m = na.length
  const n = nb.length
  // 只保留中文字符和数字/字母用于比较，过滤掉通用词减少干扰
  const clean = (s) => s.replace(/[\s项目平台系统方案工程]+/g, '')
  const ca = clean(na)
  const cb = clean(nb)
  if (!ca || !cb) return 0
  const dp = Array.from({ length: ca.length + 1 }, () => new Array(cb.length + 1).fill(0))
  for (let i = 1; i <= ca.length; i++) {
    for (let j = 1; j <= cb.length; j++) {
      if (ca[i - 1] === cb[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  const lcs = dp[ca.length][cb.length]
  return lcs / Math.max(ca.length, cb.length)
}

// 在 originalItems 中为 VM 条目寻找最佳匹配（优先 isNameMatch，其次 LCS 相似度）
function findBestMatch(vmName, originalItems, keyField) {
  let best = null
  let bestScore = 0
  originalItems.forEach((it) => {
    const origName = it.values?.[keyField] || ''
    if (isNameMatch(origName, vmName)) {
      return { item: it, score: 1 }
    }
    const sim = nameSimilarity(origName, vmName)
    if (sim > bestScore) {
      bestScore = sim
      best = it
    }
  })
  // 相似度阈值 0.4，避免错配
  return best && bestScore >= 0.4 ? { item: best, score: bestScore } : null
}

// 把 variableModules 映射到 form 的动态部分（internship/project/self）
// originalSections 为原版 sections，作为"底"，仅覆盖动态部分。
// 关键：实习/项目/自我评价在原版条目基础上做"增量更新"，保留时间、地点、部门、薪资、证明人等静态字段，
// 只替换 JD 优化后的工作内容/工作成果/项目内容/本人职责/项目成果/自我描述。
function applyVariableModules(originalSections, variableModules) {
  if (!variableModules) return

  // internship -> 在原版实习条目上更新"工作内容"和"工作成果"
  if (Array.isArray(variableModules.internship)) {
    const originalItems = (form.internship && Array.isArray(form.internship.items))
      ? deepClone(form.internship.items)
      : []
    const newItems = variableModules.internship.map((intern) => {
      // 按公司名匹配原版条目；允许名称略有差异（如全/半角、括号等），匹配不到则新增
      const match = originalItems.find((it) =>
        isNameMatch(it.values?.公司, intern.company)
      )
      const base = match
        ? deepClone(match)
        : { title: intern.company || '实习经历', values: {} }
      const values = base.values || {}
      values['公司'] = intern.company || values['公司'] || ''
      values['职位'] = intern.role || values['职位'] || ''
      // period 形如 "2026.03 ~ 2026.08"，尝试拆成开始/结束时间
      if (intern.period && typeof intern.period === 'string') {
        const parts = intern.period.split('~').map((s) => s.trim())
        if (parts[0]) values['开始时间'] = parts[0]
        if (parts[1]) values['结束时间'] = parts[1]
      }
      // 工作内容：拼接 projects 的 name + description + highlights（纯文本，不出现 markdown/【】符号）
      const workDesc = (intern.projects || [])
        .map((p) => {
          const parts = []
          if (p.name) parts.push(p.name)
          if (p.description) parts.push(p.description)
          if (Array.isArray(p.highlights) && p.highlights.length) parts.push(p.highlights.join('；'))
          return parts.join('：')
        })
        .filter((s) => String(s).trim())
        .join('\n\n')
      values['工作内容'] = cleanSymbols(workDesc)
      // 工作成果：拼接所有 highlights（纯文本）
      const highlights = []
      ;(intern.projects || []).forEach((p) => {
        if (Array.isArray(p.highlights)) highlights.push(...p.highlights)
      })
      values['工作成果'] = cleanSymbols(joinLines(highlights))
      return { title: intern.company || base.title || '实习经历', values }
    })
    form.internship = { items: newItems }
  }

  // project -> 在原版项目条目上更新"项目内容"、"本人职责"、"项目成果"
  if (Array.isArray(variableModules.project)) {
    let originalItems = (form.project && Array.isArray(form.project.items))
      ? deepClone(form.project.items)
      : []
    const matchedIndexes = new Set()
    const newItems = variableModules.project.map((p) => {
      // 先尝试精确/子串匹配，再在未匹配项中尝试模糊匹配
      const remainingItems = originalItems.filter((_, idx) => !matchedIndexes.has(idx))
      let match = null
      const exactIdx = originalItems.findIndex((it, idx) =>
        !matchedIndexes.has(idx) && isNameMatch(it.values?.项目名称, p.name)
      )
      if (exactIdx >= 0) {
        match = originalItems[exactIdx]
        matchedIndexes.add(exactIdx)
      } else {
        const best = findBestMatch(p.name, remainingItems, '项目名称')
        if (best) {
          const realIdx = originalItems.indexOf(best.item)
          if (realIdx >= 0) {
            match = best.item
            matchedIndexes.add(realIdx)
          }
        }
      }
      const base = match
        ? deepClone(match)
        : { title: p.name || '项目经验', values: {} }
      const values = base.values || {}
      values['项目名称'] = p.name || values['项目名称'] || ''
      if (p._company) values['职位'] = p._role || values['职位'] || ''
      values['项目内容'] = cleanSymbols(p.description || values['项目内容'] || '')
      values['本人职责'] = cleanSymbols(p.responsibility || values['本人职责'] || '')
      values['项目成果'] = cleanSymbols(joinLines(p.highlights))
      return { title: p.name || base.title || '项目经验', values }
    })
    form.project = { items: newItems }
  }

  // core_skills -> 在原版 self 上更新"自我描述"
  if (variableModules.core_skills && typeof variableModules.core_skills === 'object') {
    const skills = variableModules.core_skills
    const techText = cleanSymbols(joinLines(skills.technical))
    const softText = cleanSymbols(joinLines(skills.soft))
    const selfText = [techText ? '技术能力：\n' + techText : '', softText ? '软技能：\n' + softText : '']
      .filter((x) => x)
      .join('\n\n')
    // 在原版 self 基础上只更新「自我描述」，保留「自我评价」
    const selfValues = {}
    if (form.self && form.self.values) {
      Object.assign(selfValues, deepClone(form.self.values))
    }
    if (selfText) {
      selfValues['自我描述'] = selfText
    }
    form.self = { values: selfValues }
  }

  // self -> 流二文件版携带 self:{自我描述,自我评价}（区别于 DB 版的 core_skills），
  // 在原版 self 基础上更新「自我描述」与「自我评价」，保留其他字段。
  if (variableModules.self && typeof variableModules.self === 'object') {
    const selfValues = {}
    if (form.self && form.self.values) {
      Object.assign(selfValues, deepClone(form.self.values))
    }
    const sd = cleanSymbols(String(variableModules.self['自我描述'] || '').trim())
    const se = cleanSymbols(String(variableModules.self['自我评价'] || '').trim())
    if (sd) selfValues['自我描述'] = sd
    if (se) selfValues['自我评价'] = se
    form.self = { values: selfValues }
  }
}

// variableModules 可能是字符串（DB 存的是 JSON 文本）或对象，统一解析为对象
function resolveVM(vmRaw) {
  if (typeof vmRaw === 'string') {
    try {
      return JSON.parse(vmRaw)
    } catch (e) {
      return null
    }
  }
  return vmRaw || null
}

// 切换左侧菜单
async function selectResume(index) {
  if (index === activeMenu.value) return
  activeMenu.value = index
  if (index === 'original') {
    await loadOriginal()
    return
  }
  const menu = resumeMenus.value.find((m) => m.index === index)
  if (!menu || (!menu.latestId && !menu.fromCompanyFile)) return
  loadingVersion.value = true
  try {
    // 1. 先拿原版 sections 作为底（基础信息不变）
    const profRes = await getPluginProfile()
    const profData = profRes?.data ?? profRes
    let originalSections = null
    if (profData && profData.exists && profData.profile) {
      originalSections =
        profData.profile.profileV2?.sections || profData.profile.sections || null
    }
    // 2. 铺底
    loadFromSections(originalSections)
    // 3. 拉取该版本详情，覆盖动态部分
    // 流二：有「按公司在线简历」文件的版本（纯文件菜单项，或 DB 版本但已生成文件），
    // 直接加载干净的全量 profile（<company>.json）。该文件已是完整 sections，
    // 字段映射与开始/结束时间均已正确，无需再走 variable_modules 增量合并（避免 【】/技术栈 污染）。
    let variableModules = null
    if ((menu.fromCompanyFile || menu.companyFileAt) && menu.company) {
      try {
        const verRes = await getPluginResumeVersion(menu.company, pluginToken.value || '')
        const verData = verRes?.data ?? verRes
        const fullProfile = verData?.profile
        const sections = fullProfile?.profileV2?.sections || fullProfile?.sections || null
        if (sections) {
          loadFromSections(sections)
          return
        }
        // 文件存在但无全量 profile（仅有 variable_modules）时，回退到 variable_modules 合并
        variableModules = resolveVM(verData?.variableModules)
      } catch (e) {
        console.error('加载公司在线简历文件失败，回退 DB 版本', e)
      }
    }
    // 无文件、或文件无全量 profile：走 DB variable_modules 增量合并（铺底 原版 + 覆盖动态部分）
    if (!variableModules && menu.latestId) {
      const verRes = await getResumeVersion(menu.latestId)
      const verData = verRes?.data ?? verRes
      variableModules = resolveVM(verData?.variableModules)
    }
    applyVariableModules(originalSections, variableModules)
  } catch (e) {
    ElMessage.error('加载版本失败：' + (e?.message || '未知错误'))
  } finally {
    loadingVersion.value = false
  }
}

// 加载原版简历（复用现有逻辑）
async function loadOriginal() {
  try {
    const res = await getPluginProfile()
    const data = res?.data ?? res
    if (data && data.exists && data.profile) {
      const profile = data.profile
      const sections = profile.profileV2?.sections || profile.sections || null
      if (sections) loadFromSections(sections)
    }
  } catch (e) {
    ElMessage.error('加载资料失败：' + (e?.message || '未知错误'))
  }
}

// 加载版本列表：过滤 company==="原版"，同一 company 取 createdAt 最新一条
async function loadResumeMenus() {
  try {
    const res = await getResumeVersions()
    const list = res?.data ?? res
    if (!Array.isArray(list)) return
    const byCompany = {}
    list.forEach((v) => {
      // 过滤掉所有「原版」相关记录：DB 中可能 company='原版'/'原版简历' 或 id=0/isOriginal=true
      if (!v || v.id === 0 || v.id === '0' || v.isOriginal === true) return
      const c = v.company || ''
      if (c === '原版' || c === '原版简历') return
      const cur = byCompany[v.company]
      if (!cur || new Date(v.createdAt) > new Date(cur.createdAt)) {
        byCompany[v.company] = v
      }
    })
    const menus = [{ index: 'original', label: '原版简历', company: '', latestId: '' }]
    Object.keys(byCompany).forEach((company) => {
      const v = byCompany[company]
      menus.push({
        index: 'ver:' + v.id,
        label: company + '（按JD优化）',
        company,
        latestId: v.id,
      })
    })
    // 流二：合并「按公司在线简历」文件状态（生成后异步写入 <company>.variable_modules.json）。
    // 作用：(a) 给已有 DB 版本打上「已生成在线简历」标记 + 生成时间；
    //      (b) DB 无对应版本、但文件已存在的公司，补一条独立菜单项。
    try {
      const tokenRes = await getPluginToken()
      const token = tokenRes?.data?.token ?? tokenRes?.token ?? ''
      if (token) {
        pluginToken.value = token
        const statusRes = await getCompanyResumeStatus(token)
        const statusList = statusRes?.data ?? statusRes
        if (Array.isArray(statusList)) {
          const fileMap = {}
          statusList.forEach((s) => {
            if (s && s.company) fileMap[s.company] = s.createdAt
          })
          // 给已有 DB 菜单打标记
          menus.forEach((m) => {
            if (m.company && fileMap[m.company]) {
              m.companyFileAt = fileMap[m.company]
            }
          })
          // 文件存在但 DB 无对应版本的，补一条独立菜单
          Object.keys(fileMap).forEach((company) => {
            if (!byCompany[company]) {
              menus.push({
                index: 'companyfile:' + company,
                label: company + '（在线简历·按JD）',
                company,
                fromCompanyFile: true,
                companyFileAt: fileMap[company],
              })
            }
          })
        }
      }
    } catch (e) {
      // 文件状态读取失败不阻塞正常版本列表
      console.error('加载公司在线简历状态失败', e)
    }
    resumeMenus.value = menus
  } catch (e) {
    // 版本列表加载失败不影响原版编辑
    console.error('加载版本列表失败', e)
  }
}

// ---- 统计 ----
const filledFieldCount = computed(() => {
  let n = 0
  visibleDefs.value.forEach((def) => {
    if (def.kind === 'simple') {
      const values = form[def.key]?.values || {}
      def.fields.forEach((f) => {
        const v = values[f.label]
        if (v !== undefined && v !== null && String(v).trim() !== '') n++
      })
    } else {
      const items = form[def.key]?.items || []
      items.forEach((it) => {
        const values = it.values || {}
        def.fields.forEach((f) => {
          const v = values[f.label]
          if (v !== undefined && v !== null && String(v).trim() !== '') n++
        })
      })
    }
  })
  return n
})

function sectionFilledCount(def) {
  let n = 0
  if (def.kind === 'simple') {
    const values = form[def.key]?.values || {}
    def.fields.forEach((f) => {
      const v = values[f.label]
      if (v !== undefined && v !== null && String(v).trim() !== '') n++
    })
  } else {
    const items = form[def.key]?.items || []
    items.forEach((it) => {
      const values = it.values || {}
      def.fields.forEach((f) => {
        const v = values[f.label]
        if (v !== undefined && v !== null && String(v).trim() !== '') n++
      })
    })
  }
  return n
}

// ---- 模块目录锚点 ----
const activeSection = ref('')

// 在线简历页面不显示「附件」模块（已有专门的简历附件页面）
const visibleDefs = computed(() => SECTION_DEFS.filter((def) => def.key !== 'attachments'))

const sectionAnchors = computed(() => {
  return visibleDefs.value.map((def) => {
    let total
    if (def.kind === 'simple') {
      total = def.fields.length
    } else {
      const itemsLen = form[def.key]?.items?.length || 0
      total = itemsLen === 0 ? 0 : def.fields.length * itemsLen
    }
    return {
      key: def.key,
      title: def.title,
      filled: sectionFilledCount(def),
      total,
    }
  })
})

function scrollToSection(key) {
  const el = document.getElementById('section-' + key)
  if (!el) return
  const main = document.querySelector('.plugin-resume .main')
  if (main) {
    main.scrollTo({
      top: el.offsetTop - 12,
      behavior: 'smooth'
    })
  }
  activeSection.value = key
}

let scrollObserver = null
function observeActiveSection() {
  const main = document.querySelector('.plugin-resume .main')
  if (!main) return
  if (scrollObserver) main.removeEventListener('scroll', scrollObserver)
  scrollObserver = () => {
    const scrollTop = main.scrollTop
    let current = visibleDefs.value[0]?.key || ''
    visibleDefs.value.forEach((def) => {
      const el = document.getElementById('section-' + def.key)
      if (el && el.offsetTop - 16 <= scrollTop) {
        current = def.key
      }
    })
    activeSection.value = current
  }
  main.addEventListener('scroll', scrollObserver, { passive: true })
}

// ---- 操作 ----
function addItem(def) {
  form[def.key].items.push({ title: '', values: {} })
}

function removeItem(def, index) {
  form[def.key].items.splice(index, 1)
}

function buildProfilePayload() {
  const sections = {}
  SECTION_DEFS.forEach((def) => {
    if (def.kind === 'simple') {
      const values = {}
      def.fields.forEach((f) => {
        const v = form[def.key].values[f.label]
        values[f.label] = v === undefined ? '' : v
      })
      sections[def.key] = { kind: 'simple', values }
    } else {
      const items = form[def.key].items.map((it) => {
        const values = {}
        def.fields.forEach((f) => {
          const v = it.values[f.label]
          values[f.label] = v === undefined ? '' : v
        })
        return { title: it.title || '', values }
      })
      sections[def.key] = { kind: 'repeat', items }
    }
  })
  // 尽量保留原 profile 的其它信息，仅覆盖 profileV2.sections
  return { profileV2: { sections } }
}

const saving = ref(false)

async function handleSave() {
  saving.value = true
  try {
    const payload = buildProfilePayload()
    await updatePluginProfile(payload)
    ElMessage.success('资料已保存')
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

// 字段类型 -> input 类型映射
function inputType(type) {
  switch (type) {
    case 'date': return 'date'
    case 'month': return 'month'
    case 'number': return 'number'
    case 'email': return 'email'
    case 'tel': return 'tel'
    case 'url': return 'url'
    default: return 'text'
  }
}

// ---- 加载 ----
onMounted(async () => {
  initEmptyForm()
  // 原版加载与版本列表加载并行
  await loadOriginal()
  loadResumeMenus()
  // 开启滚动监听，用于高亮左侧模块目录
  setTimeout(() => {
    observeActiveSection()
  }, 500)
})

// 若页面被 <keep-alive> 缓存（删除简历文件后从其它页面返回），重新拉取 /resume/versions，
// 使被删除的在线简历版本从左侧列表消失。
onActivated(() => {
  loadResumeMenus()
})
</script>

<template>
  <div class="plugin-resume">
    <el-container class="layout">
      <!-- 左侧：简历版本列表 + 模块目录 -->
      <el-aside :width="isAsideCollapsed ? '44px' : '280px'" class="aside" :class="{ collapsed: isAsideCollapsed }">
        <!-- 折叠状态：窄条 + 展开按钮 -->
        <div v-if="isAsideCollapsed" class="collapsed-bar" title="展开侧边栏" @click="toggleAside">
          <el-icon class="collapsed-icon"><ArrowRight /></el-icon>
          <span class="collapsed-text">目录</span>
        </div>

        <!-- 展开状态：原有内容 -->
        <template v-else>
          <div class="aside-title">
            <span>简历列表</span>
            <el-icon class="collapse-btn" title="收起侧边栏" @click="toggleAside"><ArrowLeft /></el-icon>
          </div>
          <div class="resume-tip">
          原版简历为基础档案，生成版本仅覆盖实习 / 项目 / 个人优势等动态部分
        </div>
        <div class="resume-menu">
          <div
            v-for="m in resumeMenus"
            :key="m.index"
            class="mat-item"
            :class="{
              active: m.index === activeMenu,
              'is-original': m.index === 'original',
              'is-company-file': m.fromCompanyFile
            }"
            @click="selectResume(m.index)"
          >
            <el-icon class="mat-item-icon"><Document v-if="m.index === 'original'" /><CollectionTag v-else /></el-icon>
            <div class="mat-body">
              <span class="mat-name">{{ m.label }}</span>
              <span v-if="m.companyFileAt" class="mat-status">
                <el-tag size="small" type="success" effect="light" class="status-tag">已生成在线简历</el-tag>
                <span class="mat-time">{{ m.companyFileAt }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 模块目录：点击快速滚动到对应 section -->
        <div class="section-nav-title">模块目录</div>
        <div class="section-nav">
          <div
            v-for="s in sectionAnchors"
            :key="s.key"
            class="section-nav-item"
            :class="{ active: activeSection === s.key }"
            @click="scrollToSection(s.key)"
          >
            <span class="section-nav-dot" />
            <span class="section-nav-label">{{ s.title }}</span>
            <span class="section-nav-count">{{ s.filled }}/{{ s.total }}</span>
          </div>
        </div>
        </template>
      </el-aside>

      <!-- 右侧表单 -->
      <el-main class="main">
        <div class="header">
          <div class="summary">
            <el-tag type="info" effect="plain">{{ visibleDefs.length }} 个模块</el-tag>
            <el-tag type="success" effect="plain">{{ filledFieldCount }} 个已填字段</el-tag>
            <el-tag v-if="loadingVersion" type="warning" effect="plain">加载版本中…</el-tag>
          </div>
          <el-button class="save-btn" type="primary" :loading="saving" @click="handleSave">保存资料</el-button>
        </div>

        <div class="sections">
          <el-card
            v-for="def in visibleDefs"
            :id="'section-' + def.key"
            :key="def.key"
            class="section-card"
            shadow="never"
          >
            <template #header>
              <div class="section-header">
                <span class="section-title">{{ def.title }}</span>
                <el-tag size="small" type="info" effect="plain">
                  {{ sectionFilledCount(def) }}/{{ def.fields.length }} 已填
                </el-tag>
              </div>
            </template>

            <!-- simple 模块 -->
            <template v-if="def.kind === 'simple'">
              <el-form label-width="140px" label-position="right">
                <el-form-item
                  v-for="f in def.fields"
                  :key="f.label"
                  :label="f.label"
                >
                  <el-input
                    v-if="f.type === 'textarea'"
                    v-model="form[def.key].values[f.label]"
                    type="textarea"
                    :rows="3"
                    :placeholder="f.label"
                  />
                  <el-input
                    v-else
                    v-model="form[def.key].values[f.label]"
                    :type="inputType(f.type)"
                    :placeholder="f.label"
                  />
                </el-form-item>
              </el-form>
            </template>

            <!-- repeat 模块 -->
            <template v-else>
              <el-button
                class="add-btn"
                type="primary"
                size="small"
                @click="addItem(def)"
              >
                + 新增{{ def.itemLabel }}
              </el-button>

              <div v-if="form[def.key].items.length === 0" class="empty-tip">
                暂无{{ def.itemLabel }}，点击上方按钮新增
              </div>

              <el-card
                v-for="(item, idx) in form[def.key].items"
                :key="idx"
                class="item-card"
                shadow="hover"
              >
                <template #header>
                  <div class="item-header">
                    <el-input
                      v-model="item.title"
                      size="small"
                      class="item-title"
                      :placeholder="def.itemLabel + '标题'"
                    />
                    <el-button
                      type="danger"
                      size="small"
                      plain
                      @click="removeItem(def, idx)"
                    >
                      删除
                    </el-button>
                  </div>
                </template>
                <el-form label-width="140px" label-position="right">
                  <el-form-item
                    v-for="f in def.fields"
                    :key="f.label"
                    :label="f.label"
                  >
                    <el-input
                      v-if="f.type === 'textarea'"
                      v-model="item.values[f.label]"
                      type="textarea"
                      :rows="3"
                      :placeholder="f.label"
                    />
                    <el-input
                      v-else
                      v-model="item.values[f.label]"
                      :type="inputType(f.type)"
                      :placeholder="f.label"
                    />
                  </el-form-item>
                </el-form>
              </el-card>
            </template>
          </el-card>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<style scoped>
/* 项目统一主题色（与官网汇总页一致） */
:root {
  --brand: #1a73e8;      /* 主蓝 */
  --brand-soft: #e8f0fe;
  --success: #4caf50;    /* 绿 */
  --warning: #ff9800;    /* 橙 */
}
.plugin-resume {
  height: 100%;
}
.layout {
  height: 100%;
}
.aside {
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  transition: width 0.25s ease;
  overflow: hidden;
}
.aside.collapsed {
  align-items: center;
}
.aside-title {
  padding: 14px 16px;
  font-weight: 600;
  font-size: 15px;
  color: #333;
  border-bottom: 1px solid var(--el-border-color-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.collapse-btn {
  font-size: 14px;
  color: #9aa0a6;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s, color 0.2s;
}
.collapse-btn:hover {
  background: #f5f7fa;
  color: var(--brand);
}
.collapsed-bar {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  cursor: pointer;
  color: #5f6368;
  transition: background 0.2s, color 0.2s;
  user-select: none;
}
.collapsed-bar:hover {
  background: #f5f7fa;
  color: var(--brand);
}
.collapsed-icon {
  font-size: 16px;
}
.collapsed-text {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

/* 原版简历提示文字 */
.resume-tip {
  margin: 10px 12px 4px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #5f6368;
  background: var(--brand-soft);
  border-left: 3px solid var(--brand);
  border-radius: 4px;
}

/* 左侧统一的简历菜单列表（与项目文件/个人文件一致） */
.resume-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0 12px;
  flex: 1;
  overflow-y: auto;
}
.mat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 26px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}
.mat-item:hover {
  background: #f5f7fa;
}
.mat-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.mat-item-icon {
  margin-left: 4px;
}
.mat-item-icon {
  color: var(--el-color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  min-width: 18px;
}
.mat-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 流二：菜单项主体（名称 + 在线简历状态）改为纵向布局，便于承载副行状态 */
.mat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.mat-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mat-status .status-tag {
  flex-shrink: 0;
  font-weight: 600;
  border-radius: 4px;
}
.mat-time {
  font-size: 11px;
  color: #9aa0a6;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 流二：纯文件来源的菜单项，左侧加一道绿色标识，与 DB 版本区分 */
.mat-item.is-company-file {
  border-left: 3px solid var(--success);
  padding-left: 23px;
}
/* 原版简历：非选中时只做轻微文字区分，不显示永久高亮背景/左边框；
   避免用户选中其他版本时，原版仍看起来像处于选中状态。 */
.mat-item.is-original {
  font-weight: 600;
}
.mat-item.is-original.active {
  background: var(--el-color-primary-light-9);
}

/* 模块目录 */
.section-nav-title {
  padding: 12px 16px 6px;
  font-weight: 600;
  font-size: 14px;
  color: #333;
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 4px;
}
.section-nav {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.section-nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #5f6368;
  transition: background 0.2s, color 0.2s;
}
.section-nav-item:hover {
  background: #f5f7fa;
  color: #333;
}
.section-nav-item.active {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}
.section-nav-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c4c7ce;
  flex-shrink: 0;
}
.section-nav-item.active .section-nav-dot {
  background: var(--brand);
}
.section-nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-nav-count {
  font-size: 11px;
  color: #9aa0a6;
  font-variant-numeric: tabular-nums;
}
.section-nav-item.active .section-nav-count {
  color: var(--brand);
}

.main {
  padding: 16px 20px;
  overflow-y: auto;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.summary {
  display: flex;
  gap: 8px;
}

/* 顶部统计标签与官网配色统一 */
.summary :deep(.el-tag) {
  border-radius: 6px;
  font-weight: 500;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* 卡片统一 */
.section-card {
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
}
.section-card :deep(.el-card__header) {
  background: #f8f9fa;
  border-bottom: 1px solid var(--el-border-color-light);
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title {
  font-weight: 600;
  font-size: 15px;
  color: #333;
}
/* 表单 label 颜色统一 */
.section-card :deep(.el-form-item__label) {
  color: #5f6368;
  font-weight: 500;
}
.add-btn {
  margin-bottom: 12px;
}
.empty-tip {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 8px 0 12px;
}
.item-card {
  margin-bottom: 12px;
  border-radius: 8px;
}
.item-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.item-title {
  flex: 1;
}

/* 保存按钮：加深对比度 */
.save-btn {
  font-weight: 600;
  padding: 0 22px;
  height: 36px;
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(26, 115, 232, 0.25);
}
.save-btn:deep(.el-button__text) {
  color: #fff;
}

/* 新增 / 删除按钮 */
.add-btn {
  font-weight: 600;
  border-radius: 6px;
  padding: 0 14px;
}
.section-card :deep(.el-button--danger.is-plain) {
  border-color: #e0a8a8;
  color: #c62828;
  font-weight: 600;
}
.section-card :deep(.el-button--danger.is-plain:hover) {
  background: #fdecea;
  border-color: #c62828;
  color: #c62828;
}
</style>
