package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "resume_versions")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ResumeVersion {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String company;    // 原版/华为/小米/字节...（仅公司名，不含岗位）

    @Column(name = "job_title")
    private String jobTitle;   // 岗位名（可空；非空时参与输出文件名）

    private String jobId;
    @Column(columnDefinition = "TEXT")
    private String jdText;
    @Column(columnDefinition = "TEXT")
    private String jdSummary;

    @Column(columnDefinition = "TEXT")
    private String baseSnapshot;   // 生成时基础档案快照 JSON

    @Column(columnDefinition = "TEXT")
    private String variableModules; // 可变模块 JSON（实习/项目/核心能力）

    private Boolean isDefault;     // 原版=true

    private String mdPath;
    private String pdfPath;

    private Integer matchScore;    // 匹配度
    @Column(columnDefinition = "TEXT")
    private String coverage;       // JSON

    private LocalDateTime createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
