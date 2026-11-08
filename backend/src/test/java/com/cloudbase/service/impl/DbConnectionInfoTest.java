package com.cloudbase.service.impl;

import com.cloudbase.entity.ProjectEntity;
import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.ServiceSourceType;
import com.cloudbase.model.ServiceStatus;
import com.cloudbase.model.UserRole;
import com.cloudbase.portainer.ComposeGenerator;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.service.ContainerRuntimeService;
import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** What the user is told to connect to must be exactly what the database container was created with. */
class DbConnectionInfoTest {

    private final ServiceRepository services = mock(ServiceRepository.class);
    private final ContainerRuntimeService runtime = mock(ContainerRuntimeService.class);
    private final ComposeGenerator compose = new ComposeGenerator(mock(PlatformSettingsService.class), false);

    private ProjectServiceImpl impl() throws Exception {
        Constructor<?> c = ProjectServiceImpl.class.getConstructors()[0];
        Object[] args = Arrays.stream(c.getParameterTypes()).map(t -> {
            if (t == ServiceRepository.class) return services;
            if (t == ContainerRuntimeService.class) return runtime;
            if (t == ComposeGenerator.class) return compose;
            return mock(t);
        }).toArray();
        return (ProjectServiceImpl) c.newInstance(args);
    }

    private Map<String, String> connectionFor(String name, String dbType, Map<String, Object> extra, String password) throws Exception {
        Map<String, Object> src = new HashMap<>(Map.of("dbType", dbType));
        src.putAll(extra);
        String key = switch (dbType) { case "REDIS" -> "REDIS_PASSWORD"; case "MONGODB" -> "MONGO_PASSWORD"; default -> "DB_PASSWORD"; };
        ServiceEntity db = ServiceEntity.builder().id("svc-db").name(name).sourceType(ServiceSourceType.DATABASE)
                .status(ServiceStatus.RUNNING).sourceDetails(src).quotaMemoryMb(256).quotaCpuMilli(250)
                .envVars(new HashMap<>(Map.of(key, Map.of("value", password, "isSecret", true))))
                .project(ProjectEntity.builder().id("p").ownerId("u1").name("p").build()).build();
        when(services.findById("svc-db")).thenReturn(Optional.of(db));
        when(services.save(any())).thenAnswer(i -> i.getArgument(0));
        when(runtime.resolveLiveStatus(any())).thenReturn(ServiceStatus.RUNNING);
        UserEntity owner = new UserEntity();
        owner.setId("u1");
        owner.setRole(UserRole.USER);
        return impl().getDbConnection("svc-db", owner);
    }

    @Test
    void postgresConnectionMatchesTheSchemaTheContainerCreates() throws Exception {
        Map<String, String> info = connectionFor("my-db", "POSTGRESQL", Map.of(), "pw123");
        assertEquals("my_db", info.get("database"), "the container runs POSTGRES_DB=my_db");
        assertEquals("my-db", info.get("host"));
        assertEquals("postgresql://cbuser:pw123@my-db:5432/my_db", info.get("url"));
        assertEquals("jdbc:postgresql://my-db:5432/my_db", info.get("jdbcUrl"));
        assertEquals("DATABASE_URL=postgresql://cbuser:${{my-db.DB_PASSWORD}}@my-db:5432/my_db", info.get("appVariable"));
    }

    @Test
    void aRenamedDatabaseKeepsItsPinnedAddress() throws Exception {
        Map<String, String> info = connectionFor("Orders", "MYSQL",
                Map.of(ComposeGenerator.DB_NAME_KEY, "shop_db", ComposeGenerator.HOST_NAME_KEY, "shop-db"), "pw");
        assertEquals("mysql://cbuser:pw@shop-db:3306/shop_db", info.get("url"));
        assertEquals("DATABASE_URL=mysql://cbuser:${{shop-db.DB_PASSWORD}}@shop-db:3306/shop_db", info.get("appVariable"),
                "the reference uses the stable host name, not the current display name");
    }

    @Test
    void passwordsWithSpecialCharactersCannotBreakTheUrl() throws Exception {
        Map<String, String> info = connectionFor("cache", "REDIS", Map.of(), "a@b:c/d#e f");
        assertEquals("redis://:a%40b%3Ac%2Fd%23e%20f@cache:6379", info.get("url"));
        assertTrue(info.get("appVariable").startsWith("REDIS_URL=redis://:${{cache.REDIS_PASSWORD}}@cache:6379"));
    }
}
