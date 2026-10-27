<template>
  <div class="container">
    <!-- 投递进度面板（复刻旧版 #delivery-summary / renderDeliverySummary） -->
    <div id="delivery-summary" class="delivery-summary"></div>

    <div class="search-box">
      <input
        type="text"
        id="search-input"
        v-model="search"
        placeholder="搜索公司名/岗位..."
        @input="onKeywordInput"
      />
      <span id="filtered-count" class="filtered-count"></span>
    </div>

    <!-- 筛选栏（复刻旧版 .filters） -->
    <div class="filters">
      <div class="filter-group" v-for="f in filterFields" :key="f.key">
        <!-- Sunwz|2026-10-22|激活态：有勾选时按钮高亮 + 显示已选个数，避免"挂着筛选忘了"导致搜不到东西 -->
        <button type="button" class="filter-label" :class="{ 'filter-active': (filters[f.key] || []).length > 0 }" @click="toggleFilter(f.key)">
          {{ f.label }}<template v-if="(filters[f.key] || []).length"> ·{{ filters[f.key].length }}</template> ▼
        </button>
        <div class="filter-options" :id="'filter-' + f.key" style="display:none"></div>
      </div>
      <!-- 排序下拉：浅蓝底蓝字，与筛选同款外观（复刻旧版 .sort-label） -->
      <div class="filter-group filter-group-sort">
        <select id="sort-select" class="filter-label sort-label" v-model="sort" @change="filterData">
          <option value="date_desc">发布日期 新→旧</option>
          <option value="date_asc">发布日期 旧→新</option>
          <option value="deadline_asc">截止时间 紧急优先</option>
          <option value="deadline_desc">截止时间 较晚优先</option>
          <option value="name_asc">公司名 A→Z</option>
          <option value="name_desc">公司名 Z→A</option>
        </select>
      </div>
      <div class="filter-actions">
        <button class="action-btn" @click="resetFilters">重置</button>
        <button class="action-btn" :disabled="crawling" @click="triggerCrawl">
          {{ crawling ? '刷新中...' : '刷新数据' }}
        </button>
      </div>
    </div>

    <div class="table-container">
      <table id="data-table">
        <thead>
          <tr>
            <th>公司名称</th>
            <th>企业性质</th>
            <th>行业</th>
            <th>招聘对象</th>
            <th>招聘类型</th>
            <th>截止时间</th>
            <th>发布时间</th>
            <th>投递链接</th>
            <th>公告链接</th>
            <th>投递情况</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody id="table-body"></tbody>
      </table>
    </div>

    <div class="pagination">
      <button id="btn-prev" @click="changePage(-1)">上一页</button>
      <span id="page-info">第 1 页</span>
      <button id="btn-next" @click="changePage(1)">下一页</button>
    </div>
  </div>

  <!-- 爬取进度弹窗：真弹窗覆盖在底层页面之上，完成后显示确定按钮 -->
  <el-dialog
    v-model="crawlDialogVisible"
    title="正在刷新数据"
    width="560px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="crawlFinished"
    :before-close="onCrawlDialogClose"
    class="crawl-dialog"
  >
    <div class="crawl-body">
      <div class="crawl-spinner" v-if="!crawlFinished"></div>
      <h3 class="crawl-title">{{ crawlFinished ? '数据刷新完成' : '正在爬取数据...' }}</h3>
      <el-alert
        v-if="crawlStatus.lastError"
        :title="crawlStatus.lastError"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />
      <p class="crawl-stage-text">{{ crawlStatus.stage || '准备中...' }}</p>
      <div class="crawl-sources">
        <div
          v-for="(src, key) in crawlStatus.sources"
          :key="key"
          class="crawl-source"
          :class="src.status"
        >
          <span class="crawl-source-name">{{ src.label }}</span>
          <span class="crawl-source-status">
            <el-icon v-if="src.status === 'running'" class="is-loading"><Loading /></el-icon>
            <el-icon v-else-if="src.status === 'done'" color="#67c23a"><Check /></el-icon>
            <el-icon v-else-if="src.status === 'error'" color="#f56c6c"><Close /></el-icon>
            <span v-if="src.status === 'done' && src.count >= 0">✓ {{ src.count }} 条{{ src.note ? '（' + src.note + '）' : '' }}</span>
            <span v-else-if="src.status === 'error'">✗ {{ src.count || 0 }} 条 · {{ src.note || '失败' }}</span>
            <span v-else-if="src.status === 'running'">爬取中...</span>
            <span v-else>等待中</span>
          </span>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="crawlFinished" type="primary" @click="onCrawlConfirm">确定</el-button>
        <span v-else class="crawl-hint">请稍候，数据刷新中...</span>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, Check, Close } from '@element-plus/icons-vue'
import {
  getCompanies,
  getCompaniesStats,
  getCompanyStatuses,
  updateCompanyStatus,
  getDeliveredCompanies,
  crawlCompanies,
  getCrawlStatus
} from '@/api/companies'

