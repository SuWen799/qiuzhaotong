-- 秋招通 QiuzhaoHub 数据库初始化
-- 数据库：qiuzhaohub  （手动创建：CREATE DATABASE qiuzhaohub;）
-- 编码：UTF8

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP
);

-- 系统设置表（含 LLM 配置、插件令牌、爬取开关）
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP
);

-- 秋招企业汇总表
CREATE TABLE IF NOT EXISTS companies (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(255),
    type VARCHAR(100),
    industry VARCHAR(100),
    recruit_type VARCHAR(100),
    recruit_target VARCHAR(100),
    apply_url TEXT,
    announce_url TEXT,
    source VARCHAR(100),
    deadline VARCHAR(100),
    crawled_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);

-- 用户投递状态标记
CREATE TABLE IF NOT EXISTS application_status (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL UNIQUE,
    status VARCHAR(50),
    apply_date VARCHAR(50),
    note TEXT,
    updated_at TIMESTAMP
);

-- 每日统计
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date VARCHAR(20),
    new_count INTEGER,
    by_source TEXT
);

-- 基础档案（不变部分 + 可变模块模板）
CREATE TABLE IF NOT EXISTS resume_base (
    id BIGSERIAL PRIMARY KEY,
    section VARCHAR(100) NOT NULL,
    is_mutable BOOLEAN,
    content TEXT,
    updated_at TIMESTAMP
);

-- 简历版本库（串联核心）
CREATE TABLE IF NOT EXISTS resume_versions (
    id BIGSERIAL PRIMARY KEY,
    company VARCHAR(100) NOT NULL,
    job_id VARCHAR(100),
    jd_text TEXT,
    jd_summary TEXT,
    base_snapshot TEXT,
    variable_modules TEXT,
    is_default BOOLEAN,
    md_path VARCHAR(500),
    pdf_path VARCHAR(500),
    match_score INTEGER,
    coverage TEXT,
    created_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_resume_versions_company ON resume_versions(company);

-- 参考素材文件
CREATE TABLE IF NOT EXISTS reference_files (
    id BIGSERIAL PRIMARY KEY,
    category VARCHAR(100),
    filename VARCHAR(255),
    path VARCHAR(500),
    content_hash VARCHAR(64),
    size BIGINT,
    note TEXT,
    uploaded_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reference_files_category ON reference_files(category);
