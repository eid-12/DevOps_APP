package com.cloudbase.service;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.portainer.PortainerClient;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Live container ops via Portainer Docker proxy: logs, exec, stats, lifecycle.
 */
@Service
public class ContainerRuntimeService {

    private static final Duration TIMEOUT = Duration.ofSeconds(45);

    private final PortainerClient portainerClient;
    private final ComposeGenerator composeGenerator;

    public ContainerRuntimeService(PortainerClient portainerClient, ComposeGenerator composeGenerator) {
        this.portainerClient = portainerClient;
        this.composeGenerator = composeGenerator;
    }

    public List<Map<String, Object>> fetchLogs(ServiceEntity service, int tail) {
        String containerId = requireContainerId(service);
        String raw = portainerClient.getContainerLogs(containerId, tail).block(TIMEOUT);
        return parseLogLines(raw == null ? "" : raw);
    }

    public List<String> exec(ServiceEntity service, String command) {
        String cmd = command == null ? "" : command.trim();
        if (cmd.isBlank()) {
            return List.of();
        }
        if ("clear".equalsIgnoreCase(cmd) || "cls".equalsIgnoreCase(cmd)) {
            return List.of("__CLEAR__");
        }
        if ("help".equalsIgnoreCase(cmd)) {
            return List.of(
                    "CloudBase container shell (via Portainer)",
                    "Runs: sh -c \"<command>\" inside " + resolveName(service),
                    "Examples: ls -la · pwd · env · ps aux · cat /etc/os-release",
                    "Built-ins: help · clear"
            );
        }
        String containerId = requireContainerId(service);
        String out = portainerClient.exec(containerId, cmd).block(TIMEOUT);
        if (out == null || out.isBlank()) {
            return List.of("(no output)");
        }
        String[] parts = out.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        List<String> lines = new ArrayList<>();
        for (String p : parts) {
            if (!p.isEmpty() || lines.isEmpty()) {
                lines.add(p);
            }
        }
        if (lines.size() > 1 && lines.get(lines.size() - 1).isEmpty()) {
            lines.remove(lines.size() - 1);
        }
        return lines.isEmpty() ? List.of("(no output)") : lines;
    }

    public Map<String, Object> fetchMetrics(ServiceEntity service) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("serviceId", service.getId());
        result.put("containerName", resolveName(service));
        try {
            String containerId = requireContainerId(service);
            Map<String, Object> stats = portainerClient.getContainerStats(containerId).block(TIMEOUT);
            if (stats == null) {
                result.put("available", false);
                return result;
            }
            result.put("available", true);
            result.putAll(summarizeStats(stats));
        } catch (Exception e) {
            result.put("available", false);
            result.put("error", e.getMessage());
        }
        return result;
    }

    public void stop(ServiceEntity service) {
        String name = resolveName(service);
        portainerClient.findContainerIdByName(name)
                .flatMap(portainerClient::stopContainer)
                .block(TIMEOUT);
    }

    public void restart(ServiceEntity service) {
        String containerId = requireContainerId(service);
        portainerClient.restartContainer(containerId).block(TIMEOUT);
    }

    public void start(ServiceEntity service) {
        String name = resolveName(service);
        portainerClient.findContainerIdByName(name)
                .flatMap(portainerClient::startContainer)
                .block(TIMEOUT);
    }

    private String requireContainerId(ServiceEntity service) {
        String name = resolveName(service);
        String id = portainerClient.findContainerIdByName(name).block(TIMEOUT);
        if (id == null || id.isBlank()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Container not found for " + name + ". Deploy the service first.");
        }
        return id;
    }

    private String resolveName(ServiceEntity service) {
        if (service.getContainerName() != null && !service.getContainerName().isBlank()) {
            return service.getContainerName();
        }
        return composeGenerator.resolveContainerName(service);
    }

    private static List<Map<String, Object>> parseLogLines(String raw) {
        List<Map<String, Object>> lines = new ArrayList<>();
        if (raw == null || raw.isBlank()) return lines;
        String[] parts = raw.replace("\r\n", "\n").replace('\r', '\n').split("\n");
        int i = 0;
        for (String part : parts) {
            if (part.isEmpty()) continue;
            String ts = "";
            String message = part;
            // Docker timestamps: 2024-01-01T12:00:00.000000000Z message
            if (part.length() > 30 && part.charAt(10) == 'T') {
                int sp = part.indexOf(' ');
                if (sp > 0) {
                    ts = part.substring(0, sp);
                    message = part.substring(sp + 1);
                }
            }
            String level = "info";
            String lower = message.toLowerCase(Locale.ROOT);
            if (lower.contains("error") || lower.contains("exception") || lower.contains("fatal")) {
                level = "error";
            } else if (lower.contains("warn")) {
                level = "warn";
            } else if (lower.contains("debug")) {
                level = "debug";
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", "log-" + (++i));
            row.put("timestamp", ts.isBlank() ? java.time.Instant.now().toString() : ts);
            row.put("level", level);
            row.put("message", message);
            lines.add(row);
        }
        return lines;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> summarizeStats(Map<String, Object> stats) {
        Map<String, Object> out = new LinkedHashMap<>();
        double cpuPercent = 0;
        try {
            Map<String, Object> cpuStats = (Map<String, Object>) stats.get("cpu_stats");
            Map<String, Object> preCpu = (Map<String, Object>) stats.get("precpu_stats");
            if (cpuStats != null && preCpu != null) {
                Map<String, Object> cpuUsage = (Map<String, Object>) cpuStats.get("cpu_usage");
                Map<String, Object> preUsage = (Map<String, Object>) preCpu.get("cpu_usage");
                long total = asLong(cpuUsage != null ? cpuUsage.get("total_usage") : null);
                long preTotal = asLong(preUsage != null ? preUsage.get("total_usage") : null);
                long system = asLong(cpuStats.get("system_cpu_usage"));
                long preSystem = asLong(preCpu.get("system_cpu_usage"));
                long cpuDelta = total - preTotal;
                long systemDelta = system - preSystem;
                long online = asLong(cpuStats.get("online_cpus"));
                if (online <= 0 && cpuUsage != null && cpuUsage.get("percpu_usage") instanceof List<?> per) {
                    online = per.size();
                }
                if (systemDelta > 0 && cpuDelta >= 0) {
                    cpuPercent = (cpuDelta * 1.0 / systemDelta) * online * 100.0;
                }
            }
        } catch (Exception ignored) {
            // keep 0
        }

        long memUsage = 0;
        long memLimit = 0;
        try {
            Map<String, Object> mem = (Map<String, Object>) stats.get("memory_stats");
            if (mem != null) {
                memUsage = asLong(mem.get("usage"));
                memLimit = asLong(mem.get("limit"));
            }
        } catch (Exception ignored) {
            // keep 0
        }

        out.put("cpuPercent", Math.round(cpuPercent * 100.0) / 100.0);
        out.put("memoryUsageMb", Math.round(memUsage / (1024.0 * 1024.0) * 10.0) / 10.0);
        out.put("memoryLimitMb", Math.round(memLimit / (1024.0 * 1024.0) * 10.0) / 10.0);
        out.put("memoryPercent", memLimit > 0
                ? Math.round(memUsage * 1000.0 / memLimit) / 10.0
                : 0);
        return out;
    }

    private static long asLong(Object v) {
        if (v == null) return 0L;
        if (v instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(String.valueOf(v));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
