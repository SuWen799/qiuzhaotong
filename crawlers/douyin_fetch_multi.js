'use strict';
/**
 * crawlers/douyin_fetch_multi.js
 * 批量抓取抖音视频页：**复用同一个浏览器会话**依次打开多条链接（比逐条重启浏览器快得多），
 * 每条产出 <outDir>/<awemeId>.json + .png，并统一导出一份 cookies.txt。
 *
 * 用法: node douyin_fetch_multi.js <输出目录> <url1> [url2] ...
 */
const fs = require('fs');
const path = require('path');
const { safeLaunchPersistentContext } = require('./utils/launchProfile.js');

const outDir = process.argv[2];
const urls = process.argv.slice(3).filter((u) => u && !u.startsWith('--'));
if (!outDir || !urls.length) {
  console.error('usage: node douyin_fetch_multi.js <outdir> <url...>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const PROFILE_DIR = path.resolve(__dirname, '../data/douyin-profile');

// 在页面上下文里执行的提取逻辑（抖音 web 数据在 RENDER_DATA，直链只在网络请求里）
const EXTRACT = () => {
  const meta = {};
  document.querySelectorAll('meta').forEach((m) => {
    const k = m.getAttribute('property') || m.getAttribute('name');
    const v = m.getAttribute('content');
    if (k && v && v.length < 2000) meta[k] = v;
  });
  const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();

  let playUrls = [];
  let renderErr = '';
  try {
    let raw = '';
    const el = window.RENDER_DATA;
    if (typeof el === 'string') raw = el;
    else if (el && el.textContent) raw = el.textContent;
    if (!raw) {
      const s = document.querySelector('script#RENDER_DATA');
      if (s) raw = s.textContent || '';
    }
    raw = (raw || '').trim();
    if (raw) {
      try {
        raw = decodeURIComponent(raw);
      } catch (e) {
        /* 明文 */
      }
      const obj = JSON.parse(raw);
      const hits = new Set();
      const walk = (o, d) => {
        if (!o || d > 14) return;
        if (typeof o === 'string') {
          if (/^https?:\/\//.test(o) && /(\.mp4|\.m4s|douyinvod|aweme\/v1\/play)/.test(o)) hits.add(o);
          return;
        }
        if (Array.isArray(o)) {
          o.forEach((x) => walk(x, d + 1));
          return;
        }
        if (typeof o === 'object') for (const k in o) walk(o[k], d + 1);
      };
      walk(obj, 0);
      playUrls = [...hits].slice(0, 30);
    }
  } catch (e) {
    renderErr = String(e);
  }

  let netMedia = [];
  try {
    netMedia = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\.mp4|\.m4s|douyinvod|media-video|media-audio/.test(n))
      .slice(0, 30);
  } catch (e) {
    /* 忽略 */
  }

  const videoSrcs = [...document.querySelectorAll('video')]
    .map((v) => v.currentSrc || v.src)
    .filter(Boolean);

  return { title: document.title, meta, videoSrcs, textHead: text.slice(0, 6000), textLen: text.length, playUrls, netMedia, renderErr };
};

(async () => {
  const ctx = await safeLaunchPersistentContext(
    PROFILE_DIR,
    {
      channel: 'msedge',
      headless: false,
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      args: ['--disable-blink-features=AutomationControlled']
    },
    'douyin'
  );

  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);
  const summary = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const tag = `[${i + 1}/${urls.length}]`;
    const rec = { index: i + 1, url };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(7000);
      rec.finalUrl = page.url();
      Object.assign(rec, await page.evaluate(EXTRACT));

      const m = String(rec.finalUrl).match(/video\/(\d+)/);
      rec.awemeId = m ? m[1] : `idx${i + 1}`;

      const base = path.join(outDir, rec.awemeId);
      try {
        await page.screenshot({ path: base + '.png' });
      } catch (e) {
        /* 截图失败不阻断 */
      }
      fs.writeFileSync(base + '.json', JSON.stringify(rec, null, 2), 'utf8');

      console.log(`${tag} OK   ${rec.awemeId} | ${(rec.title || '').slice(0, 60)}`);
      summary.push({ index: i + 1, url, awemeId: rec.awemeId, title: rec.title, textLen: rec.textLen, media: (rec.netMedia || []).length, error: null });
    } catch (e) {
      console.log(`${tag} FAIL ${url} :: ${e.message}`);
      summary.push({ index: i + 1, url, error: e.message });
    }
  }

  // 统一导出 cookie，供后续 CDN 下载使用
  try {
    const cookies = await ctx.cookies();
    const lines = ['# Netscape HTTP Cookie File', '# douyin_fetch_multi.js', ''];
    for (const c of cookies) {
      if (!c.name || c.value === undefined) continue;
      lines.push([c.domain, c.domain && c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', c.expires && c.expires > 0 ? Math.floor(c.expires) : 0, c.name, c.value].join('\t'));
    }
    fs.writeFileSync(path.join(outDir, 'cookies.txt'), lines.join('\n'), 'utf8');
    console.log('COOKIES:', cookies.length);
  } catch (e) {
    console.error('cookie export failed:', e.message);
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  const ok = summary.filter((s) => !s.error).length;
  console.log(`DONE: ${ok}/${urls.length} 成功 -> ${outDir}`);
  await ctx.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
