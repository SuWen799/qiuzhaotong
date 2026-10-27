<template>
  <el-card shadow="never">
    <template #header>系统设置</template>
    <el-tabs v-model="active">
      <el-tab-pane label="LLM 配置" name="llm">
        <el-form :model="form" label-width="120px" style="max-width: 560px">
          <el-form-item label="API Key">
            <el-input v-model="form.api_key" placeholder="sk-..." show-password />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="form.base_url" placeholder="https://..." />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="form.model" placeholder="gpt-4o / deepseek-chat" />
          </el-form-item>
          <el-form-item label="Temperature">
            <el-slider v-model="form.temperature" :min="0" :max="1" :step="0.1" show-input />
          </el-form-item>
          <el-button type="primary" :icon="Check" :loading="saving" @click="save">保存配置</el-button>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="爬取设置" name="crawl">
        <el-form label-width="160px" style="max-width: 560px">
          <el-form-item label="启用定时爬取">
            <el-switch v-model="crawlEnabled" @change="saveCrawl" />
          </el-form-item>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="开启后系统将按设定周期自动爬取秋招官网汇总数据。"
          />
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getSettings, updateSettings } from '@/api/settings'

const active = ref('llm')
const saving = ref(false)
const form = reactive({
  api_key: '',
  base_url: '',
  model: '',
  temperature: 0.7
})
const crawlEnabled = ref(false)

// 后端 settings 表使用扁平 key（llm_api_key / llm_base_url / llm_model / llm_temperature）
async function load() {
  try {
    const res = await getSettings()
    const d = res.data || {}
    form.api_key = d.llm_api_key ?? ''
    form.base_url = d.llm_base_url ?? ''
    form.model = d.llm_model ?? ''
    const t = parseFloat(d.llm_temperature)
    form.temperature = Number.isFinite(t) ? t : 0.7
    crawlEnabled.value = !!d.crawl_schedule_enabled
  } catch (e) {}
}

async function save() {
  saving.value = true
  try {
    await updateSettings({
      llm_api_key: form.api_key,
      llm_base_url: form.base_url,
      llm_model: form.model,
      llm_temperature: String(form.temperature),
      crawl_schedule_enabled: String(crawlEnabled.value)
    })
    ElMessage.success('LLM 配置已保存')
  } catch (e) {
  } finally {
    saving.value = false
  }
}

async function saveCrawl(val) {
  try {
    await updateSettings({ crawl_schedule_enabled: String(val) })
    ElMessage.success('爬取开关已更新')
  } catch (e) {
  }
}

onMounted(load)
</script>