// 字段映射：后端驼峰字段 -> 旧版中文展示键（仅用于筛选/搜索/表格展示一致性）
const FILTER_FIELDS = ['企业性质', '行业', '招聘对象', '招聘类型', '截止时间', '投递情况']
// 旧版后端字段名（驼峰）对应中文筛选维度
const FIELD_KEY_MAP = {
  企业性质: 'type',
  行业: 'industry',
  招聘对象: 'recruitTarget',
  招聘类型: 'recruitType',
  截止时间: 'deadline',
  投递情况: 'status'
}

const STORAGE_KEY = 'qzh_company_filters'

const allRecords = ref([])
const totalCompanies = ref(0)
const currentPage = ref(1)
const pageSize = 50
const search = ref('')
const sort = ref('date_desc')

// 状态数据（复刻旧版 _statuses/_dates/_notes）
const statuses = reactive({})
const dates = reactive({})
const notes = reactive({})

// 首页下拉筛选选中态（每个维度: 选中值数组）
const filters = reactive({
  企业性质: [], 行业: [], 招聘对象: [], 招聘类型: [], 截止时间: [], 投递情况: []
})

let statsLoaded = false
// 全量统计数据（来自 /companies/stats，覆盖全部 3870 条，用于筛选面板计数）
const globalStats = reactive({
  total: 0,
  byType: {}, byIndustry: {}, byRecruitTarget: {}, byRecruitTypeSplit: {}, byDeadline: {}, byStatus: {}
})
const crawling = ref(false)
const crawlAlertShown = ref(false)
const crawlDialogVisible = ref(false)
const crawlFinished = ref(false)
const crawlStatus = reactive({
  stage: '准备中...',
  lastError: '',
  sources: {}
})

const filterFields = FILTER_FIELDS.map((f) => ({ key: f, label: f }))

// ===== 数据加载 =====
// loadList：拉取「当前筛选条件 + 当前页」的公司（服务端已筛选+分页），
// 返回的 total 即「筛选后真实总数」。供搜索、翻页、勾选筛选复用。
async function loadList() {
  const res = await getCompanies(buildParams())
  allRecords.value = (res.data.content || []).map(mapRecord)
  // total = 应用当前筛选条件后后端匹配的总数（全库口径，非当前页 50）
  totalCompanies.value = res.data.total || allRecords.value.length
  // 拉取全状态回填（含"不投递"，修复刷新后兜底成未投递的 bug）
  await decorateStatus()
  renderTable()
}

async function loadData() {
  restoreFilters()
  // 拉全量统计（一次），供筛选面板显示真实全库计数（而非当前页 50 条）
  try {
    const sres = await getCompaniesStats()
    const d = sres.data || {}
    globalStats.total = d.total || 0
    globalStats.byType = d.byType || {}
    globalStats.byIndustry = d.byIndustry || {}
    globalStats.byRecruitTarget = d.byRecruitTarget || {}
    globalStats.byRecruitTypeSplit = d.byRecruitTypeSplit || {}
    globalStats.byDeadline = d.byDeadline || {}
    globalStats.byStatus = d.byStatus || {}
  } catch (e) {}
  await loadList()
  populateFilters()
  renderDeliverySummary()
  statsLoaded = true
}

// 后端 Company 实体 -> 旧版中文键结构（保持 renderTable/populateFilters 逻辑不变）
function mapRecord(c) {
  return {
    公司名称: c.companyName || '',
    企业性质: c.type ? [c.type] : [],
    行业: c.industry ? [c.industry] : [],
    招聘对象: c.recruitTarget ? [c.recruitTarget] : [],
    招聘类型: c.recruitType ? [c.recruitType] : [],
    截止时间: c.deadline || '',
    投递链接: c.applyUrl || '',
    公告链接: c.announceUrl || '',
    发布日期: c.publishDate || '',
    source: c.source || '',
    id: c.id,
    applyDate: c.applyDate || ''
  }
}

// 状态回填（修复：用 /statuses 全状态接口，含"不投递"）
// 注意：必须基于【全量】状态记录回填，而非仅当前页 allRecords——否则翻到不含被跟踪公司的
// 那一页时 statuses 为空，导致投递进度面板全 0、所有行状态下拉显示 "-"。
async function decorateStatus() {
  try {
    const res = await getCompanyStatuses()
    const list = res.data || []
    // 全量回填（跨分页），供投递进度面板统计 + 任意页行内下拉查询
    list.forEach((d) => {
      const name = d.companyName
      if (!name) return
      statuses[name] = d.status || ''
      if (d.applyDate) dates[name] = d.applyDate
      if (d.note) notes[name] = d.note
    })
  } catch (e) {}
}

function buildParams() {
  const p = { page: currentPage.value, size: pageSize }
  if (search.value) p.keyword = search.value
  if (sort.value) p.sort = sort.value
  // 多选字段以竖线 '|' 拼接传递（后端 splitMulti 按 '|' 解析）。
  // 注意：行业等字段的值本身含逗号（如 "机械装备/电气系统,军工/航空航天"），
  // 不能用逗号做分隔符，否则会被误拆；改用数据里不会出现的 '|'。
  FILTER_FIELDS.forEach((f) => {
    if (filters[f].length) p[FIELD_KEY_MAP[f]] = filters[f].join('|')
  })
  return p
}

