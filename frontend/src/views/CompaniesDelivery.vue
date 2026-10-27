<template>
  <div class="container">
    <!-- 顶部筛选栏（投递趋势按钮作为里面的子元素，不另起 DOM） -->
    <div class="filters" id="delivery-filters"></div>

    <div class="delivery-overview" id="delivery-overview"></div>

    <!-- 已投递公司表格（复刻旧版） -->
    <div class="stats-panel">
      <h3>已投递的公司</h3>
      <div class="search-box">
        <input
          type="text"
          id="delivery-applied-search"
          placeholder="搜索已投递的公司..."
          v-model="appliedSearch"
          @input="onAppliedSearch"
        />
      </div>
      <div class="table-container">
        <table id="delivery-applied-table">
          <thead>
            <tr>
              <th>公司名称</th>
              <th>企业性质</th>
              <th>行业</th>
              <th>招聘对象</th>
              <th>招聘类型</th>
              <th>截止时间</th>
              <th>投递链接</th>
              <th>公告链接</th>
              <th>投递情况</th>
            </tr>
          </thead>
          <tbody id="delivery-applied-body"></tbody>
        </table>
      </div>
      <div class="pagination" id="delivery-applied-pagination"></div>
    </div>

    <!-- 投递趋势 / 招聘趋势 弹窗 -->
    <el-dialog v-model="trendDialogVisible" title="趋势分析" width="80%" top="5vh">
      <div class="trend-tabs" style="margin-bottom: 16px; display: flex; gap: 10px;">
        <el-button :type="trendTab === 'delivery' ? 'primary' : 'default'" @click="switchTrendTab('delivery')">投递趋势</el-button>
        <el-button :type="trendTab === 'recruit' ? 'primary' : 'default'" @click="switchTrendTab('recruit')">招聘趋势</el-button>
      </div>
      <div class="stats-panel">
        <h3>{{ trendTab === 'delivery' ? '每日投递数量' : '每日新增岗位数量' }}</h3>
        <div :id="trendTab === 'delivery' ? 'delivery-chart' : 'recruit-chart'"></div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getCompanies,
  getCompaniesStats,
  getCompanyStatuses,
  updateCompanyStatus,
  getDeliveredCompanies,
  getCompaniesDaily
} from '@/api/companies'

const FILTER_FIELDS = ['企业性质', '行业', '招聘对象', '招聘类型', '截止时间', '投递情况']
const FIELD_KEY_MAP = {
  企业性质: 'type', 行业: 'industry', 招聘对象: 'recruitTarget',
  招聘类型: 'recruitType', 截止时间: 'deadline', 投递情况: 'status'
}
const DELIVERY_FILTER_KEY = 'qzh_delivery_filters'
// 「未投递」用非空字面量 '未投递'（与后端 statusByCompany 归一值一致，避免空串筛选失效）
const STATUS_ORDER = ['未投递', '已投递', '已笔试', '已面试', '已挂', '不投递', '已offer']
const STATUS_LABELS = { '未投递': '未投递', '已投递': '已投递', '已笔试': '已笔试', '已面试': '已面试', '已挂': '已挂', '不投递': '不投递', '已offer': '已offer' }
const ACTIVE_STATUSES = ['已投递', '已笔试', '已面试', '已挂', '已offer']

const allRecords = ref([])
const deliveryFilteredRecords = ref([])
const statuses = reactive({})
const dates = reactive({})
const notes = reactive({})
const filters = reactive({ 企业性质: [], 行业: [], 招聘对象: [], 招聘类型: [], 截止时间: [], 投递情况: [] })
// 全量统计数据（来自 /companies/stats，覆盖全部 3870 条，用于筛选面板计数）
const globalStats = reactive({
  total: 0,
  byType: {}, byIndustry: {}, byRecruitTarget: {}, byRecruitTypeSplit: {}, byDeadline: {}, byStatus: {}
})
const appliedSearch = ref('')
const trendDialogVisible = ref(false)
const trendTab = ref('delivery')
let deliveryLoaded = false
let deliveryAppliedPage = 1
const DA_PAGE_SIZE = 50
let deliveryAppliedTotal = 0

