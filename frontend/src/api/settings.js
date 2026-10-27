import request from '@/utils/request'

// 获取设置
export function getSettings() {
  return request.get('/settings')
}

// 保存设置（单条或批量）
export function updateSettings(data) {
  return request.put('/settings', data)
}
