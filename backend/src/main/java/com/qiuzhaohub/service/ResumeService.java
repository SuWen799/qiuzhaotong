package com.qiuzhaohub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;

@Service
public class ResumeService {

    @Value("${spring.file.upload-dir}")
    private String uploadDir;

    // 用户撰写的实习/项目经历 md 素材目录（"项目介绍"）。生成前会自动转成引擎可读的 JSON。
    @Value("${material.dir:C:/Users/<你的Windows用户名>/Desktop/秋招文件/项目介绍}")
    private String materialDir;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final Logger log = LoggerFactory.getLogger(ResumeService.class);

    // 为每次生成保留完整 stdout/stderr，便于排查"文件生成但指标为空"等异常
    private File getEngineLogFile(String company, String suffix) {
        try {
            File dir = new File(uploadDir, "logs/resume-engine");
            dir.mkdirs();
            String ts = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
            String safeCompany = company.replaceAll("[\\\\/:*?\"<>|]", "_");
            return new File(dir, safeCompany + "_" + ts + "_" + suffix + ".log");
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 调用 Python 简历引擎生成简历。
     * 命令: python resume-engine/main.py --jd-text <jd> --company <name> --output-dir <dir> [--use-llm]
     * stdout 最后一行是 JSON 结果。
     *
     * 关键防卡死设计：
     * 1. stdout / stderr 并发读取，避免子进程缓冲区写满导致死锁；
     * 2. waitFor 带 150s 超时，超时强制 terminate/destroyForcibly；
     * 3. LLM 配置通过命令行参数显式传入，避免环境变量跨进程传递的不确定性；
     * 4. 每次生成保留引擎 stdout/stderr 运行日志，便于排查偶发指标为空/超时问题。
     */
    public Map<String, Object> generate(String jdText, String company, String jobTitle, boolean useLlm,
                                        String llmApiKey, String llmBaseUrl, String llmModel, String llmTemp) {
        Process proc = null;
        ExecutorService executor = null;
        try {
            String outDir = uploadDir + "/resumes";
            Files.createDirectories(Path.of(outDir));

            String pythonExe = System.getProperty("os.name").toLowerCase().contains("win")
                    ? "C:\\Users\\你的Windows用户名\\.workbuddy\\binaries\\python\\envs\\resume\\Scripts\\python.exe"
                    : "python3";
            String engine = "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招助手\\秋招通\\resume-engine\\main.py";

            // 输出文件命名所用标识：jobTitle 非空时为「公司名-岗位名」，否则仅「公司名」。
            // 数据库 company 字段仍只存公司名，jobTitle 单独存；此处仅用于拼接落盘文件名。
            String fileCompany = (jobTitle != null && !jobTitle.isBlank())
                    ? (company + "-" + jobTitle)
                    : company;
            // 文件名安全：替换文件系统非法字符，避免路径穿越/写盘失败
            String safeFileCompany = fileCompany.replaceAll("[\\\\/:*?\"<>|]", "_");

            List<String> cmd = new ArrayList<>();
            cmd.add(pythonExe);
            cmd.add(engine);
            // Sunwz|2026-10-22|改动目的：JD 改走 --jd-file 文件传递，不再用 --jd-text 直接传文本。
            // 根因：Windows 下 ProcessBuilder 对"含换行但无空格/Tab"的长参数不加引号，
            // 多行 JD 文本（尤其纯中文+●符号、无 ASCII 空格的 JD）在 argv 层被按行拆开，
            // argparse 报 "unrecognized arguments: <JD后半段>"，引擎启动即崩（无 stdout 只有 stderr）。
            // --jd-file 是单个路径参数，无此风险；main.py 内 --jd-file 优先于 --jd-text，UTF-8 读取。
            Path jdFile = Path.of(outDir, "jd_input_" + System.currentTimeMillis() + ".txt");
            Files.writeString(jdFile, jdText == null ? "" : jdText, StandardCharsets.UTF_8);
            cmd.add("--jd-file"); cmd.add(jdFile.toString());
            cmd.add("--company"); cmd.add(safeFileCompany);
            cmd.add("--output-dir"); cmd.add(outDir);
            if (useLlm) cmd.add("--use-llm");
            // 通过命令行参数显式传入 LLM 配置，优先级高于环境变量
            if (llmApiKey != null && !llmApiKey.isBlank()) { cmd.add("--llm-api-key"); cmd.add(llmApiKey); }
            if (llmBaseUrl != null && !llmBaseUrl.isBlank()) { cmd.add("--llm-base-url"); cmd.add(llmBaseUrl); }
            if (llmModel != null && !llmModel.isBlank()) { cmd.add("--llm-model"); cmd.add(llmModel); }
            if (llmTemp != null && !llmTemp.isBlank()) { cmd.add("--llm-temperature"); cmd.add(llmTemp); }

            // 【自动同步素材】生成前，把"项目介绍"目录下的 md 实时转成引擎可读的
            // 实习经历 JSON，写入 REFERENCES_DIR/实习经历/，确保本次生成用到的就是最新版素材。
            // 机制：引擎每次生成都是新进程实时 open() 读磁盘 JSON，无任何缓存，
            // 所以只要此处覆盖写盘，本次生成必用最新 md，杜绝"磁盘改了但生成用旧版"的割裂。
            try {
                int n = syncMaterialMdToReferences();
                log.info("[ResumeService] 素材自动同步完成: materialDir={}, 转换 {} 个 md", materialDir, n);
            } catch (Exception e) {
                // 转换失败不应阻断生成（退化为引擎内置/已有 JSON），仅记录告警
                log.warn("[ResumeService] 素材自动同步失败（生成仍继续，使用已有 JSON）: {}", e.getMessage());
            }

            // 为本次生成准备运行日志，便于排查"文件已生成但指标为空"等偶发问题
            File stdoutLog = getEngineLogFile(safeFileCompany, "stdout");
            File stderrLog = getEngineLogFile(safeFileCompany, "stderr");
            log.info("[ResumeService] 启动简历引擎: company={}, useLlm={}, cmd={}", company, useLlm, cmd);

            ProcessBuilder pb = new ProcessBuilder(cmd);
            // 环境变量作为双保险保留
            pb.environment().put("RESUME_LLM_API_KEY", llmApiKey == null ? "" : llmApiKey);
            pb.environment().put("RESUME_LLM_BASE_URL", llmBaseUrl == null ? "" : llmBaseUrl);
            pb.environment().put("RESUME_LLM_MODEL", llmModel == null ? "" : llmModel);
            pb.environment().put("RESUME_LLM_TEMPERATURE", llmTemp == null ? "0.3" : llmTemp);
            pb.environment().put("REFERENCES_DIR", uploadDir + "/references");
            // 关键：Windows 下 Python stdout 默认编码为 GBK，会导致中文文件名/内容在跨进程解析时乱码，
            // 进而使落库的 md_path 变成乱码、下载时 java.io.File.exists() 找不到文件。
            // 强制子进程 stdout 为 UTF-8，与下方 InputStreamReader 的 UTF-8 解码保持一致。
            pb.environment().put("PYTHONIOENCODING", "utf-8");
            pb.environment().put("PYTHONUTF8", "1");
            pb.redirectErrorStream(false);
            proc = pb.start();
            final Process finalProc = proc; // lambda 捕获需要 effectively final
            final File finalStdoutLog = stdoutLog;
            final File finalStderrLog = stderrLog;

            // 并发读取 stdout / stderr，避免单线程顺序读导致的缓冲区死锁
            executor = Executors.newFixedThreadPool(2);
            Future<String> stdoutFuture = executor.submit(() -> readStream(finalProc.getInputStream(), finalStdoutLog));
            Future<String> stderrFuture = executor.submit(() -> readStream(finalProc.getErrorStream(), finalStderrLog));

            long startMs = System.currentTimeMillis();
            // 150 秒硬超时：LLM 两次调用（偶发慢）+ PDF 生成 + 余量；超过则强制杀掉子进程
            boolean finished = proc.waitFor(150, TimeUnit.SECONDS);
            long elapsedMs = System.currentTimeMillis() - startMs;
            log.info("[ResumeService] 引擎进程结束: finished={}, elapsedMs={}", finished, elapsedMs);
            if (!finished) {
                proc.destroy();
                if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                    proc.destroyForcibly();
                }
                // 强制清理 Playwright 可能残留的 Chromium/Edge 子进程树
                killProcessTree(proc);
                Map<String, Object> err = new HashMap<>();
                err.put("success", false);
                err.put("error", "简历生成超时（超过150秒），已终止引擎进程。可尝试关闭「使用LLM」或检查网络/LLM服务。");
                return err;
            }

            String stdout = stdoutFuture.get(5, TimeUnit.SECONDS);
            String stderr = stderrFuture.get(5, TimeUnit.SECONDS);
            int exit = proc.exitValue();
            log.info("[ResumeService] 引擎退出码: exit={}, stdoutLen={}, stderrLen={}, stdoutLog={}, stderrLog={}",
                    exit, stdout.length(), stderr.length(), stdoutLog, stderrLog);

            if (exit != 0) {
                Map<String, Object> err = new HashMap<>();
                err.put("success", false);
                err.put("error", "Python引擎执行失败: " + stderr);
                return err;
            }

            // 解析 stdout 最后一行为 JSON
            String jsonLine = lastNonEmptyLine(stdout);
            if (jsonLine.isEmpty()) {
                Map<String, Object> err = new HashMap<>();
                err.put("success", false);
                err.put("error", "Python引擎未返回有效JSON。stderr: " + stderr);
                return err;
            }
            Map<String, Object> result = objectMapper.readValue(jsonLine, Map.class);
            result.put("success", true);
            // 补全绝对路径：直接用 safeFileCompany 构造，避免依赖 Python 返回的中文文件名做跨进程编解码（GBK→UTF-8 乱码）。
            // Python 端落盘文件名即 f"{safeFileCompany}.md" / f"{safeFileCompany}.pdf"，与此处构造一致。
            result.put("md_path", outDir + "/" + safeFileCompany + ".md");
            if (result.get("pdf_file") != null) {
                result.put("pdf_path", outDir + "/" + safeFileCompany + ".pdf");
            }
            log.info("[ResumeService] 生成结果: matchScore={}, coverageRate={}, jdSummaryLen={}",
                    result.get("match_score"),
                    result.get("coverage") instanceof Map ? ((Map<?, ?>) result.get("coverage")).get("coverage_rate") : null,
                    result.get("jd_summary") instanceof String ? ((String) result.get("jd_summary")).length() : 0);
            return result;
        } catch (Exception e) {
            if (proc != null && proc.isAlive()) {
                proc.destroyForcibly();
                killProcessTree(proc);
            }
            Map<String, Object> err = new HashMap<>();
            err.put("success", false);
            err.put("error", e.getMessage());
            return err;
        } finally {
            if (executor != null) executor.shutdownNow();
        }
    }

    private String readStream(InputStream is, File logFile) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append("\n");
                if (logFile != null) {
                    try {
                        Files.writeString(logFile.toPath(), line + System.lineSeparator(),
                                StandardCharsets.UTF_8,
                                StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                    } catch (Exception ignored) {
                        // 日志写入失败不影响主流程
                    }
                }
            }
        }
        return sb.toString();
    }

    // 兼容旧调用（不再使用，保留避免编译错误）
    private String readStream(InputStream is) throws IOException {
        return readStream(is, null);
    }

    private String lastNonEmptyLine(String text) {
        String[] lines = text.split("\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String t = lines[i].trim();
            if (!t.isEmpty()) return t;
        }
        return "";
    }

    /**
     * 强制清理子进程树。Windows 下 Playwright 启动的 Chromium/Edge 子进程
     * 在 proc.destroyForcibly() 后仍可能残留，导致后续生成变慢/超时。
     * 使用 taskkill /T /F /PID 一次性清理整个进程树。
     */
    private void killProcessTree(Process proc) {
        try {
            long pid = proc.pid();
            if (pid > 0) {
                ProcessBuilder pb = new ProcessBuilder("taskkill", "/T", "/F", "/PID", String.valueOf(pid));
                pb.redirectErrorStream(true);
                pb.inheritIO();
                pb.start();
            }
        } catch (Exception ignored) {
            // 清理失败不影响主流程
        }
    }

    /**
     * 自动同步：扫描 materialDir 下的所有 .md/.txt 素材，按"项目介绍"格式解析，
     * 转成引擎可读的项目经验 JSON（{name, description, techStack, highlights[]}），
     * 覆盖写入 references/项目经验/<文件名>.json。
     * 注意：写入「项目经验」目录而非「实习经历」，避免污染 base.internships 的
     * 顶层数组结构；md 描述的项目会作为补充素材在 flatten_projects 时合并到
     * base 已有项目的 highlights/description 中，不会增加项目条数。
     * 返回成功转换的文件数。
     */
    public int syncMaterialMdToReferences() throws IOException {
        Path srcRoot = Paths.get(materialDir).toAbsolutePath().normalize();
        if (!Files.isDirectory(srcRoot)) return 0;
        String refDir = uploadDir + "/references";
        Path projectDir = Paths.get(refDir, "项目经验").toAbsolutePath().normalize();
        // 先清空旧的项目经验 json（递归），避免 md 移动/改名/删除后留下陈旧 json 干扰生成
        if (Files.isDirectory(projectDir)) {
            try (var oldStream = Files.walk(projectDir)) {
                oldStream.sorted(Comparator.reverseOrder())
                        .filter(p -> Files.isRegularFile(p) && p.getFileName().toString().endsWith(".json"))
                        .forEach(p -> {
                            try { Files.deleteIfExists(p); } catch (IOException ignored) {}
                        });
            }
        }
        Files.createDirectories(projectDir);

        int count = 0;
        // 递归扫描 materialDir（含子文件夹）：用户按公司建子目录存放 md 素材时也能被同步进生成引擎
        try (var stream = Files.walk(srcRoot)) {
            for (Path p : (Iterable<Path>) stream.sorted()::iterator) {
                if (!Files.isRegularFile(p) || !p.startsWith(srcRoot)) continue;
                String lower = p.getFileName().toString().toLowerCase();
                if (!lower.endsWith(".md") && !lower.endsWith(".txt")) continue;
                String md = Files.readString(p, StandardCharsets.UTF_8);
                Map<String, Object> project = parseProjectIntroMdAsProject(md, p.getFileName().toString());
                if (project == null) continue;
                // 保留相对路径结构（如 示例公司A/odometry.md → 项目经验/示例公司A/odometry.json），
                // 避免不同子文件夹同名文件互相覆盖（如两个 odometry.md）
                String relBase = srcRoot.relativize(p).toString().replaceAll("\\.(md|txt)$", "").replace("\\", "/");
                Path out = projectDir.resolve(relBase + ".json");
                Files.createDirectories(out.getParent());
                objectMapper.writerWithDefaultPrettyPrinter().writeValue(out.toFile(), project);
                count++;
            }
        }
        return count;
    }

    /**
     * 把"项目介绍"格式的 md 解析为一个【项目经验】对象（不带 company/role/period 包装）。
     * 约定块：## 项目简介/项目概述 → 项目 description；## 技术栈 → techStack；
     *        ## 技术亮点/核心功能 → highlights[]。无对应块则尽力从全文提取。
     * 解析失败或内容为空返回 null。
     */
    private Map<String, Object> parseProjectIntroMdAsProject(String md, String fileName) {
        // Sunwz|2026-10-01|部分 md 带 UTF-8 BOM（\uFEFF），会让首行 startsWith("#") 判定失败，
        // 标题行混进 description 兜底（示例平台A 曾出现 "﻿# 01 · 示例公司A…"）
        if (md != null && !md.isEmpty() && md.charAt(0) == '\uFEFF') {
            md = md.substring(1);
        }
        Map<String, String> blocks = splitByH2(md);

        // name：优先取首行 # 标题，否则用文件名（去扩展名）
        String name = fileName.replaceAll("\\.(md|txt)$", "");
        String firstLine = md.lines().findFirst().orElse("").trim();
        if (firstLine.startsWith("#") && !firstLine.startsWith("##")) {
            name = firstLine.replaceFirst("^#\\s*", "").trim();
        }
        // Sunwz|2026-10-01|清理「02 · 」式编号前缀与「项目完整学习说明书（…）」标题尾巴，
        // 避免引擎按项目名匹配失败
        name = name.replaceFirst("^\\d+\\s*[·•]\\s*", "");
        name = name.replaceFirst("\\s*项目完整学习说明书.*$", "").trim();

        String description = pickBlock(blocks, "项目简介", "项目概述", "项目背景", "简介");
        if (description == null || description.isBlank()) {
            // Sunwz|2026-10-01|兜底收紧：面试防守说明书类文档开头是业务主线长文，
            // 整段灌进 description 会污染简历素材（09-30 事故）。只取首个正文段落前 2 行，
            // 且带「面试防守/说明书」特征时置空。
            String firstPara = md.lines()
                    .filter(l -> !l.trim().startsWith("#") && !l.trim().startsWith(">")
                            && !l.trim().startsWith("---") && !l.trim().isEmpty()
                            // Sunwz|2026-10-01|目录列表行（- 第 0 章…）与表格行（| 项 | 内容 |）不是正文，
                            // 示例公司D说明书曾把目录灌进 description（09-30 事故）
                            && !l.trim().startsWith("- ") && !l.trim().startsWith("| ")
                            && !l.trim().matches("\\d+\\.\\s.*"))
                    .limit(2).reduce((a, b) -> a + "\n" + b).orElse("").trim();
            description = (firstPara.contains("面试防守") || firstPara.contains("说明书")) ? "" : firstPara;
        }

        String techStackRaw = pickBlock(blocks, "技术栈", "技术架构", "技术选型");
        String techStack = "";
        if (techStackRaw != null) {
            // Sunwz|2026-10-01|精准截取：说明书「九、技术栈与个人贡献」整块曾被整段灌成堆砌
            // （09-30 事故：techStack 变成「技术栈+我的贡献」大杂烩）。块内优先只取
            // 「**技术栈**：」那一行；取不到才整块 collapse，且超 200 字视为解析失败置空。
            java.util.regex.Matcher tsLine = java.util.regex.Pattern
                    .compile("\\*{0,2}技术栈\\*{0,2}\\s*[：:]\\s*(.+)")
                    .matcher(techStackRaw);
            if (tsLine.find()) {
                techStack = tsLine.group(1).trim();
            } else {
                String c = collapse(techStackRaw);
                techStack = c.length() > 200 ? "" : c;
            }
        }

        String hlRaw = pickBlock(blocks, "技术亮点", "核心功能", "主要功能", "项目成果", "关键特性");
        List<String> highlights = hlRaw == null ? new ArrayList<>() : extractHighlights(hlRaw);

        if (description.isBlank() && techStack.isBlank() && highlights.isEmpty()) return null;

        Map<String, Object> proj = new LinkedHashMap<>();
        proj.put("name", name);
        proj.put("description", collapse(description));
        proj.put("techStack", techStack);
        proj.put("highlights", highlights);
        return proj;
    }

    /**
     * 把"项目介绍"格式的 md 解析为一个实习对象（引擎期望结构：{company,role,period,projects:[...]}）。
     * 约定块：## 项目简介/项目概述 → 项目 description；## 技术栈 → techStack；
     *        ## 技术亮点/核心功能 → highlights[]。无对应块则尽力从全文提取。
     * 解析失败或内容为空返回 null。
     */
    private Map<String, Object> parseProjectIntroMd(String md, String fileName) {
        // 兼容旧调用：实际委托给不带 company 包装的 parseProjectIntroMdAsProject。
        // 注：旧版本会包成 {company, role, period, projects:[...]}；新版本写到「项目经验」目录，
        // 引擎读取的也是项目结构，故保持项目结构语义一致。
        return parseProjectIntroMdAsProject(md, fileName);
    }

    private Map<String, String> splitByH2(String md) {
        Map<String, String> map = new LinkedHashMap<>();
        String[] lines = md.split("\n");
        String curKey = null;
        StringBuilder sb = new StringBuilder();
        for (String line : lines) {
            String t = line.trim();
            if (t.startsWith("## ") && !t.startsWith("### ")) {
                if (curKey != null) map.put(curKey, sb.toString().trim());
                curKey = t.substring(3).trim().replaceAll("^\\d+\\.\\s*", "");
                sb.setLength(0);
            } else if (curKey != null) {
                sb.append(line).append("\n");
            }
        }
        if (curKey != null) map.put(curKey, sb.toString().trim());
        return map;
    }

    private String pickBlock(Map<String, String> blocks, String... keys) {
        for (String k : keys) {
            for (Map.Entry<String, String> e : blocks.entrySet()) {
                if (e.getKey().contains(k) || k.contains(e.getKey())) return e.getValue();
            }
        }
        return null;
    }

    // 去掉 markdown 噪声（**、`、多余空行），合并为紧凑文本
    private String collapse(String s) {
        if (s == null) return "";
        return s.replaceAll("`{1,3}", "")
                .replaceAll("\\*\\*(.*?)\\*\\*", "$1")
                .replaceAll("\\*", "")
                .replaceAll("\\n{2,}", "\n")
                .trim();
    }

    // 从亮点/功能块抽取条目：优先 **加粗标题** 形式，其次 - 列表，再次 ### 子标题
    private List<String> extractHighlights(String raw) {
        List<String> out = new ArrayList<>();
        String[] lines = raw.split("\n");
        StringBuilder cur = new StringBuilder();
        for (String line : lines) {
            String t = line.trim();
            if (t.isEmpty()) continue;
            if (t.startsWith("### ") || t.startsWith("- ") || t.startsWith("* ")) {
                if (cur.length() > 0) { addHighlight(out, cur.toString()); cur.setLength(0); }
                cur.append(t.replaceFirst("^(### |[-*]\\s+)", ""));
            } else if (t.startsWith("**")) {
                if (cur.length() > 0) { addHighlight(out, cur.toString()); cur.setLength(0); }
                cur.append(t);
            } else {
                cur.append(" ").append(t);
            }
        }
        if (cur.length() > 0) addHighlight(out, cur.toString());
        return out;
    }

    private void addHighlight(List<String> out, String s) {
        String cleaned = collapse(s).replaceAll("^[:：]\\s*", "").trim();
        if (!cleaned.isEmpty() && cleaned.length() >= 4) out.add(cleaned);
    }
}