async function loadDeliveryData() {
  const [listRes, statusRes, deliveredRes, statsRes] = await Promise.all([
    getCompanies({ page: 1, size: 10000 }),
    getCompanyStatuses(),
    getDeliveredCompanies(),
    getCompaniesStats()
  ])
  allRecords.value = (listRes.data.content || []).map(mapRecord)
  ;(statusRes.data || []).forEach((d) => {
    // 未记录状态的公司归一为「未投递」（与筛选/后端语义一致）
    statuses[d.companyName] = d.status && d.status !== '' ? d.status : '未投递'
    if (d.applyDate) dates[d.companyName] = d.applyDate
    if (d.note) notes[d.companyName] = d.note
  })
  const sd = statsRes.data || {}
  globalStats.total = sd.total || 0
  globalStats.byType = sd.byType || {}
  globalStats.byIndustry = sd.byIndustry || {}
  globalStats.byRecruitTarget = sd.byRecruitTarget || {}
  globalStats.byRecruitTypeSplit = sd.byRecruitTypeSplit || {}
  globalStats.byDeadline = sd.byDeadline || {}
  globalStats.byStatus = sd.byStatus || {}
  deliveryLoaded = true
}

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
    id: c.id
  }
}

// ===== 筛选栏（复刻旧版 populateDeliveryFilters） =====
function populateDeliveryFilters() {
  const containerId = 'delivery-filters'
  const container = document.getElementById(containerId)
  if (!container) return
  let html = ''
  FILTER_FIELDS.forEach((field) => {
    html += `<div class="filter-group" id="delivery-group-${field}">
      <button type="button" class="filter-label" onclick="window.__d.toggleDeliveryFilter('${field}')">${field} ▼</button>
      <div class="filter-options" id="delivery-filter-${field}" style="display:none"></div>
    </div>`
  })
  html += `<div class="filter-group filter-group-sync">
    <button type="button" id="btn-sync-filters" class="filter-label sync-btn" onclick="window.__d.syncFiltersFromHome()" title="将首页的筛选条件同步到投递统计">🔄 同步首页筛选</button>
  </div>`
  // 投递趋势按钮作为筛选条 DOM 内部最后一个子元素（与「同步首页筛选」并列靠右）
  html += `<div class="filter-group filter-group-trend">
    <button type="button" class="filter-label trend-btn" onclick="window.__d.openTrendDialog()" title="查看投递趋势折线图">📈 投递趋势</button>
  </div>`
  container.innerHTML = html

  FILTER_FIELDS.forEach((field) => {
    const el = document.getElementById('delivery-filter-' + field)
    if (!el) return
    if (field === '截止时间') {
      const dl = globalStats.byDeadline || {}
      const opts = ['7天内', '8-30天', '30天以上', '已截止', '招满为止']
      el.innerHTML = `
        <label class="filter-checkbox filter-all"><input type="checkbox" value="__all__" checked onchange="window.__d.toggleDeliveryAll('截止时间', this)"><span><b>全部</b> (${globalStats.total || allRecords.value.length})</span></label>
        ${opts.map((v) => `<label class="filter-checkbox"><input type="checkbox" value="${v}" checked onchange="window.__d.filterDeliveryPage()"><span>${v === '7天内' ? '🔴 7天内紧急' : v === '8-30天' ? '🟠 8-30天' : v === '30天以上' ? '🟢 30天以上' : v === '已截止' ? '⛔ 已截止' : '📋 招满为止'} (${dl[v] || 0})</span></label>`).join('')}`
      return
    }
    if (field === '投递情况') {
      const byStatus = globalStats.byStatus || {}
      const trackedSum = STATUS_ORDER.filter((s) => s !== '未投递').reduce((acc, s) => acc + (Number(byStatus[s]) || 0), 0)
      const undelivered = Math.max(0, (globalStats.total || 0) - trackedSum)
      const counts = { '未投递': undelivered }
      STATUS_ORDER.filter((s) => s !== '未投递').forEach((s) => { counts[s] = Number(byStatus[s]) || 0 })
      let opts = `<label class="filter-checkbox filter-all"><input type="checkbox" value="__all__" checked onchange="window.__d.toggleDeliveryAll('投递情况', this)"><span><b>全选</b> (${globalStats.total || allRecords.value.length})</span></label>`
      opts += STATUS_ORDER.map((s) => `<label class="filter-checkbox"><input type="checkbox" value="${s}" checked onchange="window.__d.filterDeliveryPage()"><span>${STATUS_LABELS[s]} (${counts[s] || 0})</span></label>`).join('')
      el.innerHTML = opts
      return
    }
    let sourceMap = {}
    if (field === '企业性质') sourceMap = globalStats.byType || {}
    else if (field === '行业') sourceMap = globalStats.byIndustry || {}
    else if (field === '招聘对象') sourceMap = globalStats.byRecruitTarget || {}
    else if (field === '招聘类型') sourceMap = globalStats.byRecruitTypeSplit || {}
    const values = {}
    Object.entries(sourceMap).forEach(([k, v]) => { if (k) values[k] = Number(v) || 0 })
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1])
    let opts = `<label class="filter-checkbox filter-all"><input type="checkbox" value="__all__" checked onchange="window.__d.toggleDeliveryAll('${field}', this)"><span><b>全选</b> (${globalStats.total || allRecords.value.length})</span></label>`
    opts += sorted.map(([val, count]) => `<label class="filter-checkbox"><input type="checkbox" value="${val}" checked onchange="window.__d.filterDeliveryPage()"><span>${val} (${count})</span></label>`).join('')
    el.innerHTML = opts
  })
}

