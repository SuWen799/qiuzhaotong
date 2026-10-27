package com.qiuzhaohub.controller;

import com.qiuzhaohub.entity.ApplicationStatus;
import com.qiuzhaohub.entity.Company;
import com.qiuzhaohub.entity.DailyStat;
import com.qiuzhaohub.repository.ApplicationStatusRepository;
import com.qiuzhaohub.repository.CompanyRepository;
import com.qiuzhaohub.repository.DailyStatRepository;
import com.qiuzhaohub.service.CrawlerService;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.persistence.criteria.Predicate;
import java.util.*;

@RestController
@RequestMapping("/companies")
public class CompaniesController {

    private final CompanyRepository companyRepository;
    private final ApplicationStatusRepository applicationStatusRepository;
    private final CrawlerService crawlerService;
    private final DailyStatRepository dailyStatRepository;

    public CompaniesController(CompanyRepository companyRepository, ApplicationStatusRepository applicationStatusRepository,
                               CrawlerService crawlerService, DailyStatRepository dailyStatRepository) {
        this.companyRepository = companyRepository;
        this.applicationStatusRepository = applicationStatusRepository;
        this.crawlerService = crawlerService;
        this.dailyStatRepository = dailyStatRepository;
    }

    // 将竖线 '|' 分隔的多选参数拆成列表（前端 buildParams 用 '|' 拼接）。
    // 不能用逗号：行业等字段的值本身含逗号（如 "机械装备/电气系统,军工/航空航天"），
    // 用逗号会误拆。改用数据里不会出现的 '|' 作分隔符。
    private List<String> splitMulti(String v) {
        if (v == null || v.isBlank()) return Collections.emptyList();
        return Arrays.stream(v.split("\\|"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String keyword,
                                  @RequestParam(required = false) String type,
                                  @RequestParam(required = false) String industry,
                                  @RequestParam(required = false) String recruitTarget,
                                  @RequestParam(required = false) String recruitType,
                                  @RequestParam(required = false) String deadline,
                                  @RequestParam(required = false) String status,
                                  @RequestParam(defaultValue = "date_desc") String sort,
                                  @RequestParam(defaultValue = "1") int page,
                                  @RequestParam(defaultValue = "50") int size) {
        // Sunwz|2026-10-22|改动目的：全局搜索——有关键词时挂起所有筛选维度（用户心智：搜索=全库找公司，
        // 之前关键词与筛选 AND 导致"筛选没勾招满为止就搜不到招满为止的公司"）。
        boolean globalSearch = keyword != null && !keyword.isBlank();
        // 多选筛选：企业性质/行业/招聘类型/招聘对象(届数)/状态/截止时间分类 均为竖线分隔多值
        List<String> types = globalSearch ? Collections.emptyList() : splitMulti(type);
        List<String> industries = globalSearch ? Collections.emptyList() : splitMulti(industry);
        List<String> targets = globalSearch ? Collections.emptyList() : splitMulti(recruitTarget);
        List<String> recruitTypes = globalSearch ? Collections.emptyList() : splitMulti(recruitType);
        List<String> deadlines = globalSearch ? Collections.emptyList() : splitMulti(deadline); // 截止时间分类：招满为止/7天内/8-30天/30天以上/已截止
        List<String> statuses = globalSearch ? Collections.emptyList() : splitMulti(status);

        // 基础条件（不含状态/截止时间分类——这两项是按"分类"匹配，走内存过滤）
        Specification<Company> spec = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (globalSearch)
                ps.add(cb.like(root.get("companyName"), "%" + keyword + "%"));
            // Sunwz|2026-10-22|"其他"/"未知"哨兵额外匹配空值：招聘类型/企业性质/行业为空的行
            // 之前在任何筛选下都不可见（IN 不含空串），典型如婉清源"秋招专场"未被归类的公司。
            if (!types.isEmpty()) {
                if (types.contains("其他"))
                    ps.add(cb.or(root.get("type").in(types), cb.isNull(root.get("type")), cb.equal(root.get("type"), "")));
                else ps.add(root.get("type").in(types));
            }
            if (!industries.isEmpty()) {
                if (industries.contains("未知"))
                    ps.add(cb.or(root.get("industry").in(industries), cb.isNull(root.get("industry")), cb.equal(root.get("industry"), "")));
                else ps.add(root.get("industry").in(industries));
            }
            if (!recruitTypes.isEmpty()) {
                if (recruitTypes.contains("未知"))
                    ps.add(cb.or(root.get("recruitType").in(recruitTypes), cb.isNull(root.get("recruitType")), cb.equal(root.get("recruitType"), "")));
                else ps.add(root.get("recruitType").in(recruitTypes));
            }
            // 招聘对象（届数）：存储为逗号串，多个选中值取「并集(OR)」——任一选中即命中
            if (!targets.isEmpty()) {
                List<Predicate> targetPs = new ArrayList<>();
                for (String t : targets) {
                    targetPs.add(cb.like(root.get("recruitTarget"), "%" + t + "%"));
                }
                ps.add(cb.or(targetPs.toArray(new Predicate[0])));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };

        Sort s;
        // Sunwz|2026-10-21|改动目的：date_desc/date_asc 原来排的是 crawledAt（爬取时间），
        // 导致前端「发布日期 新→旧」实际不按发布时间排。改为按 publishDate（公告真实发布时间）排序，
        // crawledAt 作同日并列时的次级排序。publish_date 为 ISO 日期字符串，字典序即时间序。
        switch (sort) {
            case "date_asc" -> s = Sort.by(Sort.Order.asc("publishDate"), Sort.Order.asc("crawledAt"));
            case "name_asc" -> s = Sort.by("companyName").ascending();
            case "name_desc" -> s = Sort.by("companyName").descending();
            case "deadline_asc" -> s = Sort.by("deadline").ascending();
            case "deadline_desc" -> s = Sort.by("deadline").descending();
            default -> s = Sort.by(Sort.Order.desc("publishDate"), Sort.Order.desc("crawledAt"));
        }

        // 投递状态映射（公司ID -> 状态）；无状态记录或状态为空，统一视作「未投递」
        Map<Long, String> statusByCompany = new HashMap<>();
        for (ApplicationStatus a : applicationStatusRepository.findAll()) {
            String st = a.getStatus();
            statusByCompany.put(a.getCompanyId(), (st == null || st.isBlank()) ? "未投递" : st);
        }

        // 当带"状态"或"截止时间分类"筛选时，取出基础条件全量后在内存按分类过滤（与旧版 filterRecords 语义一致）
        boolean needMemFilter = !statuses.isEmpty() || !deadlines.isEmpty();
        if (needMemFilter) {
            List<Company> allMatched = companyRepository.findAll(spec, Sort.unsorted());
            List<Company> filtered = allMatched.stream().filter(c -> {
                // 截止时间分类匹配（空截止时间也归入"招满为止"，对齐旧版 getDeadlineDays）
                if (!deadlines.isEmpty()) {
                    if (!deadlines.contains(deadlineCategory(c.getDeadline()))) return false;
                }
                // 投递状态匹配
                if (!statuses.isEmpty()) {
                    if (!statuses.contains(statusByCompany.getOrDefault(c.getId(), "未投递"))) return false;
                }
                return true;
            }).toList();
            List<Company> sorted = sortCompanies(filtered, s);
            long total = sorted.size();
            int from = Math.max(0, (page - 1) * size);
            int to = Math.min(sorted.size(), from + size);
            List<Company> content = from < sorted.size() ? sorted.subList(from, to) : Collections.emptyList();
            return ResponseEntity.ok(Map.of(
                    "content", content,
                    "total", total,
                    "page", page,
                    "size", size));
        }

        Pageable pageable = PageRequest.of(Math.max(0, page - 1), size, s);
        Page<Company> result = companyRepository.findAll(spec, pageable);
        return ResponseEntity.ok(Map.of(
                "content", result.getContent(),
                "total", result.getTotalElements(),
                "page", page,
                "size", size));
    }

    // 截止时间分类（复刻旧版 getDeadlineDays：无日期/招满为止 -> 招满为止；负天数 -> 已截止；<=7 -> 7天内；<=30 -> 8-30天；其余 -> 30天以上）
    private String deadlineCategory(String dl) {
        if (dl == null || dl.isBlank() || dl.contains("招满")) return "招满为止";
        java.time.LocalDate d;
        try {
            d = java.time.LocalDate.parse(dl);
        } catch (Exception e) {
            return "招满为止";
        }
        long days = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.now(), d);
        if (days < 0) return "已截止";
        if (days <= 7) return "7天内";
        if (days <= 30) return "8-30天";
        return "30天以上";
    }

    // 内存排序（仅用于状态过滤后的全量结果）
    private List<Company> sortCompanies(List<Company> list, Sort s) {
        List<Company> copy = new ArrayList<>(list);
        Sort.Order order = s.iterator().hasNext() ? s.iterator().next() : null;
        if (order == null) return copy;
        String prop = order.getProperty();
        boolean asc = order.isAscending();
        copy.sort((a, b) -> {
            int cmp;
            switch (prop) {
                case "companyName" -> cmp = nullToEmpty(a.getCompanyName()).compareTo(nullToEmpty(b.getCompanyName()));
                case "deadline" -> cmp = nullToEmpty(a.getDeadline()).compareTo(nullToEmpty(b.getDeadline()));
                // 发布日期排序（与 SQL 路径一致：publishDate 为主键序，crawledAt 破并列）
                case "publishDate" -> {
                    cmp = nullToEmpty(a.getPublishDate()).compareTo(nullToEmpty(b.getPublishDate()));
                    if (cmp == 0) {
                        if (a.getCrawledAt() == null && b.getCrawledAt() == null) cmp = 0;
                        else if (a.getCrawledAt() == null) cmp = 1;
                        else if (b.getCrawledAt() == null) cmp = -1;
                        else cmp = a.getCrawledAt().compareTo(b.getCrawledAt());
                    }
                }
                default -> {
                    // crawledAt 降序优先（默认）
                    if (a.getCrawledAt() == null) cmp = b.getCrawledAt() == null ? 0 : 1;
                    else if (b.getCrawledAt() == null) cmp = -1;
                    else cmp = a.getCrawledAt().compareTo(b.getCrawledAt());
                    return asc ? cmp : -cmp;
                }
            }
            return asc ? cmp : -cmp;
        });
        return copy;
    }

    private String nullToEmpty(String v) { return v == null ? "" : v; }

    @GetMapping("/stats")
    public ResponseEntity<?> stats() {
        long total = companyRepository.count();
        Map<String, Long> byType = new LinkedHashMap<>();
        Map<String, Long> byIndustry = new LinkedHashMap<>();
        Map<String, Long> byRecruitType = new LinkedHashMap<>();
        Map<String, Long> byRecruitTypeSplit = new LinkedHashMap<>(); // 招聘类型（逗号拆分，单类别计数，供固定5项带个数）
        Map<String, Long> byRecruitTarget = new LinkedHashMap<>(); // 招聘对象/届数（逗号拆分统计）
        Map<String, Long> byDeadline = new LinkedHashMap<>();       // 截止时间分类
        java.time.LocalDate now = java.time.LocalDate.now();
        for (Company c : companyRepository.findAll()) {
            String t = c.getType() == null || c.getType().isBlank() ? "其他" : c.getType();
            byType.put(t, byType.getOrDefault(t, 0L) + 1);
            String ind = c.getIndustry() == null || c.getIndustry().isBlank() ? "未知" : c.getIndustry();
            byIndustry.put(ind, byIndustry.getOrDefault(ind, 0L) + 1);
            String rt = c.getRecruitType() == null || c.getRecruitType().isBlank() ? "未知" : c.getRecruitType();
            byRecruitType.put(rt, byRecruitType.getOrDefault(rt, 0L) + 1);
            // 招聘类型按逗号拆分，单类别计数（避免"实习,秋招"这类脏项，保证固定5项各有正确个数）
            for (String seg : rt.split(",")) {
                String segTrim = seg.trim();
                if (!segTrim.isEmpty())
                    byRecruitTypeSplit.put(segTrim, byRecruitTypeSplit.getOrDefault(segTrim, 0L) + 1);
            }
            // 招聘对象（届数）按逗号拆分
            String target = c.getRecruitTarget() == null ? "" : c.getRecruitTarget();
            for (String seg : target.split(",")) {
                String segTrim = seg.trim();
                if (!segTrim.isEmpty())
                    byRecruitTarget.put(segTrim, byRecruitTarget.getOrDefault(segTrim, 0L) + 1);
            }
            // 截止时间分类（对齐旧版：7天内/8-30天/30天以上/已截止/招满为止）
            String dl = c.getDeadline() == null ? "" : c.getDeadline();
            String cat;
            if (dl.isEmpty() || dl.contains("招满")) cat = "招满为止";
            else {
                java.time.LocalDate d;
                try { d = java.time.LocalDate.parse(dl); } catch (Exception e) { d = null; }
                if (d == null) cat = "招满为止";
                else {
                    long days = java.time.temporal.ChronoUnit.DAYS.between(now, d);
                    if (days < 0) cat = "已截止";
                    else if (days <= 7) cat = "7天内";
                    else if (days <= 30) cat = "8-30天";
                    else cat = "30天以上";
                }
            }
            byDeadline.put(cat, byDeadline.getOrDefault(cat, 0L) + 1);
        }
        Map<String, Long> byStatus = new LinkedHashMap<>();
        // 投递日期映射（公司名 -> 投递日期），供投递统计图表使用
        Map<String, String> byDate = new LinkedHashMap<>();
        Map<String, Integer> deliveryByDate = new LinkedHashMap<>();
        for (ApplicationStatus a : applicationStatusRepository.findAll()) {
            String st = a.getStatus() == null ? "" : a.getStatus();
            byStatus.put(st, byStatus.getOrDefault(st, 0L) + 1);
            String name = a.getCompanyName();
            if (name != null && a.getApplyDate() != null && !a.getApplyDate().isBlank()) {
                byDate.put(name, a.getApplyDate());
                // 投递分布应覆盖所有「已投递」衍生状态（已投递/已笔试/已面试/已挂/已offer），
                // 只要保留有投递日期，都计入该日期的投递量
                if (Arrays.asList("已投递", "已笔试", "已面试", "已挂", "已offer").contains(st)) {
                    deliveryByDate.put(a.getApplyDate(), deliveryByDate.getOrDefault(a.getApplyDate(), 0) + 1);
                }
            }
        }
        return ResponseEntity.ok(Map.of(
                "total", total,
                "byType", byType,
                "byIndustry", byIndustry,
                "byRecruitType", byRecruitType,
                "byRecruitTypeSplit", byRecruitTypeSplit,
                "byRecruitTarget", byRecruitTarget,
                "byDeadline", byDeadline,
                "byStatus", byStatus,
                "byDate", byDate,
                "deliveryByDate", deliveryByDate));
    }

    // 已投递公司列表（含投递后状态），供投递统计页「已投递公司」表格使用
    @GetMapping("/delivered")
    public ResponseEntity<?> delivered() {
        List<String> active = List.of("已投递", "已笔试", "已面试", "已挂", "已offer");
        Map<String, ApplicationStatus> statusMap = new LinkedHashMap<>();
        for (ApplicationStatus a : applicationStatusRepository.findAll()) {
            if (a.getStatus() != null && active.contains(a.getStatus())) {
                statusMap.put(a.getCompanyName(), a);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Company c : companyRepository.findAll()) {
            ApplicationStatus a = statusMap.get(c.getCompanyName());
            if (a == null) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("companyName", c.getCompanyName());
            m.put("type", c.getType());
            m.put("industry", c.getIndustry());
            m.put("recruitTarget", c.getRecruitTarget());
            m.put("recruitType", c.getRecruitType());
            m.put("deadline", c.getDeadline());
            m.put("applyUrl", c.getApplyUrl());
            m.put("announceUrl", c.getAnnounceUrl());
            m.put("status", a.getStatus());
            m.put("applyDate", a.getApplyDate());
            out.add(m);
        }
        // 按投递日期倒序
        out.sort((x, y) -> {
            String dx = (String) x.get("applyDate");
            String dy = (String) y.get("applyDate");
            if (dx == null) dx = "";
            if (dy == null) dy = "";
            return dy.compareTo(dx);
        });
        return ResponseEntity.ok(out);
    }

    // Sunwz|2026-08-22|改动目的：首页状态回填专用接口——返回全部有状态记录（含"不投递"），
    // 避免 /delivered 仅返回活跃状态导致切到"不投递"后刷新被兜底成"未投递"。
    @GetMapping("/statuses")
    public ResponseEntity<?> allStatuses() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (ApplicationStatus a : applicationStatusRepository.findAll()) {
            if (a.getStatus() == null) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("companyId", a.getCompanyId());
            m.put("companyName", a.getCompanyName());
            m.put("status", a.getStatus());
            m.put("applyDate", a.getApplyDate());
            m.put("note", a.getNote());
            out.add(m);
        }
        return ResponseEntity.ok(out);
    }

    @GetMapping("/daily")
    public ResponseEntity<?> daily() {
        try {
            // 复刻旧版 calcDailyFromMerged：按发布日期分组计数（过滤无效/未来日期），按日期升序
            java.time.LocalDate today = java.time.LocalDate.now();
            Map<String, Integer> dateCount = new TreeMap<>();
            for (Company c : companyRepository.findAll()) {
                String d = c.getPublishDate();
                if (d == null || !d.matches("^\\d{4}-\\d{2}-\\d{2}$")) continue;
                if (d.compareTo(today.toString()) > 0) continue; // 未来日期忽略
                dateCount.put(d, dateCount.getOrDefault(d, 0) + 1);
            }
            List<Map<String, Object>> daily = new ArrayList<>();
            for (Map.Entry<String, Integer> e : dateCount.entrySet()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("date", e.getKey());
                m.put("count", e.getValue());
                daily.add(m);
            }
            // 统计卡片所需：唯一公司数 + 趋势总记录 + 日均新增 + 今日新增
            int total = (int) companyRepository.count();
            int trendTotal = daily.stream().mapToInt(m -> (Integer) m.get("count")).sum();
            int avg = daily.isEmpty() ? 0 : (int) Math.round((double) trendTotal / daily.size());
            String todayStr = today.toString();
            int todayNew = dateCount.getOrDefault(todayStr, 0);
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("total", total);
            summary.put("trendTotal", trendTotal);
            summary.put("avg", avg);
            summary.put("todayNew", todayNew);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("daily", daily);
            result.put("summary", summary);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("daily", Collections.emptyList(), "summary", Collections.emptyMap()));
        }
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<?> setStatus(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        ApplicationStatus as = applicationStatusRepository.findByCompanyId(id);
        if (as == null) as = ApplicationStatus.builder().companyId(id).build();
        // 自动填充投递日期：状态变为「已投递」且没有日期时，记录今天
        String status = (String) body.get("status");
        String applyDate = (String) body.get("applyDate");
        Company company = companyRepository.findById(id).orElse(null);
        if (company != null) as.setCompanyName(company.getCompanyName());
        // DB 旧值：若 as 已从库里加载则为持久化值；新建记录（findByCompanyId 返回 null）则为 null
        String existingDate = as.getApplyDate();
        String effectiveApplyDate;
        if ("已投递".equals(status) && (existingDate == null || existingDate.isBlank())) {
            // a) 新记录/无日期 + 变为已投递 → 自动写今天
            effectiveApplyDate = java.time.LocalDate.now().toString();
        } else if ("__CLEAR__".equals(applyDate)) {
            // 显式清空指令
            effectiveApplyDate = null;
        } else if ("未投递".equals(status)) {
            // c) 状态改为未投递 → 清空
            effectiveApplyDate = null;
        } else if (applyDate != null && !applyDate.isBlank()) {
            // 前端显式传了非空值 → 使用之（覆盖）
            effectiveApplyDate = applyDate;
        } else {
            // b/d/e) 前端未传或传 null → 保留 DB 旧值（已锁定，不被误传的 null 覆盖），DB 也无则保持 null
            effectiveApplyDate = existingDate;
        }
        as.setStatus(status);
        as.setApplyDate(effectiveApplyDate);
        as.setNote((String) body.get("note"));
        applicationStatusRepository.save(as);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PostMapping("/status/fix-missing-apply-dates")
    public ResponseEntity<?> fixMissingApplyDates() {
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, String>> fixed = new ArrayList<>();
        List<String> noLegacyDate = new ArrayList<>();
        int alreadyOk = 0;
        try {
            // 读取 legacy 数据源：秋招官网汇总 user_data.json 的 dates 字段
            String legacyPath = "C:\\Users\\你的Windows用户名\\Desktop\\秋招文件\\秋招官网汇总\\campus-recruitment\\data\\user_data.json";
            Map<String, String> legacyDates = new HashMap<>();
            try {
                java.nio.file.Path p = java.nio.file.Paths.get(legacyPath);
                if (java.nio.file.Files.exists(p)) {
                    String raw = java.nio.file.Files.readString(p);
                    com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
                    Map<String, Object> root = om.readValue(raw, Map.class);
                    Object datesObj = root.get("dates");
                    if (datesObj instanceof Map) {
                        for (Map.Entry<?, ?> e : ((Map<?, ?>) datesObj).entrySet()) {
                            if (e.getValue() != null) {
                                legacyDates.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                            }
                        }
                    }
                }
            } catch (Exception ex) {
                // legacy 读取失败不应中断，仅导致所有记录 noLegacyDate
                noLegacyDate.add("__legacy_read_error__:" + ex.getMessage());
            }
            List<ApplicationStatus> missing = applicationStatusRepository.findMissingApplyDate();
            for (ApplicationStatus as : missing) {
                String name = as.getCompanyName();
                String legacyDate = name != null ? legacyDates.get(name) : null;
                if (legacyDate != null && !legacyDate.isBlank()) {
                    as.setApplyDate(legacyDate);
                    applicationStatusRepository.save(as);
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("companyName", name);
                    m.put("date", legacyDate);
                    fixed.add(m);
                } else {
                    if (name != null) noLegacyDate.add(name);
                }
            }
            // 统计 alreadyOk：已投递类状态且已有日期的记录数（粗略按全表估算）
            result.put("fixed", fixed);
            result.put("alreadyOk", alreadyOk);
            result.put("noLegacyDate", noLegacyDate);
            result.put("legacyTotal", legacyDates.size());
            result.put("scanned", missing.size());
        } catch (Exception e) {
            result.put("error", e.getMessage());
            result.put("fixed", fixed);
            result.put("noLegacyDate", noLegacyDate);
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/crawl")
    // Sunwz|2026-09-01|改动目的：原默认 live=false 只做历史合并（刷新永远显示"历史数据"）。
    // 实时爬取现已可用（autumn2027/feishu 真实抓取成功，fq 失败会优雅降级），"刷新数据"应默认走实时。
    public ResponseEntity<?> crawl(@RequestParam(required = false, defaultValue = "true") boolean live) {
        // Sunwz|2026-09-01|修复：防并发——后端也检查 running 状态，避免重复触发导致 status 混乱
        Map<String, Object> st = crawlerService.getStatus();
        if (Boolean.TRUE.equals(st.get("running"))) {
            return ResponseEntity.accepted().body(Map.of("success", true, "message", "爬取任务已在运行中，请勿重复触发", "ignored", true));
        }
        crawlerService.triggerCrawl(live);
        return ResponseEntity.ok(Map.of("success", true, "message", "爬取任务已触发（live=" + live + "）"));
    }

    @GetMapping("/crawl/status")
    public ResponseEntity<?> crawlStatus() {
        return ResponseEntity.ok(crawlerService.getStatus());
    }
}
