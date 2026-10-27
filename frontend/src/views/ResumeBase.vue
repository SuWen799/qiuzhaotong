<template>
  <el-card shadow="never">
    <template #header>基础档案维护</template>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="按模块维护你的基础档案，保存后供简历生成调用。实习经历支持多条，可自由增删。"
      style="margin-bottom: 14px"
    />
    <el-tabs v-model="activeSection" @tab-change="loadSection">
      <el-tab-pane
        v-for="s in sections"
        :key="s.key"
        :label="s.label"
        :name="s.key"
      >
        <el-card shadow="never">
          <template #header>
            <div class="sec-head">
              <span>{{ s.label }}</span>
              <el-button type="primary" size="small" :icon="Check" :loading="saving" @click="saveSection">
                保存
              </el-button>
            </div>
          </template>

          <!-- 基本信息 -->
          <el-form v-if="activeSection === '基本信息'" label-width="90px">
            <el-form-item v-for="f in basicFields" :key="f" :label="f">
              <el-input v-model="form.basic[f]" />
            </el-form-item>
          </el-form>

          <!-- 教育背景（多条） -->
          <div v-else-if="activeSection === '教育背景'">
            <div v-for="(edu, i) in form.edu" :key="i" class="block">
              <div class="block-head">
                <span>教育经历 {{ i + 1 }}</span>
                <el-button size="small" type="danger" text :icon="Delete" @click="form.edu.splice(i, 1)" />
              </div>
              <el-form label-width="90px">
                <el-form-item label="学校"><el-input v-model="edu.school" /></el-form-item>
                <el-form-item label="专业"><el-input v-model="edu.major" /></el-form-item>
                <el-form-item label="学历"><el-input v-model="edu.degree" /></el-form-item>
                <el-form-item label="时间"><el-input v-model="edu.period" /></el-form-item>
              </el-form>
            </div>
            <el-button :icon="Plus" @click="form.edu.push({ school: '', major: '', degree: '', period: '' })">
              新增教育经历
            </el-button>
          </div>

          <!-- 核心能力 -->
          <el-form v-else-if="activeSection === '核心能力'" label-width="90px">
            <el-form-item label="技术能力">
              <el-input v-model="text.technical" type="textarea" :rows="6" placeholder="每行一项" />
            </el-form-item>
            <el-form-item label="软技能">
              <el-input v-model="text.soft" type="textarea" :rows="4" placeholder="每行一项" />
            </el-form-item>
          </el-form>

          <!-- 证书（多条） -->
          <div v-else-if="activeSection === '证书'">
            <div v-for="(c, i) in form.certs" :key="i" class="block">
              <div class="block-head">
                <span>证书 {{ i + 1 }}</span>
                <el-button size="small" type="danger" text :icon="Delete" @click="form.certs.splice(i, 1)" />
              </div>
              <el-form label-width="90px">
                <el-form-item label="名称"><el-input v-model="c.name" /></el-form-item>
                <el-form-item label="颁发机构"><el-input v-model="c.issuer" /></el-form-item>
                <el-form-item label="时间"><el-input v-model="c.date" /></el-form-item>
              </el-form>
            </div>
            <el-button :icon="Plus" @click="form.certs.push({ name: '', issuer: '', date: '' })">
              新增证书
            </el-button>
          </div>

          <!-- 实习经历（多条，核心修复点） -->
          <div v-else-if="activeSection === '实习经历'">
            <div v-for="(it, i) in form.interns" :key="i" class="block">
              <div class="block-head">
                <span>实习 {{ i + 1 }} · {{ it.company || '未命名' }}</span>
                <el-button size="small" type="danger" text :icon="Delete" @click="form.interns.splice(i, 1)" />
              </div>
              <el-form label-width="90px">
                <el-form-item label="公司"><el-input v-model="it.company" /></el-form-item>
                <el-form-item label="职位"><el-input v-model="it.role" /></el-form-item>
                <el-form-item label="时间"><el-input v-model="it.period" /></el-form-item>
                <el-form-item
                  v-for="(p, pi) in it.projects"
                  :key="pi"
                  :label="`项目 ${pi + 1}`"
                >
                  <div class="project">
                    <el-input v-model="p.name" placeholder="项目名称" style="margin-bottom:6px" />
                    <el-input v-model="p.description" type="textarea" :rows="2" placeholder="项目描述" style="margin-bottom:6px" />
                    <el-input v-model="p.techStack" placeholder="技术栈" style="margin-bottom:6px" />
                    <el-input v-model="text.highlights[`${i}_${pi}`]" type="textarea" :rows="3" placeholder="亮点（每行一项）" />
                    <el-button size="small" type="danger" text :icon="Delete" @click="it.projects.splice(pi, 1)" />
                  </div>
                </el-form-item>
                <el-button :icon="Plus" size="small" @click="it.projects.push({ name: '', description: '', techStack: '', highlights: [] })">
                  新增项目
                </el-button>
              </el-form>
            </div>
            <el-button :icon="Plus" @click="addInternship">新增实习经历</el-button>
          </div>

        </el-card>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { Check, Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getResumeBase, updateResumeBase } from '@/api/resume'

