/**
 * 秋招通 crawler-bridge
 * 桥接原始 Node 爬虫工程的合并逻辑，输出统一 JSON 供 Spring Boot 读取。
 *
 * 用法:
 *   node bridge.js           -> 仅执行 merge()（使用 data/ 下历史 *_raw.json），稳定有数据；如实报告各源历史条数
 *   node bridge.js --live    -> 先尝试调用真实 crawler 再 merge；真实可跑的源（autumn2027，纯 https 无需浏览器）跑真实数据，
 *                               浏览器类源（飞书社群/飞书婉清，依赖 playwright + 登录态）若环境不具备则诚实标 error，回退历史数据
 *
 * 输出: 最后一行 JSON:
 *   { success:true, count, live:false|true,
 *     sourceCounts:{ autumn2027:{count,status}, feishu:{count,status}, fq:{count,status}, merge:{count,status} },
 *     records:[{companyName,type,industry,recruitType,recruitTarget,applyUrl,announceUrl,source,deadline}] }
 *   失败: { success:false, error:"..." }
 * 进程始终以 exit 0 结束（便于 Spring Boot 解析，不抛未捕获异常）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Sunwz|2026-08-22|改动目的：爬虫代码已迁移到新系统自身（秋招通/crawlers），数据目录为
// 秋招通/data（含飞书登录态 profile 与 *_raw.json、merged.json）。bridge 完全自包含，
// 不再依赖旧版「秋招官网汇总」代码路径——旧版代码迁走也不会影响爬取。
// 仅 playwright 这个 npm 依赖包复用旧项目已安装的那一份（通过 NODE_PATH / 路径注入），
// 它是第三方依赖库而非业务代码，后续也可在新系统 node_modules 安装后优先使用。
const SELF_DIR = __dirname;                                  // 秋招通/crawler-bridge
const PROJECT_DIR = path.resolve(SELF_DIR, '..');            // 秋招通
const ORIGIN_DIR = path.join(PROJECT_DIR, 'crawlers');       // 秋招通/crawlers（迁移过来的爬虫）
const DATA_DIR = path.join(PROJECT_DIR, 'data');             // 秋招通/data（数据+登录态）
const MERGED_FILE = path.join(DATA_DIR, 'merged.json');
// 旧项目已安装的 playwright 包（第三方依赖，仅作为回退；新系统 node_modules 优先）
const OLD_NODE_MODULES = 'C:/Users/<你的Windows用户名>/Desktop/秋招文件/秋招官网汇总/campus-recruitment/node_modules';

// 把可用的 node_modules 注入全局模块解析路径（优先新系统，回退旧项目 playwright 包）
function injectNodeModules() {
    const candidates = [
        path.join(PROJECT_DIR, 'node_modules'),  // 新系统自带的（若有）
        path.resolve(OLD_NODE_MODULES),          // 旧项目已装的 playwright 包
    ];
    let injected = false;
    for (const p of candidates) {
        const rp = path.resolve(p);
        if (!fs.existsSync(rp)) continue;
        if (!Module.globalPaths.includes(rp)) Module.globalPaths.push(rp);
        if (!module.paths.includes(rp)) module.paths.unshift(rp);
        injected = true;
    }
    return injected;
}

// 各源的「真实可运行」探针：返回 { ok, reason }
// au27 纯 https 抓 GitHub，无需浏览器；feishu/fq 依赖 playwright + 登录态。
// 优先用当前 node 自带的 playwright；找不到则注入可用的 node_modules（新系统优先、回退旧项目包）。
function probeSourceAvailability() {
    const avail = {};
    // autumn2027：无需 playwright，默认可尝试
    avail.autumn2027 = { ok: true, reason: '' };

    // feishu / feishu_wanqing：需要 playwright。
    // 爬虫代码位于 ORIGIN_DIR（秋招通/crawlers），其内部 require('playwright') 会沿
    // crawlers/node_modules -> 秋招通/node_modules 向上解析；故探针必须基于同一基准目录判断，
    // 否则会出现「探针说没装、实际能跑」或反之的不一致。
    const requireFromCrawlers = require('module').createRequire(
        path.join(ORIGIN_DIR, 'package.json')
    );
    let hasPlaywright = false;
    try {
        requireFromCrawlers.resolve('playwright');
        hasPlaywright = true;
    } catch (e) {
        // 回退：注入可用的 node_modules（新系统自带或旧项目已装 playwright 包）后重试
        try {
            injectNodeModules();
            require.resolve('playwright');
            hasPlaywright = true;
        } catch (e2) {
            hasPlaywright = false;
        }
    }
    const pwReason = '环境未安装 playwright（无法启动无头浏览器，且需要飞书登录态），当前仅能使用本地历史数据';
    avail.feishu = { ok: hasPlaywright, reason: hasPlaywright ? '' : pwReason };
    avail.fq = { ok: hasPlaywright, reason: hasPlaywright ? '' : pwReason };
    return avail;
}

// 读取某源 raw 文件真实总条数（即该源爬虫实际爬到的数量，非合并去重后的"独有"量）
// Sunwz|2026-08-24|改动目的：沙箱禁止覆盖 canonical，raw 实际写入版本号文件+.latest，需经 resolveLatest 解析
const { resolveLatest } = require(path.join(ORIGIN_DIR, 'utils', 'write-safe'));
function rawCount(file) {
    const fp = resolveLatest(path.join(DATA_DIR, file));
    if (!fs.existsSync(fp)) return 0;
    try {
        return (JSON.parse(fs.readFileSync(fp, 'utf-8')) || []).length;
    } catch (e) {
        return 0;
    }
}

function emit(obj) {
    // 必须输出在最后一行
    console.log(JSON.stringify(obj));
}

// Sunwz|2026-08-22|改动目的：进度条的各源 count 必须显示「该源真实爬到的条数」（raw 总量），
// 而不是 merge 去重后的「独有」量（feishuOnly 等）——合并阶段才知道独有量，爬取阶段根本不知道；
// 而且「三个源 sum < 合并总量」是因为大量公司跨源重复，属于正常去重，并非数据丢失。
// 因此：feishu/fq/autumn2027 一律用各自 raw 文件的真实总条数；merge 才显示去重后的总量。
function buildSourceCountsFromStats(stats, live, avail, liveErrors) {
    const counts = {};
    const total = (stats && stats.total) || 0;

    const rawMap = {
        autumn2027: 'autumn2027_raw.json',
        feishu: 'feishu_raw.json',
        fq: 'feishu_wanqing_raw.json',
    };

    ['autumn2027', 'feishu', 'fq'].forEach((k) => {
        const a = avail[k];
        const realCount = rawCount(rawMap[k]); // 该源真实爬到的总条数
        if (live) {
            // Sunwz|2026-09-01|修复：autumn2027 超时回退时标 done + 友好 note（非 error）
            let st = 'done', nt = '实时爬取完成';
            if (liveErrors && liveErrors[k]) {
                // 有数据回退时降级为 done（不吓用户），无数据才 error
                if (realCount > 0) { st = 'done'; nt = liveErrors[k] + '（已使用本地备份）'; }
                else { st = 'error'; nt = liveErrors[k]; }
            } else if (k === 'autumn2027') {
                // 再检查模块级 fallback 标志（autumn2027 内部 catch 但未抛异常的情况）
                try {
                    const au27mod = require(path.join(ORIGIN_DIR, 'autumn2027.js'));
                    if (au27mod && typeof au27mod._fallback === 'function' && au27mod._fallback()) {
                        nt = '使用本地备份数据(GitHub 实时不可达)';
                    }
                } catch (ignored) {}
            }
            counts[k] = { count: realCount, status: st, note: nt };
        } else {
            counts[k] = {
                count: realCount,
                status: a && a.ok ? 'done' : 'done', // 历史数据也标记 done（有真实历史条数）
                note: '历史数据'
            };
        }
    });

    // merge：合并后的总有效条数（去重后）
    counts.merge = { count: total || 0, status: 'done', note: '合并完成' };
    return counts;
}

async function main() {
    const live = process.argv.includes('--live');
    const avail = probeSourceAvailability();

    // 切到爬虫代码目录（秋招通/crawlers），使 merge.js 内部 require('./normalize') 正常工作
    try {
        process.chdir(ORIGIN_DIR);
    } catch (e) {
        emit({ success: false, error: '无法切换到爬虫工程目录: ' + e.message });
        return;
    }

    let mergeModule;
    try {
        // merge.js / normalize.js 已迁移到 秋招通/crawlers
        mergeModule = require(path.join(ORIGIN_DIR, 'merge'));
    } catch (e) {
        emit({ success: false, error: '加载 merge.js 失败: ' + e.message });
        return;
    }

    const liveErrors = {}; // 源 -> 错误信息
    // 实时进度上报（供后端流式更新进度条）：带 _progress:true 的行不是最终结果，
    // 后端读到后实时把对应源标为 running/done/error，最终 JSON 不带该字段。
    function emitProgress(source, state, count, note) {
        emit({ _progress: true, source, state, count: count || 0, note: note || '' });
    }
    if (live) {
        // 真实调用 crawler；au27 可真实跑；feishu/fq 若不可用则跳过并记 error
        const crawlerPlan = [
            { key: 'autumn2027', file: 'autumn2027.js' },
            { key: 'feishu', file: 'feishu.js' },
            { key: 'fq', file: 'feishu_wanqing.js' },
        ];
        for (const plan of crawlerPlan) {
            const a = avail[plan.key];
            if (!a || !a.ok) {
                liveErrors[plan.key] = (a && a.reason) || '环境不可用';
                // 不可用源：实时标 error（让前端显示「✗ 不可用」而非卡在等待中）
                emitProgress(plan.key, 'error', 0, liveErrors[plan.key]);
                console.error('[bridge] live 跳过 ' + plan.key + ': ' + liveErrors[plan.key]);
                continue;
            }
            const fp = path.join(ORIGIN_DIR, plan.file);
            if (!fs.existsSync(fp)) {
                liveErrors[plan.key] = '爬虫文件不存在: ' + plan.file;
                emitProgress(plan.key, 'error', 0, liveErrors[plan.key]);
                continue;
            }
            // 爬前：实时标 running（前端看到「正在爬取 X」）
            emitProgress(plan.key, 'running', 0, '正在爬取 ' + plan.key + '...');
            try {
                const mod = require(fp);
                if (typeof mod === 'function') {
                    await mod();
                } else if (mod && typeof mod.run === 'function') {
                    await mod.run();
                } else if (mod && typeof mod.crawl === 'function') {
                    await mod.crawl();
                }
                // 爬后：用该源真实 raw 总条数标 done（与最终 sourceCounts 一致的真实 count）
                const realCount = rawCount({
                    autumn2027: 'autumn2027_raw.json',
                    feishu: 'feishu_raw.json',
                    fq: 'feishu_wanqing_raw.json',
                }[plan.key]);
                // Sunwz|2026-09-01|修复：autumn2027 超时回退历史数据时，note 应说明"使用本地备份"
                // 而非误导性的"实时爬取完成"。通过 mod._fallback() 读取 autumn2027 暴露的标志。
                let doneNote = '实时爬取完成';
                if (plan.key === 'autumn2027' && mod && typeof mod._fallback === 'function' && mod._fallback()) {
                    doneNote = '使用本地备份数据(GitHub 实时不可达)';
                }
                emitProgress(plan.key, 'done', realCount, doneNote);
                console.error('[bridge] live 爬取 ' + plan.key + ' 完成，真实条数=' + realCount);
            } catch (ce) {
                liveErrors[plan.key] = ce.message;
                emitProgress(plan.key, 'error', 0, ce.message);
                console.error('[bridge] live 爬取 ' + plan.key + ' 失败: ' + ce.message);
            }
        }
        // merge 阶段：实时标 running
        emitProgress('merge', 'running', 0, '正在合并数据...');
    }

    // 历史模式（非 live）：各源真实条数已存在于 raw 文件，逐源实时上报 running→done，
    // 让进度条也呈现「逐个完成」的状态推进（虽快但状态机正确）。
    if (!live) {
        ['autumn2027', 'feishu', 'fq'].forEach((k) => {
            const realCount = rawCount({
                autumn2027: 'autumn2027_raw.json',
                feishu: 'feishu_raw.json',
                fq: 'feishu_wanqing_raw.json',
            }[k]);
            const a = avail[k];
            emitProgress(k, a && a.ok ? 'done' : 'done', realCount, '历史数据');
        });
        emitProgress('merge', 'running', 0, '正在合并数据...');
    }

    let output;
    try {
        output = mergeModule.merge();
    } catch (e) {
        // merge 失败但 merged.json 可能已存在（上次成功产物）
        // Sunwz|2026-08-24|改动目的：merged.json 现写版本号文件+.latest，需经 resolveLatest 解析
        const mergedReal = resolveLatest(MERGED_FILE);
        if (fs.existsSync(mergedReal)) {
            try {
                output = JSON.parse(fs.readFileSync(mergedReal, 'utf-8'));
                console.error('[bridge] merge 失败，使用历史 merged.json: ' + e.message);
            } catch (e2) {
                emit({ success: false, error: 'merge 执行失败且 merged.json 不可用: ' + e.message });
                return;
            }
        } else {
            emit({ success: false, error: 'merge 执行失败: ' + e.message });
            return;
        }
    }

    const records = (output && output.records) || [];

    // 来源计数：优先用 merge 的真实 stats（output.stats）；fallback 到 raw 反查
    let sourceCounts;
    const stats = output && output.stats;
    if (stats && typeof stats.total === 'number') {
        sourceCounts = buildSourceCountsFromStats(stats, live, avail, liveErrors);
    } else {
        // fallback：从各 raw 数据反查真实条数
        const RAW_SOURCES = [
            { file: 'feishu_raw.json', label: '飞书社群', key: 'feishu' },
            { file: 'feishu_wanqing_raw.json', label: '飞书婉清', key: 'fq' },
            { file: 'autumn2027_raw.json', label: '秋招27届', key: 'autumn2027' },
        ];
            const fb = {};
            for (const s of RAW_SOURCES) {
                const fp = resolveLatest(path.join(DATA_DIR, s.file));
                let cnt = 0;
                if (fs.existsSync(fp)) {
                    try { cnt = (JSON.parse(fs.readFileSync(fp, 'utf-8')) || []).length; } catch (e) {}
                }
                const a = avail[s.key];
                // Sunwz|2026-09-01|修复：fallback 分支也必须尊重 liveErrors（如 autumn2027 实时爬
                // GitHub 超时），否则实时失败时会被 avail.ok 误判为 done/"实时爬取完成"，与 lastError 矛盾且误导。
                if (liveErrors && liveErrors[s.key]) {
                    // 有数据回退时降级为 done + 友好 note，无数据才 error
                    if (cnt > 0) { fb[s.key] = { count: cnt, status: 'done', note: liveErrors[s.key] + '（已使用本地备份）' }; }
                    else { fb[s.key] = { count: cnt, status: 'error', note: liveErrors[s.key] }; }
                } else if (a && a.ok) {
                    let nt = live ? '实时爬取完成' : '历史数据';
                    // autumn2027 内部 catch 超时但未抛异常的情况：检查模块级 fallback 标志
                    if (live && s.key === 'autumn2027') {
                        try {
                            const au27mod = require(path.join(ORIGIN_DIR, 'autumn2027.js'));
                            if (au27mod && typeof au27mod._fallback === 'function' && au27mod._fallback()) {
                                nt = '使用本地备份数据(GitHub 实时不可达)';
                            }
                        } catch (ignored) {}
                    }
                    fb[s.key] = { count: cnt, status: 'done', note: nt };
                } else {
                    fb[s.key] = { count: cnt, status: 'error', note: (a && a.reason) || '不可用' };
                }
            }
        fb.merge = { count: records.length, status: 'done', note: '合并完成' };
        sourceCounts = fb;
    }

    // Sunwz|2026-08-22|改动目的：merge.js 单来源记录不写「来源」字段，这里从各 raw 数据反查补全
    const RAW_SOURCES = [
        { file: 'feishu_raw.json', label: '飞书社群' },
        { file: 'feishu_wanqing_raw.json', label: '飞书婉清' },
        { file: 'autumn2027_raw.json', label: '秋招27届' },
    ];
    const nameToSource = new Map();
    const normName = (n) => (n || '').replace(/\s+/g, '').toLowerCase();
    for (const s of RAW_SOURCES) {
        const fp = resolveLatest(path.join(DATA_DIR, s.file));
        if (!fs.existsSync(fp)) continue;
        try {
            const arr = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            for (const r of (arr || [])) {
                const nm = normName(r['公司名称'] || r.name || '');
                if (nm && !nameToSource.has(nm)) nameToSource.set(nm, s.label);
            }
        } catch (e) {
            console.error('[bridge] 读取 ' + s.file + ' 失败: ' + e.message);
        }
    }

    const mapped = records.map(r => {
        let src = (r['来源'] || '').toString().trim();
        if (!src) {
            const hit = nameToSource.get(normName(r['公司名称']));
            if (hit) src = hit;
        }
        return {
            companyName: (r['公司名称'] || '').trim(),
            type: (r['企业性质'] || '').toString(),
            industry: (r['行业'] || '').toString(),
            recruitType: (r['招聘类型'] || '').toString(),
            recruitTarget: (r['招聘对象'] || '').toString(),
            applyUrl: (r['投递链接'] || '').toString(),
            announceUrl: (r['公告链接'] || '').toString(),
            source: src,
            deadline: (r['截止时间'] || '').toString(),
            publishDate: (r['发布日期'] || '').toString().trim(),
        };
    }).filter(r => r.companyName);

    emit({
        success: true,
        count: mapped.length,
        live: !!live,
        sourceCounts,
        records: mapped
    });
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        emit({ success: false, error: 'bridge 未捕获异常: ' + (e && e.message) });
        process.exit(0);
    });
