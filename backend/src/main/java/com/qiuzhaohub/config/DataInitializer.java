package com.qiuzhaohub.config;

import com.qiuzhaohub.entity.Setting;
import com.qiuzhaohub.entity.User;
import com.qiuzhaohub.repository.SettingRepository;
import com.qiuzhaohub.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class DataInitializer implements CommandLineRunner {

    private final UserRepository userRepository;
    private final SettingRepository settingRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${plugin.access-token}")
    private String pluginToken;

    public DataInitializer(UserRepository userRepository, SettingRepository settingRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.settingRepository = settingRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        // 初始化 admin 账号
        if (userRepository.findByUsername("admin").isEmpty()) {
            User admin = User.builder()
                    .username("admin")
                    .passwordHash(passwordEncoder.encode("admin123"))
                    .build();
            userRepository.save(admin);
            System.out.println("[Init] 已创建默认管理员 admin / admin123");
        }

        // 初始化插件访问令牌
        if (settingRepository.findByKey("plugin_token").isEmpty()) {
            settingRepository.save(Setting.builder()
                    .key("plugin_token")
                    .value(pluginToken)
                    .build());
            System.out.println("[Init] 已写入插件访问令牌");
        }

        // 初始化 LLM 默认配置（不写死，留空待用户在设置页填）
        initSettingIfAbsent("llm_api_key", "");
        initSettingIfAbsent("llm_base_url", "https://api.openai.com/v1");
        initSettingIfAbsent("llm_model", "gpt-4o-mini");
        initSettingIfAbsent("llm_temperature", "0.3");
        initSettingIfAbsent("crawl_schedule_enabled", "false");
    }

    private void initSettingIfAbsent(String key, String value) {
        if (settingRepository.findByKey(key).isEmpty()) {
            settingRepository.save(Setting.builder().key(key).value(value).build());
        }
    }
}
