const { safeLaunchPersistentContext } = require('./utils/launchProfile');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeFileSafeSync } = require('./utils/write-safe');

const URL = 'https://ycnynolbv7lx.feishu.cn/base/M7p6bYxFWa3GcXscQ1HcHaAWnod?table=tbl9yRzedJi2IHX3&view=vewXjLcyvq';
const OUTPUT = path.join(__dirname, '..', 'data', 'feishu_raw.json');

let fieldMap = {};
let allRecords = [];
// Sunwz|2026-07-31|改动目的：用于feishu记录去重
const seenIds = new Set();
// Sunwz|2026-07-31|改动目的——END

/**
 * Sunwz|2026-07-30|改动目的：从飞书投递方式/官方公告文本中提取真实 URL
 * 飞书多维表格的链接字段存的是描述文本，需要正则提取真实链接
 */
function extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /https?:\/\/[^\s,，；;）)\]]+/g;
    return text.match(urlRegex) || [];
}
// Sunwz|2026-07-30|改动目的——END

// Sunwz|2026-08-03|改动目的：优先提取URL链接而非显示文本
function extractValue(val, info) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) {
        return val.map(v => {
            if (typeof v === 'object' && v !== null) {
                // URL类型：优先取link而非text
                if (v.type === 'url' && v.link) return v.link;
                if (v.link) return v.link;
                if (v.text) return v.text;
                if (v.id && info && info.options && info.options[v.id]) return info.options[v.id];
                return JSON.stringify(v);
            }
            if (typeof v === 'string' && v.startsWith('opt') && info && info.options && info.options[v]) return info.options[v];
            return String(v);
        }).filter(v => v).join(', ');
    }
    if (typeof val === 'object') {
        if (val.type === 'url' && val.link) return val.link;
        if (val.link) return val.link;
        if (val.text) return val.text;
        return JSON.stringify(val);
    }
    return val;
}
// Sunwz|2026-08-03|改动目的——END

// Sunwz|2026-08-03|改动目的：从API响应中解析记录
function parseRecordsFromAPI(body) {
    if (!body || !body.data || !body.data.records) return 0;
    const compressed = Buffer.from(body.data.records, 'base64');
    const decompressed = zlib.gunzipSync(compressed).toString('utf-8');
    const parsed = JSON.parse(decompressed);
    const recordMap = parsed.recordMap || {};
    let newCount = 0;
    for (const [id, raw] of Object.entries(recordMap)) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const record = { _id: id };
        for (const [fieldId, fieldData] of Object.entries(raw)) {
            const info = fieldMap[fieldId];
            record[info ? info.name : fieldId] = extractValue(fieldData.value, info);
        }
        allRecords.push(record);
        newCount++;
    }
    return newCount;
}
// Sunwz|2026-08-03|改动目的——END

// Sunwz|2026-08-03|改动目的：滚动加载单个视图的全部数据
async function scrollLoadCurrentView(page, maxRounds = 60) {
    let lastCount = 0;
    let stableRounds = 0;

    for (let i = 0; i < maxRounds; i++) {
        await page.evaluate(() => {
            const container = document.querySelector('.bitable-table-body') || document.querySelector('[data-testid="table-body"]') || window;
            container.scrollTo(0, container.scrollHeight || document.body.scrollHeight);
        });
        await page.waitForTimeout(1200);

        if (i % 5 === 0) {
            await page.keyboard.press('End');
            await page.waitForTimeout(800);
        }

        if (allRecords.length === lastCount) {
            stableRounds++;
            if (stableRounds >= 5) {
                for (let j = 0; j < 3; j++) {
                    await page.evaluate(() => window.scrollBy(0, 5000));
                    await page.waitForTimeout(1500);
                }
                if (allRecords.length === lastCount) break;
                stableRounds = 0;
            }
        } else {
            stableRounds = 0;
            lastCount = allRecords.length;
        }
        process.stdout.write(`\r  滚动加载中... 已获取 ${allRecords.length} 条 (第${i+1}轮)`);
    }
    console.log('');
}
// Sunwz|2026-08-03|改动目的——END

