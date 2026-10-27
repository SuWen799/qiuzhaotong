<template>
  <el-container class="layout">
    <!-- 顶部浅色导航栏（白底卡片风格） -->
    <el-header class="header">
      <div class="logo">
        <span class="logo-icon">🎓</span>
        <span class="logo-text">秋招通</span>
      </div>
      <!-- 一级标签式导航 + 二级下拉（对齐旧版：hover/点击展开子页切换） -->
      <nav class="nav">
        <el-dropdown
          v-for="group in groups"
          :key="group.key"
          trigger="hover"
          placement="bottom-start"
          :show-timeout="80"
          :hide-timeout="120"
          @command="(path) => onSubCommand(path)"
        >
          <div
            class="nav-group"
            :class="{ active: isGroupActive(group) }"
            @click="onGroupClick(group)"
          >
            <span class="nav-group-label">{{ group.label }}</span>
            <el-icon v-if="group.children.length" class="nav-caret"><ArrowDown /></el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu v-if="group.children.length">
              <el-dropdown-item
                v-for="child in group.children"
                :key="child.path"
                :command="child.path"
                :class="{ 'is-active': isActive(child.path) }"
              >
                {{ child.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </nav>
      <!-- 右侧用户区（登录功能已临时移除，仅显示固定标识，无退出登录入口） -->
      <div class="user">
        <span class="user-trigger">
          <el-icon><UserFilled /></el-icon>
          <span class="username">{{ username }}</span>
        </span>
      </div>
    </el-header>

    <!-- 内容区（白卡片风格，背景 #f5f7fa） -->
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 【临时移除登录功能】不再依赖 useUserStore / 退出登录逻辑
// import { useUserStore } from '@/stores/user'
// import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()

// 登录功能暂移除，固定显示为本地用户，不再读取 token / username
const username = computed(() => '本地用户')

// 分组式导航：一级分组 + 二级子页（对齐官网汇总风格）
const groups = [
  {
    key: 'companies',
    label: '官网汇总',
    children: [
      { path: '/companies', label: '企业列表' },
      { path: '/companies/delivery', label: '我的投递' },
    ]
  },
  {
    key: 'resume',
    label: '简历生成',
    children: [
      { path: '/resume/generate', label: '智能生成' },
      { path: '/resume/versions', label: '文件简历' },
      { path: '/resume/materials', label: '项目文档' }
    ]
  },
  {
    key: 'plugin',
    label: '插件管理',
    children: [
      { path: '/plugin/resume', label: '在线简历' },
      { path: '/plugin/files', label: '简历附件' }
    ]
  },
  {
    key: 'settings',
    label: '系统设置',
    children: []
  }
]

function findGroupByPath(path) {
  for (const g of groups) {
    if (g.children.some((c) => c.path === path)) return g
    if (g.key === 'plugin' && path.startsWith('/plugin')) return g
    if (g.key === 'resume' && path.startsWith('/resume')) return g
    if (g.key === 'settings' && path.startsWith('/settings')) return g
  }
  return groups[0]
}

const activeGroup = computed(() => findGroupByPath(route.path))

function isGroupActive(group) {
  return activeGroup.value && activeGroup.value.key === group.key
}

function isActive(path) {
  return route.path === path
}

function onGroupClick(group) {
  // 有二级子页时，点击一级分组直接跳到该组第一个子页（下拉也可选其它子页）
  if (group.children.length) {
    router.push(group.children[0].path)
  } else {
    router.push('/' + group.key)
  }
}

// 从二级下拉菜单选择子页跳转
function onSubCommand(path) {
  if (path) router.push(path)
}

// 登录功能已临时移除，原 handleCommand('logout') 退出登录逻辑已停用
// function handleCommand(cmd) {
//   if (cmd === 'logout') {
//     ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' })
//       .then(() => {
//         userStore.logout()
//         router.replace('/login')
//       })
//       .catch(() => {})
//   }
// }
</script>

<style scoped>
.layout {
  height: 100vh;
  background: var(--qz-bg);
}
/* 顶部导航：白底卡片 + 圆角 + 轻阴影（与官网汇总页面风格一致） */
.header {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 24px;
  background: var(--qz-surface);
  border-radius: var(--qz-radius);
  box-shadow: var(--qz-shadow);
  margin: 12px 16px 0;
  padding: 0 20px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-icon {
  font-size: 22px;
}
.logo-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--qz-primary);
  white-space: nowrap;
}
/* 一级标签式导航 */
.nav {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  height: 100%;
}
.nav-group {
  position: relative;
  height: 36px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--qz-radius-sm);
  font-size: var(--qz-font-base);
  color: var(--qz-text);
  cursor: pointer;
  transition: all 0.2s;
}
.nav-group:hover {
  background: var(--qz-primary-light);
  color: var(--qz-primary);
}
.nav-group.active {
  background: var(--qz-primary);
  color: #fff;
}
.nav-caret {
  font-size: 12px;
  margin-left: 2px;
  transition: transform 0.2s;
}
/* 二级下拉菜单中的当前页高亮 */
.nav :deep(.el-dropdown-menu__item.is-active) {
  color: var(--qz-primary);
  font-weight: 600;
  background: var(--qz-primary-light);
}
.user-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--qz-text);
}
.username {
  font-size: var(--qz-font-base);
}
/* 内容区 */
.main {
  background: var(--qz-bg);
  padding: 16px;
  overflow-y: auto;
}
</style>
