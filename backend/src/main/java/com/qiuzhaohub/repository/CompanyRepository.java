package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.Company;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface CompanyRepository extends JpaRepository<Company, Long>, JpaSpecificationExecutor<Company> {

    java.util.Optional<Company> findByCompanyNameAndApplyUrl(String companyName, String applyUrl);

    java.util.List<Company> findByCompanyName(String companyName);
}