// 返回某字段对应的筛选条 container
function filterContainers(field) {
  const el = document.getElementById('delivery-filter-' + field)
  return el ? [el] : []
}

function toggleDeliveryFilter(field) {
  const containers = filterContainers(field)
  if (!containers.length) return
  const firstOpen = containers[0]
  const isOpen = firstOpen.style.display !== 'none'
  document.querySelectorAll('.filter-options').forEach((e) => (e.style.display = 'none'))
  containers.forEach((el) => { el.style.display = isOpen ? 'none' : 'flex' })
}
function toggleDeliveryAll(field, checkbox) {
  const checked = checkbox.checked
  filterContainers(field).forEach((container) => {
    container.querySelectorAll('input:not([value="__all__"])').forEach((cb) => (cb.checked = checked))
  })
  filterDeliveryPage()
}
function updateDeliveryAllCheckbox(field) {
  filterContainers(field).forEach((container) => {
    const allCheckbox = container.querySelector('input[value="__all__"]')
    const others = container.querySelectorAll('input:not([value="__all__"])')
    if (!allCheckbox) return
    allCheckbox.checked = others.length > 0 && [...others].every((cb) => cb.checked)
    allCheckbox.indeterminate = [...others].some((cb) => cb.checked) && !allCheckbox.checked
  })
}

// 同步首页筛选（复刻旧版 syncFiltersFromHome）
function syncFiltersFromHome() {
  // 从首页 localStorage 读取（与首页 STORAGE_KEY 一致）
  try {
    const raw = localStorage.getItem('qzh_company_filters')
    if (!raw) { ElMessage.info('首页尚未保存筛选条件'); return }
    const state = JSON.parse(raw)
    FILTER_FIELDS.forEach((f) => {
      filters[f] = Array.isArray(state[f]) ? [...state[f]] : []
      const cbs = document.querySelectorAll('#delivery-filter-' + f + ' input')
      cbs.forEach((cb) => { cb.checked = filters[f].includes(cb.value) })
    })
    filterDeliveryPage()
    ElMessage.success('已同步首页筛选条件')
  } catch (e) {}
}

function saveDeliveryFilters() {
  const state = {}
  FILTER_FIELDS.forEach((f) => (state[f] = [...filters[f]]))
  try { localStorage.setItem(DELIVERY_FILTER_KEY, JSON.stringify(state)) } catch (e) {}
}
function restoreDeliveryFilters() {
  try {
    const raw = localStorage.getItem(DELIVERY_FILTER_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    FILTER_FIELDS.forEach((f) => {
      filters[f] = Array.isArray(state[f]) ? [...state[f]] : []
      const cbs = document.querySelectorAll('#delivery-filter-' + f + ' input')
      cbs.forEach((cb) => { cb.checked = filters[f].includes(cb.value) })
    })
  } catch (e) {}
}

function getDeadlineDays(deadline) {
  if (!deadline || deadline === '招满为止') return null
  const m = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.floor((d - t) / (1000 * 60 * 60 * 24))
}

function filterRecords(records, kw, fieldFilters) {
  return records.filter((r) => {
    if (kw) {
      const fields = [r['公司名称'] || '', (r['行业'] || []).join(' '), (r['企业性质'] || []).join(' '), (r['招聘对象'] || []).join(' '), (r['招聘类型'] || []).join(' '), r['备注'] || '', r['source'] || '']
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
        const cur = statuses[r['公司名称']] || '未投递'
        if (!selected.includes(cur)) return false
        continue
      }
      // 多值字段（行业/招聘对象/招聘类型可能存逗号组合串），按逗号展开后与选中值匹配，
      // 与企业列表页后端 like 语义保持一致（勾单值可命中组合值记录）
      const raw = r[field] || []
      const recVals = []
      const rawArr = Array.isArray(raw) ? raw : [raw]
      rawArr.forEach((v) => String(v).split(',').forEach((x) => { const t = x.trim(); if (t) recVals.push(t) }))
      if (recVals.length === 0) continue
      if (!selected.some((s) => recVals.includes(s))) return false
    }
    return true
  })
}

