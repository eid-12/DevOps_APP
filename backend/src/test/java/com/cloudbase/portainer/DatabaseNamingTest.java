package com.cloudbase.portainer;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/** The host and schema name shown to users must be exactly what the database container is given. */
class DatabaseNamingTest {

    private final ComposeGenerator generator = new ComposeGenerator(mock(PlatformSettingsService.class), false);

    private static ServiceEntity postgres(String name, Map<String, Object> extra) {
        Map<String, Object> src = new HashMap<>(Map.of("dbType", "POSTGRESQL"));
        src.putAll(extra);
        ServiceEntity s = ServiceEntity.builder().id("svc-db1").name(name).sourceType(ServiceSourceType.DATABASE)
                .sourceDetails(src).quotaMemoryMb(256).quotaCpuMilli(250)
                .project(ProjectEntity.builder().id("proj-1").ownerId("u-1").name("p").build()).build();
        s.setContainerName("cb-svc-db1");
        return s;
    }

    @Test
    void hyphenatedNameGetsAnUnderscoreSchemaAndTheComposeAgrees() {
        ServiceEntity db = postgres("my-db", Map.of());
        assertEquals("my_db", ComposeGenerator.databaseName(db));
        assertEquals("my-db", ComposeGenerator.serviceHostName(db));
        String compose = generator.generateCompose(db, "u-1");
        assertTrue(compose.contains("POSTGRES_DB: my_db"), compose);
        assertTrue(compose.contains("\n  my-db:\n"), compose);
    }

    @Test
    void pinnedNamesSurviveARename() {
        ServiceEntity db = postgres("Orders Store", Map.of(ComposeGenerator.DB_NAME_KEY, "my_db",
                ComposeGenerator.HOST_NAME_KEY, "my-db"));
        assertEquals("my_db", ComposeGenerator.databaseName(db));
        assertEquals("my-db", ComposeGenerator.serviceHostName(db));
        String compose = generator.generateCompose(db, "u-1");
        assertTrue(compose.contains("POSTGRES_DB: my_db"), compose);
        assertTrue(compose.contains("\n  my-db:\n"), compose);
    }

    @Test
    void malformedPinnedValuesFallBackToTheSanitizedName() {
        ServiceEntity db = postgres("orders", Map.of(ComposeGenerator.DB_NAME_KEY, "x; DROP TABLE",
                ComposeGenerator.HOST_NAME_KEY, "evil:\n  privileged: true"));
        assertEquals("orders", ComposeGenerator.databaseName(db));
        assertEquals("orders", ComposeGenerator.serviceHostName(db));
        assertTrue(!generator.generateCompose(db, "u-1").contains("privileged"));
    }
}
