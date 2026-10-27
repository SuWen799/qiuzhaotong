package com.qiuzhaohub.controller;

import com.qiuzhaohub.entity.Setting;
import com.qiuzhaohub.repository.SettingRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/settings")
public class SettingsController {

    private final SettingRepository settingRepository;

    public SettingsController(SettingRepository settingRepository) {
        this.settingRepository = settingRepository;
    }

    private static final List<String> EXPOSED = List.of(
            "llm_api_key", "llm_base_url", "llm_model", "llm_temperature", "crawl_schedule_enabled");

    @GetMapping
    public ResponseEntity<?> getSettings() {
        Map<String, String> map = new HashMap<>();
        for (String k : EXPOSED) {
            map.put(k, settingRepository.findByKey(k).map(Setting::getValue).orElse(""));
        }
        return ResponseEntity.ok(map);
    }

    @PutMapping
    public ResponseEntity<?> saveSetting(@RequestBody Map<String, String> body) {
        for (String k : EXPOSED) {
            if (body.containsKey(k)) {
                String v = body.get(k);
                Setting s = settingRepository.findByKey(k).orElse(Setting.builder().key(k).build());
                s.setValue(v);
                settingRepository.save(s);
            }
        }
        return ResponseEntity.ok(Map.of("success", true));
    }
}