function filterDeliveryPage() {
  const kw = appliedSearch.value.toLowerCase()
  const fieldFilters = {}
  FILTER_FIELDS.forEach((f) => {
    const cbs = document.querySelectorAll('#delivery-filter-' + f + ' input:checked')
    fieldFilters[f] = [...cbs].map((cb) => cb.value).filter((v) => v !== '__all__')
    filters[f] = [...fieldFilters[f]]
  })
  deliveryFilteredRecords.value = filterRecords(allRecords.value, kw, fieldFilters)
  FILTER_FIELDS.forEach((f) => updateDeliveryAllCheckbox(f))
  saveDeliveryFilters()
  renderDeliveryOverview()
  renderDeliveryChart()
  renderDeliveryAppliedTable()
}

// 统一的「投递统计作用域」：总投递数、折线图、已投递表格三处共用同一份数据，
// 保证三者永远一致。规则：
//   1) 仅含活跃状态（已投递/已笔试/已面试/已挂/已offer）公司；
//   2) 受「投递情况」筛选 + 搜索约束；
//   3) 命中顶部其他维度（行业/性质/招聘对象等）筛选的公司才纳入；
//   4) 已下架（当前数据源无该行但保留状态）的公司不受字段筛选影响，始终保留。
function getDeliveryScope() {
  const kw = appliedSearch.value.toLowerCase()
  const statusSel = filters['投递情况'] || []
  const filteredNames = new Set(deliveryFilteredRecords.value.map((r) => r['公司名称']))
  const scope = new Set()
  Object.entries(statuses).forEach(([name, s]) => {
    if (!ACTIVE_STATUSES.includes(s)) return
    if (statusSel.length && !statusSel.includes(s)) return
    if (kw && !name.toLowerCase().includes(kw)) return
    if (filteredNames.has(name)) {
      scope.add(name)
      return
    }
    // 数据源中无此行的已下架公司：保留（不受字段筛选影响），投递情况/搜索已校验
    scope.add(name)
  })
  return scope
}

// 概览卡片（复刻旧版 renderDeliveryOverview）
function renderDeliveryOverview() {
  const total = deliveryFilteredRecords.value.length
  const today = new Date().toISOString().substring(0, 10)
  const scope = getDeliveryScope()
  const todayCount = Object.entries(dates).filter(([name, d]) => scope.has(name) && d === today).length
  const totalDelivered = scope.size
  document.getElementById('delivery-overview').innerHTML = `
    <div class="summary-cards">
      <div class="summary-card"><span class="card-value">${total}</span><span class="card-label">筛选后岗位总数</span></div>
      <div class="summary-card card-today"><span class="card-value">${todayCount}</span><span class="card-label">今天投递</span></div>
      <div class="summary-card card-total"><span class="card-value">${totalDelivered}</span><span class="card-label">总投递数</span></div>
      <div class="summary-card card-all"><span class="card-value">${globalStats.total}</span><span class="card-label">全库岗位总数</span></div>
    </div>
    <div class="filtered-count-line">筛选结果: ${total} / ${globalStats.total} 条</div>`
}

