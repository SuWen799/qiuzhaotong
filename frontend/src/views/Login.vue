<template>
  <!-- 【临时移除登录功能】登录页面已停用，不再被任何路由引用；保留文件便于后续恢复 -->
  <div class="login-wrap">
    <el-card class="login-card" shadow="always">
      <div class="brand">
        <el-icon class="brand-icon"><Compass /></el-icon>
        <h2>秋招通 QiuzhaoHub</h2>
        <p class="subtitle">登录功能已临时停用（本地自用阶段，无需登录）</p>
      </div>
    </el-card>
  </div>
</template>

<script setup>
// 【临时移除登录功能】以下登录逻辑全部注释保留，后续可恢复：
// import { ref, reactive } from 'vue'
// import { useRouter } from 'vue-router'
// import { User, Lock, Compass } from '@element-plus/icons-vue'
// import { useUserStore } from '@/stores/user'
// import { ElMessage } from 'element-plus'

// const router = useRouter()
// const userStore = useUserStore()
// const formRef = ref()
// const loading = ref(false)
// const form = reactive({ username: '', password: '' })
// const rules = {
//   username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
//   password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
// }
// async function handleLogin() {
//   await formRef.value.validate(async (valid) => {
//     if (!valid) return
//     loading.value = true
//     try {
//       await userStore.login(form.username, form.password)
//       ElMessage.success('登录成功')
//       router.replace('/companies')
//     } catch (e) {
//       // 错误提示由拦截器统一处理
//     } finally {
//       loading.value = false
//     }
//   })
// }
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
}
.login-card {
  width: 380px;
  padding: 10px 20px;
  border-radius: 12px;
}
.brand {
  text-align: center;
  margin-bottom: 20px;
}
.brand-icon {
  font-size: 40px;
  color: #1a73e8;
}
.brand h2 {
  margin: 8px 0 4px;
  color: #303133;
}
.subtitle {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
.login-btn {
  width: 100%;
  margin-top: 6px;
}
</style>
