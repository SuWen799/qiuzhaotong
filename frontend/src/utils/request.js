import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

// 后端 baseURL：走同源 /api，由 Vite 开发服务器反向代理到 8080，
// 避免浏览器跨端口直连 localhost:8080 被代理/VPN 拦截导致 ERR_NETWORK。
export const BASE_URL = '/api'

const request = axios.create({
  baseURL: BASE_URL,
  timeout: 30000
})

// 请求拦截器：自动附加 Bearer token
request.interceptors.request.use(
  (config) => {
    // 【临时移除登录鉴权】注释掉 token 注入，所有请求不再携带 Authorization 头
    // const token = localStorage.getItem('token')
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`
    // }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：处理 401 统一跳登录
request.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    // 【临时移除登录鉴权】注释掉 401/403 跳转登录逻辑，保留代码作为注释
    // if (status === 401 || status === 403) {
    //   ElMessage.error('登录已过期或无权限，请重新登录')
    //   localStorage.removeItem('token')
    //   localStorage.removeItem('username')
    //   router.replace('/login')
    // } else
    if (error.response?.data?.message) {
      ElMessage.error(error.response.data.message)
    } else if (status === 404) {
      // 部分接口后端可能尚未实现，静默处理避免阻断页面
      console.warn('[API 404]', error.config?.url)
    } else if (error.code === 'ERR_NETWORK') {
      ElMessage.warning('无法连接后端服务（http://127.0.0.1:8080）')
    }
    return Promise.reject(error)
  }
)

export default request
