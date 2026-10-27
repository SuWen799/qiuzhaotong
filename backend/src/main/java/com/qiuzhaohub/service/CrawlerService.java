package com.qiuzhaohub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.qiuzhaohub.entity.Company;
import com.qiuzhaohub.repository.CompanyRepository;
import com.qiuzhaohub.repository.SettingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 调用 crawler-bridge (Node) 执行合并/爬取，并将结果 upsert 到 companies 表。
 */
@Service
public class CrawlerService {

    private static final Logger log = LoggerFactory.getLogger(CrawlerService.class);

    private final CompanyRepository companyRepository;
    private final SettingRepository settingRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Sunwz|2026-09-01|修复：原硬编码 22.22.2 路径实际不存在（managed node 目录为 22.22.2-2），
    // 导致刷新数据报 CreateProcess error=2。改为在候选路径中自动探测第一个存在的 node.exe，
    // 优先用与预期一致的 v22 managed 版本，避免版本目录名变动再次失效。
    private static final String[] NODE_CANDIDATES = {
            "C:\\Users\\你的Windows用户名\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node.exe",
            "C:\\Users\\你的Windows用户名\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe",
            "D:\\Soft\\Node\\nodejs\\node.exe"
    };
    private static final String NODE_EXE = resolveNodeExe();

    private static String resolveNodeExe() {
        for (String p : NODE_CANDIDATES) {
            if (new java.io.File(p).exists()) {
                log.info("[CrawlerService] 选用 node 路径: {}", p);
                return p;
            }
        }
        log.warn("[CrawlerService] 未找到任何候选 node.exe，回退到 {}", NODE_CANDIDATES[0]);
        return NODE_CANDIDATES[0];
    }

    private static final String BRIDGE_DIR =
            "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招助手\\秋招通\\crawler-bridge";
    private static final String BRIDGE_SCRIPT =
            "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招助手\\秋招通\\crawler-bridge\\bridge.js";

    // 内存状态，供 /crawl/status 返回
    private final Map<String, Object> status = new ConcurrentHashMap<>();

    /** 最近一次 bridge 返回的真实分源计数（sourceCounts JSON 节点） */
    private volatile JsonNode lastSourceCounts = null;

    /** 活跃数据源（复刻旧版秋招官网汇总的多源进度遮罩） */
    private static final Map<String, String> CRAWL_SOURCES = new LinkedHashMap<>();
    static {
        CRAWL_SOURCES.put("autumn2027", "秋招27届");
        CRAWL_SOURCES.put("feishu", "飞书社群");
        CRAWL_SOURCES.put("fq", "飞书婉清");
        CRAWL_SOURCES.put("merge", "合并数据");
    }

    /** 进度条权重（仅用于进度百分比估算，非数据计数；真实计数来自 bridge 的 sourceCounts） */
    private static final int[] SOURCE_WEIGHTS = { 15, 30, 30, 25 };