// 每日投递折线图（复刻旧版 renderDeliveryChart，绿线 #4caf50）
function renderDeliveryChart() {
  const container = document.getElementById('delivery-chart')
  if (!container) return // 弹窗未打开时 DOM 不存在，跳过（避免空引用崩溃）
  const deliveryByDate = {}
  // 统计「统一作用域」内全部活跃状态公司的每日投递分布（与总投递数、表格口径一致：
  // 已投递+已挂等活跃状态均计入，已挂公司现已补投日期，818 当天累计=14）
  const scope = getDeliveryScope()
  for (const [company, date] of Object.entries(dates)) {
    if (!scope.has(company)) continue
    if (ACTIVE_STATUSES.includes(statuses[company])) deliveryByDate[date] = (deliveryByDate[date] || 0) + 1
  }
  const daily = Object.entries(deliveryByDate).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
  if (daily.length === 0) {
    container.innerHTML = '<p class="no-data">暂无投递记录，在首页标记「已投递」后这里会显示趋势</p>'
    return
  }
  const data = [...daily].reverse()
  const chartHeight = 320
  const padding = { top: 30, right: 30, bottom: 60, left: 50 }
  const containerWidth = container.parentElement.clientWidth - 40
  const pointSpacing = 14
  const chartWidth = Math.max(containerWidth, data.length * pointSpacing + padding.left + padding.right)
  const maxCount = Math.max(...data.map((d) => d.count))
  const minCount = Math.min(...data.map((d) => d.count))
  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * (chartWidth - padding.left - padding.right)
    const y = chartHeight - padding.bottom - ((d.count - minCount) / Math.max(maxCount - minCount, 1)) * (chartHeight - padding.top - padding.bottom)
    return { x, y, date: d.date, count: d.count }
  })
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  let html = `<div class="chart-container" style="width:100%;overflow-x:auto"><svg width="${chartWidth}" height="${chartHeight}" style="display:block;margin:0 auto">`
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (i / 4) * (chartHeight - padding.top - padding.bottom)
    const val = Math.round(maxCount - (i / 4) * (maxCount - minCount))
    html += `<line x1="${padding.left}" y1="${y}" x2="${chartWidth - padding.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`
    html += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>`
  }
  html += `<path d="${pathD}" fill="none" stroke="#4caf50" stroke-width="2" stroke-linejoin="round"/>`
  points.forEach((p, i) => {
    html += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#4caf50" stroke="#fff" stroke-width="1.5"><title>${p.date}: ${p.count}家</title></circle>`
    html += `<text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="9" fill="#4caf50" font-weight="bold">${p.count}</text>`
    const labelStep = Math.max(1, Math.ceil(data.length / 25))
    if (i % labelStep === 0 || i === data.length - 1) {
      html += `<text x="${p.x}" y="${chartHeight - padding.bottom + 15}" text-anchor="middle" font-size="9" fill="#666" transform="rotate(-45, ${p.x}, ${chartHeight - padding.bottom + 15})">${p.date.substring(5)}</text>`
    }
  })
  html += '</svg></div>'
  container.innerHTML = html
}

// 招聘趋势（蓝线 #1a73e8），复用 CompaniesTrend.vue 渲染逻辑，接收 daily 数组
function renderRecruitTrendChart(daily) {
  const container = document.getElementById('recruit-chart')
  if (!container) return
  if (!daily || daily.length === 0) { container.innerHTML = '<p class="no-data">暂无历史数据</p>'; return }
  const data = [...daily].reverse()
  const chartHeight = 320
  const padding = { top: 30, right: 30, bottom: 60, left: 50 }
  const containerWidth = container.parentElement.clientWidth - 40
  const pointSpacing = 14
  const chartWidth = Math.max(containerWidth, data.length * pointSpacing + padding.left + padding.right)
  const maxCount = Math.max(...data.map((d) => d.count || 0), 1)
  const minCount = Math.min(...data.map((d) => d.count || 0), 0)
  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * (chartWidth - padding.left - padding.right)
    const y = chartHeight - padding.bottom - ((d.count - minCount) / Math.max(maxCount - minCount, 1)) * (chartHeight - padding.top - padding.bottom)
    return { x, y, date: d.date, count: d.count }
  })
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  let html = `<div class="chart-container" style="width:100%;overflow-x:auto"><svg width="${chartWidth}" height="${chartHeight}" style="display:block;margin:0 auto">`
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (i / 4) * (chartHeight - padding.top - padding.bottom)
    const val = Math.round(maxCount - (i / 4) * (maxCount - minCount))
    html += `<line x1="${padding.left}" y1="${y}" x2="${chartWidth - padding.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`
    html += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>`
  }
  html += `<path d="${pathD}" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>`
  points.forEach((p, i) => {
    html += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#1a73e8" stroke="#fff" stroke-width="1.5"><title>${p.date}: ${p.count}条</title></circle>`
    html += `<text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="9" fill="#1a73e8" font-weight="bold">${p.count}</text>`
    const labelStep = Math.max(1, Math.ceil(data.length / 25))
    if (i % labelStep === 0 || i === data.length - 1) {
      html += `<text x="${p.x}" y="${chartHeight - padding.bottom + 15}" text-anchor="middle" font-size="9" fill="#666" transform="rotate(-45, ${p.x}, ${chartHeight - padding.bottom + 15})">${p.date.substring(5)}</text>`
    }
  })
  html += '</svg></div>'
  container.innerHTML = html
}

