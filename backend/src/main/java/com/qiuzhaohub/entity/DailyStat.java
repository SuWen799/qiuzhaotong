package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "daily_stats")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DailyStat {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String statDate;   // yyyy-MM-dd

    private Integer newCount;

    @Column(columnDefinition = "TEXT")
    private String bySource;   // JSON
}
