import request from '@/utils/request'

// 企业列表（分页 + 多维筛选 + 排序）
export function getCompanies(params) {
  return request.get('/companies', { params })
}

// 统计概览
export function getCompaniesStats() {
  return request.get('/companies/stats')
}

// 每日趋势
export function getCompaniesDaily() {
  return request.get('/companies/daily')
}

// 标记投递状态
export function updateCompanyStatus(id, data) {
  return request.put(`/companies/${id}/status`, data)
}

// 已投递公司列表（投递统计页表格用）
export function getDeliveredCompanies() {
  return request.get('/companies/delivered')
}

// 全部有状态记录（含"不投递"），首页状态回填专用
export function getCompanyStatuses() {
  return request.get('/companies/statuses')
}

// 触发手动爬取（live=true 真实爬取；autumn2027 等可运行源会真实抓取，浏览器类源不可用时会诚实反馈）
export function crawlCompanies(live = true) {
  return request.post('/companies/crawl', null, { params: { live } })
}

// 爬取状态
export function getCrawlStatus() {
  return request.get('/companies/crawl/status')
}
