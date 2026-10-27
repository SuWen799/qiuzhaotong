import { defineStore } from 'pinia'

// 【临时移除登录功能】登录/退出/token 逻辑全部注释保留，后续可恢复：
// import { login as loginApi, getMe } from '@/api/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    // token: localStorage.getItem('token') || '',
    // username: localStorage.getItem('username') || ''
    token: '',
    username: ''
  }),
  getters: {
    isLoggedIn: () => false
  },
  actions: {
    // async login(username, password) {
    //   const res = await loginApi({ username, password })
    //   this.token = res.data.token
    //   this.username = res.data.username
    //   localStorage.setItem('token', this.token)
    //   localStorage.setItem('username', this.username)
    //   return res.data
    // },
    // async fetchMe() {
    //   const res = await getMe()
    //   this.username = res.data.username
    //   localStorage.setItem('username', this.username)
    //   return res.data
    // },
    // logout() {
    //   this.token = ''
    //   this.username = ''
    //   localStorage.removeItem('token')
    //   localStorage.removeItem('username')
    // }
  }
})

