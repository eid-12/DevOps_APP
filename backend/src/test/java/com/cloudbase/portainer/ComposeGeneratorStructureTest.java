package com.cloudbase.portainer;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The structured (serializer-based) generator must produce exactly the stacks the previous
 * string-built generator produced (golden files captured from it), and tenant-controlled
 * values must never change the stack's structure.
 */
class ComposeGeneratorStructureTest {

    private static final Set<String> APP_KEYS = Set.of(
            "image", "container_name", "restart", "pull_policy", "command", "labels", "deploy",
            "environment", "volumes", "networks");

    private static ComposeGenerator generator(boolean watchtower) {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.DOCKER_NETWORK)).thenReturn("cloudbase");
        when(settings.get(PlatformSettingsService.VOLUME_ROOT)).thenReturn("/var/lib/cloudbase/users");
        when(settings.get(PlatformSettingsService.DOCKERHUB_NAMESPACE)).thenReturn("minipcer");
        return new ComposeGenerator(settings, watchtower);
    }

    private static Object parse(String yaml) {
        return new Yaml().load(yaml);
    }

    private static String golden(String name) throws Exception {
        try (var in = Objects.requireNonNull(ComposeGeneratorStructureTest.class.getResourceAsStream("/compose-golden/" + name + ".yml"))) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void matchesTheStacksOfThePreviousGeneratorForEverySourceType() throws Exception {
        for (boolean wt : new boolean[]{true, false}) {
            ComposeGenerator g = generator(wt);
            for (Map.Entry<String, ServiceEntity> e : ComposeFixtures.all().entrySet()) {
                String name = e.getKey() + (wt ? "-wt" : "");
                String actual = g.generateCompose(e.getValue(), ComposeFixtures.OWNER, e.getKey().equals("github") ? "abc1234" : null);
                assertEquals(parse(golden(name)), parse(actual), name);
            }
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void hostileValuesNeverChangeTheStackStructure() {
        List<String> hostile = List.of(
                "a\nprivileged: true", "x: y", "# comment", "\"quoted\"", "'single'", "${HOST_SECRET}",
                "- list", "{flow: map}", "[a, b]", "&anchor", "*alias", "!!binary AAAA", "%TAG", "   ", "\t");
        ComposeGenerator g = generator(true);
        for (String value : hostile) {
            for (String field : List.of("name", "imageName", "imageTag", "startCommand", "envKey", "mountPath")) {
                ServiceEntity s = ComposeFixtures.all().get("docker");
                Map<String, Object> src = new LinkedHashMap<>(s.getSourceDetails());
                Map<String, Object> env = new LinkedHashMap<>(s.getEnvVars());
                switch (field) {
                    case "name" -> s.setName(value);
                    case "imageName" -> src.put("imageName", value);
                    case "imageTag" -> src.put("imageTag", value);
                    case "startCommand" -> src.put("startCommand", value);
                    case "envKey" -> env.put(value, Map.of("value", "v", "isSecret", false));
                    case "mountPath" -> s.setVolumeMountPath(value);
                    default -> fail(field);
                }
                s.setSourceDetails(src);
                s.setEnvVars(env);
                String yaml;
                try {
                    yaml = g.generateCompose(s, ComposeFixtures.OWNER, null);
                } catch (IllegalArgumentException | org.springframework.web.server.ResponseStatusException rejected) {
                    continue; // rejected by validation: safe
                }
                Map<String, Object> root = (Map<String, Object>) parse(yaml);
                assertEquals(Set.of("services", "networks"), root.keySet(), field + "=" + value);
                Map<String, Object> services = (Map<String, Object>) root.get("services");
                assertEquals(2, services.size(), field + "=" + value);
                Map<String, Object> app = (Map<String, Object>) services.values().iterator().next();
                assertTrue(APP_KEYS.containsAll(app.keySet()), field + "=" + value + " added keys " + app.keySet());
                assertEquals(List.of("/var/lib/cloudbase/users/u-owner1/proj-1/svc-dock1:" + mountOf(app)), app.get("volumes"),
                        field + "=" + value);
            }
        }
    }

    @Test
    void neverEmitsAnUnlimitedResourceLimit() {
        ComposeGenerator g = generator(false);
        for (int[] q : new int[][]{{0, 500}, {256, 0}, {-1, 250}}) {
            ServiceEntity s = ComposeFixtures.all().get("docker");
            s.setQuotaMemoryMb(q[0]);
            s.setQuotaCpuMilli(q[1]);
            try {
                g.generateCompose(s, ComposeFixtures.OWNER, null);
                fail("generated a stack with memory=" + q[0] + " cpu=" + q[1]);
            } catch (IllegalArgumentException expected) {
                // rejected
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static String mountOf(Map<String, Object> app) {
        String v = ((List<String>) app.get("volumes")).get(0);
        return v.substring(v.indexOf(':') + 1);
    }
}
