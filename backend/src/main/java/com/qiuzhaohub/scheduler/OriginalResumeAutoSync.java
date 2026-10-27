package com.qiuzhaohub.scheduler;

import com.qiuzhaohub.entity.Setting;
import com.qiuzhaohub.repository.SettingRepository;
import com.qiuzhaohub.service.ResumeService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * 原版简历「文件夹更新 → 系统自动同步」后台任务（三通道同步）。
 *
 * 数据源 1：C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/{原版简历.md,原版简历.pdf}
 * 数据源 2：material.dir（默认 C:/Users/<你的Windows用户名>/Desktop/秋招文件/项目介绍）下的项目文档 md
 *
 * 通道 1（简历母本）：源 md/pdf → uploadDir/resumes/{原版简历.md,原版简历.pdf}
 *   即 /resume/versions 虚拟「原版简历」记录读取的同一份固定文件，作为以后简历生成的母本。
 *
 * 通道 2（插件在线简历）：源 md 的 实习经历 / 项目经历 / 核心能力 →
 *   plugin/resume-fill-plugin/data/profile.json 的 internship / project / self 动态部分，
 *   由 backend/scripts/sync_profile_from_md.py 解析写入，保留部门/行业/薪资/参与人数等静态字段。
 *
 * 通道 3（项目文档入库）：material.dir 下项目介绍 md 变化时，主动把其同步进引擎可读取的
 *   references/项目经验/*.json（委托 ResumeService.syncMaterialMdToReferences），确保以后生成定制
 *   简历时读到的就是最新项目文档，无需人工点更新按钮。
 *
 * 机制：每 30 秒检测一次源文件最新 mtime，与 settings 表记录的同步基准比较；
 * 一旦源文件比记录的新（用户改了文件夹里的内容），即自动同步并刷新基准，无需任何手动按钮。
 *
 * 注：源路径常量须与 ResumeController 中保持一致；python 解释器取 resume venv。
 */
@Component
public class OriginalResumeAutoSync {

    private final SettingRepository settingRepository;
    private final ResumeService resumeService;

    @Value("${spring.file.upload-dir}")
    private String uploadDir;

    @Value("${material.dir:C:/Users/<你的Windows用户名>/Desktop/秋招文件/项目介绍}")
    private String materialDir;

    // 与 ResumeController 中保持一致：个人简历文件夹里的权威源文件
    private static final String ORIGINAL_RESUME_SRC =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/原版简历.pdf";
    private static final String ORIGINAL_MD_SRC =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/个人简历/原版简历.md";
    private static final String ORIGINAL_RESUME_DST_NAME = "原版简历.pdf";
    private static final String ORIGINAL_MD_DST_NAME = "原版简历.md";

    // 通道 2：插件在线简历 profile 同步（python 解释器 + 脚本）
    private static final String PYTHON_EXE =
            "C:/Users/<你的Windows用户名>/.workbuddy/binaries/python/envs/resume/Scripts/python.exe";
    private static final String PROFILE_SYNC_SCRIPT =
            "C:/Users/<你的Windows用户名>/Desktop/秋招文件/秋招助手/秋招通/backend/scripts/sync_profile_from_md.py";

    public OriginalResumeAutoSync(SettingRepository settingRepository, ResumeService resumeService) {
        this.settingRepository = settingRepository;
        this.resumeService = resumeService;
    }

    @Scheduled(initialDelay = 10000, fixedDelay = 30000)
    public void autoSync() {
        try {
            syncResumeFiles();
        } catch (Exception ignored) {
            // 通道 1 失败不影响通道 2 / 3
        }
        try {
            syncPluginProfile();
        } catch (Exception ignored) {
            // 通道 2 失败不影响主流程
        }
        try {
            syncMaterialReferences();
        } catch (Exception ignored) {
            // 通道 3 失败不影响主流程
        }
    }

    /** 通道 1：把源 md/pdf 复制为系统原版简历母本，并记录同步基准。 */
    private void syncResumeFiles() {
        File mdSrc = new File(ORIGINAL_MD_SRC);
        File pdfSrc = new File(ORIGINAL_RESUME_SRC);
        long mdMtime = mdSrc.exists() ? mdSrc.lastModified() : -1;
        long pdfMtime = pdfSrc.exists() ? pdfSrc.lastModified() : -1;
        long latest = Math.max(mdMtime, pdfMtime);
        if (latest < 0) return; // 源文件不存在，跳过

        long storedMtime = readMtime("original_resume_synced_mtime");
        if (latest == storedMtime) return; // 未变化，跳过

        copyFile(ORIGINAL_MD_SRC, uploadDir + "/resumes/" + ORIGINAL_MD_DST_NAME);
        copyFile(ORIGINAL_RESUME_SRC, uploadDir + "/resumes/" + ORIGINAL_RESUME_DST_NAME);
        saveSetting("original_resume_synced_mtime", String.valueOf(latest));
        saveSetting("original_resume_synced_at", now());
    }

