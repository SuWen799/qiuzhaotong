/**
 * 安全写文件工具：Windows / WorkBuddy 沙箱下防 EPERM/EACCES/EBUSY。
 *
 * 关键观察（已实测验证）：
 *   - 沙箱【允许】创建「新文件名」的写操作（含唯一时间戳后缀文件）。
 *   - 沙箱【禁止】对「已存在的 canonical 文件」做覆盖写 / 重命名（即便先 unlink 也仍报 EPERM）。
 *   - 沙箱【允许】删除旧文件（unlink）。
 *
 * 因此本模块采用「永远不重命名到 canonical」的策略：
 *   1. 写入一个唯一时间戳后缀的新文件：<base>.<ts>.<rand>.tmp （沙箱允许）
 *   2. 写入一个指针文件 <base>.latest，内容为真实数据文件路径（沙箱允许）
 *   3. 不触碰 canonical 文件；canonical 文件由 resolveLatest() 在读取时回退解析。
 *   4. 清理：删除同名的旧 .tmp 版本文件，避免无限堆积（unlink 允许）。
 */
const fs = require('fs');
const path = require('path');

/**
 * 解析一个 canonical 路径的真实数据文件路径。
 *
 * 重要（2026-08-28 修复）：原实现依赖 <base>.latest 指针文件，但该文件一旦创建后
 * 在 WorkBuddy 沙箱内【无法被覆盖/重命名】（EPERM），其 unlink 兜底也失败，导致指针
 * 永远停留在第一次写入时（本例为 8/26），后续每次爬取写入的新 .tmp 数据从未被读取，
 * 表现为「爬取条数恒定 + 招聘趋势停在 8/25」。
 *
 * 现改为：直接选取目录中时间戳最新的版本化 .tmp 文件（<base>.<ts>.<rand>.tmp）。
 * 该文件名每次都是【全新文件】（沙箱允许创建），无需覆盖任何已有文件，故始终可读到
 * 最新数据。若最新文件恰逢并发写入导致 JSON 解析失败，则回退到次新版本，最后才回退 canonical。
 *
 * @param {string} filePath canonical 路径，如 data/autumn2027_raw.json
 * @returns {string} 真实应读取的文件路径
 */
function resolveLatest(filePath) {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const prefix = baseName + '.';
    let candidates = [];
    try {
        candidates = fs.readdirSync(dir)
            .filter(f => f.startsWith(prefix) && f.endsWith('.tmp'))
            .map(f => {
                const m = f.match(/^(.*)\.(\d{10,})\.[A-Za-z0-9]+\.tmp$/);
                return { f, p: path.join(dir, f), ts: m ? Number(m[2]) : 0 };
            })
            .filter(c => c.ts > 0);
    } catch (e) {
        return filePath;
    }
    // 按时间戳升序，取最新；最新文件若正在写入（解析失败）则回退到更旧版本
    candidates.sort((a, b) => a.ts - b.ts);
    for (let i = candidates.length - 1; i >= 0; i--) {
        const p = candidates[i].p;
        try {
            if (fs.existsSync(p)) {
                JSON.parse(fs.readFileSync(p, 'utf-8')); // 校验非半写状态
                return p;
            }
        } catch (e) {
            continue;
        }
    }
    return filePath; // 无任何可读版本时回退 canonical
}

/**
 * 安全读取 JSON：先用 resolveLatest 解析真实路径，解析失败返回 fallback。
 * @param {string} filePath canonical 路径
 * @param {*} fallback 解析失败时的返回值（默认 []）
 */
function safeReadJsonLatest(filePath, fallback = []) {
    const realPath = resolveLatest(filePath);
    try {
        return JSON.parse(fs.readFileSync(realPath, 'utf-8'));
    } catch (e) {
        try {
            // latest 指向的文件损坏时，回退读 canonical
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e2) {
            return fallback;
        }
    }
}

function randSuffix() {
    return Math.random().toString(36).substring(2, 8);
}

function writeFileSafeSync(filePath, content, options = {}) {
    const { encoding = 'utf-8' } = options;
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const ts = Date.now();
    const versionedPath = path.join(dir, `${baseName}.${ts}.${randSuffix()}.tmp`);

    // 第一步：创建新的版本号文件（沙箱允许创建新文件，绝不覆盖已有文件）。
    // 读取方（resolveLatest）按文件名内嵌时间戳取最新，故无需再维护可变指针。
    fs.writeFileSync(versionedPath, content, { encoding });

    // 第二步：清理旧的版本号 .tmp 文件（保留最近 5 个，避免无限堆积）。unlink 允许。
    try {
        const files = fs.readdirSync(dir);
        const prefix = `${baseName}.`;
        const tmpFiles = files
            .filter(f => f.startsWith(prefix) && f.endsWith('.tmp') && f !== path.basename(versionedPath))
            .map(f => {
                const m = f.match(/^(.*)\.(\d{10,})\.[A-Za-z0-9]+\.tmp$/);
                return { f, p: path.join(dir, f), ts: m ? Number(m[2]) : 0 };
            })
            .filter(c => c.ts > 0);
        // 按时间戳升序，删除最早的，仅保留最新的 5 个
        tmpFiles.sort((a, b) => a.ts - b.ts);
        const toDelete = tmpFiles.slice(0, Math.max(0, tmpFiles.length - 5));
        for (const { p } of toDelete) {
            try { fs.unlinkSync(p); } catch (_) {}
        }
    } catch (e) {
        // 清理失败不影响主流程
    }

    return versionedPath;
}

module.exports = { writeFileSafeSync, resolveLatest, safeReadJsonLatest };