// 判断某个筛选值是否应被勾选（filters 为空表示不过滤 = 全选）
function isFilterChecked(field, value) {
  const selected = filters[field] || []
  if (selected.length === 0) return true
  return selected.includes(value)
}

// ===== 筛选面板渲染（复刻旧版 populateFilters / toggleAll） =====
function populateFilters() {
  FILTER_FIELDS.forEach((field) => {
    const container = document.getElementById('filter-' + field)
    if (!container) return
    const selected = filters[field] || []
    if (field === '截止时间') {
      const opts = ['7天内', '8-30天', '30天以上', '已截止', '招满为止']
      const dlCounts = globalStats.byDeadline || {}
      const allChecked = selected.length === 0 || opts.every((v) => selected.includes(v))
      container.innerHTML = `
        <label class="filter-checkbox filter-all">
          <input type="checkbox" value="__all__" ${allChecked ? 'checked' : ''} onchange="window.__c.updateAll('截止时间', this)">
          <span><b>全部</b> (${globalStats.total || allRecords.value.length})</span>
        </label>
        ${opts.map((v) => `<label class="filter-checkbox"><input type="checkbox" value="${v}" ${isFilterChecked(field, v) ? 'checked' : ''} onchange="window.__c.filterData()"><span>${v === '7天内' ? '🔴 7天内紧急' : v === '8-30天' ? '🟠 8-30天' : v === '30天以上' ? '🟢 30天以上' : v === '已截止' ? '⛔ 已截止' : '📋 招满为止'} (${dlCounts[v] || 0})</span></label>`).join('')}
      `
      return
    }
    if (field === '投递情况') {
      // 「未投递」用非空字面量 '未投递' 作为标记值（与后端 statusByCompany 归一值一致），
      // 避免空串被 splitMulti 过滤导致筛选失效。
      const statusOrder = ['未投递', '已投递', '已笔试', '已面试', '已挂', '不投递', '已offer']
      const statusLabels = { '未投递': '未投递', '已投递': '已投递', '已笔试': '已笔试', '已面试': '已面试', '已挂': '已挂', '不投递': '不投递', '已offer': '已offer' }
      const byStatus = globalStats.byStatus || {}
      // 后端 byStatus 仅含「有状态记录」的公司；未投递 = 全量 - 已标注有效状态之和（含脏数据归一）。
      const trackedSum = statusOrder.filter((s) => s !== '未投递').reduce((acc, s) => acc + (Number(byStatus[s]) || 0), 0)
      const undelivered = Math.max(0, (globalStats.total || 0) - trackedSum)
      const counts = { '未投递': undelivered }
      statusOrder.filter((s) => s !== '未投递').forEach((s) => { counts[s] = Number(byStatus[s]) || 0 })
      const allChecked = selected.length === 0 || statusOrder.every((v) => selected.includes(v))
      let html = `<label class="filter-checkbox filter-all"><input type="checkbox" value="__all__" ${allChecked ? 'checked' : ''} onchange="window.__c.updateAll('投递情况', this)"><span><b>全部</b> (${globalStats.total || allRecords.value.length})</span></label>`
      html += statusOrder.map((s) => `<label class="filter-checkbox"><input type="checkbox" value="${s}" ${isFilterChecked(field, s) ? 'checked' : ''} onchange="window.__c.filterData()"><span>${statusLabels[s]} (${counts[s] || 0})</span></label>`).join('')
      container.innerHTML = html
      return
    }
    // 全量计数来源：企业性质->byType, 行业->byIndustry, 招聘对象->byRecruitTarget, 招聘类型->byRecruitTypeSplit
    let sourceMap = {}
    if (field === '企业性质') sourceMap = globalStats.byType || {}
    else if (field === '行业') sourceMap = globalStats.byIndustry || {}
    else if (field === '招聘对象') sourceMap = globalStats.byRecruitTarget || {}
    else if (field === '招聘类型') sourceMap = globalStats.byRecruitTypeSplit || {}
    const values = {}
    Object.entries(sourceMap).forEach(([k, v]) => { if (k) values[k] = Number(v) || 0 })
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1])
    const keys = sorted.map(([val]) => val)
    const allChecked = selected.length === 0 || keys.every((v) => selected.includes(v))
    let html = `<label class="filter-checkbox filter-all"><input type="checkbox" value="__all__" ${allChecked ? 'checked' : ''} onchange="window.__c.updateAll('${field}', this)"><span><b>全选</b> (${globalStats.total || allRecords.value.length})</span></label>`
    html += sorted.map(([val, count]) => `<label class="filter-checkbox"><input type="checkbox" value="${val}" ${isFilterChecked(field, val) ? 'checked' : ''} onchange="window.__c.filterData()"><span>${val} (${count})</span></label>`).join('')
    container.innerHTML = html
  })
}

