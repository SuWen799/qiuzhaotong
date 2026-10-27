package com.qiuzhaohub.controller;

import com.qiuzhaohub.entity.ResumeBase;
import com.qiuzhaohub.entity.ResumeVersion;
import com.qiuzhaohub.entity.Setting;
import com.qiuzhaohub.repository.ResumeBaseRepository;
import com.qiuzhaohub.repository.ResumeVersionRepository;
import com.qiuzhaohub.repository.SettingRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.LinkedHashMap;

    @RestController
    @RequestMapping("/plugin")
    public class PluginController {

        private static final Logger log = LoggerFactory.getLogger(PluginController.class);

    private final ResumeVersionRepository resumeVersionRepository;
    private final SettingRepository settingRepository;
    private final ResumeBaseRepository resumeBaseRepository;

    @Value("${plugin.profile-path:D:/qiuzhaohub/uploads/plugin/profile.json}")
    private String profilePath;

    @Value("${plugin.data-dir:D:/qiuzhaohub/uploads/plugin}")
    private String pluginDataDir;

    @Value("${plugin.files-dir:C:/Users/<你的Windows用户名>/Desktop/秋招文件/证明文件}")
    private String filesDir;

    public PluginController(ResumeVersionRepository resumeVersionRepository, SettingRepository settingRepository,
                            ResumeBaseRepository resumeBaseRepository) {
        this.resumeVersionRepository = resumeVersionRepository;
        this.settingRepository = settingRepository;
        this.resumeBaseRepository = resumeBaseRepository;
    }

    @GetMapping("/resume-version")
    public ResponseEntity<?> resumeVersion(@RequestParam String company, @RequestParam String token,
                                             @RequestParam(required = false) String versionId) {
        if (!validToken(token)) return ResponseEntity.status(403).body(Map.of("error", "令牌无效"));

        // 流二优先：按公司在线简历文件（生成后异步写入的 <company>.variable_modules.json）。
        // 该文件是本次 JD 定制版的三块（实习/项目/自评）LLM 总结结果，覆盖 ResumeVersion 中的可变模块。
        String safeCompany = company.replaceAll("[\\\\/:*?\"<>|]", "_");
        java.io.File fullFile = new java.io.File(pluginDataDir + "/versions/" + safeCompany + ".json");
        java.io.File vmFile = new java.io.File(pluginDataDir + "/versions/" + safeCompany + ".variable_modules.json");
        if (fullFile.exists() || vmFile.exists()) {
            try {
                ObjectMapper om = new ObjectMapper();
                Map<String, Object> resp = new HashMap<>();
                resp.put("company", company);
                Long vid = null;
                if (versionId != null && !versionId.isBlank()) {
                    try { vid = Long.parseLong(versionId); } catch (NumberFormatException ignored) {}
                }
                resp.put("versionId", vid);
                // 全量干净 profile（面板展示用）：<company>.json 由 sync_company_resume.py 生成，
                // 已含正确字段映射与拆分后的开始/结束时间，前端应直接 loadFromSections 渲染，
                // 不再走 variable_modules 的增量合并（避免 【】/技术栈 等污染）。
                if (fullFile.exists()) {
                    resp.put("profile", om.readValue(fullFile, Map.class));
                }
                // 引擎格式 variable_modules（插件填充管线用）：<company>.variable_modules.json
                if (vmFile.exists()) {
                    resp.put("variableModules", om.readValue(vmFile, Map.class));
                }
                resp.put("baseSnapshot", null);
                resp.put("createdAt", formatFileMtime((fullFile.exists() ? fullFile : vmFile).lastModified()));
                resp.put("isDefault", false);
                resp.put("fromCompanyFile", true);
                return ResponseEntity.ok(resp);
            } catch (Exception e) {
                // 读取失败则回退到下方 ResumeVersion 逻辑
                log.warn("[PluginController] 读取公司在线简历失败，回退 ResumeVersion: {}", e.getMessage());
            }
        }

        // 原有逻辑：按 ResumeVersion 表返回（无公司文件时回退）
        ResumeVersion rv = null;
        if (versionId != null && !versionId.isBlank()) {
            try {
                rv = resumeVersionRepository.findById(Long.parseLong(versionId)).orElse(null);
            } catch (NumberFormatException ignored) {
            }
        }
        if (rv == null) {
            // 取该 company 最新生成的版本；若没有则回退到「原版」（对齐需求文档 v1.1 §7）
            rv = resumeVersionRepository.findAllByOrderByCreatedAtDesc().stream()
                    .filter(v -> company.equals(v.getCompany()))
                    .findFirst()
                    .orElse(resumeVersionRepository.findAllByOrderByCreatedAtDesc().stream()
                            .filter(v -> "原版".equals(v.getCompany())).findFirst().orElse(null));
        }
        if (rv == null) return ResponseEntity.status(404).body(Map.of("error", "未找到该公司版本，且不存在原版母本"));

        Map<String, Object> resp = new HashMap<>();
        resp.put("company", rv.getCompany());
        resp.put("versionId", rv.getId());
        resp.put("variableModules", rv.getVariableModules());
        resp.put("baseSnapshot", rv.getBaseSnapshot());
        resp.put("createdAt", formatCreatedAt(rv.getCreatedAt()));
        resp.put("isDefault", rv.getIsDefault());
        return ResponseEntity.ok(resp);
    }

    // 流二：列出已生成的「按公司在线简历」文件（<data-dir>/versions/<company>.variable_modules.json）。
    // 前端据此在版本列表里标记哪些公司已有按 JD 定制的在线简历、以及生成时间，便于投递前确认数据源已就绪。
    @GetMapping("/company-resume-status")
    public ResponseEntity<?> companyResumeStatus(@RequestParam String token) {
        if (!validToken(token)) return ResponseEntity.status(403).body(Map.of("error", "令牌无效"));
        List<Map<String, Object>> list = new ArrayList<>();
        java.io.File dir = new java.io.File(pluginDataDir + "/versions");
        if (dir.exists() && dir.isDirectory()) {
            java.io.File[] files = dir.listFiles((d, name) -> name.endsWith(".variable_modules.json"));
            if (files != null) {
                for (java.io.File f : files) {
                    String name = f.getName();
                    String company = name.substring(0, name.length() - ".variable_modules.json".length());
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("company", company);
                    m.put("createdAt", formatFileMtime(f.lastModified()));
                    m.put("fileExists", true);
                    list.add(m);
                }
            }
        }
        return ResponseEntity.ok(list);
    }

    @GetMapping("/versions")
    public ResponseEntity<?> versions(@RequestParam String token) {
        if (!validToken(token)) return ResponseEntity.status(403).body(Map.of("error", "令牌无效"));
        List<Map<String, Object>> list = new ArrayList<>();
        for (ResumeVersion rv : resumeVersionRepository.findAllByOrderByCreatedAtDesc()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rv.getId());
            m.put("company", rv.getCompany());
            m.put("jobTitle", rv.getJobTitle());
            m.put("jobId", rv.getJobId());
            m.put("createdAt", formatCreatedAt(rv.getCreatedAt()));
            m.put("isDefault", rv.getIsDefault());
            list.add(m);
        }
        return ResponseEntity.ok(list);
    }

    private String formatCreatedAt(java.time.LocalDateTime dt) {
        if (dt == null) return null;
        return dt.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    private String formatFileMtime(long millis) {
        if (millis <= 0) return null;
        return java.time.LocalDateTime.ofInstant(
                        java.time.Instant.ofEpochMilli(millis),
                        java.time.ZoneId.systemDefault())
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    @GetMapping("/token")
    public ResponseEntity<?> token() {
        String t = settingRepository.findByKey("plugin_token").map(Setting::getValue).orElse("");
        return ResponseEntity.ok(Map.of("token", t));
    }

    // ===== 插件资料编辑（profile.json 权威源，编辑后同步回基础档案） =====

    @GetMapping("/profile")
    public ResponseEntity<?> getProfile() {
        try {
            Path p = Paths.get(profilePath);
            if (!Files.exists(p)) {
                return ResponseEntity.ok(Map.of("profile", Map.of(), "exists", false));
            }
            String text = Files.readString(p);
            ObjectMapper om = new ObjectMapper();
            Map<String, Object> profile = om.readValue(text, Map.class);
            return ResponseEntity.ok(Map.of("profile", profile, "exists", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/profile")
    public ResponseEntity<?> saveProfile(@RequestBody Map<String, Object> body) {
        try {
            Object profileObj = body.get("profile");
            if (profileObj == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "profile 为空"));
            }
            ObjectMapper om = new ObjectMapper();
            String json = om.writerWithDefaultPrettyPrinter().writeValueAsString(profileObj);
            Path p = Paths.get(profilePath);
            Files.createDirectories(p.getParent());
            // 沙箱环境可能禁止覆盖已存在的 canonical 文件，先删除再写入
            safeWriteProfile(p, json);
            // 同步关键字段回 resume_base，供简历自动生成使用
            syncProfileToBase(profileObj);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(500).body(Map.of("error", e.getClass().getSimpleName() + ": " + e.getMessage()));
        }
    }

    // 将 profile 中的基本信息/教育/实习/证书/核心能力 映射写回 resume_base
    private void syncProfileToBase(Object profileObj) {
        try {
            Map<String, Object> profile = (Map<String, Object>) profileObj;
            Map<String, Object> v2 = (Map<String, Object>) profile.get("profileV2");
            if (v2 == null) return;
            Map<String, Object> sections = (Map<String, Object>) v2.get("sections");
            if (sections == null) return;

            // 基本信息
            Map<String, Object> basic = (Map<String, Object>) sections.get("basic");
            if (basic != null) {
                Map<String, Object> flat = flattenSection(basic);
                upsertBase("基本信息", flat);
            }
            // 教育背景
            Map<String, Object> edu = (Map<String, Object>) sections.get("education");
            if (edu != null) {
                List<Object> list = toList(edu);
                if (list != null) upsertBase("教育背景", list);
            }
            // 实习经历
            Map<String, Object> intern = (Map<String, Object>) sections.get("internship");
            if (intern != null) {
                List<Object> list = toList(intern);
                if (list != null) upsertBase("实习经历", list);
            }
            // 证书
            Map<String, Object> cert = (Map<String, Object>) sections.get("certificates");
            if (cert != null) {
                List<Object> list = toList(cert);
                if (list != null) upsertBase("证书", list);
            }
        } catch (Exception ignored) {
            // 同步失败不影响 profile 保存
        }
    }

    private void upsertBase(String section, Object content) {
        List<ResumeBase> existings = resumeBaseRepository.findBySection(section);
        ResumeBase rb = existings.stream().findFirst().orElse(null);
        if (rb == null) {
            rb = ResumeBase.builder().section(section).content(toJson(content)).isMutable(false).build();
        } else {
            rb.setContent(toJson(content));
        }
        ResumeBase saved = resumeBaseRepository.save(rb);
        for (ResumeBase e : existings) {
            if (!e.getId().equals(saved.getId())) resumeBaseRepository.deleteById(e.getId());
        }
    }

    // 将 {fieldKey: {value: ...}} 结构拍平为 {fieldKey: value}
    private Map<String, Object> flattenSection(Map<String, Object> section) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> en : section.entrySet()) {
            Object v = en.getValue();
            if (v instanceof Map) {
                Object val = ((Map<?, ?>) v).get("value");
                out.put(en.getKey(), val);
            } else {
                out.put(en.getKey(), v);
            }
        }
        return out;
    }

    // 将板块中 items/values 数组转为 List（取每项 value）
    private List<Object> toList(Map<String, Object> section) {
        Object items = section.get("items");
        if (!(items instanceof List)) items = section.get("values");
        if (!(items instanceof List)) return null;
        List<Object> out = new ArrayList<>();
        for (Object it : (List<?>) items) {
            if (it instanceof Map) {
                Map<?, ?> m = (Map<?, ?>) it;
                Object val = m.get("value");
                if (val instanceof Map) {
                    out.add(((Map<?, ?>) val).get("value") != null ? ((Map<?, ?>) val).get("value") : val);
                } else {
                    out.add(val);
                }
            } else {
                out.add(it);
            }
        }
        return out;
    }

    private String toJson(Object o) {
        try {
            return new ObjectMapper().writeValueAsString(o);
        } catch (Exception e) {
            return String.valueOf(o);
        }
    }

    // 沙箱/Windows 下直接覆盖已有 canonical 文件可能被拦截；先删除再写入，失败则落到 uploads 目录
    private void safeWriteProfile(Path target, String content) throws IOException {
        IOException last = null;
        try {
            if (Files.exists(target)) {
                Files.delete(target);
            }
            Files.writeString(target, content);
            return;
        } catch (IOException e) {
            last = e;
        }
        // 兜底：写到 uploads/plugin/profile.json，并尝试用系统命令复制回插件目录
        Path fallbackDir = Paths.get(System.getProperty("user.home"), ".qiuzhaohub").toAbsolutePath();
        try {
            Files.createDirectories(fallbackDir);
        } catch (IOException ignored) {}
        Path fallback = fallbackDir.resolve("profile.json");
        try {
            if (Files.exists(fallback)) Files.delete(fallback);
            Files.writeString(fallback, content);
        } catch (IOException e) {
            if (last != null) throw last;
            throw e;
        }
        try {
            String[] cmd = {"cmd", "/c", "copy", fallback.toString(), target.toString()};
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.inheritIO();
            Process proc = pb.start();
            proc.waitFor(5, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // 兜底文件已落盘，插件路径复制失败不阻塞返回
        }
    }

    @GetMapping("/files")
    public ResponseEntity<?> listFiles(@RequestParam(required = false) String path) {
        try {
            Path root = Paths.get(filesDir).toAbsolutePath().normalize();
            Path target = (path == null || path.isBlank()) ? root : root.resolve(path).normalize();
            if (!target.startsWith(root)) return ResponseEntity.status(400).body(Map.of("error","非法路径"));
            if (!Files.exists(target)) return ResponseEntity.ok(List.of());
            if (Files.isRegularFile(target)) return ResponseEntity.ok(nodeInfo(root, target));
            List<Map<String,Object>> children = new ArrayList<>();
            try (var stream = Files.list(target)) {
                stream.sorted().forEach(p -> children.add(nodeInfo(root, p)));
            }
            return ResponseEntity.ok(children);
        } catch (Exception e) { return ResponseEntity.status(500).body(Map.of("error", e.getMessage())); }
    }

    @GetMapping("/files/view")
    public ResponseEntity<?> viewFile(@RequestParam String path) {
        try {
            Path root = Paths.get(filesDir).toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target) || Files.isDirectory(target))
                return ResponseEntity.status(400).body(Map.of("error","非法路径或目录"));
            String name = target.getFileName().toString().toLowerCase();
            if (name.endsWith(".pdf")) {
                byte[] bytes = Files.readAllBytes(target);
                String base64 = java.util.Base64.getEncoder().encodeToString(bytes);
                return ResponseEntity.ok(Map.of("type","pdf","name",target.getFileName().toString(),"data",base64));
            }
            if (name.endsWith(".jpg")||name.endsWith(".jpeg")||name.endsWith(".png")||name.endsWith(".gif")||name.endsWith(".webp")) {
                byte[] bytes = Files.readAllBytes(target);
                String base64 = java.util.Base64.getEncoder().encodeToString(bytes);
                String mime = name.endsWith(".png")?"image/png":name.endsWith(".jpg")||name.endsWith(".jpeg")?"image/jpeg":name.endsWith(".gif")?"image/gif":"image/webp";
                return ResponseEntity.ok(Map.of("type","image","mime",mime,"name",target.getFileName().toString(),"data",base64));
            }
            // 文本类（txt等）原文返回
            String text = Files.readString(target);
            return ResponseEntity.ok(Map.of("type","text","name",target.getFileName().toString(),"text",text));
        } catch (Exception e) { return ResponseEntity.status(500).body(Map.of("error", e.getMessage())); }
    }

    @PostMapping("/files/upload")
    public ResponseEntity<?> uploadFile(@RequestParam("file") MultipartFile file,
                                        @RequestParam(required = false) String path) {
        try {
            String original = file.getOriginalFilename();
            if (original == null || original.isBlank())
                return ResponseEntity.status(400).body(Map.of("error", "文件名不能为空"));
            Path root = Paths.get(filesDir).toAbsolutePath().normalize();
            Path target = (path == null || path.isBlank()) ? root.resolve(original).normalize()
                                                            : root.resolve(path).normalize();
            if (!target.startsWith(root)) return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            Files.createDirectories(target.getParent());
            file.transferTo(target.toFile());
            return ResponseEntity.ok(Map.of("success", true,
                    "path", root.relativize(target).toString().replace("\\", "/"),
                    "name", target.getFileName().toString()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/files")
    public ResponseEntity<?> deleteFile(@RequestParam String path) {
        try {
            Path root = Paths.get(filesDir).toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target) || Files.isDirectory(target))
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            Files.deleteIfExists(target);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private Map<String,Object> nodeInfo(Path root, Path p) {
        Map<String,Object> m = new HashMap<>();
        String rel = root.relativize(p).toString().replace("\\","/");
        m.put("path", rel);
        m.put("name", p.getFileName().toString());
        m.put("isDir", Files.isDirectory(p));
        if (Files.isRegularFile(p)) {
            String n = p.getFileName().toString().toLowerCase();
            m.put("kind", n.endsWith(".pdf")?"pdf":(n.endsWith(".jpg")||n.endsWith(".jpeg")||n.endsWith(".png")||n.endsWith(".gif")||n.endsWith(".webp"))?"image":"text");
        }
        return m;
    }

    private boolean validToken(String token) {
        if (token == null) return false;
        String expected = settingRepository.findByKey("plugin_token").map(Setting::getValue).orElse("");
        return token.equals(expected);
    }
}
