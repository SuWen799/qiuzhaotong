<template>
  <router-view />
</template>

<script setup></script>

<style>
/* ===== 全局基础规范：对齐「秋招官网汇总」视觉 ===== */
html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f5f7fa;
  color: #333;
}

/* 主色链接 */
a {
  color: #1a73e8;
}

/* ===== Element Plus 全局覆盖：主色 #1a73e8 ===== */
.el-button--primary {
  background-color: #1a73e8;
  border-color: #1a73e8;
}
.el-button--primary:hover,
.el-button--primary:focus {
  background-color: #1557b0;
  border-color: #1557b0;
}
.el-button--primary:active {
  background-color: #1557b0;
  border-color: #1557b0;
}
.el-link.el-link--primary {
  color: #1a73e8;
}
.el-link.el-link--primary:hover {
  color: #1557b0;
}

/* ===== 卡片容器风格：白底圆角 + 轻阴影 ===== */
.el-card {
  border-radius: 8px;
  border: 1px solid #ebeef5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08) !important;
}
.el-card__header {
  border-bottom: 1px solid #ebeef5;
  font-weight: 600;
  color: #303133;
}

/* ===== 表格风格：表头 #f8f9fa、行 hover #f8faff ===== */
.el-table th.el-table__cell {
  background-color: #f8f9fa !important;
  color: #303133;
  font-weight: 600;
}
.el-table .el-table__row:hover > td.el-table__cell {
  background-color: #f8faff !important;
}
.el-table td.el-table__cell,
.el-table th.el-table__cell {
  border-bottom: 1px solid #f0f0f0;
}

/* ===== 彩色投递状态徽章（对齐官网汇总 .status-select.status-xxx） ===== */
.status-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}
.status-已投递,
.status-applied {
  background: #e8f5e9;
  color: #2e7d32;
}
.status-未投递,
.status-unapplied {
  background: #fff3e0;
  color: #e65100;
}
.status-已笔试,
.status-written {
  background: #e3f2fd;
  color: #1565c0;
}
.status-已面试,
.status-interview {
  background: #f3e5f5;
  color: #7b1fa2;
}
.status-已挂,
.status-rejected {
  background: #ffebee;
  color: #c62828;
}
.status-不投递,
.status-giveup {
  background: #eceff1;
  color: #607d8b;
}
</style>
