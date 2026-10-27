const fs = require('fs');
const path = require('path');
const { normalizeCompanyType, normalizeIndustry, normalizeTarget, normalizeRecruitType } = require('./normalize');
const { writeFileSafeSync, safeReadJsonLatest } = require('./utils/write-safe');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Sunwz|2026-08-09|改动目的：givemeoc cookie 过期，暂停使用，不再参与合并
// const GIVE_MEOC_RAW = path.join(DATA_DIR, 'givemeoc_raw.json');
const FEISHU_RAW = path.join(DATA_DIR, 'feishu_raw.json');
// Sunwz|2026-08-09|改动目的：offerbiu/xixicc2027 已停更，不再参与合并
// const OFFERBIU_RAW = path.join(DATA_DIR, 'offerbiu_raw.json');
// const XIXICC2027_RAW = path.join(DATA_DIR, 'xixicc2027_raw.json');
const AUTUMN2027_RAW = path.join(DATA_DIR, 'autumn2027_raw.json');
const FEISHU_WANQING_RAW = path.join(DATA_DIR, 'feishu_wanqing_raw.json');
// Sunwz|2026-08-09|改动目的：腾讯文档已停更，注释掉
// const TENCENT_SMARTSHEET_RAW = path.join(DATA_DIR, 'tencent_smartsheet_raw.json');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
const OUTPUT = path.join(DATA_DIR, 'merged.json');

// Sunwz|2026-07-30|改动目的：链接库动态累积 + 多来源链接选择，解决每日爬取链接缺失问题

/**
 * 加载链接库（公司名 → {投递链接, 公告链接} 映射）
 */
function loadLinksDb() {
    try {
        return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8'));
    } catch (e) {
        return {};
    }
}

/**
 * 保存链接库到磁盘
 */
function saveLinksDb(links) {
    writeFileSafeSync(LINKS_FILE, JSON.stringify(links, null, 2));
}

// Sunwz|2026-07-30|改动目的：清洗截止日期异常数据
/**
 * 规范化截止日期格式
 * 处理：缺位年份、多数字年份、乱码、不完整日期等
 */
function normalizeDeadline(deadline) {
    if (!deadline || typeof deadline !== 'string') return '';
    let d = deadline.trim();

    // 已知非标准文本
    if (d === '招满为止' || d === '招满即止' || d === '尽快投递') return '招满为止';
    if (d.includes('筛选前必看') || d.includes('必看')) return '';

    // 尝试修复常见格式问题
    // 1. 替换各种分隔符为 -
    d = d.replace(/[/.]/g, '-').replace(/[=]/g, '-').replace(/\s+/g, '');

    // 2. 匹配 YYYY-MM-DD 格式并严格验证
    let match = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        const year = parseInt(match[1]);
        let month = parseInt(match[2]);
        let dd = parseInt(match[3]);
        // 修复月份/日期超出范围（如 606 → 06）
        if (month > 12 && match[2].length >= 2) {
            month = parseInt(match[2].substring(match[2].length - 2));
        }
        if (dd > 31 && match[3].length >= 2) {
            dd = parseInt(match[3].substring(0, 2));
        }
        // 严格验证年月日范围
        if (year >= 2025 && year <= 2028 && month >= 1 && month <= 12 && dd >= 1 && dd <= 31) {
            return `${year}-${String(month).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        }
    }

    // 3. 修复少年份（如 202-05-31 → 2026-05-31）
    match = d.match(/^(\d{3})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        const [, y, m, day] = match;
        const year = 2000 + parseInt(y.substring(0,2)) * 10 + parseInt(y[2]); // 不完全准确，但尝试
        // 简单处理：202x → 2026
        if (y.startsWith('202')) return `2026-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }

    // 4. 修复多年份（如 20260-3-30 → 2026-03-30，20266-06-30 → 2026-06-30）
    match = d.match(/^(\d{5})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        const y = match[1].substring(0, 4);
        let m = match[1].substring(4) + match[2];
        const day = match[3];
        // 验证月份范围，如果超出则尝试修复
        let monthNum = parseInt(m);
        if (monthNum > 12) {
            // 尝试取后两位
            monthNum = parseInt(m.substring(m.length - 2));
        }
        if (monthNum >= 1 && monthNum <= 12 && parseInt(day) >= 1 && parseInt(day) <= 31) {
            return `${y}-${String(monthNum).padStart(2,'0')}-${day.padStart(2,'0')}`;
        }
    }

    // 5. 修复缺日（如 2026-06 → 2026-06-01）
    match = d.match(/^(\d{4})-(\d{1,2})$/);
    if (match) {
        return `${match[1]}-${match[2].padStart(2,'0')}-01`;
    }

    // 6. 无法解析的返回空
    return '';
}
// Sunwz|2026-07-30|改动目的——END

