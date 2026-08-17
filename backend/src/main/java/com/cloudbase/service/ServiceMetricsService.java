package com.cloudbase.service;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.ServiceMetricEntity;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.repository.ServiceMetricRepository;
import com.cloudbase.repository.ServiceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Persists CPU/RAM samples so Metrics charts survive beyond the current browser session
 * (up to ~30 days). Cascades away with the service row.
 */
@Service
public class ServiceMetricsService {

    private static final Logger log = LoggerFactory.getLogger(ServiceMetricsService.class);
    /** Keep at most one month; older rows are deleted daily. */
    private static final Duration RETENTION = Duration.ofDays(30);
    private static final int MAX_CHART_POINTS = 180;

    private final ServiceMetricRepository metricRepository;
    private final ServiceRepository serviceRepository;
    private final ContainerRuntimeService containerRuntime;

    public ServiceMetricsService(
            ServiceMetricRepository metricRepository,
            ServiceRepository serviceRepository,
            ContainerRuntimeService containerRuntime
    ) {
        this.metricRepository = metricRepository;
        this.serviceRepository = serviceRepository;
        this.containerRuntime = containerRuntime;
    }

    @Transactional
    public void recordSample(String serviceId, Map<String, Object> live) {
        if (serviceId == null || live == null || !Boolean.TRUE.equals(live.get("available"))) {
            return;
        }
        ServiceMetricEntity row = ServiceMetricEntity.builder()
                .serviceId(serviceId)
                .recordedAt(Instant.now())
                .cpuPercent(asDouble(live.get("cpuPercent")))
                .memoryUsageMb(asDouble(live.get("memoryUsageMb")))
                .memoryLimitMb(asDouble(live.get("memoryLimitMb")))
                .memoryPercent(asDouble(live.get("memoryPercent")))
                .build();
        metricRepository.save(row);
    }

    public List<Map<String, Object>> history(String serviceId, String range) {
        Instant since = Instant.now().minus(rangeToDuration(range));
        List<ServiceMetricEntity> rows = metricRepository
                .findByServiceIdAndRecordedAtGreaterThanEqualOrderByRecordedAtAsc(serviceId, since);
        return downsample(rows, MAX_CHART_POINTS);
    }

    /** Poll RUNNING services every minute so history fills even if nobody has Metrics open. */
    @Scheduled(fixedDelayString = "${cloudbase.metrics.poll-ms:60000}", initialDelayString = "45000")
    public void collectRunningServices() {
        List<ServiceEntity> running = serviceRepository.findByStatus(ServiceStatus.RUNNING);
        for (ServiceEntity service : running) {
            try {
                Map<String, Object> live = containerRuntime.fetchMetrics(service);
                recordSample(service.getId(), live);
            } catch (Exception e) {
                log.debug("metrics collect skip {}: {}", service.getId(), e.toString());
            }
        }
    }

    @Scheduled(cron = "0 20 3 * * *")
    @Transactional
    public void pruneOldSamples() {
        Instant cutoff = Instant.now().minus(RETENTION);
        int deleted = metricRepository.deleteOlderThan(cutoff);
        if (deleted > 0) {
            log.info("Pruned {} service metric samples older than {}", deleted, cutoff);
        }
    }

    private static Duration rangeToDuration(String range) {
        String r = range == null ? "1h" : range.trim().toLowerCase(Locale.ROOT);
        return switch (r) {
            case "6h" -> Duration.ofHours(6);
            case "1d", "24h" -> Duration.ofDays(1);
            case "7d" -> Duration.ofDays(7);
            case "30d" -> Duration.ofDays(30);
            default -> Duration.ofHours(1);
        };
    }

    private static List<Map<String, Object>> downsample(List<ServiceMetricEntity> rows, int maxPoints) {
        if (rows.isEmpty()) {
            return List.of();
        }
        if (rows.size() <= maxPoints) {
            List<Map<String, Object>> out = new ArrayList<>(rows.size());
            for (ServiceMetricEntity row : rows) {
                out.add(toMap(row));
            }
            return out;
        }
        double step = (rows.size() - 1.0) / (maxPoints - 1.0);
        List<Map<String, Object>> out = new ArrayList<>(maxPoints);
        for (int i = 0; i < maxPoints; i++) {
            int idx = (int) Math.round(i * step);
            out.add(toMap(rows.get(Math.min(idx, rows.size() - 1))));
        }
        return out;
    }

    private static Map<String, Object> toMap(ServiceMetricEntity row) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("t", row.getRecordedAt() != null ? row.getRecordedAt().toEpochMilli() : Instant.now().toEpochMilli());
        m.put("cpuPercent", row.getCpuPercent());
        m.put("memoryUsageMb", row.getMemoryUsageMb());
        m.put("memoryLimitMb", row.getMemoryLimitMb());
        m.put("memoryPercent", row.getMemoryPercent());
        return m;
    }

    private static double asDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v == null) {
            return 0;
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
