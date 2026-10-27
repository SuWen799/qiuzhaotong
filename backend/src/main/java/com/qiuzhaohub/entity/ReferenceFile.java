package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "reference_files")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReferenceFile {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String category;   // 实习/项目/核心能力/原版母本
    private String filename;
    private String path;       // 绝对路径
    private String contentHash;
    private Long size;
    private String note;
    private LocalDateTime uploadedAt;

    @PrePersist
    void onCreate() {
        if (uploadedAt == null) uploadedAt = LocalDateTime.now();
    }
}