    /** 通道 2：源 md 变化时，用脚本把动态部分同步进插件在线简历 profile。 */
    private void syncPluginProfile() {
        File mdSrc = new File(ORIGINAL_MD_SRC);
        long mdMtime = mdSrc.exists() ? mdSrc.lastModified() : -1;
        if (mdMtime < 0) return; // 源 md 不存在，跳过

        long storedMtime = readMtime("plugin_profile_synced_mtime");
        if (mdMtime == storedMtime) return; // 未变化，跳过

        if (runPythonProfileSync()) {
            saveSetting("plugin_profile_synced_mtime", String.valueOf(mdMtime));
            saveSetting("plugin_profile_synced_at", now());
        }
    }

    /** 通道 3：项目文档（material.dir）变化时，主动把项目介绍 md 同步进引擎 references/项目经验。 */
    private void syncMaterialReferences() {
        long latest = materialLatestMtime();
        if (latest < 0) return; // 源目录不存在或无文件，跳过

        long storedMtime = readMtime("material_synced_mtime");
        // Sunwz|2026-10-01|改为 <= 判断：源没有更新（mtime 比基准旧）就不重建。
        // 旧逻辑只判 ==，mtime 回退（目录扰动/文件被 touch 后还原）会导致每次后端重启
        // 都假触发「清空项目经验目录+全量重建」，09-30 15:04 的坏档复发即此因。
        if (latest <= storedMtime) return;

        try {
            resumeService.syncMaterialMdToReferences();
            saveSetting("material_synced_mtime", String.valueOf(latest));
            saveSetting("material_synced_at", now());
        } catch (Exception ignored) {
            // 同步失败不影响主流程，下一轮会重试
        }
    }

    /** 递归取 material.dir 下所有常规文件的最新 mtime（用于变更检测）。 */
    private long materialLatestMtime() {
        try {
            java.nio.file.Path root = Paths.get(materialDir).toAbsolutePath().normalize();
            if (!Files.exists(root)) return -1;
            try (Stream<java.nio.file.Path> stream = Files.walk(root)) {
                long max = -1;
                for (java.nio.file.Path p : (Iterable<java.nio.file.Path>) stream.sorted()::iterator) {
                    if (Files.isRegularFile(p)) {
                        long m = p.toFile().lastModified();
                        if (m > max) max = m;
                    }
                }
                return max;
            }
        } catch (Exception e) {
            return -1;
        }
    }

    /** 调用 python 解释器运行 sync_profile_from_md.py（内部用 LLM 总结），成功返回 true。 */
    private boolean runPythonProfileSync() {
        try {
            String py = PYTHON_EXE;
            if (!new File(py).exists()) py = "python"; // 兜底：PATH 中的 python
            ProcessBuilder pb = new ProcessBuilder(py, PROFILE_SYNC_SCRIPT);
            pb.redirectErrorStream(true);
            // 注入 LLM 配置（settings 表 llm_*）为 RESUME_LLM_* 环境变量 + UTF-8 环境
            java.util.Map<String, String> env = pb.environment();
            putEnv(env, "RESUME_LLM_API_KEY", "llm_api_key");
            putEnv(env, "RESUME_LLM_BASE_URL", "llm_base_url");
            putEnv(env, "RESUME_LLM_MODEL", "llm_model");
            putEnv(env, "RESUME_LLM_TEMPERATURE", "llm_temperature");
            env.put("PYTHONIOENCODING", "utf-8");
            env.put("PYTHONUTF8", "1");
            Process p = pb.start();
            // 消费输出，避免管道写满导致进程阻塞
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    // 可选：System.out.println("[profile-sync] " + line);
                }
            }
            // 单次同步会对 3 段实习 + 5 个项目各调一次 LLM，留足超时
            return p.waitFor(300, TimeUnit.SECONDS);
        } catch (Exception e) {
            return false;
        }
    }

    /** 把 settings 表的 key 值注入到进程环境变量 envKey。 */
    private void putEnv(java.util.Map<String, String> env, String envKey, String settingKey) {
        String v = settingRepository.findByKey(settingKey).map(Setting::getValue).orElse(null);
        if (v != null && !v.isBlank()) {
            env.put(envKey, v);
        }
    }

    private long readMtime(String key) {
        String stored = settingRepository.findByKey(key).map(Setting::getValue).orElse(null);
        if (stored == null) return -1;
        try {
            return Long.parseLong(stored);
        } catch (Exception e) {
            return -1;
        }
    }

    private void copyFile(String srcPath, String dstPath) {
        try {
            File src = new File(srcPath);
            if (!src.exists()) return;
            File dst = new File(dstPath);
            dst.getParentFile().mkdirs();
            try (InputStream in = new FileInputStream(src);
                 OutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        } catch (Exception ignored) { }
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

    private String now() {
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }
}