// Sunwz|2026-08-03|改动目的：获取页面上所有视图名称
async function getAllViews(page) {
    return await page.evaluate(() => {
        const views = [];
        // 查找飞书视图菜单项（实测 DOM：li.bitable-view-menu-item）
        document.querySelectorAll('.bitable-view-menu-item, [class*=\"view-tab\"], [class*=\"tab-item\"], [role=\"tab\"]').forEach(el => {
            const text = el.textContent.trim();
            if (text && text.length < 30 && (text.includes('届') || text.includes('26') || text.includes('27'))) {
                views.push(text);
            }
        });
        // 也查找所有可能的视图元素
        document.querySelectorAll('span, div').forEach(el => {
            const text = el.textContent.trim();
            if (text.match(/^(26|27|26~27)/) && text.includes('届') && text.length < 25) {
                if (!views.includes(text)) views.push(text);
            }
        });
        return [...new Set(views)];
    });
}
// Sunwz|2026-08-03|改动目的——END

async function crawl() {
    // Sunwz|2026-08-05|改动目的：重置模块级变量，避免多次爬取（定时+手动）时累积重复记录
    allRecords = [];
    seenIds.clear();
    fieldMap = {};
    // Sunwz|2026-08-05|改动目的——END

    console.log('[feishu] 启动 Edge 浏览器...');
    // Sunwz|2026-08-04|改动目的：改用独立持久化 Edge profile 复用飞书登录态
    // 原因：飞书表格需要登录才能访问；临时 profile 无登录态；用户 Edge 的 Default profile 会被占用锁死
    // 方案：独立 profile 目录（data/feishu-profile），首次运行弹出 Edge 登录飞书一次，之后定时/手动爬取自动复用登录态
    const PROFILE_DIR = path.join(__dirname, '..', 'data', 'feishu-profile');
    console.log(`[feishu] 使用独立 Edge profile: ${PROFILE_DIR}`);
    console.log('[feishu] 提示：首次运行请在弹出的 Edge 窗口中登录飞书，登录后会自动继续');
    const context = await safeLaunchPersistentContext(PROFILE_DIR, {
        channel: 'msedge', headless: false, args: ['--no-sandbox'], timeout: 60000,
    }, 'feishu');
    // Sunwz|2026-08-04|改动目的——END
    const page = await context.newPage();

    // 拦截响应
    page.on('response', async response => {
        const url = response.url();
        if (url.includes('/clientvars')) {
            try {
                const body = await response.json();
                if (body && body.data && body.data.table) {
                    const compressed = Buffer.from(body.data.table, 'base64');
                    const decompressed = zlib.gunzipSync(compressed).toString('utf-8');
                    const parsed = JSON.parse(decompressed);
                    if (parsed.fieldMap) {
                        for (const [id, field] of Object.entries(parsed.fieldMap)) {
                            const opts = {};
                            if (field.property && field.property.options) {
                                for (const o of field.property.options) opts[o.id] = o.name;
                            }
                            fieldMap[id] = { name: field.name, type: field.fieldUIType, options: opts };
                        }
                        console.log(`  字段映射: ${Object.keys(fieldMap).length} 个`);
                    }
                }
            } catch (e) {}
        }
        if (url.includes('/space/api/v1/bitable/') && url.includes('/records')) {
            try {
                const newCount = parseRecordsFromAPI(await response.json());
                if (newCount > 0) {
                    console.log(`  新增 ${newCount} 条，累计 ${allRecords.length} 条`);
                }
            } catch (e) {}
        }
    });

    console.log('[feishu] 打开飞书页面...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);

    // Sunwz|2026-08-04|改动目的：登录检测放在视图遍历之前（首次运行需登录，登录后才有数据可爬）
    // 轮询等待登录完成（最多 5 分钟），登录后页面 URL 不再是登录页，自动继续
    const waitLoginFinish = async () => {
        console.log('[feishu] 需要登录，请在弹出的 Edge 窗口中登录飞书...');
        for (let i = 0; i < 60; i++) {
            const currentUrl = page.url();
            if (!currentUrl.includes('login') && !currentUrl.includes('accounts')) {
                console.log('[feishu] 登录完成，继续爬取...');
                return true;
            }
            await page.waitForTimeout(5000);
        }
        console.log('[feishu] 登录等待超时');
        return false;
    };

    // 检测登录状态（多次检测，因为飞书可能延迟跳转登录页）
    let needLogin = false;
    for (let i = 0; i < 3; i++) {
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('accounts')) {
            needLogin = true;
            break;
        }
        await page.waitForTimeout(3000);
    }
    if (needLogin) {
        await waitLoginFinish();
    }
    // Sunwz|2026-08-04|改动目的——END

    // Sunwz|2026-08-03|改动目的：爬取指定届别的视图
    // Sunwz|2026-08-04|改动目的：只爬 27 届视图（用户是 27 届，26 届和 26~27 届不需要）
    const TARGET_VIEW_KEYWORD = '27届'; // 只爬 27 届
    const views = await getAllViews(page);
    console.log(`  发现视图: ${views.join(', ') || '无，使用默认视图'}`);

    // 找目标视图：优先匹配以 "27届" 开头的视图（避免误匹配 "26~27届"）
    const targetView = views.find(v => v.startsWith(TARGET_VIEW_KEYWORD))
        || views.find(v => v.includes(TARGET_VIEW_KEYWORD) && !v.includes('26'));
    console.log(`[feishu] 目标视图: ${targetView || '(未找到，使用默认视图)'}`);

    if (targetView) {
        // 切换到 27 届视图
        const clicked = await page.evaluate((name) => {
            // 优先：视图菜单项
            const items = document.querySelectorAll('.bitable-view-menu-item');
            for (const el of items) {
                if (el.textContent && el.textContent.trim() === name) {
                    el.click();
                    return true;
                }
            }
            // 兜底：任意叶子节点
            const els = document.querySelectorAll('*');
            for (const el of els) {
                if (el.textContent && el.textContent.trim() === name && el.children.length === 0) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, targetView);

        if (clicked) {
            console.log(`[feishu] 已切换到视图: ${targetView}`);
            await page.waitForTimeout(5000);
            await scrollLoadCurrentView(page, 30);
        } else {
            console.log('[feishu] 视图切换失败，滚动默认视图');
            await scrollLoadCurrentView(page);
        }
    } else {
        // 没有目标视图，直接滚动加载默认视图
        console.log('[feishu] 滚动加载默认视图...');
        await scrollLoadCurrentView(page);
    }
    // Sunwz|2026-08-03|改动目的——END

    // Sunwz|2026-07-30|改动目的：飞书数据输出前，从投递方式/官方公告字段提取真实 URL
    allRecords = allRecords.map(r => {
        const deliveryText = r['投递方式'] || '';
        const noticeText = r['官方公告'] || '';
        const deliveryUrls = extractUrls(deliveryText);
        const noticeUrls = extractUrls(noticeText);
        if (deliveryUrls[0]) r['_deliveryLink'] = deliveryUrls[0];
        if (noticeUrls[0]) r['_noticeLink'] = noticeUrls[0];
        return r;
    });
    const withLinks = allRecords.filter(r => r['_deliveryLink'] || r['_noticeLink']).length;
    console.log(`[feishu] 从飞书字段中提取到链接: ${withLinks} 条`);
    // Sunwz|2026-07-30|改动目的——END

    console.log(`[feishu] 完成: ${allRecords.length} 条`);

    // Sunwz|2026-08-03|改动目的：改用记录ID去重（同一公司不同岗位是多条记录）
    // Sunwz|2026-08-06|改动目的：局部变量改名 dedupSeenIds，避免遮蔽模块级 seenIds（否则函数开头的 seenIds.clear() 触发 TDZ 报错）
    const deduped = [];
    const dedupSeenIds = new Set();
    for (const r of allRecords) {
        const id = r._id;
        if (dedupSeenIds.has(id)) continue;
        dedupSeenIds.add(id);
        deduped.push(r);
    }
    // Sunwz|2026-08-06|改动目的——END
    const removed = allRecords.length - deduped.length;
    if (removed > 0) {
        console.log(`[feishu] 去重: 移除 ${removed} 条重复，保留 ${deduped.length} 条`);
    }
    // Sunwz|2026-08-03|改动目的——END
    // Sunwz|2026-07-31|改动目的——END

    // Sunwz|2026-07-31|改动目的：爬取数量过少时不覆盖原数据，防止数据丢失
    if (deduped.length < 1000) {
        console.warn(`[feishu] ⚠️ 爬取仅 ${deduped.length} 条，未覆盖原数据！`);
        await context.close();
        return deduped;
    }
    console.log(`[feishu] 数据已保存`);
    // Sunwz|2026-07-31|改动目的——END

    writeFileSafeSync(OUTPUT, JSON.stringify(deduped, null, 2));
    await context.close();
    return deduped;
}

if (require.main === module) {
    crawl().catch(console.error);
}

module.exports = { crawl };
