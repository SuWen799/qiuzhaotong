<template>
  <div class="materials">
    <div class="mat-toolbar">
      <span class="mat-title">项目文档</span>
      <span class="mat-hint">可展开子文件夹查看各公司 md 素材，预览/下载均为原版文件（不展示 json）</span>
      <el-upload
        class="mat-upload"
        :show-file-list="false"
        :before-upload="beforeUpload"
        :http-request="handleReplace"
        accept=".md,.txt"
      >
        <el-button type="primary" size="small" :icon="Upload">新增 / 更换素材</el-button>
      </el-upload>
    </div>

    <div class="mat-body">
      <!-- 左侧：目录 + 散文件混排（支持子文件夹展开） -->
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
              @click="selectFile(child)"
            >
              <el-icon class="mat-item-icon"><Picture v-if="child.kind === 'image'" /><Document v-else /></el-icon>
              <span class="mat-name">{{ child.name }}</span>
            </div>
            <!-- 散文件（根目录直接显示） -->
            <div
              v-if="!node.isDir"
              class="mat-item"
              :class="{ active: selected && selected.path === node.path }"
              @click="selectFile(node)"
            >
              <el-icon class="mat-item-icon"><Picture v-if="node.kind === 'image'" /><Document v-else /></el-icon>
              <span class="mat-name">{{ node.name }}</span>
            </div>
          </template>
          <div v-if="!listLoading && nodes.length === 0" class="mat-empty">暂无素材文件</div>
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
                accept=".md,.txt"
              >
                <el-button size="small" type="warning" :icon="Refresh">更换</el-button>
              </el-upload>
              <el-button size="small" type="danger" :icon="Delete" @click="removeSelected">删除</el-button>
            </div>
          </div>
        </template>

        <div v-if="!selected" class="empty">
          <el-empty description="从左侧选择 md 素材进行预览（只读）" />
        </div>
        <div v-else-if="selected.isDir" class="empty">
          <el-empty :description="`目录「${selected.name}」请在左侧展开后选择具体文件`" />
        </div>
        <div v-else-if="previewLoading" v-loading="true" class="preview-loading"></div>
        <div v-else>
          <!-- 图片 -->
          <img v-if="preview && preview.type === 'image'" :src="`data:${preview.mime};base64,${preview.data}`" class="mat-img" />
          <!-- md 渲染 -->
          <div v-else-if="preview && preview.isMarkdown" class="markdown-body" v-html="renderedMd"></div>
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
import { Document, Download, Upload, Refresh, Delete, Folder, FolderOpened, ArrowRight, ArrowDown, Picture } from '@element-plus/icons-vue'
import { marked } from 'marked'
import {
  listMaterialFiles,
  getMaterialContent,
  downloadMaterialFile,
  uploadMaterialFile,
  deleteMaterialFile
} from '@/api/materials'

const listLoading = ref(false)
const nodes = ref([])            // 根目录全部节点（文件夹 + 散文件），文件夹带 children
const expanded = ref(new Set())  // 展开的文件夹 path 集合
const selected = ref(null)
const preview = ref(null)
const previewLoading = ref(false)

const renderedMd = computed(() => {
  if (preview.value && preview.value.isMarkdown && preview.value.text) {
    try {
      return marked.parse(preview.value.text)
    } catch (e) {
      return '<pre>' + preview.value.text + '</pre>'
    }
  }
  return ''
})

// 仅展示可预览的文件（md / txt / 图片），绝不向用户暴露 json
function isViewableFile(n) {
  return !n.isDir && /\.(md|txt|png|jpe?g|gif|webp)$/i.test(n.name)
}

async function loadList(showTip = false) {
  listLoading.value = true
  try {
    const res = await listMaterialFiles('')
    const data = res.data || []
    // 文件夹在前、文件在后（与插件文件页一致）
    const dirs = data.filter((n) => n.isDir)
    const files = data.filter(isViewableFile)
    nodes.value = [...dirs, ...files]
    if (showTip) ElMessage.success(`已刷新，共 ${dirs.length} 个文件夹 / ${files.length} 个文件`)
  } catch (e) {
    ElMessage.error('素材列表加载失败')
  } finally {
    listLoading.value = false
  }
}

// 点击文件夹：展开/收起，并异步拉取子项（按 path 列子目录，后端已支持）
async function toggleFolder(node) {
  if (expanded.value.has(node.path)) {
    expanded.value.delete(node.path)
    expanded.value = new Set(expanded.value)
    return
  }
  // 首次展开时加载子项
  if (!node.children) {
    try {
      const res = await listMaterialFiles(node.path)
      node.children = (res.data || []).filter(isViewableFile)
    } catch (e) {
      node.children = []
    }
  }
  expanded.value.add(node.path)
  expanded.value = new Set(expanded.value)
}

async function selectFile(node) {
  selected.value = node
  preview.value = null
  if (node.isDir) return
  previewLoading.value = true
  try {
    const res = await getMaterialContent(node.path)
    const d = res.data
    if (d.error) {
      ElMessage.error(d.error)
      return
    }
    preview.value = d
  } catch (e) {
    ElMessage.error('预览失败')
  } finally {
    previewLoading.value = false
  }
}

function downloadSelected() {
  if (!selected.value || selected.value.isDir) return
  downloadMaterialFile(selected.value.path)
    .then((res) => {
      const blob = res.data
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selected.value.name
      a.click()
      window.URL.revokeObjectURL(url)
    })
    .catch(() => ElMessage.error('下载失败'))
}

function beforeUpload(file) {
  const lower = file.name.toLowerCase()
  if (!(lower.endsWith('.md') || lower.endsWith('.txt'))) {
    ElMessage.warning('仅支持 .md / .txt 素材文件')
    return false
  }
  return true
}

async function handleReplace(options, fixedPath) {
  const file = options.file
  try {
    const path = fixedPath || file.name
    await uploadMaterialFile(file, path)
    ElMessage.success(fixedPath ? '已更换' : '已新增')
    await loadList()
    // 若更换的是当前选中文件，刷新预览
    if (fixedPath && selected.value && selected.value.path === fixedPath) {
      selectFile(selected.value)
    }
  } catch (e) {
    ElMessage.error('上传失败：' + (e?.message || '未知错误'))
  }
}

function removeSelected() {
  if (!selected.value || selected.value.isDir) return
  ElMessageBox.confirm(`确认删除素材「${selected.value.name}」？`, '删除确认', { type: 'warning' })
    .then(async () => {
      try {
        await deleteMaterialFile(selected.value.path)
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
.mat-text { white-space: pre-wrap; word-break: break-all; font-family: monospace; padding: 8px; }
.mat-alert { margin-top: 0; }
.mat-alert-body { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mat-alert-files { flex: 1 1 auto; color: #606266; font-size: 13px; word-break: break-all; }

/* 轻量 markdown 渲染样式 */
.markdown-body { line-height: 1.7; padding: 4px 8px; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) {
  margin: 16px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 4px;
}
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 24px; }
.markdown-body :deep(code) {
  background: #f5f7fa; padding: 2px 4px; border-radius: 4px; font-family: monospace;
}
.markdown-body :deep(pre) {
  background: #f5f7fa; padding: 12px; border-radius: 6px; overflow: auto;
}
.markdown-body :deep(pre code) { background: transparent; padding: 0; }
.markdown-body :deep(blockquote) {
  border-left: 4px solid #dcdfe6; margin: 8px 0; padding: 4px 12px; color: #606266;
}
.markdown-body :deep(table) { border-collapse: collapse; width: 100%; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid #ebeef5; padding: 6px 10px; }
</style>
