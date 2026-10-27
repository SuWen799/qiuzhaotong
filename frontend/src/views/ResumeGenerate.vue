<template>
  <div>
    <el-row :gutter="16">
      <!-- 输入区 -->
      <el-col :span="10">
        <el-card shadow="never" header="生成参数">
          <el-form label-position="top">
            <el-form-item label="目标公司">
              <el-input v-model="company" placeholder="如：腾讯 / 字节跳动" />
            </el-form-item>
            <el-form-item label="岗位">
              <el-input v-model="jobTitle" placeholder="选填，如 AI应用开发工程师" />
            </el-form-item>
            <el-form-item label="JD 文本">
              <el-input
                v-model="jdText"
                type="textarea"
                :rows="14"
                placeholder="粘贴岗位 JD 描述，系统将据此匹配并生成定制简历..."
              />
            </el-form-item>
            <el-form-item>
              <el-checkbox v-model="useLlm">使用 LLM 增强生成</el-checkbox>
            </el-form-item>
            <el-button type="primary" :icon="MagicStick" :loading="generating" @click="handleGenerate">
              生成简历
            </el-button>
          </el-form>
        </el-card>
      </el-col>

      <!-- 结果区 -->
      <el-col :span="14">
        <el-card shadow="never" v-loading="generating" element-loading-text="正在生成简历...">
          <template #header>
            <span>生成结果</span>
            <span v-if="result" style="float: right">
              <el-button size="small" type="primary" :icon="Document" @click="downloadFile('md')" :disabled="!result.versionId">MD</el-button>
              <el-button size="small" type="success" :icon="Printer" @click="downloadFile('pdf')" :disabled="!result.versionId">PDF</el-button>
            </span>
            <div v-if="result" class="result-filename">
              生成文件：{{ resultFileName }}.md / {{ resultFileName }}.pdf
            </div>
          </template>

          <el-empty v-if="!result" description="填写左侧 JD 后点击生成" />

          <div v-else>
            <el-row :gutter="12" class="metrics">
              <el-col :span="8">
                <el-card shadow="hover" class="metric">
                  <div class="m-val" style="color: #67c23a">{{ result.match ?? '-' }}%</div>
                  <div class="m-label">匹配度</div>
                </el-card>
              </el-col>
              <el-col :span="8">
                <el-card shadow="hover" class="metric">
                  <div class="m-val" style="color: #1a73e8">{{ covPct }}%</div>
                  <div class="m-label">覆盖度</div>
                </el-card>
              </el-col>
              <el-col :span="8">
                <el-card shadow="hover" class="metric">
                  <div class="m-val" style="color: #e6a23c">{{ (result.matchedSkills || []).length }}</div>
                  <div class="m-label">命中关键词</div>
                </el-card>
              </el-col>
            </el-row>

            <el-divider>JD 摘要</el-divider>
            <p class="jd-summary">{{ result.jdSummary || '（无）' }}</p>

            <el-divider>命中关键词</el-divider>
            <div class="kw-legend">
              <span class="legend-item"><i class="dot dot-green"></i>绿色 = 已命中 / 已包装进简历</span>
              <span class="legend-item"><i class="dot dot-gray"></i>灰色 = JD 已识别但简历未包装进去</span>
            </div>
            <el-tag v-for="s in result.matchedSkills || []" :key="'c-'+s" class="tag" type="success">
              {{ s }}
            </el-tag>
            <el-tag v-for="s in result.notCoveredSkills || []" :key="'n-'+s" class="tag" type="info" effect="plain">
              {{ s }}
            </el-tag>
            <span v-if="!(result.matchedSkills || []).length && !(result.notCoveredSkills || []).length" class="gray">无</span>

            <el-divider>变化明细</el-divider>
            <div v-if="coverageList.length">
              <el-row v-for="c in coverageList" :key="c.key" class="cov-row">
                <el-col :span="8">{{ c.key }}</el-col>
                <el-col :span="4">
                  <el-tag :type="c.rate >= 80 ? 'success' : c.rate >= 50 ? 'warning' : 'danger'" size="small">
                    {{ c.rate }}%
                  </el-tag>
                </el-col>
                <el-col :span="12" class="gray">{{ c.detail }}</el-col>
              </el-row>
            </div>
            <span v-else class="gray">无</span>

          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { MagicStick, Document, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { generateResume, downloadResumeVersion } from '@/api/resume'

const company = ref('')
const jobTitle = ref('')
const jdText = ref('')
const useLlm = ref(true)
const generating = ref(false)
const result = ref(null)

// 生成结果区展示的文件名（仅文件名，不含绝对路径），如：原版简历-公司名-岗位名.md
const resultFileName = computed(() => {
  const safeCompany = (company.value || '简历').replace(/[\\/:*?"<>|]/g, '_')
  const safeJob = (jobTitle.value || '').replace(/[\\/:*?"<>|]/g, '_')
  return `原版简历-${safeCompany}${safeJob ? '-' + safeJob : ''}`
})

// 覆盖度 = JD 关键词中「被简历命中」的占比（与旧版口径一致：已覆盖 / (已覆盖+未覆盖)）
const covPct = computed(() => {
  const r = result.value
  if (!r) return '-'
  const covered = (r.coveredList || []).length
  const notCovered = (r.notCoveredList || []).length
  const total = covered + notCovered
  return total ? Math.round((covered / total) * 100) : '-'
})

const coverageList = computed(() => {
  const r = result.value
  if (!r) return []
  const covered = r.coveredList || []
  const notCovered = r.notCoveredList || []
  const rows = []
  covered.slice(0, 30).forEach((k) => rows.push({ key: k, rate: 100, detail: '已匹配' }))
  notCovered.slice(0, 30).forEach((k) => rows.push({ key: k, rate: 0, detail: '缺口' }))
  return rows
})

// 后端返回 snake_case 契约（md_path/pdf_path/jd_summary/match_score/coverage{covered,not_covered,coverage_rate}），
// 这里统一适配为前端展示用的结构（驼峰 + 数字型 coverage）。
function adaptResult(raw) {
  if (!raw) return {}
  const cov = raw.coverage || {}
  const covered = Array.isArray(cov.covered) ? cov.covered : []
  const notCovered = Array.isArray(cov.not_covered) ? cov.not_covered : []
  const total = covered.length + notCovered.length
  const coveredRate = total ? Math.round((covered.length / total) * 100) : 0
  return {
    mdPath: raw.md_path || '',
    pdfPath: raw.pdf_path || '',
    mdContent: raw.md_content || '',
    versionId: raw.version_id != null ? raw.version_id : null,
    jdSummary: raw.jd_summary || '',
    match: typeof raw.match_score === 'number' ? raw.match_score : 0,
    matchedSkills: covered,
    notCoveredSkills: notCovered,
    coverage: {
      '关键词覆盖': coveredRate,
      '已覆盖': covered.length,
      '未覆盖': notCovered.length,
      '覆盖率': coveredRate
    },
    variableModules: raw.variable_modules || {},
    coveredList: covered,
    notCoveredList: notCovered
  }
}

async function handleGenerate() {
  if (!jdText.value.trim()) {
    ElMessage.warning('请填写 JD 文本')
    return
  }
  generating.value = true
  result.value = null
  try {
    const res = await generateResume({
      jdText: jdText.value,
      company: company.value,
      jobTitle: jobTitle.value,
      useLlm: useLlm.value
    })
    const data = res.data || {}
    // 后端可能返回 200 + success:false（如引擎超时/失败），必须显式判断
    if (!data.success) {
      ElMessage.error(data.error || '简历生成失败')
      result.value = null
      return
    }
    result.value = adaptResult(data)
    ElMessage.success('简历生成完成')
  } catch (e) {
    console.error('[ResumeGenerate] 生成失败:', e)
    ElMessage.error(e?.response?.data?.error || e?.message || '生成失败')
  } finally {
    generating.value = false
  }
}

// 走带鉴权的下载接口（版本库同款方式），避免直接拼接绝对路径或缺失 JWT
async function downloadFile(type) {
  if (!result.value?.versionId) {
    ElMessage.warning('未获取到简历版本，暂无法下载')
    return
  }
  try {
    const res = await downloadResumeVersion(result.value.versionId, type)
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // 文件名仅展示「文件名」，包含公司名与岗位名（如填写），不含任何绝对路径
    a.download = `${resultFileName.value}.${type}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success(`已下载 ${type.toUpperCase()}`)
  } catch (e) {
    console.error('[ResumeGenerate] 下载失败:', e)
    ElMessage.error('下载失败：' + (e?.response?.data?.error || e?.message || '未知错误'))
  }
}
</script>

<style scoped>
.metrics {
  margin-bottom: 6px;
}
.metric {
  text-align: center;
}
.m-val {
  font-size: 26px;
  font-weight: bold;
}
.m-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.tag {
  margin: 0 6px 6px 0;
}
.gray {
  color: #909399;
}
.kw-legend {
  margin-bottom: 8px;
  font-size: 12px;
  color: #606266;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  margin-right: 14px;
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
}
.dot-green {
  background: #67c23a;
}
.dot-gray {
  background: #c0c4cc;
}
.result-filename {
  clear: both;
  margin-top: 8px;
  font-size: 13px;
  color: #1a73e8;
  background: #eef4ff;
  padding: 6px 10px;
  border-radius: 4px;
  word-break: break-all;
}
.jd-summary {
  color: #606266;
  line-height: 1.6;
}
.cov-row {
  padding: 6px 0;
  border-bottom: 1px dashed #ebeef5;
  align-items: center;
}
</style>
