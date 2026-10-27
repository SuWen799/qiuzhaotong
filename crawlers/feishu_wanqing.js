const { safeLaunchPersistentContext } = require('./utils/launchProfile');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeFileSafeSync } = require('./utils/write-safe');

const URL = 'https://yal2at57cvq.feishu.cn/base/GtSLbyyR3aCENOsJYC6cdlsVnih?from=from_copylink';
const OUTPUT = path.join(__dirname, '..', 'data', 'feishu_wanqing_raw.json');
const PROFILE = path.join(__dirname, '..', 'data', 'feishu-wanqing');

let fieldMap = {};
let allRecords = [];
const seenIds = new Set();

// Option ID -> 名称映射（从 fieldMap 构建）
const optionNameMap = {};
function buildOptionMap() {
    for (const field of Object.values(fieldMap)) {
        if (field.options) {
            for (const opt of field.options) {
                optionNameMap[opt.id] = opt.name;
            }
        }
    }
}

function extractValue(val, info) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) {
        // MultiSelect: 数组中的 option ID 转名称
        return val.map(v => {
            if (typeof v === 'object' && v !== null) {
                if (v.type === 'url' && v.link) return v.link;
                if (v.link) return v.link;
                if (v.text) return v.text;
                if (v.id && info?.options?.[v.id]) return info.options[v.id];
                return JSON.stringify(v);
            }
            // option ID 转名称
            if (optionNameMap[String(v)]) return optionNameMap[String(v)];
            return String(v);
        }).filter(v => v).join(', ');
    }
    if (typeof val === 'object') {
        if (val.type === 'url' && val.link) return val.link;
        if (val.link) return val.link;
        if (val.text) return val.text;
        return JSON.stringify(val);
    }
    // 单个 option ID 转名称
    if (optionNameMap[String(val)]) return optionNameMap[String(val)];
    return val;
}

function parseRecordsFromAPI(body) {
    if (!body?.data?.records) return 0;
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
            record[info?.name || fieldId] = extractValue(fieldData.value, info);
        }
        // 过滤：只保留 27 届秋招（届次含 2027）
        const target = record['届次'] || '';
        const is27 = String(target).includes('2027');
        if (!is27) continue;
        allRecords.push(record);
        newCount++;
    }
    return newCount;
}

async function scrollLoad(page, maxRounds = 60) {
    let lastCount = 0, stableRounds = 0;
    for (let i = 0; i < maxRounds; i++) {
        await page.evaluate(() => {
            const c = document.querySelector('.bitable-table-body') || document.querySelector('[data-testid="table-body"]') || window;
            c.scrollTo(0, c.scrollHeight || document.body.scrollHeight);
        });
        await page.waitForTimeout(1200);
        if (i % 5 === 0) { await page.keyboard.press('End'); await page.waitForTimeout(800); }
        if (allRecords.length === lastCount) {
            stableRounds++;
            if (stableRounds >= 5) {
                for (let j = 0; j < 3; j++) { await page.evaluate(() => window.scrollBy(0, 5000)); await page.waitForTimeout(1500); }
                if (allRecords.length === lastCount) break;
                stableRounds = 0;
            }
        } else { stableRounds = 0; lastCount = allRecords.length; }
        process.stdout.write(`\r  滚动加载... 已获取 ${allRecords.length} 条 (第${i+1}轮)`);
    }
    console.log('');
}

async function crawl() {
    allRecords = [];
    seenIds.clear();
    fieldMap = {};

    console.log('[feishu_wanqing] 启动 Edge（独立 profile）...');
    const context = await safeLaunchPersistentContext(PROFILE, { channel: 'msedge', headless: false, args: ['--no-sandbox'], timeout: 60000 }, 'feishu_wanqing');
    const page = await context.newPage();

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('/clientvars') && url.includes('bitable')) {
            try {
                const body = await response.json();
                if (body?.data?.table) {
                    const d = zlib.gunzipSync(Buffer.from(body.data.table, 'base64')).toString();
                    const p = JSON.parse(d);
                    if (p.fieldMap) {
                        for (const [id, f] of Object.entries(p.fieldMap)) {
                            fieldMap[id] = { name: f.name, type: f.fieldUIType, options: (f.property?.options || []).map(o => ({id: o.id, name: o.name})) };
                        }
                        buildOptionMap();
                    }
                }
            } catch(e) {}
        }
        if (url.includes('/space/api/v1/bitable/') && url.includes('/records')) {
            const n = parseRecordsFromAPI(await response.json());
            if (n > 0) console.log(`  新增 ${n} 条，累计 ${allRecords.length} 条`);
        }
    });

    console.log('[feishu_wanqing] 打开页面...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 等待登录（最多 3 分钟）
    console.log('[feishu_wanqing] 等待登录...');
    for (let i = 0; i < 180; i++) {
        await page.waitForTimeout(1000);
        const text = await page.evaluate(() => document.body.innerText.substring(0, 50));
        if (!text.includes('登录/注册') && !text.includes('请登录')) { console.log('  登录完成'); break; }
    }

    // 切换到 27届秋招🍁 视图
    console.log('[feishu_wanqing] 切换视图到 27届秋招...');
    await page.evaluate(() => {
        // 尝试多种选择器找视图
        const selectors = ['.bitable-view-menu-item', '[class*=view-tab]', '[class*=tab-item]', '[role=tab]'];
        for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (el.textContent?.includes('27届秋招')) { el.click(); return; }
            }
        }
    });
    await page.waitForTimeout(5000);

    console.log('[feishu_wanqing] 滚动加载数据...');
    await scrollLoad(page);

    // 提取链接
    allRecords = allRecords.map(r => {
        const deliveryText = r['投递链接'] || '';
        const noticeText = r['公告链接'] || '';
        const deliveryUrls = deliveryText.match(/https?:\/\/[^\s,，；;）)\]]+/g) || [];
        const noticeUrls = noticeText.match(/https?:\/\/[^\s,，；;）)\]]+/g) || [];
        if (deliveryUrls[0]) r['_deliveryLink'] = deliveryUrls[0];
        if (noticeUrls[0]) r['_noticeLink'] = noticeUrls[0];
        return r;
    });

    const withLinks = allRecords.filter(r => r['_deliveryLink'] || r['_noticeLink']).length;
    console.log(`[feishu_wanqing] 提取到链接: ${withLinks}/${allRecords.length} 条`);
    console.log(`[feishu_wanqing] 完成: ${allRecords.length} 条`);

    // 数量过少不覆盖
    if (allRecords.length < 100) {
        console.warn(`[feishu_wanqing] ⚠️ 仅 ${allRecords.length} 条，未覆盖原数据`);
        await context.close();
        return allRecords;
    }

    writeFileSafeSync(OUTPUT, JSON.stringify(allRecords, null, 2));
    await context.close();
    return allRecords;
}

if (require.main === module) { crawl().catch(console.error); }
module.exports = { crawl };
