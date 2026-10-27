package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "application_status", uniqueConstraints = @UniqueConstraint(columnNames = "company_id"))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApplicationStatus {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long companyId;

    private String companyName;

    private String status;    // 未投/已投/面试中/Offer/拒
    private String applyDate;
    @Column(columnDefinition = "TEXT")
    private String note;

    private LocalDateTime updatedAt;

    @PreUpdate
    @PrePersist
    void onSave() {
        updatedAt = LocalDateTime.now();
    }
}
