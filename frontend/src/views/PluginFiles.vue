<template>
  <div class="materials">
    <div class="mat-toolbar">
      <span class="mat-title">简历附件</span>
      <span class="mat-hint">点击左侧条目查看文件（pdf / 图片 / 文本），支持预览 / 下载 / 更换 / 删除</span>
      <el-upload
        class="mat-upload"
        :show-file-list="false"
        :before-upload="beforeUpload"
        :http-request="handleReplace"
        accept="*"
      >
        <el-button type="primary" size="small" :icon="Upload">新增 / 更换文件</el-button>
      </el-upload>
    </div>

    <div class="mat-body">
      <!-- 左侧：目录 + 散文件混排 -->
      <el-card class="mat-list-card" shadow="never">
        <template #header><span class="card-title">文件目录</span></template>
        <div v-loading="listLoading" class="mat-tree">
          <template v-for="node in nodes" :key="node.path">
            <!-- 文件夹：可展开 -->
            <div
              v-if="node.isDir"
              class="mat-item mat-folder"
              :class="{ active: selected && selected.path === node.path && !selected.isDir }"
              @click="toggleFolder(node)"
            >
              <el-icon class="mat-item-icon"><FolderOpened v-if="expanded.has(node.path)" /><Folder v-else /></el-icon>
              <span class="mat-name">{{ node.name }}</span>
              <el-icon class="mat-arrow"><ArrowDown v-if="expanded.has(node.path)" /><ArrowRight v-else /></el-icon>
            </div>
            <!-- 文件夹展开后的子项（缩进） -->
            <div
              v-if="node.isDir && expanded.has(node.path)"
              v-for="child in node.children"
              :key="child.path"
              class="mat-item mat-child"
              :class="{ active: selected && selected.path === child.path }"
              @click="selectFile(child, node)"
            >
              <el-icon class="mat-item-icon"><Document v-if="child.kind === 'text'" /><Picture v-else-if="child.kind === 'image'" /><Tickets v-else /></el-icon>
              <span class="mat-name">{{ child.name }}</span>
            </div>
            <!-- 散文件（根目录直接显示） -->
            <div
              v-if="!node.isDir"
              class="mat-item"
              :class="{ active: selected && selected.path === node.path }"
              @click="selectFile(node, null)"
            >
              <el-icon class="mat-item-icon"><Document v-if="node.kind === 'text'" /><Picture v-else-if="node.kind === 'image'" /><Tickets v-else /></el-icon>
              <span class="mat-name">{{ node.name }}</span>
            </div>
          </template>
          <div v-if="!listLoading && nodes.length === 0" class="mat-empty">暂无文件</div>
        </div>
      </el-card>

      <!-- 右侧：预览 + 操作 -->
      <el-card class="mat-preview-card" shadow="never">
        <template #header>
          <div class="preview-header">
            <span class="card-title">{{ selected ? selected.name : '预览' }}</span>
            <div v-if="selected && !selected.isDir" class="preview-actions">
              <el-button size="small" :icon="Download" @click="downloadSelected">下载</el-button>
              <el-upload
                :show-file-list="false"
                :before-upload="beforeUpload"
                :http-request="(o) => handleReplace(o, selected.path)"
                accept="*"
              >
                <el-button size="small" type="warning" :icon="Refresh">更换</el-button>
              </el-upload>
              <el-button size="small" type="danger" :icon="Delete" @click="removeSelected">删除</el-button>
            </div>
          </div>
        </template>

        <div v-if="!selected" class="empty">
          <el-empty description="从左侧选择文件进行预览（只读）" />
        </div>
        <div v-else-if="selected.isDir" class="empty">
          <el-empty :description="`目录「${selected.name}」请在左侧展开后选择具体文件`" />
        </div>
        <div v-else-if="previewLoading" v-loading="true" class="preview-loading"></div>
        <div v-else>
          <!-- 图片 -->
          <img v-if="preview && preview.type === 'image'" :src="`data:${preview.mime};base64,${preview.data}`" class="mat-img" />
          <!-- pdf -->
          <iframe v-else-if="preview && preview.type === 'pdf'" :src="pdfDataUrl" class="mat-pdf" frameborder="0"></iframe>
          <!-- 纯文本兜底 -->
          <pre v-else-if="preview" class="mat-text">{{ preview.text }}</pre>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Picture, Tickets, Download, Upload, Refresh, Delete, Folder, FolderOpened, ArrowRight, ArrowDown } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { getPluginFiles, viewPluginFile, uploadPluginFile, deletePluginFile } from '@/api/plugin'

const listLoading = ref(false)
const nodes = ref([])            // 根目录全部节点（文件夹 + 散文件），文件夹带 children
const expanded = ref(new Set())  // 展开的文件夹 path 集合
const selected = ref(null)
const preview = ref(null)
const previewLoading = ref(false)

