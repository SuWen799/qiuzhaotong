package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "resume_base")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ResumeBase {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String section;   // 基本信息/教育背景/核心能力/证书/实习/项目/个人优势

    private Boolean isMutable; // 是否随 JD 变化

    @Column(columnDefinition = "TEXT")
    private String content;    // JSON 字符串

    private LocalDateTime updatedAt;

    @PreUpdate
    @PrePersist
    void onSave() {
        updatedAt = LocalDateTime.now();
    }
}