    private Map<String, Object> buildIdleStatus() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("running", false);
        s.put("lastRun", "");
        s.put("lastCount", 0);
        s.put("lastError", "");
        s.put("lastUpdated", "");
        s.put("status", "idle");
        s.put("percent", 0);
        s.put("stage", "");
        s.put("startedAt", "");
        Map<String, Object> sources = new LinkedHashMap<>();
        CRAWL_SOURCES.forEach((k, label) -> {
            Map<String, Object> src = new LinkedHashMap<>();
            src.put("label", label);
            src.put("status", "waiting");
            src.put("count", 0);
            src.put("note", "");
            sources.put(k, src);
        });
        s.put("sources", sources);
        return s;
    }

    public CrawlerService(CompanyRepository companyRepository, SettingRepository settingRepository) {
        this.companyRepository = companyRepository;
        this.settingRepository = settingRepository;
        status.putAll(buildIdleStatus());
    }

    /** 是否启用定时爬取（手动按钮始终允许） */
    public boolean isEnabled() {
        return settingRepository.findByKey("crawl_schedule_enabled")
                .map(s -> "true".equalsIgnoreCase(s.getValue()))
                .orElse(false);
    }

    public Map<String, Object> getStatus() {
        return new HashMap<>(status);
    }

    /**
     * 触发爬取（异步）。
     * 默认走 live 真实爬取（autumn2027 等可真实运行的源会真实抓取，浏览器类源若环境不具备会被 bridge 诚实标 error）；
     * 旧版「仅 merge 历史」语义已不再需要（bridge 在 live 失败时会自动回退历史数据）。
     */
    @Async
    public void triggerCrawl() {
        triggerCrawl(true);
    }

    @Async
    public void triggerCrawl(boolean live) {
        // Sunwz|2026-09-01|修复：防并发守卫。status 是全局单例 ConcurrentHashMap，
        // 多次触发（用户连点/前端轮询）会导致 status 被重新初始化、旧 bridge 子进程
        // 的 progress 事件与新任务的 merge-done 混写，出现 fq=running 但 merge=done 的矛盾状态。
        if (Boolean.TRUE.equals(status.get("running"))) {
            log.warn("[CrawlerService] 爬取任务已在运行中，忽略重复触发");
            return;
        }
        LocalDateTime started = LocalDateTime.now();
        // 初始化多源进度（复刻旧版：各源 waiting→running→done/error）
        Map<String, Object> sources = new LinkedHashMap<>();
        CRAWL_SOURCES.forEach((k, label) -> {
            Map<String, Object> src = new LinkedHashMap<>();
            src.put("label", label);
            src.put("status", "waiting");
            src.put("count", 0);
            src.put("note", "");
            sources.put(k, src);
        });
        status.put("running", true);
        status.put("lastError", "");
        status.put("status", "running");
        status.put("percent", 0);
        status.put("stage", live ? "开始实时爬取..." : "开始合并历史数据...");
        status.put("startedAt", started.toString());
        status.put("lastRun", started);
        status.put("sources", sources);

        int saved = 0;
        try {
            // Sunwz|2026-08-22|改动目的：不再在这里把所有源一次性标 running（否则前端看不到
            // 「爬哪个显示哪个」的逐步推进）。各源的 running/done/error 完全由 bridge 的
            // _progress 实时流驱动——桥接脚本在真正开始爬某源时才发 running，爬完发 done。
            // 仅保留初始 waiting（已在上方初始化），merge 源在 bridge 发 merge running 前保持 waiting。
            status.put("stage", "正在爬取数据源（秋招27届/飞书社群/飞书婉清）...");

            // 调用 bridge（live 真实爬取并合并；失败自动回退历史）
            List<Map<String, Object>> records = runBridge(live);
            if (records == null) {
                status.put("lastError", "爬取脚本返回失败（详见后端日志）");
                for (String k : CRAWL_SOURCES.keySet()) {
                    if (!"merge".equals(k)) markSource(k, "error", 0);
                }
                return;
            }

            // 用 bridge 返回的真实 sourceCounts 填充各源进度（不再使用假权重估算）
            JsonNode sourceCounts = lastSourceCounts;
            if (sourceCounts != null && sourceCounts.isObject()) {
                CRAWL_SOURCES.forEach((k, label) -> {
                    JsonNode sc = sourceCounts.get(k);
                    if (sc != null && sc.isObject()) {
                        int c = sc.path("count").asInt(0);
                        String st = sc.path("status").asText("done");
                        String note = sc.path("note").asText("");
                        markSource(k, st, c, note);
                    }
                });
            } else {
                // fallback：bridge 未返回分源计数时，merge 源标 done 含总数，其余标 done
                int total = records.size();
                for (String k : CRAWL_SOURCES.keySet()) {
                    if ("merge".equals(k)) markSource(k, "done", total);
                    else markSource(k, "done", 0);
                }
            }

            // 合并阶段
            status.put("stage", "正在合并数据...");
            markSource("merge", "running", 0);
            saved = upsert(records);
            // merge 的真实 count：取 sourceCounts.merge 或本次写入数
            int mergeCount = (sourceCounts != null && sourceCounts.path("merge").isObject())
                    ? sourceCounts.path("merge").path("count").asInt(saved) : saved;
            markSource("merge", "done", mergeCount);
            status.put("lastCount", saved);
            status.put("lastUpdated", LocalDateTime.now());

            // 计算总体进度：真实各源状态加权平均（done/error 视为完成，running=50，waiting=0）
            int[] weightFor = { 15, 30, 30, 25 }; // autumn2027, feishu, fq, merge 仅用于进度条权重
            int totalPct = 0, wi = 0;
            for (String k : CRAWL_SOURCES.keySet()) {
                Map<String, Object> src = (Map<String, Object>) sources.get(k);
                String st = (String) src.get("status");
                int pct = "done".equals(st) || "error".equals(st) ? 100 : "running".equals(st) ? 50 : 0;
                totalPct += pct * weightFor[wi];
                wi++;
            }
            status.put("percent", totalPct / 100);

            // 汇总真实反馈（若有源 error，写入 lastError 便于前端提示）
            StringBuilder errNotes = new StringBuilder();
            CRAWL_SOURCES.forEach((k, label) -> {
                Map<String, Object> src = (Map<String, Object>) sources.get(k);
                if ("error".equals(src.get("status"))) {
                    errNotes.append(label).append(": ").append(src.getOrDefault("note", "")).append("；");
                }
            });
            if (errNotes.length() > 0) {
                status.put("lastError", "部分数据源不可用 -> " + errNotes);
            }
            status.put("stage", "爬取完成");
            log.info("爬取完成，写入/更新 {} 条公司记录", saved);
        } catch (Exception e) {
            log.error("爬取过程异常", e);
            status.put("lastError", e.getMessage());
        } finally {
            status.put("running", false);
            status.put("status", "done");
            status.put("percent", 100);
        }
    }

    @SuppressWarnings("unchecked")
    private void markSource(String key, String state, int count) {
        markSource(key, state, count, null);
    }

    @SuppressWarnings("unchecked")
    private void markSource(String key, String state, int count, String note) {
        Object o = status.get("sources");
        if (!(o instanceof Map)) return;
        Map<String, Object> sources = (Map<String, Object>) o;
        Map<String, Object> src = (Map<String, Object>) sources.get(key);
        if (src == null) return;
        src.put("status", state);
        if (count > 0) src.put("count", count);
        if (note != null) src.put("note", note);
        sources.put(key, src);
        status.put("sources", sources);
    }

    /** 调用 Node 桥接脚本，返回映射后的记录列表；失败返回 null */
    private List<Map<String, Object>> runBridge(boolean live) throws Exception {
        List<String> cmd = new ArrayList<>();
        cmd.add(NODE_EXE);
        cmd.add(BRIDGE_SCRIPT);
        if (live) cmd.add("--live");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(new java.io.File(BRIDGE_DIR));
        pb.redirectErrorStream(false);
        // Sunwz|2026-08-22|改动目的：把旧系统（秋招官网汇总）的 node_modules 透传给 bridge 子进程。
        // 后端用 WorkBuddy 隔离 node 调用 bridge，该 node 默认找不到 playwright；
        // bridge 内部已注入旧项目 node_modules 路径来解析 playwright，这里再补一份 NODE_PATH
        // 作为双保险（隔离 node 即使忽略，bridge 的绝对路径注入也已兜底）。
        java.util.Map<String, String> env = pb.environment();
        String oldNodeModules =
                "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招官网汇总\\campus-recruitment\\node_modules";
        String existing = env.get("NODE_PATH");
        env.put("NODE_PATH", (existing == null || existing.isEmpty()) ? oldNodeModules
                : existing + ";" + oldNodeModules);
        Process proc = pb.start();

        // Sunwz|2026-08-22|改动目的：流式读取 bridge 的 stdout，遇到含 _progress:true 的中间行
        // 就实时把对应数据源标为 running/done/error（复刻旧版「爬哪个显示哪个爬取中」的逐步推进），
        // 最终不含 _progress 的 JSON 行用于解析真实分源计数与记录列表。
        final StringBuilder outBuf = new StringBuilder();
        Thread reader = new Thread(() -> {
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    outBuf.append(line).append("\n");
                    String t = line.trim();
                    if (t.isEmpty()) continue;
                    try {
                        JsonNode p = objectMapper.readTree(t);
                        if (p.path("_progress").asBoolean(false)) {
                            String src = p.path("source").asText();
                            String st = p.path("state").asText();
                            int c = p.path("count").asInt(0);
                            String note = p.path("note").asText("");
                            if (!src.isEmpty()) markSource(src, st, c, note.isEmpty() ? null : note);
                        }
                    } catch (Exception ignore) {
                        // 非 JSON 行（如 console.error 日志）忽略
                    }
                }
            } catch (java.io.IOException ignore) {
            }
        });
        reader.setDaemon(true);
        reader.start();

        // Sunwz|2026-09-01|修复：stderr 改为异步读取，避免子进程卡死时同步 readStream 阻塞在
        // EOF 上，导致下方 waitFor 超时逻辑永远到不了（前端因此"爬取中"永不结束）。
        final StringBuilder errBuf = new StringBuilder();
        Thread errReader = new Thread(() -> {
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(proc.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) errBuf.append(line).append("\n");
            } catch (java.io.IOException ignore) {
            }
        });
        errReader.setDaemon(true);
        errReader.start();

        // Sunwz|2026-09-01|修复：bridge.js（autumn2027 爬 GitHub 等）若半开挂起会永久 pending，
        // 这里给 waitFor 加 5 分钟兜底，超时则强制终止子进程并标记错误，杜绝无限等待。
        boolean finished;
        try {
            finished = proc.waitFor(5, java.util.concurrent.TimeUnit.MINUTES);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            finished = false;
        }
        if (!finished) {
            log.error("[CrawlerService] bridge.js 5分钟内未结束，强制终止（避免前端\"爬取中\"永不结束）");
            proc.destroyForcibly();
            try { proc.waitFor(10, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
            status.put("lastError", "爬取脚本(bridge.js)超过5分钟未返回，已强制终止——多为 autumn2027 源访问 GitHub 挂起，请检查网络/代理");
        }
        try { reader.join(5000); } catch (InterruptedException ignore) {}
        try { errReader.join(5000); } catch (InterruptedException ignore) {}

        String stderr = errBuf.toString();
        int exit = finished ? proc.exitValue() : -1;

        if (exit != 0) {
            log.error("bridge.js 非零退出({}): {}", exit, stderr);
        }

        String stdout = outBuf.toString();
        String jsonLine = lastNonEmptyLine(stdout);
        if (jsonLine.isEmpty()) {
            log.error("bridge.js 无有效输出, stderr={}", stderr);
            return null;
        }
        JsonNode root = objectMapper.readTree(jsonLine);
        if (!root.path("success").asBoolean(false)) {
            log.error("bridge.js 返回失败: {}", root.path("error").asText());
            return null;
        }
        // 保存真实分源计数（sourceCounts）供 triggerCrawl 填充进度条
        JsonNode sc = root.path("sourceCounts");
        if (sc.isObject()) {
            lastSourceCounts = sc;
            log.info("bridge.js 返回真实分源计数: {}", sc);
        } else {
            lastSourceCounts = null;
        }
        JsonNode recs = root.path("records");
        List<Map<String, Object>> list = new ArrayList<>();
        if (recs.isArray()) {
            for (JsonNode n : recs) {
                Map<String, Object> m = objectMapper.convertValue(n, Map.class);
                list.add(m);
            }
        }
        log.info("bridge.js 返回 {} 条记录", list.size());
        return list;
    }

    /** 按 companyName+applyUrl 去重做 upsert */
    private int upsert(List<Map<String, Object>> records) {
        int count = 0;
        LocalDateTime now = LocalDateTime.now();
        for (Map<String, Object> r : records) {
            String name = str(r.get("companyName"));
            if (name.isEmpty()) continue;
            String applyUrl = str(r.get("applyUrl"));

            Company existing = null;
            if (!applyUrl.isEmpty()) {
                existing = companyRepository.findByCompanyNameAndApplyUrl(name, applyUrl)
                        .orElse(null);
            }
            if (existing == null) {
                // 退而按名称匹配第一条
                List<Company> byName = companyRepository.findByCompanyName(name);
                if (!byName.isEmpty()) existing = byName.get(0);
            }

            Company c = (existing != null) ? existing : new Company();
            c.setCompanyName(trunc(name, 255));
            c.setType(trunc(str(r.get("type")), 255));
            c.setIndustry(trunc(str(r.get("industry")), 255));
            c.setRecruitType(trunc(str(r.get("recruitType")), 255));
            c.setRecruitTarget(trunc(str(r.get("recruitTarget")), 255));
            c.setApplyUrl(trunc(applyUrl, 255));
            c.setAnnounceUrl(trunc(str(r.get("announceUrl")), 255));
            c.setSource(trunc(str(r.get("source")), 255));
            c.setDeadline(trunc(str(r.get("deadline")), 255));
            c.setPublishDate(trunc(str(r.get("publishDate")), 255));
            c.setCrawledAt(now);
            companyRepository.save(c);
            count++;
        }
        return count;
    }

    private String trunc(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    private String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }

    private String readStream(java.io.InputStream is) throws java.io.IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
        }
        return sb.toString();
    }

    private String lastNonEmptyLine(String text) {
        if (text == null) return "";
        String[] lines = text.split("\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String t = lines[i].trim();
            if (!t.isEmpty()) return t;
        }
        return "";
    }
}