const pdfDataUrl = computed(() => {
  const d = preview.value
  if (d && d.type === 'pdf' && d.data) return `data:application/pdf;base64,${d.data}`
  return ''
})

async function loadList() {
  listLoading.value = true
  try {
    const res = await getPluginFiles('')
    const data = res.data || []
    // 文件夹在前、文件在后，与素材管理风格一致
    const dirs = data.filter((n) => n.isDir)
    const files = data.filter((n) => !n.isDir)
    nodes.value = [...dirs, ...files]
  } catch (e) {
    ElMessage.error('文件目录加载失败')
  } finally {
    listLoading.value = false
  }
}

// 点击文件夹：展开/收起，并异步拉取子项
async function toggleFolder(node) {
  if (expanded.value.has(node.path)) {
    expanded.value.delete(node.path)
    expanded.value = new Set(expanded.value)
    return
  }
  // 首次展开时加载子项
  if (!node.children) {
    try {
      const res = await getPluginFiles(node.path)
      const children = (res.data || []).filter((n) => !n.isDir)
      node.children = children
    } catch (e) {
      node.children = []
    }
  }
  expanded.value.add(node.path)
  expanded.value = new Set(expanded.value)
}

async function selectFile(node, parentFolder) {
  selected.value = node
  preview.value = null
  if (node.isDir) return
  previewLoading.value = true
  try {
    const res = await viewPluginFile(node.path)
    const d = res.data
    if (d.error) {
      ElMessage.error(d.error)
      return
    }
    preview.value = {
      type: d.type,
      mime: d.mime,
      data: d.data,
      text: d.text,
      name: node.name
    }
  } catch (e) {
    ElMessage.error('预览失败')
  } finally {
    previewLoading.value = false
  }
}

function downloadSelected() {
  if (!selected.value || selected.value.isDir) return
  // 后端 /plugin/files/view 对图片/pdf 返回 base64，直接下载
  viewPluginFile(selected.value.path)
    .then((res) => {
      const d = res.data
      if (d.error) { ElMessage.error(d.error); return }
      let url = ''
      if (d.type === 'image') url = `data:${d.mime};base64,${d.data}`
      else if (d.type === 'pdf') url = `data:application/pdf;base64,${d.data}`
      if (!url) { ElMessage.warning('该类型文件不支持在线下载'); return }
      const a = document.createElement('a')
      a.href = url
      a.download = selected.value.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    })
    .catch(() => ElMessage.error('下载失败'))
}

function beforeUpload(file) {
  void file
  return true
}

async function handleReplace(options, fixedPath) {
  const file = options.file
  try {
    const path = fixedPath || file.name
    await uploadPluginFile(file, path)
    ElMessage.success(fixedPath ? '已更换' : '已新增')
    await loadList()
    // 若更换的是当前选中文件，刷新预览
    if (fixedPath && selected.value && selected.value.path === fixedPath) {
      selectFile(selected.value, null)
    }
  } catch (e) {
    ElMessage.error('上传失败：' + (e?.message || '未知错误'))
  }
}

function removeSelected() {
  if (!selected.value || selected.value.isDir) return
  ElMessageBox.confirm(`确认删除文件「${selected.value.name}」？`, '删除确认', { type: 'warning' })
    .then(async () => {
      try {
        await deletePluginFile(selected.value.path)
        ElMessage.success('已删除')
        selected.value = null
        preview.value = null
        await loadList()
      } catch (e) {
        ElMessage.error('删除失败')
      }
    })
    .catch(() => {})
}

onMounted(loadList)
</script>

<style scoped>
.materials { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.mat-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background:#fff; padding: 14px 18px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.mat-title { font-size: 16px; font-weight: 600; }
.mat-hint { color: #909399; font-size: 13px; }
.mat-upload { margin-left: auto; }
.mat-body { display: flex; gap: 16px; flex: 1 1 auto; min-height: 0; }
.mat-list-card { width: 300px; flex: 0 0 300px; overflow: auto; }
.mat-preview-card { flex: 1 1 auto; overflow: auto; }
.mat-tree { display: flex; flex-direction: column; }
.mat-item {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  transition: background 0.2s;
}
.mat-item:hover { background: #f5f7fa; }
.mat-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.mat-item-icon { color: var(--el-color-primary); }
.mat-name { margin-left: 2px; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mat-arrow { color: #c0c4cc; flex: 0 0 auto; }
.mat-child { padding-left: 34px; }
.mat-empty, .empty { text-align: center; color: #909399; padding: 40px 0; }
.preview-header { display: flex; align-items: center; justify-content: space-between; }
.preview-actions { display: flex; gap: 8px; }
.preview-loading { height: 300px; }
.mat-img { max-width: 100%; }
.mat-pdf { width: 100%; height: 70vh; border: none; }
.mat-text { white-space: pre-wrap; word-break: break-all; font-family: monospace; padding: 8px; }
</style>