// ===== 趋势弹窗 =====
function openTrendDialog() {
  trendDialogVisible.value = true
}
async function switchTrendTab(tab) {
  trendTab.value = tab
  await nextTick()
  if (tab === 'delivery') {
    renderDeliveryChart()
  } else if (tab === 'recruit') {
    try {
      const res = await getCompaniesDaily()
      const daily = (res && res.data && res.data.daily) ? res.data.daily : []
      renderRecruitTrendChart(daily)
    } catch (e) {
      const c = document.getElementById('recruit-chart')
      if (c) c.innerHTML = '<p class="no-data">加载招聘趋势数据失败</p>'
    }
  }
}

// ===== 已投递公司表格（复刻旧版 renderDeliveryAppliedTable） =====
function onAppliedSearch() {
  deliveryAppliedPage = 1
  filterDeliveryPage() // 复用整套刷新（卡片、表格、折线图同步）
}

function appliedStatusSelectHtml(company, status) {
  const options = ACTIVE_STATUSES
  return `<select class="status-select status-${status}" data-company="${encodeURIComponent(company)}" onchange="window.__d.saveDeliveryStatus(this)">
    ${options.map((o) => `<option value="${o}" ${status === o ? 'selected' : ''}>${o}</option>`).join('')}
  </select>`
}

function renderDeliveryAppliedTable() {
  const container = document.getElementById('delivery-applied-body')
  if (!container) return
  // 已投递表格：与总投递数/折线图共用统一作用域（投递情况筛选+搜索+顶部字段筛选生效，
  // 已下架公司始终保留），保证三处数字一致。
  const scope = getDeliveryScope()
  let companies = [...scope]
  companies.sort((a, b) => String(dates[b] || '').localeCompare(String(dates[a] || '')))
  deliveryAppliedTotal = companies.length
  const totalPages = Math.ceil(companies.length / DA_PAGE_SIZE) || 1
  if (deliveryAppliedPage > totalPages) deliveryAppliedPage = totalPages
  const start = (deliveryAppliedPage - 1) * DA_PAGE_SIZE
  const pageCompanies = companies.slice(start, start + DA_PAGE_SIZE)

  if (companies.length === 0) {
    container.innerHTML = '<tr><td colspan="9" class="no-data">暂无已投递的公司，在首页标记「已投递」后这里会显示</td></tr>'
  } else {
    container.innerHTML = pageCompanies.map((name) => {
      // 从完整数据源 allRecords 取详情（企业性质/行业/链接等），避免被顶部筛选误判为「已下架」
      const rec = allRecords.value.find((r) => r['公司名称'] === name)
      const r = rec || { '公司名称': name, '企业性质': [], '行业': [], '招聘对象': [], '招聘类型': [], '截止时间': '招满为止', '投递链接': '', '公告链接': '' }
      const s = statuses[name] || ''
      const date = dates[name] || ''
      // 真正「已下架」=数据源中都没有此公司记录（当前数据均无此情况）；
      // 若数据源有记录但投递链接为空，仅标记链接缺失（符合「只是链接没了」的语义）
      const removedMark = !rec
        ? `<span class="applied-expired" title="该公司当前不在数据源中，状态仍保留可跟进">⚠ 已下架</span>`
        : (!r['投递链接'] ? `<span class="applied-nolink" title="该公司投递链接缺失">🔗 链接缺失</span>` : '')
      return `
        <tr>
          <td>${r['公司名称'] || ''}${date ? `<span class="applied-date">(${date})</span>` : ''}${removedMark}</td>
          <td>${(r['企业性质'] || []).join(', ')}</td>
          <td>${(r['行业'] || []).join(', ')}</td>
          <td>${(r['招聘对象'] || []).join(', ')}</td>
          <td>${(r['招聘类型'] || []).join(', ')}</td>
          <td>${r['截止时间'] || '招满为止'}</td>
          <td class="link-cell">${linkHtml(r['投递链接'])}</td>
          <td class="link-cell">${linkHtml(r['公告链接'])}</td>
          <td>${appliedStatusSelectHtml(name, s)}</td>
        </tr>`
    }).join('')
  }
  renderDAPagination(totalPages)
}

function linkHtml(val) {
  if (!val || val === '#' || val === '') return '<span class="no-link">-</span>'
  if (typeof val === 'string' && val.startsWith('http')) {
    const text = val.length > 40 ? val.substring(0, 40) + '...' : val
    return `<a href="${val}" target="_blank" title="${val}">${text}</a>`
  }
  return `<span class="link-text" title="${val}">${val.length > 20 ? val.substring(0, 20) + '...' : val}</span>`
}