function toggleFilter(field) {
  const container = document.getElementById('filter-' + field)
  const isOpen = container.style.display !== 'none'
  document.querySelectorAll('.filter-options').forEach((el) => (el.style.display = 'none'))
  container.style.display = isOpen ? 'none' : 'flex'
}

function updateAll(field, checkbox) {
  const checked = checkbox.checked
  const container = document.getElementById('filter-' + field)
  container.querySelectorAll('input:not([value="__all__"])').forEach((cb) => (cb.checked = checked))
  filterData()
}

function updateAllCheckbox(field) {
  const container = document.getElementById('filter-' + field)
  if (!container) return
  const allCheckbox = container.querySelector('input[value="__all__"]')
  const others = container.querySelectorAll('input:not([value="__all__"])')
  const allChecked = [...others].every((cb) => cb.checked)
  const anyChecked = [...others].some((cb) => cb.checked)
  if (allCheckbox) {
    allCheckbox.checked = allChecked
    allCheckbox.indeterminate = !allChecked && anyChecked
  }
}

// ===== 筛选逻辑（复刻旧版 filterRecords / filterData） =====
function getDeadlineDays(deadline) {
  if (!deadline || deadline === '招满为止') return null
  const match = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const d = new Date(+match[1], +match[2] - 1, +match[3])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((d - today) / (1000 * 60 * 60 * 24))
}

function filterRecords(records, kw, fieldFilters) {
  return records.filter((r) => {
    if (kw) {
      const fields = [
        r['公司名称'] || '', (r['行业'] || []).join(' '), (r['企业性质'] || []).join(' '),
        (r['招聘对象'] || []).join(' '), (r['招聘类型'] || []).join(' '), r['备注'] || '', r['source'] || ''
      ]
      if (!fields.join(' ').toLowerCase().includes(kw)) return false
    }
    for (const [field, selected] of Object.entries(fieldFilters)) {
      if (!selected.length) continue
      if (field === '截止时间') {
        const days = getDeadlineDays(r['截止时间'])
        let cat
        if (days === null) cat = '招满为止'
        else if (days < 0) cat = '已截止'
        else if (days <= 7) cat = '7天内'
        else if (days <= 30) cat = '8-30天'
        else cat = '30天以上'
        if (!selected.includes(cat)) return false
        continue
      }
      if (field === '投递情况') {
        const cur = statuses[r['公司名称']] || ''
        if (!selected.includes(cur)) return false
        continue
      }
      const recVals = r[field] || []
      if (Array.isArray(recVals) && recVals.length === 0) continue
      if (!selected.some((s) => recVals.includes(s))) return false
    }
    return true
  })
}

function getPublishSortKey(dateStr) {
  if (!dateStr) return 0
  const m = String(dateStr).match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/)
  if (!m) return 0
  return +m[1] * 10000 + +m[2] * 100 + (+m[3] || 0)
}
function getDeadlineSortKey(deadline) {
  if (!deadline || deadline === '招满为止' || deadline === '招满即止') return Infinity
  const m = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return Infinity
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
}
function compareByKey(a, b, keyFn, asc) {
  const ka = keyFn(a), kb = keyFn(b)
  const aInv = ka === 0 || ka === Infinity, bInv = kb === 0 || kb === Infinity
  if (aInv && bInv) return 0
  if (aInv) return 1
  if (bInv) return -1
  return asc ? ka - kb : kb - ka
}
function sortRecords(records, mode) {
  const s = [...records]
  switch (mode) {
    case 'date_desc': return s.sort((a, b) => compareByKey(a, b, (r) => getPublishSortKey(r['发布日期']), false))
    case 'date_asc': return s.sort((a, b) => compareByKey(a, b, (r) => getPublishSortKey(r['发布日期']), true))
    case 'deadline_asc': return s.sort((a, b) => compareByKey(a, b, (r) => getDeadlineSortKey(r['截止时间']), true))
    case 'deadline_desc': return s.sort((a, b) => compareByKey(a, b, (r) => getDeadlineSortKey(r['截止时间']), false))
    case 'name_asc': return s.sort((a, b) => String(a['公司名称'] || '').localeCompare(String(b['公司名称'] || ''), 'zh'))
    case 'name_desc': return s.sort((a, b) => String(b['公司名称'] || '').localeCompare(String(a['公司名称'] || ''), 'zh'))
    default: return s
  }
}

async function filterData(resetPage = true) {
  const fieldFilters = {}
  FILTER_FIELDS.forEach((f) => {
    const allCbs = document.querySelectorAll('#filter-' + f + ' input:not([value="__all__"])')
    const checkedCbs = document.querySelectorAll('#filter-' + f + ' input:checked:not([value="__all__"])')
    // 全选 或 全不选 都视为「该维度不过滤」（旧版语义：勾全选 = 看全部）
    if (checkedCbs.length === 0 || checkedCbs.length === allCbs.length) {
      fieldFilters[f] = []
    } else {
      fieldFilters[f] = [...checkedCbs].map((cb) => cb.value)
    }
  })
  // 同步到 filters（供 buildParams 持久化到后端筛选）
  FILTER_FIELDS.forEach((f) => (filters[f] = [...fieldFilters[f]]))
  if (resetPage) currentPage.value = 1
  // 筛选走服务端：后端返回的 total 即「筛选后真实总数」，currentPage 数据即筛选后当前页
  await loadList()
  renderTable()
  saveFilters()
  FILTER_FIELDS.forEach((f) => updateAllCheckbox(f))
}

