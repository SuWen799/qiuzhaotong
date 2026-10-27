import request from '@/utils/request'

// 参考素材列表（按分类 / 关键词筛选）
export function getReferences(params) {
  return request.get('/references', { params })
}

// 上传参考素材（multipart）
export function uploadReference(formData) {
  return request.post('/references/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// 下载素材
export function downloadReference(id) {
  return request.get(`/references/${id}/download`, { responseType: 'blob' })
}

// 获取素材文本内容
export function getReferenceContent(id) {
  return request.get(`/references/${id}/content`)
}

// 删除素材
export function deleteReference(id) {
  return request.delete(`/references/${id}`)
}

// 浏览原始素材目录（D:/qiuzhaohub/uploads/references）
export function listReferenceFiles(path) {
  return request.get('/references/files', { params: path ? { path } : {} })
}

// 读取原始文件内容（文本或图片 base64）
export function getReferenceFileContent(path) {
  return request.get('/references/files/content', { params: { path } })
}

// 下载原始文件
export function downloadReferenceFile(path) {
  return request.get('/references/files/download', {
    params: { path },
    responseType: 'blob'
  })
}

// 上传原始素材文件（覆盖同名时传同一 category）
export function uploadRefFile(file, category, note) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('category', category || '')
  if (note) fd.append('note', note)
  return request.post('/references/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// 按 path 删除原始素材文件
export function deleteRefFile(path) {
  return request.delete('/references/files', { params: { path } })
}

// 以原版 md 形式获取文件内容（.json 自动转为 md，确保用户看不到 json）
export function getRefMarkdown(path) {
  return request.get('/references/files/markdown', { params: { path } })
}

// 一键把 references 目录下所有未入 json 的 md/txt 同步为同名 .json
export function syncRefMd() {
  return request.post('/references/files/sync')
}
