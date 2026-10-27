package com.qiuzhaohub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import com.qiuzhaohub.service.ResumeService;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * 简历生成 -> 素材管理：仅管理用户撰写的项目/实习经历等 md 素材。
 * 根目录固定指向 C:/Users/<你的Windows用户名>/Desktop/秋招文件/项目介绍（可在 application.yml 用 material.dir 覆盖）。
 * 规则：列表/预览/下载一律是 md（或图片），绝不向用户暴露底层 json。
 */
@RestController
@RequestMapping("/materials")
public class MaterialController {

    @Value("${material.dir:C:/Users/<你的Windows用户名>/Desktop/秋招文件/项目介绍}")
    private String materialDir;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private ResumeService resumeService;

    private Path root() {
        return Paths.get(materialDir).toAbsolutePath().normalize();
    }

    private Path resolve(String path) {
        Path root = root();
        if (path == null || path.isBlank()) return root;
        return root.resolve(path).normalize();
    }

    // 列目录：返回 [{path,name,isDir,kind}]
    @GetMapping("/files")
    public ResponseEntity<?> listFiles(@RequestParam(required = false) String path) {
        try {
            Path target = resolve(path);
            if (!target.startsWith(root())) return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            if (!Files.exists(target)) return ResponseEntity.ok(List.of());
            if (Files.isRegularFile(target)) return ResponseEntity.ok(List.of(nodeInfo(target)));
            List<Map<String, Object>> children = new ArrayList<>();
            try (var stream = Files.list(target)) {
                stream.sorted().forEach(p -> children.add(nodeInfo(p)));
            }
            return ResponseEntity.ok(children);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 预览：md 文本 / 图片 base64。绝不返回 json 原文。
    @GetMapping("/files/content")
    public ResponseEntity<?> getContent(@RequestParam String path) {
        try {
            Path target = resolve(path);
            if (!target.startsWith(root()) || !Files.exists(target) || Files.isDirectory(target))
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            String name = target.getFileName().toString().toLowerCase();
            if (name.endsWith(".md") || name.endsWith(".txt")) {
                String text = Files.readString(target);
                return ResponseEntity.ok(Map.of("type", "text", "isMarkdown", true, "name", target.getFileName().toString(), "text", text));
            }
            if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".gif") || name.endsWith(".webp")) {
                byte[] bytes = Files.readAllBytes(target);
                String base64 = Base64.getEncoder().encodeToString(bytes);
                String mime = name.endsWith(".png") ? "image/png" : name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" : name.endsWith(".gif") ? "image/gif" : "image/webp";
                return ResponseEntity.ok(Map.of("type", "image", "mime", mime, "name", target.getFileName().toString(), "data", base64));
            }
            return ResponseEntity.ok(Map.of("type", "other", "name", target.getFileName().toString()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 下载原文件
    @GetMapping("/files/download")
    public ResponseEntity<?> download(@RequestParam String path) {
        try {
            Path target = resolve(path);
            if (!target.startsWith(root()) || !Files.exists(target) || Files.isDirectory(target))
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            byte[] bytes = Files.readAllBytes(target);
            String name = target.getFileName().toString();
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"" + name + "\"")
                    .header("Content-Type", "application/octet-stream")
                    .body(bytes);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 更换/上传：覆盖同名文件（path 指定相对路径，不含目录时落到根目录）
    @PostMapping("/upload")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file,
                                    @RequestParam(required = false) String path) {
        try {
            String original = file.getOriginalFilename();
            if (original == null || original.isBlank())
                return ResponseEntity.status(400).body(Map.of("error", "文件名不能为空"));
            // 仅允许 md/txt/图片，符合"素材都是 md"的约束
            String lower = original.toLowerCase();
            boolean allowed = lower.endsWith(".md") || lower.endsWith(".txt")
                    || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")
                    || lower.endsWith(".gif") || lower.endsWith(".webp");
            if (!allowed) return ResponseEntity.status(400).body(Map.of("error", "仅支持 md/txt/图片文件"));

            Path target = resolve(path == null || path.isBlank() ? original : path);
            if (!target.startsWith(root())) return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            Files.createDirectories(target.getParent());
            file.transferTo(target.toFile());
            return ResponseEntity.ok(Map.of("success", true, "path", root().relativize(target).toString().replace("\\", "/"), "name", target.getFileName().toString()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 按 path 删除
    @DeleteMapping("/files")
    public ResponseEntity<?> deleteFile(@RequestParam String path) {
        try {
            Path target = resolve(path);
            if (!target.startsWith(root()) || !Files.exists(target))
                return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            Files.deleteIfExists(target);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private Map<String, Object> nodeInfo(Path p) {
        Map<String, Object> m = new HashMap<>();
        String rel = root().relativize(p).toString().replace("\\", "/");
        m.put("path", rel);
        m.put("name", p.getFileName().toString());
        m.put("isDir", Files.isDirectory(p));
        if (Files.isRegularFile(p)) {
            String n = p.getFileName().toString().toLowerCase();
            boolean isMd = n.endsWith(".md") || n.endsWith(".txt");
            m.put("kind", isMd ? "text" : (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".gif") || n.endsWith(".webp")) ? "image" : "other");
            m.put("isMd", isMd);
            if (isMd) {
                String base = p.getFileName().toString().replaceAll("\\.(md|txt)$", "");
                // "入 json" 判定：同名 .json 存在，或已同步过（.md.sync 标记）
                Path siblingJson = p.getParent().resolve(base + ".json");
                Path siblingSync = p.getParent().resolve(p.getFileName() + ".sync");
                m.put("hasJson", Files.exists(siblingJson) || Files.exists(siblingSync));
            }
        }
        return m;
    }

    // ===== 项目文档一键同步：主动把 material.dir 下 md 同步进引擎 references/项目经验（生成时真正读取处）=====
    @PostMapping("/files/sync")
    public ResponseEntity<?> syncMdToJson() {
        try {
            int n = resumeService.syncMaterialMdToReferences();
            return ResponseEntity.ok(Map.of("synced", n, "skipped", 0, "details", java.util.List.of()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }
}