/**
 * 从文本中提取所有 URL
 */
function extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /https?:\/\/[^\s,，；;）)\]]+/g;
    return text.match(urlRegex) || [];
}

/**
 * 判断值是否为有效 URL
 */
function isValidUrl(val) {
    return val && typeof val === 'string' && val.startsWith('http') && val !== '#';
}

/**
 * 选择最优链接值
 * 优先级：飞书提取 URL > 链接库历史 > 文本正则 > 描述文本
 * Sunwz|2026-08-09|改动目的：givemeoc 暂停，移除其优先级
 */
function pickLink(gmVal, fshVal, companyName) {
    // 1. 飞书字段中提取的 URL
    if (isValidUrl(fshVal)) return fshVal;

    // 3. 链接库中的历史 URL（按公司名匹配）
    if (companyName) {
        const linksDb = loadLinksDb();
        const key = normalizeName(companyName);
        for (const [dbName, dbLinks] of Object.entries(linksDb)) {
            if (normalizeName(dbName) === key) {
                if (isValidUrl(dbLinks['投递链接'])) return dbLinks['投递链接'];
                if (isValidUrl(dbLinks['公告链接'])) return dbLinks['公告链接'];
            }
        }
    }

    // 4. 从描述文本中正则提取 URL
    const gmUrls = extractUrls(gmVal);
    if (gmUrls.length > 0) return gmUrls[0];
    const fshUrls = extractUrls(fshVal);
    if (fshUrls.length > 0) return fshUrls[0];

    // 5. 兜底：返回较长的描述文本
    if (gmVal && gmVal !== '#' && gmVal.length > (fshVal || '').length) return gmVal;
    if (fshVal && fshVal !== '#') return fshVal;
    return gmVal || fshVal || '';
}

/**
 * 规范化公司名称用于匹配（去空格、转小写）
 */
function normalizeName(name) {
    return (name || '').replace(/\s+/g, '').toLowerCase().trim();
}
// Sunwz|2026-07-30|改动目的——END

// Sunwz|2026-07-31|改动目的：多来源链接选择辅助函数
function pickLinkBySource(record, _, companyName) {
    // 当前记录已有有效链接则直接返回
    if (isValidUrl(record['投递链接'])) return record['投递链接'];
    // 尝试从链接库获取
    if (companyName) {
        const linksDb = loadLinksDb();
        const key = normalizeName(companyName);
        for (const [dbName, dbLinks] of Object.entries(linksDb)) {
            if (normalizeName(dbName) === key) {
                if (isValidUrl(dbLinks['投递链接'])) return dbLinks['投递链接'];
                break;
            }
        }
    }
    return record['投递链接'] || '';
}

function pickLinkByNotice(record, _, companyName) {
    if (isValidUrl(record['公告链接'])) return record['公告链接'];
    if (companyName) {
        const linksDb = loadLinksDb();
        const key = normalizeName(companyName);
        for (const [dbName, dbLinks] of Object.entries(linksDb)) {
            if (normalizeName(dbName) === key) {
                if (isValidUrl(dbLinks['公告链接'])) return dbLinks['公告链接'];
                break;
            }
        }
    }
    return record['公告链接'] || '';
}
// Sunwz|2026-07-31|改动目的——END

// Sunwz|2026-07-31|改动目的：安全读取数据文件，文件不存在时返回空数组
// Sunwz|2026-08-24|改动目的：沙箱禁止覆盖 canonical 文件，改用 safeReadJsonLatest 解析 .latest 指针
function safeReadJson(file) {
    return safeReadJsonLatest(file, []);
}
// Sunwz|2026-07-31|改动目的——END

