import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  // ===== 临时移除登录功能（秋招通本地自用阶段）=====
  // 登录页面与路由不再启用，所有页面直接进入、无需登录。代码保留便于后续恢复。
  // {
  //   path: '/login',
  //   name: 'Login',
  //   component: () => import('@/views/Login.vue'),
  //   meta: { public: true }
  // },
  {
    path: '/',
    component: () => import('@/layout/MainLayout.vue'),
    redirect: '/companies',
    children: [
      {
        path: 'companies',
        name: 'Companies',
        component: () => import('@/views/Companies.vue'),
        meta: { title: '企业列表', group: 'companies' }
      },
      {
        path: 'companies/delivery',
        name: 'CompaniesDelivery',
        component: () => import('@/views/CompaniesDelivery.vue'),
        meta: { title: '我的投递', group: 'companies' }
      },
      {
        path: 'resume/generate',
        name: 'ResumeGenerate',
        component: () => import('@/views/ResumeGenerate.vue'),
        meta: { title: '智能生成' }
      },
      {
        path: 'resume/versions',
        name: 'ResumeVersions',
        component: () => import('@/views/ResumeVersions.vue'),
        meta: { title: '文件简历' }
      },
      {
        path: 'resume/materials',
        name: 'ResumeMaterials',
        component: () => import('@/views/ResumeMaterials.vue'),
        meta: { title: '项目文档' }
      },
      {
        path: 'plugin',
        redirect: '/plugin/resume'
      },
      {
        path: 'plugin/resume',
        name: 'PluginResume',
        component: () => import('@/views/PluginResume.vue'),
        meta: { title: '在线简历' }
      },
      {
        path: 'plugin/files',
        name: 'PluginFiles',
        component: () => import('@/views/PluginFiles.vue'),
        meta: { title: '简历附件' }
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '系统设置' }
      }
    ]
  },
  // 兜底重定向：原指向 /login 的非法路径现在统一回到企业列表主界面
  { path: '/:pathMatch(.*)*', redirect: '/companies' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：未登录跳登录
// 【临时移除登录鉴权】注释整个 beforeEach，所有路由无需登录即可访问
// router.beforeEach((to) => {
//   const token = localStorage.getItem('token')
//   if (!to.meta.public && !token) {
//     return { path: '/login' }
//   }
//   if (to.path === '/login' && token) {
//     return { path: '/companies' }
//   }
//   return true
// })

export default router
