package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.ResumeBase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ResumeBaseRepository extends JpaRepository<ResumeBase, Long> {
    List<ResumeBase> findBySection(String section);
    ResumeBase findBySectionAndIsMutable(String section, Boolean isMutable);
}
