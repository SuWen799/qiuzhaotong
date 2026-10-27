<template>
  <el-card shadow="never" class="versions-card">
    <template #header>
      <div class="head">
        <span>文件简历</span>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </template>
    <el-table :data="versions" v-loading="loading" border stripe>
      <!-- 公司 -->
      <el-table-column prop="company" label="公司" min-width="140" show-overflow-tooltip />

      <!-- 岗位：有值显示岗位名，没填显示「-」（不显示路径） -->
      <el-table-column prop="jobTitle" label="岗位" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.jobTitle">{{ row.jobTitle }}</span>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <!-- 创建时间：后端返回 yyyy-MM-dd HH:mm:ss 直接显示；ISO 串则用原生格式化保留整数秒 -->
      <el-table-column label="创建时间" min-width="180">
        <template #default="{ row }">
          <span>{{ formatTime(row.createdAt) }}</span>
        </template>
      </el-table-column>

      <!-- 匹配度 -->
      <el-table-column prop="matchScore" label="匹配度" width="90" align="center">
        <template #default="{ row }">
          <span v-if="row.matchScore != null" class="score">{{ row.matchScore }}</span>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <!-- 命中关键词：绿色=已命中/已包装进简历；灰色=JD 已识别但简历未包装进去 -->
      <el-table-column label="命中关键词" min-width="260">
        <template #default="{ row }">
          <template v-if="coveredOf(row).length || notCoveredOf(row).length">
            <el-tooltip
              v-for="k in coveredOf(row)"
              :key="'c-' + k"
              content="简历已命中该关键词"
              placement="top"
            >
              <el-tag size="small" type="success" class="kw-tag">{{ k }}</el-tag>
            </el-tooltip>
            <el-tooltip
              v-for="k in notCoveredOf(row)"
              :key="'n-' + k"
              content="JD 已识别，但简历未体现（建议补充）"
              placement="top"
            >
              <el-tag size="small" type="info" effect="plain" class="kw-tag">{{ k }}</el-tag>
            </el-tooltip>
          </template>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <!-- 操作：原版简历(id=0)仅 PDF 下载，不可删除；普通版本 MD/PDF 下载 + 删除 -->
      <el-table-column label="操作" min-width="220">
        <template #default="{ row }">
          <div class="ops">
            <el-button
              v-if="row.mdExists"
              size="small"
              type="primary"
              :icon="Document"
              @click="download(row, 'md')"
            >MD</el-button>
            <el-button
              v-if="row.pdfExists"
              size="small"
              type="success"
              :icon="Printer"
              @click="download(row, 'pdf')"
            >PDF</el-button>
            <el-button
              v-if="!isOriginal(row)"
              size="small"
              type="danger"
              :icon="Delete"
              @click="remove(row)"
            />
          </div>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Refresh, Document, Printer, Delete } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getResumeVersions,
  deleteResumeVersion,
  downloadResumeVersion
} from '@/api/resume'

const versions = ref([])
const loading = ref(false)
let refreshTimer = null

// 原版简历特殊标记：后端在 /resume/versions 插入，id=0 或 isOriginal=true
function isOriginal(row) {
  return row && (row.id === 0 || row.id === '0' || row.isOriginal === true)
}

// 格式化创建时间：后端可能返回 yyyy-MM-dd HH:mm:ss（直接显示），
// 也可能返回 ISO 串，此时用原生 new Date().toLocaleString('zh-CN') 格式化保留整数秒。
function formatTime(val) {
  if (!val) return '-'
  // 已是标准展示格式（含空格的分隔时间），直接返回
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) {
    return val
  }
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}

async function load() {
  loading.value = true
  try {
    const res = await getResumeVersions()
    versions.value = res.data || []
  } catch (e) {
  } finally {
    loading.value = false
  }
}

// 从版本数据里解析命中关键词（后端 coverage 字段为 JSON 字符串：{covered,not_covered,coverage_rate}）
function coveredOf(row) {
  const cov = row && row.coverage
  if (!cov) return []
  try {
    const obj = typeof cov === 'string' ? JSON.parse(cov) : cov
    return Array.isArray(obj.covered) ? obj.covered : []
  } catch (e) {
    return []
  }
}

// JD 已识别、但简历未体现的关键词（置灰，提示待补充）
function notCoveredOf(row) {
  const cov = row && row.coverage
  if (!cov) return []
  try {
    const obj = typeof cov === 'string' ? JSON.parse(cov) : cov
    return Array.isArray(obj.not_covered) ? obj.not_covered : []
  } catch (e) {
    return []
  }
}

async function download(row, type) {
  try {
    const res = await downloadResumeVersion(row.id, type)
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // 前端构造下载文件名：原版简历-公司名[-岗位名].ext
    const company = (row.company || '简历').replace(/[\\/:*?"<>|]/g, '_')
    const job = (row.jobTitle || '').replace(/[\\/:*?"<>|]/g, '_')
    a.download = `原版简历-${company}${job ? '-' + job : ''}.${type}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success(`已下载 ${type.toUpperCase()}`)
  } catch (e) {}
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.company || '该版本'}」的该版本？`, '删除确认', {
      type: 'warning'
    })
    await deleteResumeVersion(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {}
}

onMounted(() => {
  load()
  // 静默热更新：每 15 秒刷新一次版本列表，让「原版简历」的同步时间自动变化
  refreshTimer = setInterval(load, 15000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
/* 操作列按钮容器：自动换行，避免挤压重叠 */
.ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.score {
  color: #2e7d32;
  font-weight: 600;
}
.muted {
  color: #c0c4cc;
}
/* 命中关键词标签：允许换行并保持间距 */
.kw-tag {
  margin: 2px 4px 2px 0;
}
</style>
