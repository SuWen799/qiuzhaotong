import request from '@/utils/request'
import { BASE_URL } from '@/utils/request'

// 根据 company 获取简历版本快照（插件用，免 JWT，带 token 参数）
export function getPluginResumeVersion(company, token) {
  return request.get('/plugin/resume-version', { params: { company, token } })
}

// 版本浏览（插件用，免 JWT，带 token 参数）
export function getPluginVersions(token) {
  return request.get('/plugin/versions', { params: { token } })
}

// 获取插件访问令牌（需 JWT）
export function getPluginToken() {
  return request.get('/plugin/token')
}

// 获取全量 profile（在线编辑）
export function getPluginProfile() {
  return request.get('/plugin/profile')
}

// 保存 profile
export function updatePluginProfile(profile) {
  return request.put('/plugin/profile', { profile })
}

// 构造插件可直接访问的下载链接（后端文件接口走 baseURL）
export function pluginResumeVersionUrl(company, token) {
  return `${BASE_URL}/plugin/resume-version?company=${encodeURIComponent(company)}&token=${encodeURIComponent(token)}`
}

// 列出证明文件目录下的文件/子目录（path 为空=根目录）
export function getPluginFiles(path) {
  return request.get('/plugin/files', { params: { path: path || '' } })
}

// 预览单个文件（图片/pdf/base64，文本原文）
export function viewPluginFile(path) {
  return request.get('/plugin/files/view', { params: { path } })
}

// 上传 / 更换：覆盖同名文件（path 指定相对路径）
export function uploadPluginFile(file, path) {
  const fd = new FormData()
  fd.append('file', file)
  if (path) fd.append('path', path)
  return request.post('/plugin/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

// 按 path 删除文件
export function deletePluginFile(path) {
  return request.delete('/plugin/files', { params: { path } })
}

// 流二：列出已生成的「按公司在线简历」文件状态（<data-dir>/versions/<company>.variable_modules.json）
export function getCompanyResumeStatus(token) {
  return request.get('/plugin/company-resume-status', { params: { token } })
}