function merge() {
    console.log('[merge] 开始合并数据...');

    // Sunwz|2026-08-09|改动目的：givemeoc/offerbiu/xixicc2027/腾讯文档 均停用，设为空数组
    // const givemeoc = safeReadJson(GIVE_MEOC_RAW);
    const givemeoc = [];
    const feishu = safeReadJson(FEISHU_RAW);
    // const offerbiu = safeReadJson(OFFERBIU_RAW);
    const offerbiu = [];
    // const xixicc2027 = safeReadJson(XIXICC2027_RAW);
    const xixicc2027 = [];
    const autumn2027 = safeReadJson(AUTUMN2027_RAW);
    const fq = safeReadJson(FEISHU_WANQING_RAW);
    // const tq = safeReadJson(TENCENT_SMARTSHEET_RAW);
    const tq = [];

    console.log(`[merge] 数据源: feishu=${feishu.length}, fq=${fq.length}, autumn2027=${autumn2027.length}`);

    const gmNormalized = givemeoc.map(r => ({
        '公司名称': r.name || '',
        '企业性质': normalizeCompanyType(r.type || ''),
        '行业': normalizeIndustry(r.industry || ''),
        '招聘对象': normalizeTarget(r.target || ''),
        '招聘类型': normalizeRecruitType(r.recruitmentType || ''),
        '截止时间': normalizeDeadline(r.deadline || ''),
        '发布日期': normalizeDate(r.updateTime || ''),
        '投递链接': r.linksUrl || '',
        '公告链接': r.noticeUrl || '',
        '备注': r.notes || '',
        // Sunwz|2026-08-08|改动目的：来源名称与前端显示一致
        '_source': 'GiveMeOC',
    }));

    const fshNormalized = feishu.map(r => ({
        '公司名称': r['公司名称'] || '',
        '企业性质': normalizeCompanyType(r['企业性质'] || ''),
        '行业': normalizeIndustry(r['行业大类'] || ''),
        '招聘对象': normalizeTarget(r['招聘对象'] || ''),
        '招聘类型': normalizeRecruitType(r['批次'] || ''),
        '截止时间': normalizeDeadline(r['截止时间'] || ''),
        '发布日期': normalizeDate(r['更新时间'] || ''),
        '投递链接': r['_deliveryLink'] || r['投递方式'] || '',
        '公告链接': r['_noticeLink'] || r['官方公告'] || '',
        '备注': r['备注/提示'] || '',
        // Sunwz|2026-08-08|改动目的：来源名称与前端显示一致
        '_source': '飞书社群',
    }));

    // Sunwz|2026-07-31|改动目的：新数据源已经是统一格式，直接添加 _source 标记
    // Sunwz|2026-08-09|改动目的：offerbiu/xixicc2027 停用，不再归一化
    const obNormalized = []; // offerbiu 已停更
    const xxNormalized = []; // xixicc2027 已停更

    const a27Normalized = autumn2027.map(r => ({
        '公司名称': r['公司名称'] || '',
        '企业性质': normalizeCompanyType(r['企业性质'] || ''),
        '行业': normalizeIndustry(r['行业'] || ''),
        '招聘对象': normalizeTarget(r['招聘对象'] || ''),
        '招聘类型': normalizeRecruitType(r['招聘类型'] || ''),
        '截止时间': normalizeDeadline(r['截止时间'] || ''),
        '发布日期': normalizeDate(r['发布日期'] || ''),
        '投递链接': r['投递链接'] || '',
        '公告链接': r['公告链接'] || '',
        '备注': r['备注'] || '',
        // Sunwz|2026-08-08|改动目的：来源名称与前端显示一致
        '_source': '秋招27届',
    }));
    // Sunwz|2026-07-31|改动目的——END

    const fqNormalized = fq.map(r => ({
        '公司名称': r['公司名称'] || '',
        '企业性质': normalizeCompanyType(r['企业性质'] || ''),
        '行业': normalizeIndustry(r['行业分类'] || ''),
        '招聘对象': normalizeTarget(r['届次'] || ''),
        '招聘类型': normalizeRecruitType(r['批次'] || ''),
        '截止时间': normalizeDeadline(r['截止时间'] || ''),
        '发布日期': normalizeDate(r['更新时间'] || ''),
        '投递链接': r['_deliveryLink'] || r['投递链接'] || '',
        '公告链接': r['_noticeLink'] || r['公告链接'] || '',
        '备注': r['公告来源'] || '',
        // Sunwz|2026-08-08|改动目的：来源名称与前端显示一致
        '_source': '飞书婉清',
    }));
    // Sunwz|2026-08-08|改动目的——END

    // Sunwz|2026-08-09|改动目的：腾讯文档停用
    const tqNormalized = [];

    // Sunwz|2026-07-31|改动目的：多来源合并策略 - 以所有数据源为基础，按公司名匹配合并
    const allByName = new Map(); // 公司名 -> [{source, index, record}]

    const addByName = (list, source) => {
        list.forEach((r, i) => {
            const key = normalizeName(r['公司名称']);
            if (!key) return;
            if (!allByName.has(key)) allByName.set(key, []);
            allByName.get(key).push({ source, index: i, record: r });
        });
    };

    // Sunwz|2026-08-08|改动目的：飞书优先（先添加 = entries[0] = primary）
    // Sunwz|2026-08-08|改动目的：飞书婉清学姐也作为高优先级源（数据量大且链接完整）
    // Sunwz|2026-08-09|改动目的：仅保留3个活跃源
    addByName(fshNormalized, '飞书社群');
    addByName(fqNormalized, '飞书婉清');
    addByName(a27Normalized, '秋招27届');
    // Sunwz|2026-08-03|改动目的——END

    const merged = [];
    const usedSources = new Map(); // 记录每个来源已使用的索引

    for (const [name, entries] of allByName.entries()) {
        if (entries.length === 1) {
            // 只有一个来源，直接使用
            const e = entries[0];
            merged.push({ ...e.record, '投递链接': pickLinkBySource(e.record, [], name), '公告链接': pickLinkByNotice(e.record, [], name) });
        } else {
            // 多个来源，合并（entries[0] 是飞书 = primary）
            const primary = entries[0];
            const others = entries.slice(1);

            let result = { ...primary.record };

            // 从其他来源补全链接和字段
            for (const other of others) {
                // 补全投递链接
                if (!isValidUrl(result['投递链接']) && isValidUrl(other.record['投递链接'])) {
                    result['投递链接'] = other.record['投递链接'];
                }
                // 补全公告链接
                if (!isValidUrl(result['公告链接']) && isValidUrl(other.record['公告链接'])) {
                    result['公告链接'] = other.record['公告链接'];
                }
                // 补全其他字段
                if (!result['行业'] || result['行业'].includes('其他')) {
                    if (other.record['行业'] && !other.record['行业'].includes('其他')) result['行业'] = other.record['行业'];
                }
                if (!result['企业性质']) result['企业性质'] = other.record['企业性质'];
                if (!result['截止日期']) result['截止日期'] = other.record['截止日期'];
                // Sunwz|2026-08-03|改动目的：发布日期取最新值
                const otherDate = other.record['发布日期'] || '';
                const currentDate = result['发布日期'] || '';
                if (otherDate > currentDate) {
                    result['发布日期'] = otherDate;
                }
                // Sunwz|2026-08-03|改动目的——END
            }

            result['_source'] = [...new Set(entries.map(e => e.source))].join(' + ');
            merged.push(result);
        }
    }
    // Sunwz|2026-07-31|改动目的——END

    const clean = merged.map(r => {
        const { _source, ...rest } = r;
        return { ...rest, '来源': _source };
    });

    // Sunwz|2026-08-03|改动目的：在过滤前检测待搜索公司（GiveMeOC独有 + 无链接 + 历史库也没有）
    // 必须在过滤之前执行，否则无链接的记录会被直接移除而无法触发搜索
    // 注意：clean 数组中来源字段是 '来源'（不是 _source）
    // 规则：有投递链接就算完整（公告链接是次要的，搜索不一定能找到）
    const linksDbForSearch = loadLinksDb();
    const needSearch = [];
    for (const r of clean) {
        const name = r['公司名称'];
        if (!name) continue;
        // 只处理 givemeoc 独有的记录（clean 中来源字段名为 '来源'）
        // Sunwz|2026-08-08|改动目的：更新为新的来源名称
        if (r['来源'] !== 'GiveMeOC') continue;
        // 已有有效投递链接则跳过
        if (isValidUrl(r['投递链接'])) continue;
        // 检查历史库是否已有投递链接
        const existing = linksDbForSearch[name];
        if (existing && isValidUrl(existing['投递链接'])) continue;
        // 需要搜索
        needSearch.push({
            '公司名称': name,
            '招聘类型': r['招聘类型'] || [],
            '招聘对象': r['招聘对象'] || [],
            '截止时间': r['截止时间'] || '',
            '更新时间': r['发布日期'] || '',
        });
    }
    const NEED_SEARCH_FILE = path.join(DATA_DIR, '_need_search.json');
    writeFileSafeSync(NEED_SEARCH_FILE, JSON.stringify(needSearch, null, 2));
    console.log(`[merge] 待搜索链接: ${needSearch.length} 家（GiveMeOC独有 + 无链接 + 历史库也没有）`);
    // Sunwz|2026-08-03|改动目的——END

    // Sunwz|2026-07-31|改动目的：过滤无效链接（保留过期记录供用户手动筛选）
    const beforeFilter = clean.length;
    const valid = clean.filter(r => {
        if (!isValidUrl(r['投递链接']) && !isValidUrl(r['公告链接'])) return false;
        return true;
    });
    const removedCount = beforeFilter - valid.length;
    if (removedCount > 0) {
        console.log(`[merge] 过滤: 移除 ${removedCount} 条无效链接记录，保留 ${valid.length} 条`);
    }
    // Sunwz|2026-07-31|改动目的——END

    // Sunwz|2026-07-31|改动目的：有链接按链接去重，无链接按公司名+截止时间兜底
    const dedupedMap = new Map();
    for (const r of valid) {
        const name = normalizeName(r['公司名称']);
        const link = (r['投递链接'] || '').trim();
        const notice = (r['公告链接'] || '').trim();
        const deadline = (r['截止时间'] || '').trim();
        let key;
        if (link && link !== '#') {
            key = 'L:' + link + '||' + notice;
        } else {
            key = 'N:' + name + '||' + deadline;
        }
        if (!dedupedMap.has(key)) {
            dedupedMap.set(key, r);
        }
    }
    const deduped = [...dedupedMap.values()];
    const dupesRemoved = valid.length - deduped.length;
    if (dupesRemoved > 0) {
        console.log(`[merge] 去重: 移除 ${dupesRemoved} 条重复，保留 ${deduped.length} 条`);
    }
    // Sunwz|2026-07-31|改动目的——END

    // Sunwz|2026-07-31|改动目的：统计各来源贡献数量
    const countSource = (src) => merged.filter(r => (r._source || '').includes(src)).length;
    // Sunwz|2026-08-08|改动目的：统计使用更新后的来源名称
    const stats = {
        total: deduped.length,
        // Sunwz|2026-08-09|改动目的：仅统计3个活跃源
        feishuOnly: merged.filter(r => r._source === '飞书社群').length,
        wanqingOnly: merged.filter(r => r._source === '飞书婉清').length,
        autumn2027Only: merged.filter(r => r._source === '秋招27届').length,
        multiSource: merged.filter(r => (r._source || '').includes('+')).length,
        // Sunwz|2026-07-30|改动目的：添加链接覆盖率统计，方便监控链接获取效果
        withDeliveryLink: deduped.filter(r => isValidUrl(r['投递链接'])).length,
        withNoticeLink: deduped.filter(r => isValidUrl(r['公告链接'])).length,
        // Sunwz|2026-07-30|改动目的——END
    };

    // Sunwz|2026-07-30|改动目的：链接库累积 — 将本次发现的真实 URL 写入 links.json
    const linksDb = loadLinksDb();
    let newLinksCount = 0;
    // Sunwz|2026-07-31|改动目的：链接库累积使用去重后的数据
    for (const r of deduped) {
        const name = r['公司名称'];
        if (!name) continue;
        const delivery = r['投递链接'];
        const notice = r['公告链接'];
        if (isValidUrl(delivery) || isValidUrl(notice)) {
            const existing = linksDb[name] || {};
            if (isValidUrl(delivery) && existing['投递链接'] !== delivery) {
                existing['投递链接'] = delivery;
                newLinksCount++;
            }
            if (isValidUrl(notice) && existing['公告链接'] !== notice) {
                existing['公告链接'] = notice;
                newLinksCount++;
            }
            existing['updatedAt'] = new Date().toISOString().substring(0, 10);
            linksDb[name] = existing;
        }
    }
    saveLinksDb(linksDb);
    console.log(`[merge] 链接库更新: 新增 ${newLinksCount} 条链接，累计 ${Object.keys(linksDb).length} 家公司`);
    // Sunwz|2026-07-30|改动目的——END

    // Sunwz|2026-08-03|改动目的：数据质量检查 - 统计新鲜度和异常
    const today = new Date().toISOString().substring(0, 10);
    const last7Days = deduped.filter(r => {
        const d = r['发布日期'] || '';
        return d >= today.substring(0, 8) + '01' && d <= today;
    }).length;
    const noLinkCount = deduped.filter(r => !isValidUrl(r['投递链接']) && !isValidUrl(r['公告链接'])).length;

    if (noLinkCount > 0) {
        console.warn(`[merge] ⚠️ 有 ${noLinkCount} 条记录无有效链接`);
    }
    console.log(`[merge] 数据新鲜度: 近7天新增 ${last7Days} 条`);
    // Sunwz|2026-08-03|改动目的——END

    // Sunwz|2026-08-08|改动目的：去重后将 _source 重命名为 来源，前端依赖 '来源' 字段
    const finalRecords = deduped.map(r => {
        const { _source, ...rest } = r;
        return { ...rest, '来源': _source };
    });
    // Sunwz|2026-07-31|改动目的：输出去重后的数据
    const output = { lastUpdated: new Date().toISOString(), stats, records: finalRecords };
    writeFileSafeSync(OUTPUT, JSON.stringify(output, null, 2));
    console.log(`[merge] 完成: ${stats.total} 条`);
    console.log(`[merge] 来源分布: feishu=${stats.feishuOnly}, wanqing=${stats.wanqingOnly}, autumn2027=${stats.autumn2027Only}, 多来源=${stats.multiSource}`);
    console.log(`[merge] 链接覆盖率: 投递链接 ${stats.withDeliveryLink}/${stats.total} (${stats.total ? (stats.withDeliveryLink/stats.total*100).toFixed(1) : 0}%), 公告链接 ${stats.withNoticeLink}/${stats.total} (${stats.total ? (stats.withNoticeLink/stats.total*100).toFixed(1) : 0}%)`);
    // Sunwz|2026-07-31|改动目的——END

    return output;
}