let kwTimer = null
function onKeywordInput() {
  if (kwTimer) clearTimeout(kwTimer)
  // 关键词搜索走服务端（跨全量 3853 条），回到第 1 页后重新拉取
  kwTimer = setTimeout(() => { currentPage.value = 1; loadList() }, 250)
}

function saveFilters() {
  // 不再持久化搜索关键词，避免每次进页面都恢复上次的搜索词
  const state = { sort: sort.value }
  FILTER_FIELDS.forEach((f) => (state[f] = [...filters[f]]))
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (e) {}
}
function restoreFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    if (state.sort) sort.value = state.sort
    FILTER_FIELDS.forEach((f) => { filters[f] = Array.isArray(state[f]) ? [...state[f]] : [] })
  } catch (e) {}
}

function resetFilters() {
  FILTER_FIELDS.forEach((f) => (filters[f] = []))
  search.value = ''
  sort.value = 'date_desc'
  try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
  populateFilters()
  filterData()
}

// ===== 表格渲染（复刻旧版 renderTable + linkHtml） =====
function linkHtml(val, shortText) {
  if (!val || val === '#' || val === '') return '<span class="no-link">-</span>'
  if (typeof val === 'string' && val.startsWith('http')) {
    // shortText：投递链接等只需可点、不必展示完整 URL 的列（悬停 title 仍可见完整地址）
    const text = shortText || (val.length > 40 ? val.substring(0, 40) + '...' : val)
    return `<a href="${val}" target="_blank" title="${val}">${text}</a>`
  }
  return `<span class="link-text" title="${val}">${val.length > 20 ? val.substring(0, 20) + '...' : val}</span>`
}

async function renderTable() {
  const tbody = document.getElementById('table-body')
  // 服务端分页：allRecords 已是「当前筛选条件 + 当前页」的完整记录，直接渲染
  const pageRecords = allRecords.value
  tbody.innerHTML = pageRecords.map((r) => {
    const name = r['公司名称'] || ''
    const cur = statuses[name] || ''
    const note = notes[name] || ''
    const days = getDeadlineDays(r['截止时间'])
    let rowClass = '', deadlineStyle = ''
    if (days !== null) {
      if (days < 0) { rowClass = 'row-expired' }
      else if (days <= 7) { rowClass = 'row-urgent'; deadlineStyle = 'color:#d32f2f;font-weight:bold;' }
      else if (days <= 30) { rowClass = 'row-soon'; deadlineStyle = 'color:#e65100;' }
    }
    return `
      <tr class="${rowClass}">
        <td class="td-name" title="${name}">${name}</td>
        <td>${(r['企业性质'] || []).join(', ')}</td>
        <td class="td-industry" title="${(r['行业'] || []).join(', ')}">${(r['行业'] || []).join(', ')}</td>
        <td>${(r['招聘对象'] || []).join(', ')}</td>
        <td>${(r['招聘类型'] || []).join(', ')}</td>
        <td style="${deadlineStyle}">${r['截止时间'] || '招满为止'}</td>
        <td class="pd-cell">${r['发布日期'] || '-'}</td>
        <td class="link-cell apply-link-cell">${linkHtml(r['投递链接'], '去投递 ↗')}</td>
        <td class="link-cell">${linkHtml(r['公告链接'])}</td>
        <td>
          <select class="status-select status-${cur}" data-company="${encodeURIComponent(name)}" onchange="window.__c.saveDeliveryStatus(this)">
            <option value="" ${cur === '' ? 'selected' : ''}>-</option>
            <option value="未投递" ${cur === '未投递' ? 'selected' : ''}>未投递</option>
            <option value="已投递" ${cur === '已投递' ? 'selected' : ''}>已投递</option>
            <option value="已笔试" ${cur === '已笔试' ? 'selected' : ''}>已笔试</option>
            <option value="已面试" ${cur === '已面试' ? 'selected' : ''}>已面试</option>
            <option value="已挂" ${cur === '已挂' ? 'selected' : ''}>已挂</option>
            <option value="不投递" ${cur === '不投递' ? 'selected' : ''}>不投递</option>
            <option value="已offer" ${cur === '已offer' ? 'selected' : ''}>已offer</option>
          </select>
        </td>
        <td>
          <input type="text" class="note-input" data-company="${encodeURIComponent(name)}" value="${note}" placeholder="添加备注..." onchange="window.__c.saveNote(this)" />
        </td>
      </tr>`
  }).join('')

  const totalPages = Math.ceil(totalCompanies.value / pageSize) || 1
  document.getElementById('page-info').textContent = `第 ${currentPage.value}/${totalPages} 页 (共 ${totalCompanies.value} 条)`
  document.getElementById('btn-prev').disabled = currentPage.value <= 1
  document.getElementById('btn-next').disabled = currentPage.value >= totalPages
  const countEl = document.getElementById('filtered-count')
  // 左侧 = 筛选后真实总数（服务端 total，全库口径）；右侧 = 全库总数（globalStats.total）
  // Sunwz|2026-10-22|有关键词时后端为全局搜索（筛选挂起），文案如实提示
  if (search.value) {
    countEl.textContent = globalStats.total > 0
      ? `全局搜索: ${totalCompanies.value} / ${globalStats.total} 条（筛选已临时挂起）` : ''
  } else {
    countEl.textContent = globalStats.total > 0
      ? `筛选结果: ${totalCompanies.value} / ${globalStats.total} 条` : ''
  }
}

