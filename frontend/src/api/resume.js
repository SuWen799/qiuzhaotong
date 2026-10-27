import request from '@/utils/request'

// 生成简历（LLM 优化较慢，单独放宽超时到 180s，避免前端提前报 timeout）
export function generateResume(data) {
  return request.post('/resume/generate', data, { timeout: 180000 })
}

// 获取基础档案
export function getResumeBase() {
  return request.get('/resume/base')
}

// 保存基础档案某一 section
export function updateResumeBase(section, content) {
  return request.put(`/resume/base/${section}`, { content })
}

// 简历版本库列表
export function getResumeVersions() {
  return request.get('/resume/versions')
}

// 单个版本详情
export function getResumeVersion(id) {
  return request.get(`/resume/versions/${id}`)
}

// 删除版本
export function deleteResumeVersion(id) {
  return request.delete(`/resume/versions/${id}`)
}

// 下载版本（md / pdf）
export function downloadResumeVersion(id, type = 'md') {
  return request.get(`/resume/versions/${id}/download`, {
    params: { type },
    responseType: 'blob'
  })
}