function renderDAPagination(totalPages) {
  const container = document.getElementById('delivery-applied-pagination')
  if (!container) return
  if (totalPages <= 1) { container.innerHTML = ''; return }
  let html = `<button class="page-num" onclick="window.__d.daChangePage(-1)" ${deliveryAppliedPage <= 1 ? 'disabled' : ''}>上一页</button>`
  generatePageNums(totalPages, deliveryAppliedPage).forEach((p) => {
    if (p === '...') html += '<span class="page-dots">...</span>'
    else html += `<button class="page-num ${p === deliveryAppliedPage ? 'active' : ''}" onclick="window.__d.daGotoPage(${p})">${p}</button>`
  })
  html += `<button class="page-num" onclick="window.__d.daChangePage(1)" ${deliveryAppliedPage >= totalPages ? 'disabled' : ''}>下一页</button>`
  html += `<span class="page-info">第 ${deliveryAppliedPage}/${totalPages} 页 (${deliveryAppliedTotal} 条)</span>`
  container.innerHTML = html
}
function daChangePage(delta) {
  const totalPages = Math.ceil(deliveryAppliedTotal / DA_PAGE_SIZE) || 1
  deliveryAppliedPage = Math.max(1, Math.min(totalPages, deliveryAppliedPage + delta))
  renderDeliveryAppliedTable()
}
function daGotoPage(page) {
  deliveryAppliedPage = page
  renderDeliveryAppliedTable()
}
function generatePageNums(totalPages, current) {
  const nums = new Set([1, totalPages])
  for (let i = Math.max(1, current - 2); i <= Math.min(totalPages, current + 2); i++) nums.add(i)
  const sorted = [...nums].sort((a, b) => a - b)
  const result = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) result.push('...')
    result.push(n)
    prev = n
  }
  return result
}

// 状态保存（投递统计页表格内联下拉）
async function saveDeliveryStatus(selectEl) {
  const name = decodeURIComponent(selectEl.dataset.company)
  const value = selectEl.value
  const row = allRecords.value.find((r) => r['公司名称'] === name)
  const id = row ? row.id : null
  if (value) {
    statuses[name] = value
    // 投递日期一旦设置即锁定不变（首次标记为已投递时初始化）
    if (value === '已投递' && !dates[name]) dates[name] = new Date().toISOString().substring(0, 10)
  }
  selectEl.className = 'status-select status-' + value
  if (id) {
    try { await updateCompanyStatus(id, { status: value, applyDate: dates[name] || null, note: notes[name] || '' }) } catch (e) {}
  }
  renderDeliveryOverview()
  renderDeliveryChart()
  renderDeliveryAppliedTable()
}

window.__d = {
  toggleDeliveryFilter, toggleDeliveryAll, syncFiltersFromHome, filterDeliveryPage,
  daChangePage, daGotoPage, saveDeliveryStatus,
  openTrendDialog, switchTrendTab
}

// 弹窗打开时确保绿色折线渲染（DOM 在 v-if 下需 nextTick 等待）
watch(trendDialogVisible, async (visible) => {
  if (visible) {
    trendTab.value = 'delivery'
    await nextTick()
    renderDeliveryChart()
  }
})

onMounted(async () => {
  await loadDeliveryData()
  populateDeliveryFilters()
  restoreDeliveryFilters()
  filterDeliveryPage()
})
</script>

