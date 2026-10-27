<template>
  <el-card shadow="never">
    <template #header>
      <div class="head">
        <span>参考素材管理</span>
        <el-tag type="info" size="small">素材目录：D:/qiuzhaohub/uploads/references</el-tag>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <!-- 原始素材目录（默认，直接看 md/图片） -->
      <el-tab-pane label="原始素材目录" name="raw">
        <el-breadcrumb separator="/" style="margin-bottom: 12px">
          <el-breadcrumb-item>
            <el-link type="primary" :underline="false" @click="navigate('')">根目录</el-link>
          </el-breadcrumb-item>
          <el-breadcrumb-item v-for="(seg, i) in pathSegs" :key="i">
            <el-link type="primary" :underline="false" @click="navigate(pathSegs.slice(0, i + 1).join('/'))">
              {{ seg }}
            </el-link>
          </el-breadcrumb-item>
        </el-breadcrumb>

        <!-- md 未入 json 提醒 -->
        <el-alert
          v-if="unsyncedMd.length"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
        >
          <template #title>
            <span>检测到 {{ unsyncedMd.length }} 个 markdown 文档尚未转为 JSON，无法用于生成简历的参考素材。</span>
          </template>
          <div class="sync-tip">
            <span class="sync-files">{{ unsyncedMd.map(f => f.name).join('、') }}</span>
            <el-button
              type="warning"
              size="small"
              :icon="Refresh"
              :loading="syncing"
              @click="syncMd"
              style="margin-left: 8px"
            >一键同步到 JSON</el-button>
          </div>
        </el-alert>

        <el-table :data="files" v-loading="loading" border stripe @row-dblclick="onRowDblClick">
          <el-table-column prop="name" label="名称" min-width="240">
            <template #default="{ row }">
              <el-icon v-if="row.isDir"><Folder /></el-icon>
              <el-icon v-else-if="row.kind === 'image'"><Picture /></el-icon>
              <el-icon v-else-if="row.kind === 'text'"><Document /></el-icon>
              <el-icon v-else><Files /></el-icon>
              {{ row.name }}
            </template>
          </el-table-column>
          <el-table-column prop="kind" label="类型" width="100">
            <template #default="{ row }">
              <el-tag size="small" v-if="row.isDir">目录</el-tag>
              <el-tag size="small" type="success" v-else-if="row.kind === 'image'">图片</el-tag>
              <el-tag size="small" type="info" v-else-if="row.kind === 'text'">文本</el-tag>
              <el-tag size="small" type="warning" v-else-if="row.kind === 'pdf'">PDF</el-tag>
              <el-tag size="small" v-else>其他</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="size" label="大小" width="120" />
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button v-if="row.isDir" size="small" :icon="FolderOpened" @click="navigate(row.path)">进入</el-button>
              <template v-else>
                <el-button size="small" :icon="View" @click="preview(row)">查看</el-button>
                <el-button size="small" type="primary" :icon="Download" @click="downloadFile(row)">下载</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 我的上传（DB 管理，可选） -->
      <el-tab-pane label="我的上传" name="uploaded">
        <div style="margin-bottom: 12px">
          <el-input v-model="keyword" placeholder="搜索素材" style="width: 180px; margin-right: 8px"
            :prefix-icon="Search" @keyup.enter="loadUploaded" clearable @clear="loadUploaded" />
          <el-button type="primary" :icon="UploadFilled" @click="uploadVisible = true">上传素材</el-button>
          <el-button :icon="Refresh" @click="loadUploaded">刷新</el-button>
        </div>
        <el-table :data="uploadedList" v-loading="upLoading" border stripe>
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="filename" label="文件名" min-width="180" />
          <el-table-column prop="category" label="分类" width="120">
            <template #default="{ row }"><el-tag size="small">{{ row.category }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="160" />
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button size="small" :icon="View" @click="viewUploaded(row)">查看</el-button>
              <el-button size="small" type="primary" :icon="Download" @click="downloadUploaded(row)">下载</el-button>
              <el-button size="small" type="danger" :icon="Delete" @click="removeUploaded(row)" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 原始文件预览 -->
    <el-dialog v-model="previewVisible" :title="`查看 - ${currentFile?.name}`" width="70%" top="5vh">
      <pre v-if="previewType === 'text'" class="content">{{ previewText }}</pre>
      <img v-else-if="previewType === 'image'" :src="previewImg" alt="preview" style="max-width: 100%" />
      <el-empty v-else description="该文件类型暂不支持在线预览，请下载查看" />
    </el-dialog>

    <!-- 上传弹窗 -->
    <el-dialog v-model="uploadVisible" title="上传参考素材" width="480px">
      <el-form label-width="80px">
        <el-form-item label="分类">
          <el-select
            v-model="uploadForm.category"
            placeholder="选择或输入分类"
            filterable
            allow-create
            default-first-option
          >
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="uploadForm.note" placeholder="可选备注" />
        </el-form-item>
        <el-form-item label="文件">
          <el-upload :auto-upload="false" :limit="1" :on-change="onFileChange"
            :on-remove="() => (uploadForm.file = null)" drag>
            <el-icon><UploadFilled /></el-icon>
            <div>拖拽或点击选择文件（MD / PDF / TXT / JSON / 图片）</div>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">上传</el-button>
      </template>
    </el-dialog>

    <!-- 上传文件内容查看 -->
    <el-dialog v-model="upContentVisible" :title="`查看 - ${currentUp?.filename}`" width="70%" top="5vh">
      <pre class="content">{{ upContentText }}</pre>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Search, UploadFilled, Refresh, View, Download, Delete,
  Folder, FolderOpened, Picture, Document, Files
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listReferenceFiles, getReferenceFileContent, downloadReferenceFile,
  getReferences, uploadReference, downloadReference, getReferenceContent, deleteReference,
  syncRefMd
} from '@/api/references'

