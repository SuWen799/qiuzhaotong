const https = require('https');
const fs = require('fs');
const path = require('path');
const { writeFileSafeSync } = require('./utils/write-safe');

const RAW_URL = 'https://raw.githubusercontent.com/houhouhou218/2027-autumn-recruitment/main/data.json';
const API_URL = 'https://api.github.com/repos/houhouhou218/2027-autumn-recruitment/contents/data.json';
const OUTPUT = path.join(__dirname, '..', 'data', 'autumn2027_raw.json');
const MAX_RETRIES = 3;

/**
 * Sunwz|2026-07-31|改动目的：从GitHub下载autumn2027 data.json，raw失败时回退到API
 */
function downloadJSON() {
    // Sunwz|2026-09-01|改动目的：所有 https.get 加 10s socket 超时 + 整体 60s 兜底超时，
    // 避免 GitHub（国内常被墙/静默挂起）连接半开导致 Promise 永久 pending，
    // 进而 bridge 卡在 autumn2027 源、后端 waitFor 无限等待、前端"爬取中"永不结束。
    const REQ_TIMEOUT = 10000;
    const OVERALL_TIMEOUT = 60000;
    return Promise.race([
        new Promise((resolve, reject) => {
            const attemptRaw = (n) => {
                console.log(`[autumn2027] 下载数据 (raw, 尝试 ${n}/${MAX_RETRIES})...`);
                const chunks = [];
                const req = https.get(RAW_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                    req.setTimeout(0); // 已收到响应首字节，取消连接超时
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        const req2 = https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
                            req2.setTimeout(0);
                            r2.on('data', c => chunks.push(c));
                            r2.on('end', () => resolve(Buffer.concat(chunks)));
                        });
                        req2.setTimeout(REQ_TIMEOUT, () => req2.destroy(new Error('重定向请求超时')));
                        req2.on('error', e => n < MAX_RETRIES ? attemptRaw(n + 1) : tryAPI());
                        return;
                    }
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                });
                req.setTimeout(REQ_TIMEOUT, () => req.destroy(new Error('raw 请求超时')));
                req.on('error', e => {
                    if (n < MAX_RETRIES) {
                        console.log(`  ✗ raw下载失败: ${e.message}，重试中...`);
                        setTimeout(() => attemptRaw(n + 1), 2000 * n);
                    } else {
                        tryAPI();
                    }
                });
            };

            const tryAPI = () => {
                console.log('[autumn2027] raw失败，尝试 GitHub API...');
                const req = https.get(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/vnd.github.v3+json' } }, (res) => {
                    req.setTimeout(0);
                    let d = '';
                    res.on('data', c => d += c);
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(d);
                            if (data.content) {
                                const content = Buffer.from(data.content, 'base64').toString('utf-8');
                                resolve(Buffer.from(content));
                            } else {
                                reject(new Error('API返回无content字段'));
                            }
                        } catch (e) {
                            reject(new Error('API解析失败: ' + e.message));
                        }
                    });
                });
                req.setTimeout(REQ_TIMEOUT, () => req.destroy(new Error('API 请求超时')));
                req.on('error', e => reject(new Error('API请求失败: ' + e.message)));
            };

            attemptRaw(1);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('downloadJSON 整体超时(' + OVERALL_TIMEOUT + 'ms)')), OVERALL_TIMEOUT)),
    ]);
}
// Sunwz|2026-09-01|改动目的——END
// Sunwz|2026-07-31|改动目的——END

/**
 * Sunwz|2026-07-31|改动目的：将autumn2027记录转换为统一格式
 */
function transformRecord(r) {
    // 投递链接
    let deliveryLink = '';
    if (r.applyUrl && r.applyUrl.startsWith('http')) deliveryLink = r.applyUrl;

    // 公告链接（sourceUrl 作为公告来源）
    let noticeLink = '';
    if (r.sourceUrl && r.sourceUrl.startsWith('http')) noticeLink = r.sourceUrl;

    // 招聘对象
    let target = '';
    if (r.audience) {
        const m = r.audience.match(/20\d{2}/);
        if (m) target = m[0] + '届';
    }

    return {
        '公司名称': r.company || '',
        '企业性质': r.nature || '',
        '行业': r.industry || '',
        '招聘对象': target,
        '招聘类型': r.recruitmentType || '',
        '截止时间': r.deadline || '',
        '发布日期': r.openDate || '',
        '投递链接': deliveryLink,
        '公告链接': noticeLink,
        '备注': r.notes || '',
        '_source': 'autumn2027',
    };
}
// Sunwz|2026-07-31|改动目的——END

