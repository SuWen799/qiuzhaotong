package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.ReferenceFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReferenceFileRepository extends JpaRepository<ReferenceFile, Long> {
    List<ReferenceFile> findByCategory(String category);
}
