const fs = require('fs');
const SRC = 'C:/Users/<你的Windows用户名>/Desktop/秋招文件/秋招官网汇总/campus-recruitment/data/merged.json';
const OUT = 'C:/Users/<你的Windows用户名>/Desktop/秋招文件/秋招助手/秋招通/db_backfill_pubdate.sql';
const d = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
const map = {};
for (const r of (d.records || [])) {
  const nm = (r['公司名称'] || '').trim();
  if (!nm) continue;
  const pub = (r['发布日期'] || '').trim();
  if (!map[nm]) map[nm] = pub;
}
const esc = (s) => s.replace(/'/g, "''");
const lines = [];
for (const [nm, pub] of Object.entries(map)) {
  lines.push("UPDATE companies SET publish_date = '" + pub.replace(/'/g, '') + "' WHERE company_name = '" + esc(nm) + "' AND (publish_date IS NULL OR publish_date = '');");
}
fs.writeFileSync(OUT, lines.join('\n'));
console.log('wrote', lines.length, 'updates');