<style scoped>
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
:deep(.filters) { display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); align-items: flex-start; }
:deep(.filter-group) { position: relative; min-width: 140px; }
:deep(.filter-label) { font-size: 14px; font-weight: 600; color: #333; background: #f8f9fa; border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; cursor: pointer; text-align: left; transition: background 0.2s; width: 100%; }
:deep(.filter-label:hover) { background: #e8f0fe; border-color: #1a73e8; }
:deep(.filter-options) { position: absolute; top: 100%; left: 0; z-index: 1000; display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; min-width: 200px; border: 1px solid #ddd; border-radius: 4px; padding: 8px; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
:deep(.filter-checkbox) { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; padding: 3px 6px; border-radius: 3px; }
:deep(.filter-checkbox:hover) { background: #f0f7ff; }
:deep(.filter-checkbox input[type="checkbox"]) { cursor: pointer; width: 14px; height: 14px; }
:deep(.filter-checkbox span) { flex: 1; }
:deep(.filter-all) { border-bottom: 1px solid #eee; margin-bottom: 4px; padding-bottom: 6px; }
:deep(.filter-group-sync) { margin-left: auto; }
:deep(.filter-group-trend) { margin-left: 8px; }
:deep(.sync-btn) { background: #e8f0fe !important; color: #1a73e8 !important; border-color: #1a73e8 !important; white-space: nowrap; }
:deep(.sync-btn:hover) { background: #d2e3fc !important; }
:deep(.trend-btn) { background: #1a73e8 !important; color: #fff !important; border-color: #1a73e8 !important; white-space: nowrap; }
:deep(.trend-btn:hover) { background: #155cb8 !important; border-color: #155cb8 !important; }

:deep(.delivery-overview) { margin-bottom: 20px; }
:deep(.summary-cards) { display: flex; gap: 15px; flex-wrap: wrap; }
:deep(.summary-card) { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 15px 20px; flex: 1; min-width: 150px; text-align: center; }
:deep(.card-value) { display: block; font-size: 28px; font-weight: 700; color: #1a73e8; }
:deep(.card-label) { display: block; font-size: 13px; color: #666; margin-top: 4px; }
:deep(.card-today .card-value) { color: #4caf50; }
:deep(.card-total .card-value) { color: #ff9800; }
:deep(.card-all .card-value) { color: #1a73e8; }
:deep(.filtered-count-line) { margin-top: 10px; font-size: 14px; color: #1a73e8; font-weight: 600; }

:deep(.stats-panel) { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 20px; margin-top: 20px; }
:deep(.stats-panel h3) { margin: 0 0 15px; color: #333; }
:deep(.no-data) { color: #999; font-size: 14px; }
:deep(.chart-container) { width: 100%; overflow-x: auto; }
:deep(.chart-container svg) { background: #fafbfc; border-radius: 4px; }

:deep(.search-box) { margin-bottom: 15px; }
:deep(#delivery-applied-search) { width: 100%; padding: 12px 16px; border: 1px solid #ddd; border-radius: 6px; font-size: 15px; outline: none; box-sizing: border-box; }
:deep(#delivery-applied-search:focus) { border-color: #1a73e8; }

:deep(.table-container) { background: #fff; border-radius: 8px; overflow-x: auto; }
:deep(table) { width: 100%; border-collapse: collapse; font-size: 14px; }
:deep(th) { background: #f8f9fa; padding: 12px 10px; text-align: left; font-weight: 600; border-bottom: 2px solid #e0e0e0; white-space: nowrap; }
:deep(td) { padding: 10px; border-bottom: 1px solid #f0f0f0; }
:deep(tr:hover) { background: #f8faff; }
:deep(td a) { color: #1a73e8; text-decoration: none; }
:deep(.link-cell) { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.link-text) { color: #999; font-style: italic; cursor: help; border-bottom: 1px dashed #ccc; font-size: 12px; }
:deep(.status-select) { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; font-size: 13px; cursor: pointer; background: #fff; }
:deep(.status-select:focus) { outline: none; border-color: #1a73e8; }
:deep(.status-select.status-已投递) { background: #e8f5e9; color: #2e7d32; border-color: #4caf50; }
:deep(.status-select.status-已笔试) { background: #e3f2fd; color: #1565c0; border-color: #2196f3; }
:deep(.status-select.status-已面试) { background: #f3e5f5; color: #7b1fa2; border-color: #9c27b0; }
:deep(.status-select.status-已挂) { background: #ffebee; color: #c62828; border-color: #f44336; }
:deep(.status-select.status-已offer) { background: #fff8e1; color: #f57f17; border-color: #ffc107; }
:deep(.applied-date) { font-size: 12px; color: #999; margin-left: 4px; font-weight: normal; }
:deep(.applied-expired) { display: inline-block; font-size: 12px; color: #c62828; background: #ffebee; border-radius: 3px; padding: 1px 6px; margin-left: 4px; }
:deep(.applied-nolink) { display: inline-block; font-size: 12px; color: #e65100; background: #fff3e0; border-radius: 3px; padding: 1px 6px; margin-left: 4px; }
:deep(.no-link) { color: #ccc; }

:deep(.pagination) { display: flex; justify-content: center; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 20px; }
:deep(.pagination button) { padding: 8px 16px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; }
:deep(.pagination button:hover) { background: #e8f0fe; }
:deep(.pagination button:disabled) { opacity: 0.5; cursor: not-allowed; }
:deep(#delivery-applied-pagination .page-num) { min-width: 36px; padding: 6px 10px; text-align: center; }
:deep(#delivery-applied-pagination .page-num.active) { background: #1a73e8; color: #fff; border-color: #1a73e8; }
:deep(#delivery-applied-pagination .page-dots) { color: #999; padding: 0 2px; }
:deep(#delivery-applied-pagination .page-info) { font-size: 13px; color: #666; margin-left: 6px; }
</style>
