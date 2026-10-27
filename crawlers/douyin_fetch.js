'use strict';
/**
 * crawlers/douyin_fetch.js
 * 抖音单条视频内容提取探针：用 msedge 真实浏览器（持久化 profile）打开视频页，
 * 提取标题/文案/作者/互动数/视频地址，并落截图 + JSON。
 *
 * 用法: node douyin_fetch.js <抖音链接> [输出名]
 * 产物: outputs/douyin/<输出名>.json + .png
 */
const fs = require('fs');
const path = require('path');
const { safeLaunchPersistentContext } = require('./utils/launchProfile.js');

const url = process.argv[2];
if (!url) {
  console.error('usage: node douyin_fetch.js <url> [outname]');
  process.exit(1);
}
const outName = process.argv[3] || ('douyin_' + Date.now());

const OUT_DIR = path.resolve(__dirname, '../../outputs/douyin');
const PROFILE_DIR = path.resolve(__dirname, '../data/douyin-profile');
fs.mkdirSync(OUT_DIR, { recursive: true });

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

  let finalUrl = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    finalUrl = page.url();
  } catch (e) {
    console.error('goto err:', e.message);
  }

  const shot = path.join(OUT_DIR, outName + '.png');
  try {
    await page.screenshot({ path: shot });
  } catch (e) {
    console.error('shot err:', e.message);
  }

  const data = await page.evaluate(() => {
    const meta = {};
    document.querySelectorAll('meta').forEach((m) => {
      const k = m.getAttribute('property') || m.getAttribute('name');
      const v = m.getAttribute('content');
      if (k && v && v.length < 2000) meta[k] = v;
    });
    const videoSrcs = [...document.querySelectorAll('video')]
      .map((v) => v.currentSrc || v.src)
      .filter(Boolean);
    const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();

    // 抖音 web 的真实数据在 RENDER_DATA（URL 编码 JSON）里。注意它常被赋值成
    // <script> 元素而非字符串，必须先取 textContent 再解码。
    let renderLen = 0;
    let renderErr = '';
    let playUrls = [];
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
          /* 本来就是明文，忽略 */
        }
        renderLen = raw.length;
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
        .filter((n) => /\.mp4|\.m4s|douyinvod|media-video/.test(n))
        .slice(0, 20);
    } catch (e) {
      /* 忽略 */
    }

    return {
      title: document.title,
      meta,
      videoSrcs,
      textHead: text.slice(0, 5000),
      textLen: text.length,
      hasRouterData: !!window._ROUTER_DATA,
      hasRenderData: !!window.RENDER_DATA,
      renderLen,
      renderErr,
      playUrls,
      netMedia
    };
  });

  const out = { url, finalUrl, fetchedAt: new Date().toISOString(), screenshot: shot, ...data };
  const jf = path.join(OUT_DIR, outName + '.json');
  fs.writeFileSync(jf, JSON.stringify(out, null, 2), 'utf8');

  console.log('TITLE      :', data.title);
  console.log('FINAL_URL  :', finalUrl);
  console.log('VIDEO_SRCS :', JSON.stringify(data.videoSrcs).slice(0, 400));
  console.log('ROUTER/RENDER:', data.hasRouterData, data.hasRenderData);
  console.log('TEXT_LEN   :', data.textLen);
  console.log('META_KEYS  :', Object.keys(data.meta).join(', ').slice(0, 500));
  console.log('TEXT_HEAD  :', data.textHead.slice(0, 800));
  console.log('RENDER_LEN :', data.renderLen, '| err:', data.renderErr);
  console.log('PLAY_URLS  :', JSON.stringify(data.playUrls || []).slice(0, 1500));
  console.log('NET_MEDIA  :', JSON.stringify(data.netMedia || []).slice(0, 800));
  console.log('---');
  console.log('JSON:', jf);
  console.log('SHOT:', shot);

  await ctx.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
