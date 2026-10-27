package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.ApplicationStatus;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApplicationStatusRepository extends JpaRepository<ApplicationStatus, Long> {
    ApplicationStatus findByCompanyId(Long companyId);

    @org.springframework.data.jpa.repository.Query(
        value = "SELECT a FROM ApplicationStatus a WHERE a.status IN ('已投递','已笔试','已面试','已挂','已offer') " +
                "AND (a.applyDate IS NULL OR a.applyDate = '')")
    java.util.List<ApplicationStatus> findMissingApplyDate();
}
