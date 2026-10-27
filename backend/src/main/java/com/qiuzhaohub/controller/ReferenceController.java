package com.qiuzhaohub.controller;

import com.qiuzhaohub.entity.ReferenceFile;
import com.qiuzhaohub.repository.ReferenceFileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/references")
public class ReferenceController {

    @Value("${spring.file.upload-dir}")
    private String uploadDir;

    private final ReferenceFileRepository referenceFileRepository;

    public ReferenceController(ReferenceFileRepository referenceFileRepository) {
        this.referenceFileRepository = referenceFileRepository;
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String category,
                                  @RequestParam(required = false) String keyword) {
        List<ReferenceFile> all = referenceFileRepository.findAll();
        if (category != null && !category.isBlank()) {
            all = all.stream().filter(f -> category.equals(f.getCategory())).toList();
        }
        if (keyword != null && !keyword.isBlank()) {
            String k = keyword.toLowerCase();
            all = all.stream().filter(f -> (f.getFilename() != null && f.getFilename().toLowerCase().contains(k))
                    || (f.getNote() != null && f.getNote().toLowerCase().contains(k))).toList();
        }
        return ResponseEntity.ok(all);
    }

    @PostMapping("/upload")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file,
                                    @RequestParam("category") String category,
                                    @RequestParam(required = false) String note) {
        try {
            String refDir = uploadDir + "/references";
            Files.createDirectories(Paths.get(refDir));
            String filename = System.currentTimeMillis() + "_" + file.getOriginalFilename();
            Path dest = Paths.get(refDir, filename);
            file.transferTo(dest.toFile());

            String hash = sha256(dest.toFile());
            ReferenceFile rf = ReferenceFile.builder()
                    .category(category)
                    .filename(file.getOriginalFilename())
                    .path(dest.toString())
                    .contentHash(hash)
                    .size(file.getSize())
                    .note(note)
                    .uploadedAt(LocalDateTime.now())
                    .build();
            referenceFileRepository.save(rf);
            return ResponseEntity.ok(rf);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id) {
        ReferenceFile rf = referenceFileRepository.findById(id).orElse(null);
        if (rf == null) return ResponseEntity.notFound().build();
        File f = new File(rf.getPath());
        if (!f.exists()) return ResponseEntity.status(404).body(Map.of("error", "文件未找到"));
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + rf.getFilename() + "\"")
                .body(f);
    }

    @GetMapping("/{id}/content")
    public ResponseEntity<?> content(@PathVariable Long id) {
        ReferenceFile rf = referenceFileRepository.findById(id).orElse(null);
        if (rf == null) return ResponseEntity.notFound().build();
        try {
            String text = Files.readString(Paths.get(rf.getPath()));
            return ResponseEntity.ok(Map.of("content", text));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        ReferenceFile rf = referenceFileRepository.findById(id).orElse(null);
        if (rf != null) {
            try { Files.deleteIfExists(Paths.get(rf.getPath())); } catch (IOException ignored) {}
            referenceFileRepository.deleteById(id);
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    // ===== 直接浏览原始素材目录（D:/qiuzhaohub/uploads/references），绕过 DB =====

    @GetMapping("/files")
    public ResponseEntity<?> listFiles(@RequestParam(required = false) String path) {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            Path target = (path == null || path.isBlank()) ? root : root.resolve(path).normalize();
            if (!target.startsWith(root)) {
                return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            }
            if (!Files.exists(target)) {
                return ResponseEntity.ok(List.of());
            }
            if (Files.isRegularFile(target)) {
                return ResponseEntity.ok(nodeInfo(root, target));
            }
            List<Map<String, Object>> children = new ArrayList<>();
            try (var stream = Files.list(target)) {
                stream.sorted().forEach(p -> children.add(nodeInfo(root, p)));
            }
            return ResponseEntity.ok(children);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/files/content")
    public ResponseEntity<?> fileContent(@RequestParam String path) {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target) || Files.isDirectory(target)) {
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            }
            String name = target.getFileName().toString().toLowerCase();
            String mime = probeMime(name);
            if (mime.startsWith("image/")) {
                byte[] bytes = Files.readAllBytes(target);
                String base64 = java.util.Base64.getEncoder().encodeToString(bytes);
                return ResponseEntity.ok(Map.of("type", "image", "mime", mime, "data", base64));
            }
            String text = Files.readString(target);
            return ResponseEntity.ok(Map.of("type", "text", "text", text));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 以「原版 md」形式返回文件内容：对 .json 素材做 json→md 转换，确保用户看到的永远是 md 而非 json
    @GetMapping("/files/markdown")
    public ResponseEntity<?> markdownFile(@RequestParam String path) {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target) || Files.isDirectory(target)) {
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            }
            String name = target.getFileName().toString().toLowerCase();
            String raw = Files.readString(target);
            if (name.endsWith(".json")) {
                String md = jsonToMarkdown(raw);
                return ResponseEntity.ok(Map.of("type", "markdown", "text", md,
                        "downloadName", target.getFileName().toString().replaceAll("\\.json$", ".md")));
            }
            return ResponseEntity.ok(Map.of("type", "markdown", "text", raw,
                    "downloadName", target.getFileName().toString()));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // ===== md / txt → json 一键同步 =====
    // 约定格式（二级标题分块）：
    //   ## 基本信息        -> 根目录 个人信息.json（对象，- key: value）
    //   ## 教育背景        -> 根目录 教育背景.json（数组，### 条目N 分隔每个对象）
    //   ## 核心能力        -> 根目录 核心能力.json（对象，technical/soft 用 ; 或 、 分隔成数组）
    //   ## 荣誉证书        -> 根目录 证书/荣誉证书.json（字符串数组，纯 - 项）
    //   ## 实习经历        -> 实习经历/<文件名>.json（数组，### 公司名 分隔每个实习，含 projects）
    // 位于 实习经历/ 子目录的 md 同理，整篇按多个 ### 公司 解析为该目录下的 <文件名>.json 数组。
    @PostMapping("/files/sync")
    public ResponseEntity<?> syncMdToJson() {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            List<Map<String, Object>> details = new ArrayList<>();
            int[] r = doSyncMdToJson(root, details);
            return ResponseEntity.ok(Map.of("synced", r[0], "skipped", r[1], "details", details));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    // 共用同步逻辑：被 ReferenceController 和 MaterialController 都调用
    public int[] doSyncMdToJson(Path root, List<Map<String, Object>> details) throws Exception {
        if (!Files.exists(root)) return new int[]{0, 0};
        int synced = 0, skipped = 0;
        // 1) 递归扫描根目录（含子文件夹）顶层块 md：用户按公司建子目录存放素材时也能同步
        try (var stream = Files.walk(root)) {
            for (Path p : (Iterable<Path>) stream.sorted()::iterator) {
                if (!Files.isRegularFile(p) || !p.startsWith(root)) continue;
                String lower = p.getFileName().toString().toLowerCase();
                if (!lower.endsWith(".md") && !lower.endsWith(".txt")) continue;
                String md = Files.readString(p);
                int produced = dispatchTopLevelMd(root, p, md, details);
                if (produced > 0) {
                    synced += produced;
                    try { Files.writeString(p.getParent().resolve(p.getFileName() + ".sync"),
                            String.valueOf(System.currentTimeMillis())); } catch (IOException ignored) {}
                } else {
                    skipped++;
                }
            }
        }
        // 2) 实习经历/ 子目录
        Path internDir = root.resolve("实习经历");
        if (Files.exists(internDir) && Files.isDirectory(internDir)) {
            try (var stream = Files.list(internDir)) {
                for (Path p : (Iterable<Path>) stream.sorted()::iterator) {
                    if (!Files.isRegularFile(p)) continue;
                    String lower = p.getFileName().toString().toLowerCase();
                    if (!lower.endsWith(".md") && !lower.endsWith(".txt")) continue;
                    String base = p.getFileName().toString().replaceAll("\\.(md|txt)$", "");
                    Path out = p.getParent().resolve(base + ".json");
                    if (Files.exists(out)) { skipped++; continue; }
                    String md = Files.readString(p);
                    Object json = parseInternshipDoc(md);
                    if (json != null) {
                        writeJson(out, json);
                        synced++;
                        details.add(Map.of("file", root.relativize(p).toString().replace("\\", "/"),
                                "to", root.relativize(out).toString().replace("\\", "/")));
                    }
                }
            }
        }
        return new int[]{synced, skipped};
    }

    // 根目录 md：按 ## 块分发到不同固定 json（一个 md 可同时含多个块，分别写出）
    // 映射：基本信息/个人信息 -> 个人信息.json；教育背景 -> 教育背景.json；
    //       核心能力 -> 核心能力.json；荣誉证书/证书 -> 证书/荣誉证书.json
    private int dispatchTopLevelMd(Path root, Path mdPath, String md, List<Map<String, Object>> details) {
        Map<String, String> blocks = splitByH2(md);
        if (blocks.isEmpty()) {
            // 无 ## 块：整篇当作基本信息对象
            Map<String, Object> obj = parseObjectBlock(md);
            if (obj.isEmpty()) return 0;
            return writeNamed(root, mdPath, "个人信息.json", obj, details);
        }
        int count = 0;
        if (blocks.containsKey("基本信息") || blocks.containsKey("个人信息")) {
            count += writeNamed(root, mdPath, "个人信息.json",
                    parseObjectBlock(blocks.getOrDefault("基本信息", blocks.get("个人信息"))), details);
        }
        if (blocks.containsKey("教育背景")) {
            count += writeNamed(root, mdPath, "教育背景.json",
                    parseArrayBlocks(blocks.get("教育背景")), details);
        }
        if (blocks.containsKey("核心能力")) {
            count += writeNamed(root, mdPath, "核心能力.json",
                    parseCoreSkills(blocks.get("核心能力")), details);
        }
        if (blocks.containsKey("荣誉证书") || blocks.containsKey("证书")) {
            count += writeNamed(root, mdPath, "证书/荣誉证书.json",
                    parseStringList(blocks.getOrDefault("荣誉证书", blocks.get("证书"))), details);
        }
        if (blocks.containsKey("实习经历")) {
            String base = mdPath.getFileName().toString().replaceAll("\\.(md|txt)$", "");
            count += writeNamed(root, mdPath, "实习经历/" + base + ".json",
                    parseInternshipDoc(md), details);
        }
        return count;
    }

    // 写出 named json（若已存在则跳过，避免覆盖用户已有数据），返回 1 或 0
    private int writeNamed(Path root, Path mdPath, String jsonRel, Object data, List<Map<String, Object>> details) {
        try {
            Path out = root.resolve(jsonRel.replace("/", File.separator));
            if (Files.exists(out)) return 0; // 已存在，跳过
            Files.createDirectories(out.getParent());
            writeJson(out, data);
            details.add(Map.of("file", root.relativize(mdPath).toString().replace("\\", "/"),
                    "to", jsonRel));
            return 1;
        } catch (Exception e) {
            return 0;
        }
    }

    // 实习经历 md（根目录 ## 实习经历 或 实习经历/ 子目录整篇）：解析为实习对象数组
    private Object parseInternshipDoc(String md) {
        Map<String, String> blocks = splitByH2(md);
        String internBlock = blocks.getOrDefault("实习经历",
                blocks.isEmpty() ? md : blocks.values().iterator().next());
        // 按 ### 公司 切块
        List<Object> list = new ArrayList<>();
        Map<String, String> sub = splitByH3(internBlock);
        if (sub.isEmpty()) {
            // 没有 ### 子标题，整段作为一个实习对象
            list.add(parseInternshipItem(internBlock, null));
        } else {
            for (Map.Entry<String, String> en : sub.entrySet()) {
                list.add(parseInternshipItem(en.getValue(), en.getKey()));
            }
        }
        return list;
    }

    private Map<String, Object> parseInternshipItem(String text, String companyFallback) {
        List<Node> nodes = parseNodes(text);
        Map<String, Object> item = new LinkedHashMap<>();
        String company = kv(nodes, "company");
        if (company == null) company = companyFallback;
        item.put("company", company == null ? "" : company);
        item.put("role", firstNonEmpty(kv(nodes, "role"), kv(nodes, "position"), kv(nodes, "职位")));
        item.put("period", firstNonEmpty(kv(nodes, "period"), kv(nodes, "时间")));
        // projects：找 projects 节点下的子节点
        List<Object> projects = new ArrayList<>();
        Node projRoot = findList(nodes, "projects");
        if (projRoot != null && !projRoot.children.isEmpty()) {
            // 判断模式：是否存在「自身无 children 但含 name 字段」的平铺子节点（即单项目平铺）
            boolean flat = projRoot.children.stream().anyMatch(c -> "name".equalsIgnoreCase(c.key) && c.children.isEmpty());
            if (flat) {
                projects.add(parseProjectNode(projRoot));
            } else {
                for (Node c : projRoot.children) projects.add(parseProjectNode(c));
            }
        }
        if (projects.isEmpty()) projects.add(parseProjectNode(null));
        item.put("projects", projects);
        return item;
    }

    private Map<String, Object> parseProjectNode(Node node) {
        Map<String, Object> proj = new LinkedHashMap<>();
        List<Node> src = (node == null) ? new ArrayList<>() : node.children.isEmpty() ? List.of(node) : node.children;
        String name = (node != null && node.value != null && !node.value.isEmpty()) ? node.value : kv(src, "name");
        proj.put("name", name == null ? "" : name);
        proj.put("description", firstNonEmpty(kv(src, "description"), kv(src, "desc"), kv(src, "描述")));
        proj.put("techStack", splitCsv(firstNonEmpty(kv(src, "techStack"), kv(src, "tech"), kv(src, "技术栈"))));
        List<String> hl = new ArrayList<>();
        Node hlRoot = findList(src, "highlights");
        if (hlRoot != null) {
            for (Node c : hlRoot.children) if (c.value != null && !c.value.isEmpty()) hl.add(c.value);
        }
        proj.put("highlights", hl);
        return proj;
    }

    // 通用「缩进感知」节点：每行 - 项构成树，key: value 的 value 为节点值，其余 - 项为字符串值
    private static class Node {
        String key;     // 冒号前的 key（无冒号则为 null）
        String value;   // 该项的值（可能是字符串列表项，或 key:value 的 value）
        List<Node> children = new ArrayList<>();
        Node(String key, String value) { this.key = key; this.value = value; }
    }

    // 把 md 文本按「- 列表项 + 缩进层级」解析成节点树，支持嵌套（如 projects 下的 name/description/highlights）
    private List<Node> parseNodes(String text) {
        List<Node> result = new ArrayList<>();
        if (text == null) return result;
        List<String> raw = new ArrayList<>();
        for (String l : text.split("\n")) {
            if (l.trim().isEmpty()) continue;
            raw.add(l);
        }
        int[] indents = new int[raw.size()];
        for (int i = 0; i < raw.size(); i++) {
            int n = 0;
            for (char c : raw.get(i).toCharArray()) { if (c == ' ') n++; else if (c == '\t') n += 4; else break; }
            indents[i] = n;
        }
        Deque<Node> stack = new ArrayDeque<>();
        Deque<Integer> indentStack = new ArrayDeque<>();
        for (int i = 0; i < raw.size(); i++) {
            String line = raw.get(i).trim();
            if (line.isEmpty()) continue;
            String body;
            boolean isListItem = line.startsWith("-") || line.startsWith("*");
            if (isListItem) body = line.substring(1).trim();
            else body = line;
            int idx = body.indexOf(':');
            Node node;
            // key 不含空格/连字符时才视为 key:value，否则视为纯字符串项
            if (idx > 0 && !body.substring(0, idx).trim().matches(".*[\\s\\-].*")) {
                String k = body.substring(0, idx).trim();
                String v = body.substring(idx + 1).trim();
                node = new Node(k, v.isEmpty() ? null : v);
            } else {
                node = new Node(null, body);
            }
            while (!indentStack.isEmpty() && indentStack.peek() >= indents[i]) {
                stack.pop(); indentStack.pop();
            }
            if (stack.isEmpty()) result.add(node);
            else stack.peek().children.add(node);
            stack.push(node); indentStack.push(indents[i]);
        }
        return result;
    }

    // 在节点树里找第一个 key 匹配的节点
    private Node findNode(List<Node> nodes, String key) {
        for (Node n : nodes) {
            if (key.equalsIgnoreCase(n.key)) return n;
            Node r = findNode(n.children, key);
            if (r != null) return r;
        }
        return null;
    }

    // 找 key 匹配的「列表型」节点（其 children 为列表项）
    private Node findList(List<Node> nodes, String key) {
        Node n = findNode(nodes, key);
        return (n != null && !n.children.isEmpty()) ? n : null;
    }

    // 取 key 对应的标量值（优先自身 value，否则其下第一个子节点 value）
    private String kv(List<Node> nodes, String key) {
        Node n = findNode(nodes, key);
        if (n == null) return null;
        if (n.value != null && !n.value.isEmpty()) return n.value;
        if (!n.children.isEmpty()) {
            for (Node c : n.children) if (c.value != null && !c.value.isEmpty()) return c.value;
        }
        return null;
    }

    // ----- 基础解析工具 -----
    private Map<String, String> splitByH2(String md) {
        Map<String, String> map = new LinkedHashMap<>();
        String[] lines = md.split("\n");
        String curKey = null; StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            if (line.startsWith("## ")) {
                if (curKey != null) map.put(curKey, sb.toString().trim());
                curKey = line.substring(3).trim();
                sb = new StringBuilder();
            } else if (line.startsWith("# ")) {
                // 忽略 H1（文档标题）
            } else if (curKey != null) {
                sb.append(line).append("\n");
            }
        }
        if (curKey != null) map.put(curKey, sb.toString().trim());
        return map;
    }

    private Map<String, String> splitByH3(String md) {
        Map<String, String> map = new LinkedHashMap<>();
        String[] lines = md.split("\n");
        String curKey = null; StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            if (line.startsWith("### ")) {
                if (curKey != null) map.put(curKey, sb.toString().trim());
                curKey = line.substring(4).trim();
                sb = new StringBuilder();
            } else if (curKey != null) {
                sb.append(line).append("\n");
            }
        }
        if (curKey != null) map.put(curKey, sb.toString().trim());
        return map;
    }

    // 解析对象块：- key: value（value 含 ; 或 、 或 , 才拆成数组，否则保持标量字符串，以对齐引擎期望）
    private Map<String, Object> parseObjectBlock(String text) {
        Map<String, Object> obj = new LinkedHashMap<>();
        if (text == null) return obj;
        for (String line : text.split("\n")) {
            line = line.trim();
            if (line.startsWith("-")) line = line.substring(1).trim();
            int idx = line.indexOf(':');
            if (idx <= 0) continue;
            String k = line.substring(0, idx).trim();
            String v = line.substring(idx + 1).trim();
            if (k.isEmpty()) continue;
            List<String> arr = splitCsv(v);
            // 单值保持字符串；多值才为数组
            obj.put(k, arr.size() <= 1 ? (v.isEmpty() ? "" : v) : arr);
        }
        return obj;
    }

    // 解析数组块：按 ### 条目 切成多个对象
    private List<Object> parseArrayBlocks(String text) {
        List<Object> list = new ArrayList<>();
        Map<String, String> subs = splitByH3(text);
        if (subs.isEmpty()) { list.add(parseObjectBlock(text)); return list; }
        for (String sub : subs.values()) list.add(parseObjectBlock(sub));
        return list;
    }

    // 核心能力：technical/soft 两个数组字段
    private Map<String, Object> parseCoreSkills(String text) {
        Map<String, Object> obj = new LinkedHashMap<>();
        List<String> tech = new ArrayList<>(), soft = new ArrayList<>();
        for (String line : text.split("\n")) {
            line = line.trim();
            if (line.startsWith("-")) line = line.substring(1).trim();
            int idx = line.indexOf(':');
            if (idx <= 0) continue;
            String k = line.substring(0, idx).trim().toLowerCase();
            String v = line.substring(idx + 1).trim();
            if (k.contains("technical") || k.contains("技术") || k.contains("技能")) tech.addAll(splitCsv(v));
            else if (k.contains("soft") || k.contains("软") || k.contains("素质")) soft.addAll(splitCsv(v));
            else { for (String s : splitCsv(v)) tech.add(s); }
        }
        obj.put("technical", tech);
        obj.put("soft", soft);
        return obj;
    }

    // 纯字符串列表：- 项
    private List<String> parseStringList(String text) {
        List<String> list = new ArrayList<>();
        if (text == null) return list;
        for (String line : text.split("\n")) {
            line = line.trim();
            if (line.startsWith("-")) line = line.substring(1).trim();
            if (!line.isEmpty()) list.add(line);
        }
        return list;
    }

    private String field(String text, String key) {
        if (text == null) return null;
        for (String line : text.split("\n")) {
            line = line.trim();
            if (line.startsWith("-")) line = line.substring(1).trim();
            int idx = line.toLowerCase().indexOf(key.toLowerCase() + ":");
            if (idx >= 0) {
                String v = line.substring(idx + key.length() + 1).trim();
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }

    // 取某个 key 对应的多行块（key: 之后直到下一个 - key2: 或 ### 为止）
    private String blockField(String text, String key) {
        if (text == null) return null;
        String[] lines = text.split("\n");
        StringBuilder sb = new StringBuilder();
        boolean in = false;
        for (String line : lines) {
            String t = line.trim();
            if (t.startsWith("-")) t = t.substring(1).trim();
            int idx = t.toLowerCase().indexOf(key.toLowerCase() + ":");
            if (idx >= 0) { in = true; String rest = t.substring(idx + key.length() + 1).trim(); if (!rest.isEmpty()) sb.append(rest).append("\n"); continue; }
            if (in) {
                if (t.startsWith("###") || (t.startsWith("-") && t.contains(":"))) break;
                if (!t.isEmpty()) sb.append(t).append("\n");
            }
        }
        return in && sb.length() > 0 ? sb.toString().trim() : null;
    }

    private List<String> splitCsv(String v) {
        if (v == null || v.isEmpty()) return new ArrayList<>();
        List<String> out = new ArrayList<>();
        for (String s : v.split("[;；、,]")) {
            s = s.trim();
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }

    private String firstNonEmpty(String... vals) {
        for (String v : vals) if (v != null && !v.isEmpty()) return v;
        return "";
    }

    private void writeJson(Path out, Object data) throws Exception {
        ObjectMapper om = new ObjectMapper();
        om.writerWithDefaultPrettyPrinter().writeValue(out.toFile(), data);
    }

    // 通用 json → md 转换：顶层对象每个 key 作为二级标题，数组元素逐条列出，嵌套对象递归
    private String jsonToMarkdown(String json) {
        try {
            ObjectMapper om = new ObjectMapper();
            Object obj = om.readValue(json, Object.class);
            StringBuilder sb = new StringBuilder();
            appendMarkdown(sb, obj, 2);
            return sb.toString().trim() + "\n";
        } catch (Exception e) {
            return json; // 解析失败则返回原文
        }
    }

    @SuppressWarnings("unchecked")
    private void appendMarkdown(StringBuilder sb, Object obj, int level) {
        String h = "#".repeat(Math.min(level, 6));
        if (obj instanceof Map) {
            for (Map.Entry<String, Object> en : ((Map<String, Object>) obj).entrySet()) {
                sb.append(h).append(" ").append(en.getKey()).append("\n\n");
                appendMarkdown(sb, en.getValue(), level + 1);
            }
        } else if (obj instanceof List) {
            int i = 1;
            for (Object item : (List<Object>) obj) {
                if (item instanceof Map || item instanceof List) {
                    sb.append(h).append(" 条目 ").append(i).append("\n\n");
                    appendMarkdown(sb, item, level + 1);
                } else {
                    sb.append("- ").append(String.valueOf(item)).append("\n");
                }
                i++;
            }
            sb.append("\n");
        } else {
            sb.append(String.valueOf(obj)).append("\n\n");
        }
    }

    @DeleteMapping("/files")
    public ResponseEntity<?> deleteFile(@RequestParam String path) {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target)) {
                return ResponseEntity.status(400).body(Map.of("error", "非法路径"));
            }
            Files.deleteIfExists(target);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/files/download")
    public ResponseEntity<?> fileDownload(@RequestParam String path) {
        try {
            Path root = Paths.get(uploadDir, "references").toAbsolutePath().normalize();
            Path target = root.resolve(path).normalize();
            if (!target.startsWith(root) || !Files.exists(target) || Files.isDirectory(target)) {
                return ResponseEntity.status(400).body(Map.of("error", "非法路径或目录"));
            }
            File f = target.toFile();
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"" + f.getName() + "\"")
                    .body(f);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private Map<String, Object> nodeInfo(Path root, Path p) {
        Map<String, Object> m = new HashMap<>();
        String rel = root.relativize(p).toString().replace("\\", "/");
        m.put("path", rel);
        m.put("name", p.getFileName().toString());
        m.put("isDir", Files.isDirectory(p));
        try { m.put("size", Files.size(p)); } catch (IOException e) { m.put("size", 0); }
        if (Files.isRegularFile(p)) {
            String lower = p.getFileName().toString().toLowerCase();
            m.put("kind", kindOf(lower));
            boolean isMd = lower.endsWith(".md") || lower.endsWith(".txt");
            m.put("isMd", isMd);
            // 同名 .json 是否存在（用于判断「md 未入 json」）
            if (isMd) {
                String base = p.getFileName().toString().replaceAll("\\.(md|txt)$", "");
                Path siblingJson = p.getParent().resolve(base + ".json");
                // 同名 .json 或隐藏 .md.sync 标记（sync 已处理过）都视为已入 json
                Path syncMark = p.getParent().resolve(p.getFileName().toString() + ".sync");
                m.put("hasJson", Files.exists(siblingJson) || Files.exists(syncMark));
            } else {
                m.put("hasJson", false);
            }
        } else {
            m.put("isMd", false);
            m.put("hasJson", false);
        }
        return m;
    }

    private String kindOf(String name) {
        if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".json"))
            return "text";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".gif") || name.endsWith(".webp"))
            return "image";
        if (name.endsWith(".pdf")) return "pdf";
        return "other";
    }

    private String probeMime(String name) {
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream is = new FileInputStream(f)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
