import request from '@/utils/request'

// 简历生成 -> 素材管理：仅管理项目介绍等 md 素材（根目录见后端 material.dir 配置）
export function listMaterialFiles(path) {
  return request.get('/materials/files', { params: { path: path || '' } })
}

export function getMaterialContent(path) {
  return request.get('/materials/files/content', { params: { path } })
}

export function downloadMaterialFile(path) {
  return request.get('/materials/files/download', { params: { path }, responseType: 'blob' })
}

// 更换/上传：file 为 File 对象，path 指定覆盖目标（默认落到根目录同名）
export function uploadMaterialFile(file, path) {
  const fd = new FormData()
  fd.append('file', file)
  if (path) fd.append('path', path)
  return request.post('/materials/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

export function deleteMaterialFile(path) {
  return request.delete('/materials/files', { params: { path } })
}

// 一键把"项目文档"目录下所有未入 json 的 md/txt 转成 json（共用 /materials/files/sync）
export function syncMaterialMd() {
  return request.post('/materials/files/sync')
}