function changePage(delta) {
  const totalPages = Math.ceil(totalCompanies.value / pageSize) || 1
  const next = Math.max(1, Math.min(totalPages, currentPage.value + delta))
  if (next === currentPage.value) return
  currentPage.value = next
  loadList()
}

// ===== 状态/备注保存（复刻旧版 saveDeliveryStatus / saveNote，对接后端） =====
async function saveDeliveryStatus(selectEl) {
  const name = decodeURIComponent(selectEl.dataset.company)
  const value = selectEl.value
  const row = allRecords.value.find((r) => r['公司名称'] === name)
  const id = row ? row.id : null
  if (!id) { ElMessage.warning('该公司记录缺少 ID，无法保存'); return }
  if (value) {
    statuses[name] = value
    if (value === '已投递' && !dates[name]) dates[name] = new Date().toISOString().substring(0, 10)
    if (value !== '已投递' && dates[name]) delete dates[name]
  } else {
    delete statuses[name]
    delete dates[name]
  }
  selectEl.className = 'status-select' + (value ? ' status-' + value : '')
  try {
    await updateCompanyStatus(id, { status: value || null, applyDate: dates[name] || null, note: notes[name] || '' })
    ElMessage.success('已更新投递状态')
  } catch (e) {}
  renderDeliverySummary()
}

async function saveNote(inputEl) {
  const name = decodeURIComponent(inputEl.dataset.company)
  const value = inputEl.value.trim()
  const row = allRecords.value.find((r) => r['公司名称'] === name)
  const id = row ? row.id : null
  if (value) notes[name] = value
  else delete notes[name]
  if (id) {
    try {
      await updateCompanyStatus(id, { status: statuses[name] || null, applyDate: dates[name] || null, note: value || '' })
    } catch (e) {}
  }
}

// ===== 投递进度面板（复刻旧版 renderDeliverySummary） =====
function renderDeliverySummary() {
  const counts = { '未投递': 0, '已投递': 0, '已笔试': 0, '已面试': 0, '已挂': 0, '不投递': 0, '已offer': 0 }
  Object.values(statuses).forEach((s) => { if (counts.hasOwnProperty(s)) counts[s]++ })
  const total = Object.keys(statuses).length
  const container = document.getElementById('delivery-summary')
  if (!container) return
  container.innerHTML = `
    <div class="delivery-stats">
      <span class="ds-label">投递进度:</span>
      <span class="ds-item ds-已投递">已投递 <b>${counts['已投递']}</b></span>
      <span class="ds-item ds-已笔试">已笔试 <b>${counts['已笔试']}</b></span>
      <span class="ds-item ds-已面试">已面试 <b>${counts['已面试']}</b></span>
      <span class="ds-item ds-已挂">已挂 <b>${counts['已挂']}</b></span>
      <span class="ds-item ds-未投递">未投递 <b>${counts['未投递']}</b></span>
      <span class="ds-item ds-不投递">不投递 <b>${counts['不投递']}</b></span>
      <span class="ds-item ds-已offer">已offer <b>${counts['已offer']}</b></span>
      <span class="ds-item ds-total">已跟踪 <b>${total}</b>/${totalCompanies.value}</span>
    </div>`
}

// ===== 爬取弹窗控制 =====
function openCrawlDialog() {
  crawlDialogVisible.value = true
  crawlFinished.value = false
  crawlAlertShown.value = false
  crawling.value = true
  crawlStatus.stage = '准备中...'
  crawlStatus.lastError = ''
  crawlStatus.sources = {}
}

function onCrawlDialogClose(done) {
  // 未完成时禁止关闭弹窗（防止用户误触空白处关闭）
  if (!crawlFinished.value) return
  done()
}

async function onCrawlConfirm() {
  crawlDialogVisible.value = false
  crawling.value = false
  await loadData()
  // 真实反馈：若部分数据源不可用（如缺 playwright），如实告知用户
  if (crawlStatus.lastError && String(crawlStatus.lastError).includes('不可用')) {
    ElMessage.warning('⚠️ 数据已更新（真实爬取）。部分数据源不可用：' + crawlStatus.lastError)
  } else {
    ElMessage.success('✅ 爬取完成！数据已更新。')
  }
}

