package com.qiuzhaohub.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "companies")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Company {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String companyName;
    private String type;          // 企业性质
    private String industry;      // 行业
    private String recruitType;   // 招聘类型
    private String recruitTarget; // 招聘对象
    private String applyUrl;      // 投递链接
    private String announceUrl;   // 公告链接
    private String source;        // 数据来源
    private String deadline;      // 截止时间
    private String publishDate;   // 发布日期（用于趋势统计，对齐旧版）
    private LocalDateTime crawledAt;
}