const sections = [
  { key: '基本信息', label: '基本信息' },
  { key: '教育背景', label: '教育背景' },
  { key: '核心能力', label: '核心能力' },
  { key: '证书', label: '证书' },
  { key: '实习经历', label: '实习经历' }
]

const activeSection = ref('基本信息')
const saving = ref(false)
const basicFields = ['name', 'age', 'gender', 'phone', 'email', 'hometown']

const form = reactive({
  basic: {},
  edu: [],
  certs: [],
  interns: []
})
// 文本域类字段（数组 <-> 文本互转）
const text = reactive({
  technical: '',
  soft: '',
  // 实习项目亮点 key = `${internIdx}_${projIdx}`
  highlights: {}
})

// 把后端 content（已解析对象）加载进表单
function loadIntoForm(section, content) {
  if (section === '基本信息') {
    Object.assign(form.basic, content || {})
  } else if (section === '教育背景') {
    form.edu = Array.isArray(content) ? content.map((x) => ({ ...x })) : []
  } else if (section === '核心能力') {
    const tech = (content && content.technical) || []
    const soft = (content && content.soft) || []
    text.technical = tech.join('\n')
    text.soft = soft.join('\n')
  } else if (section === '证书') {
    form.certs = Array.isArray(content) ? content.map((x) => ({ ...x })) : []
  } else if (section === '实习经历') {
    const list = Array.isArray(content) ? content : (content ? [content] : [])
    form.interns = list.map((it) => ({
      company: it.company || '',
      role: it.role || '',
      period: it.period || '',
      projects: (it.projects || []).map((p) => ({ ...p }))
    }))
    // 初始化亮点文本映射
    text.highlights = {}
    form.interns.forEach((it, i) => {
      it.projects.forEach((p, pi) => {
        text.highlights[`${i}_${pi}`] = (p.highlights || []).join('\n')
      })
    })
  }
}

// 把当前表单转成可保存的对象
function buildPayload(section) {
  if (section === '基本信息') return { ...form.basic }
  if (section === '教育背景') return form.edu
  if (section === '核心能力') {
    return {
      technical: text.technical.split('\n').map((s) => s.trim()).filter(Boolean),
      soft: text.soft.split('\n').map((s) => s.trim()).filter(Boolean)
    }
  }
  if (section === '证书') return form.certs
  if (section === '实习经历') {
    return form.interns.map((it, i) => ({
      company: it.company,
      role: it.role,
      period: it.period,
      projects: it.projects.map((p, pi) => ({
        name: p.name,
        description: p.description,
        techStack: p.techStack,
        highlights: (text.highlights[`${i}_${pi}`] || '').split('\n').map((s) => s.trim()).filter(Boolean)
      }))
    }))
  }
  return {}
}

async function loadSection() {
  try {
    const res = await getResumeBase()
    const list = res.data || []
    const found = list.filter((x) => x.section === activeSection.value)
    if (activeSection.value === '实习经历') {
      // 同名 section 可能有多条（历史数据），聚合为数组
      const arr = found.map((x) => {
        try { return JSON.parse(x.content) } catch { return null }
      }).filter(Boolean)
      const merged = arr.length > 1 ? arr : (arr[0] || [])
      loadIntoForm('实习经历', merged)
    } else {
      const one = found[0]
      let c = {}
      if (one && one.content) {
        try { c = JSON.parse(one.content) } catch { c = {} }
      }
      loadIntoForm(activeSection.value, c)
    }
  } catch (e) {
    ElMessage.error('加载失败')
  }
}

function addInternship() {
  form.interns.push({ company: '', role: '', period: '', projects: [{ name: '', description: '', techStack: '', highlights: [] }] })
}

async function saveSection() {
  saving.value = true
  try {
    const payload = buildPayload(activeSection.value)
    await updateResumeBase(activeSection.value, payload)
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// 首次加载
loadSection()
</script>

<style scoped>
.sec-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.block {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
  background: #fafbfc;
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.project {
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}
</style>
