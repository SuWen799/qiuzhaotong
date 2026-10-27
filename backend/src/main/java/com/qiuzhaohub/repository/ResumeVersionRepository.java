package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.ResumeVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ResumeVersionRepository extends JpaRepository<ResumeVersion, Long> {
    List<ResumeVersion> findAllByOrderByCreatedAtDesc();
    Optional<ResumeVersion> findByCompany(String company);
    Optional<ResumeVersion> findByCompanyAndIsDefaultTrue(String company);
}
