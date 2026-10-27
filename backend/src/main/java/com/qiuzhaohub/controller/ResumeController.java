package com.qiuzhaohub.controller;

import com.qiuzhaohub.entity.ResumeBase;
import com.qiuzhaohub.entity.ResumeVersion;
import com.qiuzhaohub.entity.Setting;
import com.qiuzhaohub.repository.ResumeBaseRepository;
import com.qiuzhaohub.repository.ResumeVersionRepository;
import com.qiuzhaohub.repository.SettingRepository;
import com.qiuzhaohub.service.ResumeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.LinkedHashMap;
import java.util.concurrent.TimeUnit;

    @RestController
    @RequestMapping("/resume")
    public class ResumeController {

        private static final Logger log = LoggerFactory.getLogger(ResumeController.class);

        // 流二：生成后异步触发，把 JD 定制简历的三块（实习/项目/自评）LLM 总结写入按公司在线简历。
        private static final String PYTHON_EXE =
                "C:\\Users\\你的Windows用户名\\.workbuddy\\binaries\\python\\envs\\resume\\Scripts\\python.exe";
        private static final String SYNC_SCRIPT =
                "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招助手\\秋招通\\backend\\scripts\\sync_company_resume.py";

    private final ResumeService resumeService;
    private final ResumeBaseRepository resumeBaseRepository;
    private final ResumeVersionRepository resumeVersionRepository;
    private final SettingRepository settingRepository;

    @Value("${spring.file.upload-dir}")
    private String uploadDir;

    @Value("${plugin.data-dir:D:/qiuzhaohub/uploads/plugin}")
    private String pluginDataDir;

    // 原版简历 PDF/MD 源文件与落盘目标
    private static final String ORIGINAL_RESUME_SRC =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/原版简历.pdf";
    private static final String ORIGINAL_MD_SRC =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/原版简历.md";
    private static final String ORIGINAL_RESUME_DST_NAME = "原版简历.pdf";
    private static final String ORIGINAL_MD_DST_NAME = "原版简历.md";
    // 在线简历「原版」profile.json 权威源（始终从此读取）
    private static final String ORIGINAL_PROFILE_PATH =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/秋招助手/秋招通/plugin/resume-fill-plugin/data/profile.json";

    public ResumeController(ResumeService resumeService, ResumeBaseRepository resumeBaseRepository,
                            ResumeVersionRepository resumeVersionRepository, SettingRepository settingRepository) {
        this.resumeService = resumeService;
        this.resumeBaseRepository = resumeBaseRepository;
        this.resumeVersionRepository = resumeVersionRepository;
        this.settingRepository = settingRepository;
    }

    @PostMapping("/generate")
    public ResponseEntity<?> generate(@RequestBody Map<String, Object> body) {
        String jdText = (String) body.get("jdText");
        String company = (String) body.get("company");
        String jobTitle = body.get("jobTitle") != null ? (String) body.get("jobTitle") : null;
        Boolean useLlm = body.get("useLlm") != null && (Boolean) body.get("useLlm");
        if (jdText == null || jdText.isBlank() || company == null || company.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "JD内容或公司名为空"));
        }
        String k = settingRepository.findByKey("llm_api_key").map(s -> s.getValue()).orElse("");
        String u = settingRepository.findByKey("llm_base_url").map(s -> s.getValue()).orElse("");
        String m = settingRepository.findByKey("llm_model").map(s -> s.getValue()).orElse("");
        String t = settingRepository.findByKey("llm_temperature").map(s -> s.getValue()).orElse("0.3");

        Map<String, Object> result = resumeService.generate(jdText, company, jobTitle, useLlm != null && useLlm, k, u, m, t);
        if (!(Boolean) result.getOrDefault("success", false)) {
            // 业务失败（如 LLM 超时/引擎异常）返回 200 + success:false，由前端读取 error 字段提示，
            // 避免被前端误判为服务器 500 错误。
            return ResponseEntity.ok(result);
        }

        // 落库 resume_versions（每次生成新增一版，不替换历史版本）
        // baseSnapshot：生成时基础档案全量快照，供插件端作为母本回填
        String baseSnapshot = toJson(resumeBaseRepository.findAll());
        ResumeVersion rv = ResumeVersion.builder()
                .company(company)
                .jobTitle(jobTitle)
                .jdText(jdText)
                .jdSummary((String) result.get("jd_summary"))
                .baseSnapshot(baseSnapshot)
                .variableModules(toJson(result.get("variable_modules")))
                .mdPath((String) result.get("md_path"))
                .pdfPath((String) result.get("pdf_path"))
                .matchScore(result.get("match_score") != null ? ((Number) result.get("match_score")).intValue() : null)
                .coverage(toJson(result.get("coverage")))
                .isDefault("原版".equals(company))
                .build();
        ResumeVersion saved = resumeVersionRepository.save(rv);
        // 返回刚保存的版本 id，前端据此走带鉴权的下载接口（/resume/versions/{id}/download）
        result.put("version_id", saved.getId());

        // 流二：异步把生成的 JD 定制简历三块 LLM 总结后写入按公司在线简历
        // （<pluginDataDir>/versions/<company>.json + .variable_modules.json），不阻塞生成响应。
        if (!"原版".equals(company)) {
            asyncSyncCompanyResume(company, jdText, (String) result.get("md_path"),
                    k, u, m, t);
        }
        return ResponseEntity.ok(result);
    }

    @GetMapping("/base")
    public ResponseEntity<?> getBase() {
        return ResponseEntity.ok(resumeBaseRepository.findAll());
    }

    @PutMapping("/base/{section}")
    public ResponseEntity<?> saveBase(@PathVariable String section, @RequestBody Map<String, Object> body) {
        Object contentObj = body.get("content");
        String content = toJson(contentObj);
        Boolean isMutable = body.get("isMutable") != null ? (Boolean) body.get("isMutable") : false;
        // 实习经历等特殊 section 允许存为数组：保留第一条记录，删除其余同名记录，避免重复覆盖
        List<ResumeBase> existings = resumeBaseRepository.findBySection(section);
        ResumeBase rb = existings.stream().findFirst().orElse(null);
        if (rb == null) {
            rb = ResumeBase.builder().section(section).content(content).isMutable(isMutable).build();
        } else {
            rb.setContent(content);
            rb.setIsMutable(isMutable);
        }
        ResumeBase saved = resumeBaseRepository.save(rb);
        // 清理同名 section 下的多余记录（仅保留刚保存的那条）
        for (ResumeBase e : existings) {
            if (!e.getId().equals(saved.getId())) {
                resumeBaseRepository.deleteById(e.getId());
            }
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    @GetMapping("/versions")
    public ResponseEntity<?> getVersions() {
        // 确保原版简历 PDF 与 MD 已就位（首次读取时复制）
        ensureOriginalResumeCopied();

        List<ResumeVersion> list = resumeVersionRepository.findAllByOrderByCreatedAtDesc();
        // 附带文件是否存在标记，前端据此隐藏「假文件」的下载按钮
        List<Map<String, Object>> out = new ArrayList<>();
        for (ResumeVersion rv : list) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rv.getId());
            m.put("company", rv.getCompany());
            m.put("jobTitle", rv.getJobTitle());
            m.put("jobId", rv.getJobId());
            m.put("createdAt", formatCreatedAt(rv.getCreatedAt()));
            m.put("matchScore", rv.getMatchScore());
            m.put("coverage", rv.getCoverage());
            m.put("mdExists", rv.getMdPath() != null && new java.io.File(rv.getMdPath()).exists());
            m.put("pdfExists", rv.getPdfPath() != null && new java.io.File(rv.getPdfPath()).exists());
            out.add(m);
        }
        // 始终插入一条特殊的「原版简历」记录（id=0，company="原版简历"，jobTitle 空）
        // 让前端简历文件页能显示「原版简历」行，其 PDF 为 uploads/resumes/原版简历.pdf
        Map<String, Object> original = new LinkedHashMap<>();
        String originalPdfPath = uploadDir + "/resumes/" + ORIGINAL_RESUME_DST_NAME;
        String originalMdPath = uploadDir + "/resumes/" + ORIGINAL_MD_DST_NAME;
        boolean originalPdfExists = new java.io.File(originalPdfPath).exists();
        boolean originalMdExists = new java.io.File(originalMdPath).exists();
        original.put("id", 0);
        original.put("company", "原版简历");
        original.put("jobTitle", null);
        original.put("jobId", null);
        // 原版简历为虚拟记录，创建时间展示为「最近一次系统自动同步时间」，让用户从界面上直观感知热更新已发生
        String lastSyncedAt = settingRepository.findByKey("original_resume_synced_at")
                .map(Setting::getValue).orElse(null);
        original.put("createdAt", lastSyncedAt);
        original.put("matchScore", null);
        original.put("coverage", null);
        original.put("mdExists", originalMdExists);
        original.put("pdfExists", originalPdfExists);
        out.add(original);
        return ResponseEntity.ok(out);
    }

    // 首次读取时把原版简历 PDF/MD 复制到 uploads/resumes/（若目标不存在）
    private void ensureOriginalResumeCopied() {
        copyIfSourceExists(ORIGINAL_RESUME_SRC, uploadDir + "/resumes/" + ORIGINAL_RESUME_DST_NAME);
        copyIfSourceExists(ORIGINAL_MD_SRC, uploadDir + "/resumes/" + ORIGINAL_MD_DST_NAME);
    }

    // 原版简历的「手动更新」由 /resume/original/sync 负责；此处仅在目标缺失时兜底复制一次，
    // 不自动跟随源文件变化，避免与「检测变更→用户点更新按钮」的交互冲突。
    private void copyIfSourceExists(String srcPath, String dstPath) {
        try {
            java.io.File src = new java.io.File(srcPath);
            java.io.File dst = new java.io.File(dstPath);
            if (src.exists() && !dst.exists()) {
                dst.getParentFile().mkdirs();
                try (java.io.InputStream in = new java.io.FileInputStream(src);
                     java.io.OutputStream out = new java.io.FileOutputStream(dst)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        } catch (Exception ignored) {
            // 复制失败不影响主流程
        }
    }

    private String formatCreatedAt(java.time.LocalDateTime dt) {
        if (dt == null) return null;
        return dt.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    @GetMapping("/versions/{id}")
    public ResponseEntity<?> getVersion(@PathVariable Long id) {
        return ResponseEntity.ok(resumeVersionRepository.findById(id).orElse(null));
    }

    @DeleteMapping("/versions/{id}")
    public ResponseEntity<?> deleteVersion(@PathVariable Long id) {
        // id=0 为前端虚拟的「原版简历」记录，不对应 DB 数据，禁止删除
        if (id == null || id == 0) {
            return ResponseEntity.ok(Map.of("success", true));
        }
        ResumeVersion rv = resumeVersionRepository.findById(id).orElse(null);
        resumeVersionRepository.deleteById(id);

        if (rv != null) {
            // 1) 级联删除「按公司在线简历」文件（流二产物）：
            //    <pluginDataDir>/versions/<company>.json（完整 profile）
            //    与 <company>.variable_modules.json（引擎格式，插件填充实际读取的就是它）。
            //    两个文件共同构成「在线简历」，必须一起删，否则插件端仍会读到残留的
            //    .variable_modules.json，导致删了文件简历后在线简历依然「还在」。
            deleteOnlineResumeFiles(rv.getCompany());
            // 2) 删除落盘简历文件：uploads/resumes/公司名.md 与 公司名.pdf（如果存在）
            //    注意：文件名可能为「公司名-岗位名」，优先按库中存的 mdPath/pdfPath 删除；
            //    再兜底按 company 删除（兼容历史数据）。
            deleteIfExists(rv.getMdPath());
            deleteIfExists(rv.getPdfPath());
            String base = uploadDir + "/resumes/" + rv.getCompany();
            deleteIfExists(base + ".md");
            deleteIfExists(base + ".pdf");
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    private void deleteIfExists(String path) {
        if (path == null) return;
        java.io.File f = new java.io.File(path);
        if (f.exists()) f.delete();
    }

    // 删除「按公司在线简历」全部产物（命名与 asyncSyncCompanyResume 保持一致：safeCompany）。
    // 在线简历由 <company>.json（完整 profile）与 <company>.variable_modules.json（引擎格式）两个文件组成，
    // 必须一起删除，否则插件端仍会读到残留的 .variable_modules.json。
    private void deleteOnlineResumeFiles(String company) {
        if (company == null) return;
        String safeCompany = company.replaceAll("[\\\\/:*?\"<>|]", "_");
        String versionsDir = pluginDataDir + "/versions";
        deleteIfExists(versionsDir + "/" + safeCompany + ".json");
        deleteIfExists(versionsDir + "/" + safeCompany + ".variable_modules.json");
    }

    // ===== 原版简历「文件夹更新 → 提醒 → 手动同步」机制 =====
    // 数据源：C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/{原版简历.md,原版简历.pdf}
    // 同步目标：uploadDir/resumes/{原版简历.md,原版简历.pdf}（getVersions 的虚拟「原版简历」记录即从这里读取）
    // 检测依据：比较源文件最新 mtime 与 settings 表中记录的 lastSyncedMtime

    @GetMapping("/original/status")
    public ResponseEntity<?> getOriginalStatus() {
        java.io.File mdSrc = new java.io.File(ORIGINAL_MD_SRC);
        java.io.File pdfSrc = new java.io.File(ORIGINAL_RESUME_SRC);
        long mdMtime = mdSrc.exists() ? mdSrc.lastModified() : -1;
        long pdfMtime = pdfSrc.exists() ? pdfSrc.lastModified() : -1;
        long latest = Math.max(mdMtime, pdfMtime);

        String syncedMtimeStr = settingRepository.findByKey("original_resume_synced_mtime")
                .map(Setting::getValue).orElse(null);
        long syncedMtime = -1;
        if (syncedMtimeStr != null) {
            try { syncedMtime = Long.parseLong(syncedMtimeStr); } catch (Exception ignored) { }
        }
        boolean changed = latest != syncedMtime;

        String syncedAt = settingRepository.findByKey("original_resume_synced_at")
                .map(Setting::getValue).orElse(null);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("changed", changed);
        m.put("sourceMdExists", mdSrc.exists());
        m.put("sourcePdfExists", pdfSrc.exists());
        m.put("sourceMdName", "原版简历.md");
        m.put("sourcePdfName", "原版简历.pdf");
        m.put("sourceLatestMtime", latest > 0 ? latest : null);
        m.put("lastSyncedMtime", syncedMtime >= 0 ? syncedMtime : null);
        m.put("lastSyncedAt", syncedAt);
        return ResponseEntity.ok(m);
    }

    @PostMapping("/original/sync")
    public ResponseEntity<?> syncOriginal() {
        try {
            String mdDst = uploadDir + "/resumes/" + ORIGINAL_MD_DST_NAME;
            String pdfDst = uploadDir + "/resumes/" + ORIGINAL_RESUME_DST_NAME;
            boolean mdOk = copyFile(ORIGINAL_MD_SRC, mdDst);
            boolean pdfOk = copyFile(ORIGINAL_RESUME_SRC, pdfDst);

            // 记录同步基准：源文件最新 mtime + 同步时间，用于后续变更检测
            java.io.File mdSrc = new java.io.File(ORIGINAL_MD_SRC);
            java.io.File pdfSrc = new java.io.File(ORIGINAL_RESUME_SRC);
            long latest = Math.max(mdSrc.exists() ? mdSrc.lastModified() : -1,
                    pdfSrc.exists() ? pdfSrc.lastModified() : -1);
            saveSetting("original_resume_synced_mtime", String.valueOf(latest));
            saveSetting("original_resume_synced_at",
                    java.time.LocalDateTime.now()
                            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("success", true);
            m.put("mdCopied", mdOk);
            m.put("pdfCopied", pdfOk);
            return ResponseEntity.ok(m);
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("success", false, "error", e.getMessage()));
        }
    }

    private boolean copyFile(String srcPath, String dstPath) {
        try {
            java.io.File src = new java.io.File(srcPath);
            if (!src.exists()) return false;
            java.io.File dst = new java.io.File(dstPath);
            dst.getParentFile().mkdirs();
            try (java.io.InputStream in = new java.io.FileInputStream(src);
                 java.io.OutputStream out = new java.io.FileOutputStream(dst)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void saveSetting(String key, String value) {
        Setting s = settingRepository.findByKey(key).orElse(null);
        if (s == null) {
            s = new Setting();
            s.setKey(key);
        }
        s.setValue(value);
        settingRepository.save(s);
    }

    @GetMapping("/versions/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id, @RequestParam String type) {
        // id=0 是前端虚拟的「原版简历」记录，走固定落盘的 PDF/MD 文件
        if (id != null && id == 0) {
            String ext = "md".equals(type) ? "md" : "pdf";
            String name = "md".equals(type) ? ORIGINAL_MD_DST_NAME : ORIGINAL_RESUME_DST_NAME;
            java.io.File f = new java.io.File(uploadDir + "/resumes/" + name);
            if (!f.exists()) {
                // 文件尚未复制时触发一次复制
                ensureOriginalResumeCopied();
                f = new java.io.File(uploadDir + "/resumes/" + name);
            }
            if (!f.exists()) return ResponseEntity.status(404).body(Map.of("error", "文件未找到"));
            return buildDownloadResponse(f, "原版简历-原版简历." + ext);
        }

        ResumeVersion rv = resumeVersionRepository.findById(id).orElse(null);
        if (rv == null) return ResponseEntity.notFound().build();
        String path = "md".equals(type) ? rv.getMdPath() : rv.getPdfPath();
        java.io.File f = (path != null) ? new java.io.File(path) : null;
        // 兜底：用 company 重建路径，应对历史数据中因 GBK→UTF-8 乱码导致的 md_path 失效
        if (f == null || !f.exists()) {
            String ext = "md".equals(type) ? "md" : "pdf";
            String rebuilt = uploadDir + "/resumes/" + rv.getCompany() + "." + ext;
            f = new java.io.File(rebuilt);
        }
        if (!f.exists()) return ResponseEntity.status(404).body(Map.of("error", "文件未找到"));
        // 下载文件名：原版简历-公司名[-岗位名].扩展名
        String company = rv.getCompany() == null ? "简历" : rv.getCompany();
        String jobTitle = rv.getJobTitle();
        String safeCompany = company.replaceAll("[\\\\/:*?\"<>|]", "_");
        String safeJob = jobTitle == null ? "" : jobTitle.replaceAll("[\\\\/:*?\"<>|]", "_");
        String downloadName = "原版简历-" + safeCompany + (safeJob.isEmpty() ? "" : "-" + safeJob) + "." + ("md".equals(type) ? "md" : "pdf");
        return buildDownloadResponse(f, downloadName);
    }

    private ResponseEntity<?> buildDownloadResponse(java.io.File f, String downloadName) {
        String ext = downloadName.toLowerCase().endsWith(".md") ? "md" : "pdf";
        String asciiName = "resume." + ext;
        String encodedName;
        try {
            encodedName = java.net.URLEncoder.encode(downloadName, "UTF-8").replaceAll("\\+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            encodedName = asciiName;
        }
        return ResponseEntity.ok()
                .header("Content-Type", "application/octet-stream")
                .header("Content-Disposition",
                        "attachment; filename=\"" + asciiName + "\"; filename*=UTF-8''" + encodedName)
                .body(new FileSystemResource(f));
    }

    private String toJson(Object o) {
        if (o == null) return null;
        if (o instanceof String) return (String) o;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o);
        } catch (Exception e) {
            return o.toString();
        }
    }

    // ===== 流二：异步把 JD 定制简历同步为「按公司在线简历」 =====
    // 生成接口同步返回 ResumeVersion；后台线程跑 sync_company_resume.py，
    // 写 <pluginDataDir>/versions/<company>.json（完整 profile）+ .variable_modules.json（引擎格式）。
    // 插件稍后通过 /plugin/resume-version 读取该文件（优先于 ResumeVersion）。
    private void asyncSyncCompanyResume(String company, String jdText, String mdPath,
                                        String llmApiKey, String llmBaseUrl, String llmModel, String llmTemp) {
        if (mdPath == null || !new java.io.File(mdPath).exists()) {
            log.warn("[ResumeController] 跳过公司在线简历同步：md 文件缺失 ({})", mdPath);
            return;
        }
        new Thread(() -> {
            try {
                String safeCompany = company.replaceAll("[\\\\/:*?\"<>|]", "_");
                String outPath = pluginDataDir + "/versions/" + safeCompany + ".json";
                List<String> cmd = new ArrayList<>();
                cmd.add(PYTHON_EXE);
                cmd.add(SYNC_SCRIPT);
                cmd.add("--md-path"); cmd.add(mdPath);
                cmd.add("--profile-path"); cmd.add(ORIGINAL_PROFILE_PATH);
                cmd.add("--output-path"); cmd.add(outPath);
                cmd.add("--company"); cmd.add(company);
                if (jdText != null && !jdText.isBlank()) { cmd.add("--jd-text"); cmd.add(jdText); }

                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.environment().put("RESUME_LLM_API_KEY", llmApiKey == null ? "" : llmApiKey);
                pb.environment().put("RESUME_LLM_BASE_URL", llmBaseUrl == null ? "" : llmBaseUrl);
                pb.environment().put("RESUME_LLM_MODEL", llmModel == null ? "" : llmModel);
                pb.environment().put("RESUME_LLM_TEMPERATURE", llmTemp == null ? "0.3" : llmTemp);
                pb.environment().put("PYTHONIOENCODING", "utf-8");
                pb.environment().put("PYTHONUTF8", "1");
                pb.redirectErrorStream(true);
                Process proc = pb.start();
                String out = readStreamToString(proc.getInputStream());
                boolean finished = proc.waitFor(180, TimeUnit.SECONDS);
                if (!finished) {
                    proc.destroyForcibly();
                    log.warn("[ResumeController] 公司在线简历同步超时 company={}", company);
                    return;
                }
                log.info("[ResumeController] 公司在线简历同步完成 company={} exit={} out={}", company, proc.exitValue(), out);
            } catch (Exception e) {
                log.warn("[ResumeController] 公司在线简历同步失败 company={} : {}", company, e.getMessage());
            }
        }).start();
    }

    private String readStreamToString(InputStream is) {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
        } catch (Exception ignored) {
        }
        return sb.toString().trim();
    }
}
