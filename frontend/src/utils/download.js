// 通用文件下载：用 axios 的 blob 响应，触发浏览器下载
import request from './request'

export async function downloadFile(url, filename) {
  const res = await request.get(url, { responseType: 'blob' })
  const blob = res.data
  const urlObj = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = urlObj
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(urlObj)
}
