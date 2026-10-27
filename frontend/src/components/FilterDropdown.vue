<template>
  <div class="filter-group" ref="root">
    <!-- 标题按钮（复刻旧版：点击展开/收起下拉面板） -->
    <button type="button" class="filter-label" @click="toggle">
      {{ label }}
      <span v-if="selectedCount" class="sel-count">{{ selectedCount }}</span>
      <span class="caret" :class="{ open }">▾</span>
    </button>

    <!-- 下拉面板：checkbox 列表 + 全选总开关（复刻旧版 filter-options） -->
    <div v-if="open" class="filter-options" @change="onAnyChange">
      <label class="filter-checkbox filter-all">
        <input type="checkbox" :checked="allChecked" :indeterminate="indeterminate" @change="toggleAll" />
        <span><b>全选</b> ({{ options.length }})</span>
      </label>
      <label
        v-for="opt in options"
        :key="opt.value"
        class="filter-checkbox"
      >
        <input type="checkbox" :value="opt.value" v-model="localSelected" />
        <span>{{ opt.label }} ({{ opt.count }})</span>
      </label>
      <div v-if="!options.length" class="no-opt">暂无选项</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  // 选项：[{value,label,count}]
  options: { type: Array, default: () => [] },
  // 父组件传入的已选值（v-model）
  modelValue: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const root = ref(null)
// 本地选中副本：默认全部勾选（复刻旧版"默认全选"）
const localSelected = ref([])

watch(() => props.options, (opts) => {
  const vals = (opts || []).map((o) => o.value)
  // 默认全选（父未选中任何项时）
  if (!props.modelValue || props.modelValue.length === 0) {
    localSelected.value = [...vals]
  } else {
    localSelected.value = [...props.modelValue]
  }
}, { immediate: true })

watch(() => props.modelValue, (v) => {
  if (v && v.length) localSelected.value = [...v]
}, { deep: true })

const selectedCount = computed(() => {
  // 选中数少于总数时显示徽标（等于总数=全选时不显示，对齐旧版"全部"语义）
  const n = localSelected.value.length
  return n > 0 && n < props.options.length ? n : 0
})
const allChecked = computed(
  () => props.options.length > 0 && localSelected.value.length === props.options.length
)
const indeterminate = computed(
  () => localSelected.value.length > 0 && localSelected.value.length < props.options.length
)

function toggle() {
  open.value = !open.value
}

function toggleAll(e) {
  const checked = e.target.checked
  if (checked) {
    localSelected.value = props.options.map((o) => o.value)
  } else {
    localSelected.value = []
  }
  emitChange()
}

function onAnyChange() {
  // v-model 已更新 localSelected，这里仅触发 emit（实时筛选，无需查询按钮）
  emitChange()
}

function emitChange() {
  emit('update:modelValue', [...localSelected.value])
  emit('change', [...localSelected.value])
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.filter-group {
  position: relative;
  min-width: 140px;
}
/* 标题按钮：复刻旧版 .filter-label */
.filter-label {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  background: #f8f9fa;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label:hover {
  background: #e8f0fe;
  border-color: #1a73e8;
}
.sel-count {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #1a73e8;
  color: #fff;
  font-size: 11px;
  text-align: center;
}
.caret {
  margin-left: auto;
  transition: transform 0.15s;
  font-size: 12px;
  color: #888;
}
.caret.open {
  transform: rotate(180deg);
}
/* 下拉面板：复刻旧版 .filter-options（绝对定位、白底黑字、清晰可读） */
.filter-options {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
  min-width: 200px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.filter-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 3px;
}
.filter-checkbox:hover {
  background: #f0f7ff;
}
.filter-checkbox input[type='checkbox'] {
  cursor: pointer;
  width: 14px;
  height: 14px;
  accent-color: #1a73e8;
}
.filter-checkbox span {
  flex: 1;
}
.filter-all {
  border-bottom: 1px solid #eee;
  margin-bottom: 4px;
  padding-bottom: 6px;
}
.no-opt {
  color: #c0c4cc;
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}
</style>