function mergeArrays(a, b) {
    return [...new Set([...(a || []), ...(b || [])])];
}

// 统一日期格式为 YYYY-MM-DD
function normalizeDate(dateStr) {
    if (!dateStr) return '';
    // 处理时间戳（数字）
    if (typeof dateStr === 'number') {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().substring(0, 10);
    }
    if (typeof dateStr !== 'string') return '';
    return dateStr.replace(/\//g, '-').replace(/\./g, '-').substring(0, 10);
}

// Sunwz|2026-07-31|改动目的：招聘对象/类型取兼容值，冲突时取有链接的来源
function mergeRecords(gm, fsh) {
    // 招聘对象：取交集，无交集时取有投递链接的那个
    const gmTargets = gm['招聘对象'] || [];
    const fshTargets = fsh['招聘对象'] || [];
    const targetOverlap = gmTargets.filter(t => fshTargets.includes(t));
    let target;
    if (targetOverlap.length > 0) {
        target = targetOverlap;
    } else if (isValidUrl(gm['投递链接'])) {
        target = gmTargets;
    } else if (isValidUrl(fsh['投递链接'])) {
        target = fshTargets;
    } else {
        target = gmTargets.length > 0 ? gmTargets : fshTargets;
    }

    // 招聘类型：取交集，无交集时取有投递链接的那个
    const gmTypes = gm['招聘类型'] || [];
    const fshTypes = fsh['招聘类型'] || [];
    const typeOverlap = gmTypes.filter(t => fshTypes.includes(t));
    let type;
    if (typeOverlap.length > 0) {
        type = typeOverlap;
    } else if (isValidUrl(gm['投递链接'])) {
        type = gmTypes;
    } else if (isValidUrl(fsh['投递链接'])) {
        type = fshTypes;
    } else {
        type = gmTypes.length > 0 ? gmTypes : fshTypes;
    }

    return {
        '公司名称': gm['公司名称'] || fsh['公司名称'],
        '企业性质': mergeArrays(gm['企业性质'], fsh['企业性质']),
        '行业': mergeArrays(gm['行业'], fsh['行业']),
        '招聘对象': target,
        '招聘类型': type,
        '截止时间': gm['截止时间'] || fsh['截止时间'],
        '发布日期': gm['发布日期'] || fsh['发布日期'] || '',
        '投递链接': pickLink(gm['投递链接'], fsh['投递链接'], gm['公司名称'] || fsh['公司名称']),
        '公告链接': pickLink(gm['公告链接'], fsh['公告链接'], gm['公司名称'] || fsh['公司名称']),
        '备注': gm['备注'] || fsh['备注'] || '',
        // Sunwz|2026-08-08|改动目的：更新为新的来源名称组合
        '_source': 'GiveMeOC + 飞书社群',
    };
}
// Sunwz|2026-07-31|改动目的——END

// Sunwz|2026-07-31|改动目的：判断记录是否过期
function isExpired(deadline) {
    if (!deadline || deadline === '招满为止' || deadline === '招满即止') return false;
    const m = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return d < now;
}
// Sunwz|2026-07-31|改动目的——END

if (require.main === module) {
    merge();
}

module.exports = { merge };
