<template>
  <el-card shadow="never">
    <template #header>插件管理（Edge 简历插件）</template>
    <el-tabs v-model="activeTab">
      <!-- 资料编辑 -->
      <el-tab-pane label="资料编辑" name="profile">
        <el-alert type="info" :closable="false" show-icon title="在此在线编辑插件使用的全量 profile（基础档案 + 版本映射）。保存后将自动同步至基础档案，供简历自动生成调用。" style="margin-bottom: 12px" />
        <el-button type="primary" :icon="Check" :loading="saving" @click="saveProfile">保存 profile</el-button>
        <el-button :icon="Refresh" @click="loadProfile">重新加载</el-button>
        <el-tag v-if="profileLoaded" type="success" size="small" style="margin-left: 10px">
          已从 profile.json 载入 {{ profileSectionCount }} 个板块
        </el-tag>
        <el-input
          v-model="profileText"
          type="textarea"
          :rows="18"
          style="margin-top: 12px"
          placeholder="编辑 profile JSON"
        />
      </el-tab-pane>

      <!-- 版本浏览 -->
      <el-tab-pane label="版本浏览" name="versions">
        <el-input
          v-model="versionSearch"
          placeholder="搜索公司名"
          style="width: 220px; margin-bottom: 12px"
          :prefix-icon="Search"
          clearable
          @input="filterVersions"
        />
        <el-table :data="filteredVersions" v-loading="verLoading" border stripe>
          <el-table-column prop="company" label="公司" min-width="160" />
          <el-table-column prop="jobId" label="JobId" min-width="160" />
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button size="small" type="primary" :icon="View" @click="viewVersion(row)">快照</el-button>
              <el-button size="small" :icon="Link" @click="copyVersionUrl(row)">链接</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-dialog v-model="verDetailVisible" :title="`版本快照 - ${currentVer?.company}`" width="70%">
          <pre class="json">{{ verDetailText }}</pre>
        </el-dialog>
      </el-tab-pane>

      <!-- 识别说明 -->
      <el-tab-pane label="识别说明" name="doc">
        <div class="doc">
          <h3>Edge 简历插件识别流程</h3>
          <ol>
            <li>用户在浏览器中访问目标公司投递页面，点击插件图标唤醒识别。</li>
            <li>插件读取页面中的 <code>company</code> 字段（或从页面标题/URL 提取公司名）。</li>
            <li>插件携带本系统下发的 <strong>访问令牌（token）</strong> 调用
              <code>GET /plugin/resume-version?company=&token=</code>。</li>
            <li>后端返回该公司的 <code>variableModules</code>（可替换模块：实习/项目/核心能力）与
              <code>baseSnapshot</code>（基础母本）。</li>
            <li>插件按页面字段将对应模块注入母本，生成最终简历并允许一键填入。</li>
            <li>若需浏览全部版本，调用 <code>GET /plugin/versions?token=</code>。</li>
          </ol>
          <el-alert type="warning" :closable="false" show-icon title="插件接口免 JWT，仅依赖 token 参数鉴权；token 可在「访问令牌」标签页获取。" />
        </div>
      </el-tab-pane>

      <!-- 访问令牌 -->
      <el-tab-pane label="访问令牌" name="token">
        <el-button type="primary" :icon="Refresh" :loading="tokenLoading" @click="loadToken">
          获取访问令牌
        </el-button>
        <el-alert
          v-if="pluginToken"
          type="success"
          :closable="false"
          show-icon
          style="margin-top: 14px"
        >
          <template #title>当前访问令牌</template>
          <code class="token">{{ pluginToken }}</code>
          <el-button size="small" :icon="CopyDocument" style="margin-left: 10px" @click="copyToken">
            复制
          </el-button>
        </el-alert>
        <el-empty v-else description="点击上方按钮获取令牌" />
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  Check,
  Refresh,
  Search,
  View,
  Link,
  CopyDocument
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getPluginProfile,
  updatePluginProfile,
  getPluginVersions,
  getPluginResumeVersion,
  getPluginToken,
  pluginResumeVersionUrl
} from '@/api/plugin'

const activeTab = ref('profile')

// ---- profile ----
const profileText = ref('{}')
const saving = ref(false)
const profileLoaded = ref(false)
const profileSectionCount = ref(0)
async function loadProfile() {
  try {
    const res = await getPluginProfile()
    const data = res.data?.profile ?? res.data ?? {}
    profileText.value = JSON.stringify(data, null, 2)
    const secs = data?.profileV2?.sections
    profileSectionCount.value = secs ? Object.keys(secs).length : 0
    profileLoaded.value = true
  } catch (e) {
    profileLoaded.value = false
  }
}
async function saveProfile() {
  saving.value = true
  try {
    const profile = JSON.parse(profileText.value || '{}')
    await updatePluginProfile(profile)
    ElMessage.success('profile 已保存，并已同步至基础档案（供简历自动生成）')
    loadProfile()
  } catch (e) {
    if (e instanceof SyntaxError) ElMessage.error('JSON 格式错误')
  } finally {
    saving.value = false
  }
}

// ---- versions ----
const verLoading = ref(false)
const versions = ref([])
const versionSearch = ref('')
const filteredVersions = computed(() => {
  const k = versionSearch.value.trim().toLowerCase()
  if (!k) return versions.value
  return versions.value.filter((v) => (v.company || '').toLowerCase().includes(k))
})
async function loadVersions() {
  verLoading.value = true
  try {
    const token = await ensureToken()
    if (!token) return
    const res = await getPluginVersions(token)
    versions.value = res.data || []
  } catch (e) {
  } finally {
    verLoading.value = false
  }
}
function filterVersions() {
  // 计算属性已处理过滤
}

const verDetailVisible = ref(false)
const verDetailText = ref('')
const currentVer = ref(null)
async function viewVersion(row) {
  currentVer.value = row
  verDetailText.value = '加载中...'
  verDetailVisible.value = true
  try {
    const token = await ensureToken()
    const res = await getPluginResumeVersion(row.company, token)
    verDetailText.value = JSON.stringify(res.data, null, 2)
  } catch (e) {
    verDetailText.value = '（加载失败）'
  }
}
async function copyVersionUrl(row) {
  const token = await ensureToken()
  const url = pluginResumeVersionUrl(row.company, token)
  await navigator.clipboard.writeText(url)
  ElMessage.success('版本链接已复制')
}

// ---- token ----
const pluginToken = ref('')
const tokenLoading = ref(false)
async function loadToken() {
  tokenLoading.value = true
  try {
    const res = await getPluginToken()
    pluginToken.value = res.data?.token ?? ''
    ElMessage.success('已获取令牌')
  } catch (e) {
  } finally {
    tokenLoading.value = false
  }
}
async function copyToken() {
  await navigator.clipboard.writeText(pluginToken.value)
  ElMessage.success('已复制')
}
// 内部确保有 token（优先缓存，否则拉取）
let tokenCache = ''
async function ensureToken() {
  if (tokenCache) return tokenCache
  const res = await getPluginToken()
  tokenCache = res.data?.token ?? ''
  pluginToken.value = tokenCache
  return tokenCache
}

onMounted(() => {
  loadProfile()
  loadVersions()
})
</script>

<style scoped>
.doc {
  line-height: 1.8;
  color: #606266;
}
.doc code {
  background: #f0f2f5;
  padding: 2px 6px;
  border-radius: 4px;
  color: #1a73e8;
}
.token {
  font-size: 14px;
  word-break: break-all;
}
.json {
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  background: #f7f8fa;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
}
</style>
