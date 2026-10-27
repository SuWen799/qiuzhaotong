package com.qiuzhaohub.repository;

import com.qiuzhaohub.entity.DailyStat;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DailyStatRepository extends JpaRepository<DailyStat, Long> {
}