const activeTab = ref('raw')

// ---- 原始素材目录 ----
const currentPath = ref('')
const files = ref([])
const loading = ref(false)
const syncing = ref(false)
const pathSegs = computed(() => (currentPath.value ? currentPath.value.split('/') : []))

// 仅在根目录（currentPath 为空）检测"md 未入 json"
const unsyncedMd = computed(() => {
  if (currentPath.value) return []
  return (files.value || []).filter(f => f.isMd && !f.hasJson && !f.isDir)
})

async function loadRaw() {
  loading.value = true
  try {
    const res = await listReferenceFiles(currentPath.value)
    files.value = res.data || []
  } catch (e) {
    ElMessage.error('读取素材目录失败')
  } finally {
    loading.value = false
  }
}

async function syncMd() {
  syncing.value = true
  try {
    const res = await syncRefMd()
    const d = res.data || {}
    if (d.synced > 0) {
      ElMessage.success(`已同步 ${d.synced} 个文档为 JSON` + (d.skipped > 0 ? `，${d.skipped} 个已存在 JSON 已跳过` : ''))
    } else if (d.skipped > 0) {
      ElMessage.info(`${d.skipped} 个文档已存在同名 JSON，无需同步`)
    } else {
      ElMessage.info('没有需要同步的 markdown 文档')
    }
    await loadRaw()
  } catch (e) {
    ElMessage.error('同步失败，请确认后端已更新')
  } finally {
    syncing.value = false
  }
}
function navigate(p) {
  currentPath.value = p || ''
  loadRaw()
}
function onRowDblClick(row) {
  if (row.isDir) navigate(row.path)
}

const previewVisible = ref(false)
const previewType = ref('')
const previewText = ref('')
const previewImg = ref('')
const currentFile = ref(null)
async function preview(row) {
  currentFile.value = row
  previewVisible.value = true
  previewType.value = ''
  previewText.value = ''
  previewImg.value = ''
  try {
    const res = await getReferenceFileContent(row.path)
    const d = res.data || {}
    if (d.type === 'image') {
      previewType.value = 'image'
      previewImg.value = `data:${d.mime};base64,${d.data}`
    } else {
      previewType.value = 'text'
      previewText.value = d.text ?? ''
    }
  } catch (e) {
    ElMessage.error('读取失败')
  }
}
async function downloadFile(row) {
  try {
    const res = await downloadReferenceFile(row.path)
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.name
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('已下载')
  } catch (e) {}
}

// ---- 我的上传（DB） ----
const categories = ['实习', '项目', '核心能力', '原版母本', '个人信息', '教育背景', '证书', '母本/照片']
const keyword = ref('')
const uploadedList = ref([])
const upLoading = ref(false)
const uploadVisible = ref(false)
const uploading = ref(false)
const uploadForm = reactive({ category: '实习', note: '', file: null })
const upContentVisible = ref(false)
const upContentText = ref('')
const currentUp = ref(null)

async function loadUploaded() {
  upLoading.value = true
  try {
    const params = {}
    if (keyword.value) params.keyword = keyword.value
    const res = await getReferences(params)
    uploadedList.value = res.data || []
  } catch (e) {}
  finally { upLoading.value = false }
}
function onFileChange(file) { uploadForm.file = file.raw }
async function submitUpload() {
  if (!uploadForm.file) { ElMessage.warning('请选择文件'); return }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', uploadForm.file)
    fd.append('category', uploadForm.category)
    fd.append('note', uploadForm.note)
    await uploadReference(fd)
    ElMessage.success('上传成功')
    uploadVisible.value = false
    uploadForm.note = ''
    uploadForm.file = null
    loadUploaded()
  } catch (e) {} finally { uploading.value = false }
}
async function viewUploaded(row) {
  currentUp.value = row
  upContentText.value = '加载中...'
  upContentVisible.value = true
  try {
    const res = await getReferenceContent(row.id)
    upContentText.value = res.data?.content ?? '（空内容或二进制文件，请下载查看）'
  } catch (e) { upContentText.value = '（读取失败）' }
}
async function downloadUploaded(row) {
  try {
    const res = await downloadReference(row.id)
    const blob = res.data
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.filename || `reference_${row.id}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('已下载')
  } catch (e) {}
}
async function removeUploaded(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.filename}」？`, '删除确认', { type: 'warning' })
    await deleteReference(row.id)
    ElMessage.success('已删除')
    loadUploaded()
  } catch (e) {}
}

onMounted(() => { loadRaw(); loadUploaded() })
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.sync-tip { display: flex; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.sync-files { font-size: 13px; color: #8a6d3b; }
.content {
  max-height: 70vh; overflow: auto; white-space: pre-wrap;
  background: #f7f8fa; padding: 12px; border-radius: 6px; font-size: 13px;
}
</style>