async function triggerCrawl() {
  openCrawlDialog()
  try {
    await crawlCompanies()
  } catch (e) {}

  let pollActive = true
  const poll = setInterval(async () => {
    if (!pollActive) return
    try {
      const resp = await getCrawlStatus()
      const data = resp.data || {}
      if (data.stage) crawlStatus.stage = data.stage
      if (data.lastError) crawlStatus.lastError = data.lastError
      if (data.sources) {
        crawlStatus.sources = data.sources
      }
      if (data.status === 'done' || data.status === 'error') {
        pollActive = false
        clearInterval(poll)
        crawlFinished.value = true
        crawling.value = false
      }
    } catch (e) {}
  }, 800)
}

// 暴露给原生 onchange 内联处理器
window.__c = {
  filterData, updateAll, saveDeliveryStatus, saveNote
}

function onDocClick(e) {
  if (!e.target.closest('.filter-group')) {
    document.querySelectorAll('.filter-options').forEach((el) => (el.style.display = 'none'))
  }
}

onMounted(() => {
  loadData()
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  delete window.__c
})
</script>

<style scoped>
/* ===== 复刻旧版 style.css 视觉（官网汇总首页） ===== */
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
:deep(.delivery-summary) { background: #fff; padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 15px; }
:deep(.delivery-stats) { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
:deep(.ds-label) { font-weight: 600; color: #333; font-size: 14px; }
:deep(.ds-item) { padding: 4px 10px; border-radius: 4px; font-size: 13px; background: #f5f5f5; }
:deep(.ds-item b) { font-size: 15px; }
:deep(.ds-已投递) { background: #e8f5e9; color: #2e7d32; }
:deep(.ds-已笔试) { background: #e3f2fd; color: #1565c0; }
:deep(.ds-已面试) { background: #f3e5f5; color: #7b1fa2; }
:deep(.ds-已挂) { background: #ffebee; color: #c62828; }
:deep(.ds-未投递) { background: #fff3e0; color: #e65100; }
:deep(.ds-不投递) { background: #f5f5f5; color: #616161; }
:deep(.ds-已offer) { background: #fff8e1; color: #f9a825; }
:deep(.ds-total) { background: #e8eaf6; color: #283593; }

:deep(.search-box) { margin-bottom: 15px; }
:deep(#search-input) { width: 100%; padding: 12px 16px; border: 1px solid #ddd; border-radius: 6px; font-size: 15px; outline: none; box-sizing: border-box; }
:deep(#search-input:focus) { border-color: #1a73e8; }
:deep(.filtered-count) { font-size: 14px; color: #1a73e8; font-weight: 600; margin-left: 10px; }

:deep(.filters) { display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); align-items: flex-start; }
:deep(.filter-group) { position: relative; min-width: 140px; }
:deep(.filter-label) { font-size: 14px; font-weight: 600; color: #333; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; cursor: pointer; text-align: left; transition: background 0.2s; width: 100%; }
:deep(.filter-label:hover) { background: #e8f0fe; border-color: #1a73e8; }
/* Sunwz|2026-10-22|筛选激活态：高亮蓝底，一眼看出哪些维度挂着筛选 */
:deep(.filter-label.filter-active) { background: #1a73e8; color: #fff; border-color: #1a73e8; }
:deep(.filter-label.filter-active:hover) { background: #1565c0; }
:deep(.sort-label) { appearance: none; -webkit-appearance: none; -moz-appearance: none; background: #f0f7ff; color: #1a73e8; border-color: #1a73e8; }
:deep(.sort-label:hover) { background: #e8f0fe; }
:deep(.sort-label option) { background: #fff; color: #333; }
:deep(.filter-options) { position: absolute; top: 100%; left: 0; z-index: 1000; display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; min-width: 200px; border: 1px solid #ddd; border-radius: 4px; padding: 8px; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
:deep(.filter-checkbox) { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; padding: 3px 6px; border-radius: 3px; }
:deep(.filter-checkbox:hover) { background: #f0f7ff; }
:deep(.filter-checkbox input[type="checkbox"]) { cursor: pointer; width: 14px; height: 14px; }
:deep(.filter-checkbox span) { flex: 1; }
:deep(.filter-all) { border-bottom: 1px solid #eee; margin-bottom: 4px; padding-bottom: 6px; }

:deep(.filter-actions) { margin-left: auto; display: flex; gap: 8px; align-items: center; }
:deep(.action-btn) { font-size: 14px; font-weight: 600; color: #333; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px; padding: 8px 14px; cursor: pointer; transition: background 0.2s; }
:deep(.action-btn:hover) { background: #e8f0fe; border-color: #1a73e8; }
:deep(.action-btn:disabled) { opacity: 0.6; cursor: not-allowed; }

:deep(.table-container) { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow-x: auto; }
:deep(table) { width: 100%; border-collapse: collapse; font-size: 14px; }
:deep(th) { background: #f8f9fa; padding: 12px 10px; text-align: left; font-weight: 600; border-bottom: 2px solid #e0e0e0; white-space: nowrap; }
:deep(td) { padding: 10px; border-bottom: 1px solid #f0f0f0; }
/* 行高挤压：所有单元格不换行，长内容列用 max-width+省略号（悬停 title 看全文），
   消除「招聘对象/招聘类型」等短内容列被挤到换行产生的空行 */
:deep(td) { white-space: nowrap; }
:deep(.td-name) { max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
:deep(.td-industry) { max-width: 210px; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: #555; }
/* 发布时间列：紧跟截止时间，弱化展示 */
:deep(.pd-cell) { font-size: 13px; color: #555; }
/* 投递链接列窄化：固定短文案「去投递 ↗」，完整地址悬停可见 */
:deep(.apply-link-cell) { max-width: 96px; }
:deep(.apply-link-cell a) { white-space: nowrap; }
:deep(tr:hover) { background: #f8faff; }
:deep(td a) { color: #1a73e8; text-decoration: none; }
:deep(td a:hover) { text-decoration: underline; }
:deep(.link-cell) { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.link-text) { color: #999; font-style: italic; cursor: help; border-bottom: 1px dashed #ccc; font-size: 12px; }
:deep(.status-select) { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; font-size: 13px; cursor: pointer; background: #fff; }
:deep(.status-select:focus) { outline: none; border-color: #1a73e8; }
:deep(.status-select.status-已投递) { background: #e8f5e9; color: #2e7d32; border-color: #4caf50; }
:deep(.status-select.status-未投递) { background: #fff3e0; color: #e65100; border-color: #ff9800; }
:deep(.status-select.status-已笔试) { background: #e3f2fd; color: #1565c0; border-color: #2196f3; }
:deep(.status-select.status-已面试) { background: #f3e5f5; color: #7b1fa2; border-color: #9c27b0; }
:deep(.status-select.status-已挂) { background: #ffebee; color: #c62828; border-color: #f44336; }
:deep(.status-select.status-不投递) { background: #f5f5f5; color: #616161; border-color: #9e9e9e; }
:deep(.status-select.status-已offer) { background: #fff8e1; color: #f57f17; border-color: #ffc107; }

:deep(tr.row-urgent) { background: #fff8e1 !important; }
:deep(tr.row-urgent:hover) { background: #fff3cd !important; }
:deep(tr.row-soon) { background: #fff3e0 !important; }
:deep(tr.row-soon:hover) { background: #ffe0b2 !important; }
:deep(tr.row-expired) { opacity: 0.6; text-decoration: line-through; color: #999; }

:deep(.note-input) { width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 12px; box-sizing: border-box; }
:deep(.note-input:focus) { outline: none; border-color: #1a73e8; }
:deep(.note-input::placeholder) { color: #ccc; }
:deep(.no-link) { color: #ccc; }

:deep(.pagination) { display: flex; justify-content: center; align-items: center; gap: 15px; margin-top: 20px; }
:deep(.pagination button) { padding: 8px 16px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; }
:deep(.pagination button:hover) { background: #e8f0fe; }
:deep(.pagination button:disabled) { opacity: 0.5; cursor: not-allowed; }
:deep(#page-info) { font-size: 14px; color: #666; }

/* 爬取弹窗 —— 复刻旧版 .crawl-overlay/.crawl-modal 视觉风格（保留 el-dialog 模态定位 + 确定按钮） */
:deep(.crawl-dialog .el-dialog) {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  padding: 0;
  overflow: hidden;
}
:deep(.crawl-dialog .el-dialog__header) {
  display: none; /* 隐藏默认标题栏，改用内部 .crawl-title，复刻旧版无标题栏外观 */
}
:deep(.crawl-dialog .el-dialog__body) {
  padding: 40px 50px;
  text-align: center;
}
:deep(.crawl-dialog .el-dialog__footer) {
  padding: 0 50px 32px;
  text-align: right;
}
.crawl-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #e0e0e0;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}
.crawl-title {
  margin: 0 0 8px;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}
.crawl-stage-text { text-align: center; color: #666; font-size: 14px; margin: 4px 0 16px 0; }
.crawl-sources { display: flex; flex-direction: column; gap: 8px; }
.crawl-source { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #f8f9fa; border-radius: 8px; transition: background 0.3s; }
.crawl-source.running { background: #e3f2fd; }
.crawl-source.done { background: #e8f5e9; }
.crawl-source.error { background: #ffebee; }
.crawl-source-name { flex: 1; font-size: 14px; color: #333; font-weight: 500; }
.crawl-source-status { font-size: 13px; display: flex; align-items: center; gap: 4px; }
.crawl-hint { color: #909399; font-size: 13px; }
.dialog-footer { display: flex; justify-content: flex-end; align-items: center; }
:deep(.crawl-source-status.waiting) { color: #999; }
:deep(.crawl-source-status.running) { color: #1a73e8; }
:deep(.crawl-source-status.done) { color: #4caf50; }
:deep(.crawl-source-status.error) { color: #d32f2f; }
:deep(.crawl-source-spinner) { width: 14px; height: 14px; border: 2px solid #e0e0e0; border-top-color: #1a73e8; border-radius: 50%; animation: crawl-spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes crawl-spin { to { transform: rotate(360deg); } }
</style>
