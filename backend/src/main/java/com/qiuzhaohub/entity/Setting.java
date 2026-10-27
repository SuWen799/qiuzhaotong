package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "settings")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Setting {
    @Id
    private String key;   // llm_api_key / llm_base_url / llm_model / llm_temperature / plugin_token / crawl_schedule_enabled

    @Column(columnDefinition = "TEXT")
    private String value;

    private LocalDateTime updatedAt;

    @PreUpdate
    @PrePersist
    void onSave() {
        updatedAt = LocalDateTime.now();
    }
}