// Sunwz|2026-09-01|修复：fallback 标志供 bridge.js 读取，用于区分"实时成功"与"超时回退"
let _usedFallback = false;

async function crawl() {
    console.log('[autumn2027] 开始爬取...');
    _usedFallback = false; // 每次重置

    // Sunwz|2026-07-31|改动目的：下载前备份原数据
    const backupFile = OUTPUT + '.bak';
    try {
        if (fs.existsSync(OUTPUT)) {
            fs.copyFileSync(OUTPUT, backupFile);
            console.log('[autumn2027] 已备份原数据');
        }
    } catch (e) { }
    // Sunwz|2026-07-31|改动目的——END

    // Sunwz|2026-09-01|修复：downloadJSON 超时/失败时内部 catch 并从备份恢复，
    // 正常返回历史数据而非抛异常。这样 bridge.js 会走 done 路径（note 说明原因），
    // 不会标 error 导致"有132条数据却显示超时报错"的矛盾。
    let buf;
    try {
        buf = await downloadJSON();
        console.log(`[autumn2027] 下载完成: ${(buf.length / 1024).toFixed(1)} KB`);
    } catch (dlErr) {
        _usedFallback = true; // 标记：本次使用了本地回退数据
        console.warn(`[autumn2027] ⚠️ 实时下载失败(${dlErr.message})，使用本地备份数据`);
        if (fs.existsSync(backupFile)) {
            buf = fs.readFileSync(backupFile);
            console.log(`[autumn2027] 已从备份恢复: ${(buf.length / 1024).toFixed(1)} KB`);
        } else if (fs.existsSync(OUTPUT)) {
            buf = fs.readFileSync(OUTPUT);
            console.log(`[autumn2027] 备份不存在，使用当前文件: ${(buf.length / 1024).toFixed(1)} KB`);
        } else {
            throw new Error('实时下载失败且无任何本地数据可回退: ' + dlErr.message);
        }
    }

    const raw = JSON.parse(buf.toString('utf-8'));
    const rawRecords = raw.records || raw;
    console.log(`[autumn2027] 解析完成: ${rawRecords.length} 条记录`);

    const records = rawRecords.map(transformRecord).filter(r => r['公司名称']);

    console.log(`[autumn2027] 转换完成: ${records.length} 条有效记录`);

    // Sunwz|2026-07-31|改动目的：按公司名+投递链接去重
    const seen = new Set();
    const deduped = [];
    for (const r of records) {
        const name = (r['公司名称'] || '').replace(/\s+/g, '').toLowerCase().trim();
        const link = (r['投递链接'] || '').trim();
        const key = 'L:' + name + '||' + link;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(r);
        }
    }
    const removed = records.length - deduped.length;
    if (removed > 0) {
        console.log(`[autumn2027] 去重: 移除 ${removed} 条重复，保留 ${deduped.length} 条`);
    }
    // Sunwz|2026-07-31|改动目的——END

    // Sunwz|2026-07-31|改动目的：爬取数量过少时从备份恢复
    // Sunwz|2026-08-24|改动目的：沙箱禁止覆盖 canonical，恢复改用 writeFileSafeSync 写版本号文件+.latest
    if (deduped.length < 20) {
        console.warn(`[autumn2027] ⚠️ 爬取仅 ${deduped.length} 条，从备份恢复！`);
        try {
            if (fs.existsSync(backupFile)) {
                const bakContent = fs.readFileSync(backupFile, 'utf-8');
                writeFileSafeSync(OUTPUT, bakContent);
                console.log('[autumn2027] 已从备份恢复');
            }
        } catch (e) { }
        return deduped;
    }
    // Sunwz|2026-07-31|改动目的——END

    writeFileSafeSync(OUTPUT, JSON.stringify(deduped, null, 2));
    console.log(`[autumn2027] 完成: ${deduped.length} 条`);
    return deduped;
}

if (require.main === module) {
    crawl().catch(console.error);
}

module.exports = { crawl, _fallback: () => _usedFallback };
