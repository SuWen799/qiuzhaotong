<template>
  <div class="container">
    <div class="stats-summary" id="stats-summary"></div>
    <div class="stats-panel">
      <h3>每日新增岗位数量</h3>
      <div id="stats-chart"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { getCompaniesDaily, getCompaniesStats } from '@/api/companies'

const chartData = ref([])
const hasData = ref(false)

async function loadTrend() {
  try {
    const [dailyRes, statsRes] = await Promise.all([getCompaniesDaily(), getCompaniesStats()])
    const data = dailyRes.data || {}
    const summary = data.summary || {}
    const statsData = statsRes.data || {}
    const uniqueCompanies = statsData.total ?? summary.total ?? 0
    const dayList = data.daily || []
    document.getElementById('stats-summary').innerHTML = `
      <div class="summary-cards">
        <div class="summary-card"><span class="card-value">${uniqueCompanies}</span><span class="card-label">唯一公司数</span></div>
        <div class="summary-card"><span class="card-value">${summary.trendTotal ?? '-'}</span><span class="card-label">趋势总记录</span></div>
        <div class="summary-card"><span class="card-value">${summary.avg ?? '-'}</span><span class="card-label">日均新增</span></div>
        <div class="summary-card"><span class="card-value">${summary.todayNew ?? '-'}</span><span class="card-label">今日新增</span></div>
      </div>`
    chartData.value = [...dayList].reverse()
    hasData.value = chartData.value.length > 0
    renderChart()
  } catch (e) {}
}

// 折线图渲染（复刻旧版 SVG 折线 + 数据点标注，蓝线 #1a73e8）
function renderChart() {
  nextTick(() => {
    const el = document.getElementById('stats-chart')
    if (!el) return
    const data = chartData.value
    if (!Array.isArray(data) || !data.length) {
      el.innerHTML = '<p class="no-data">暂无历史数据</p>'
      return
    }
    const chartHeight = 320
    const padding = { top: 30, right: 30, bottom: 60, left: 50 }
    const containerWidth = el.parentElement.clientWidth - 40
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
    el.innerHTML = html
  })
}

onMounted(loadTrend)
</script>

<style scoped>
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
:deep(.stats-summary) { margin-bottom: 20px; }
:deep(.summary-cards) { display: flex; gap: 15px; flex-wrap: wrap; }
:deep(.summary-card) { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 15px 20px; flex: 1; min-width: 150px; text-align: center; }
:deep(.card-value) { display: block; font-size: 28px; font-weight: 700; color: #1a73e8; }
:deep(.card-label) { display: block; font-size: 13px; color: #666; margin-top: 4px; }
:deep(.stats-panel) { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); padding: 20px; margin-top: 20px; }
:deep(.stats-panel h3) { margin-bottom: 15px; color: #333; }
:deep(.no-data) { color: #999; font-size: 14px; }
:deep(.chart-container) { width: 100%; overflow-x: auto; }
:deep(.chart-container svg) { background: #fafbfc; border-radius: 4px; }
</style>
