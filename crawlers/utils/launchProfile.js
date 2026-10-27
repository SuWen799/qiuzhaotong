/**
 * crawlers/utils/launchProfile.js
 * Sunwz|2026-09-01|自动恢复：飞书类爬虫的 Edge 持久化 profile 偶发损坏（多为上次浏览器异常退出残留
 * SingletonLock 等锁文件），导致 chromium.launchPersistentContext 抛
 * "Target page, context or browser has been closed"，整源爬取红字报错、还得手工改名 .bak。
 *
 * 本模块做两件事，彻底自治：
 *   1) 启动前清理 profile 目录下的残留锁文件（SingletonLock/SingletonCookie/SingletonSocket/DevToolsActivePort，
 *      含 Default 子目录）—— 根因预防，绝大多数损坏靠这一步即可避免。
 *   2) 若启动仍失败且报错特征属"启动类失败"，自动把损坏目录 rename 为 .bak-<ts>（保留供排查），
 *      用全新空 profile 重试一次 —— 兜底自愈，无需人工介入。
 *
 * 用法：把原来 `await chromium.launchPersistentContext(PROFILE, opts)` 换成
 *      `await safeLaunchPersistentContext(PROFILE, opts, 'feishu')`。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// 浏览器异常退出后会残留的"单例锁"文件，正是下次 launch 失败的根因
const STALE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];

function cleanStaleLocks(profileDir) {
  if (!fs.existsSync(profileDir)) return;
  for (const f of STALE_LOCK_FILES) {
    // recursive:true —— 锁文件有时会被建成目录，非递归 rm 删不掉，必须递归
    try { fs.rmSync(path.join(profileDir, f), { force: true, recursive: true }); } catch (e) { /* 忽略 */ }
  }
  // Default 子目录里也可能残留锁
  const def = path.join(profileDir, 'Default');
  if (fs.existsSync(def)) {
    for (const f of STALE_LOCK_FILES) {
      try { fs.rmSync(path.join(def, f), { force: true, recursive: true }); } catch (e) { /* 忽略 */ }
    }
  }
}

// 仅当报错特征属于"启动类失败"才触发自愈，避免吞掉真正的业务错误
function isLaunchFailure(err) {
  const msg = (err && err.message) || String(err);
  return /launchPersistentContext|Target page, context or browser has been closed|Failed to launch|browser has been closed|Connection closed/i.test(msg);
}

/**
 * 带自动恢复的 launchPersistentContext。
 * @param {string} profileDir 持久化 profile 目录（绝对或相对）
 * @param {object} options   传给 chromium.launchPersistentContext 的选项
 * @param {string} label     日志前缀（如 'feishu' / 'feishu_wanqing'）
 */
async function safeLaunchPersistentContext(profileDir, options, label = 'browser') {
  fs.mkdirSync(profileDir, { recursive: true });
  cleanStaleLocks(profileDir);

  const doLaunch = () => chromium.launchPersistentContext(profileDir, options);

  try {
    return await doLaunch();
  } catch (e) {
    if (!isLaunchFailure(e)) throw e; // 非启动类错误，原样抛出
    const msg = (e && e.message) || String(e);
    console.warn(`[${label}] Edge 启动失败，疑似 profile 损坏，自动重建后重试一次: ${msg}`);
    // 把损坏目录改名保留（带时间戳，避免覆盖历史 .bak），用全新空 profile 兜底
    const bak = `${profileDir}.bak-${Date.now()}`;
    try { fs.renameSync(profileDir, bak); } catch (e2) { /* 极端情况下目录被锁，忽略，交由下方重建 */ }
    fs.mkdirSync(profileDir, { recursive: true });
    cleanStaleLocks(profileDir);
    return await doLaunch();
  }
}

module.exports = { safeLaunchPersistentContext, cleanStaleLocks };
