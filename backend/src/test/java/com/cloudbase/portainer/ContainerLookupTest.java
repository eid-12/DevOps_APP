package com.cloudbase.portainer;

import com.cloudbase.service.PlatformSettingsService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Looking up one service's container asks Docker for that exact name (not a list of every tenant's containers),
 * and still only ever returns the container whose name matches exactly. Captured on a real HTTP server.
 */
class ContainerLookupTest {

    private HttpServer server;
    private final List<String> queries = new ArrayList<>();

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    /** The engine answers with a near-miss name first: the client must not take it. */
    private PortainerClient client(String responseJson) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            String raw = ex.getRequestURI().getRawQuery();
            queries.add(raw == null ? "" : URLDecoder.decode(raw, StandardCharsets.UTF_8));
            byte[] body = responseJson.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.PORTAINER_URL)).thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
        when(settings.get(PlatformSettingsService.PORTAINER_API_KEY)).thenReturn("synthetic");
        when(settings.getInt(eq(PlatformSettingsService.PORTAINER_ENDPOINT_ID), anyInt())).thenReturn(1);
        return new PortainerClient(settings, WebClient.builder());
    }

    @Test
    void asksForTheExactNameAndOnlyAcceptsAnExactMatch() throws IOException {
        PortainerClient c = client("[{\"Id\":\"other\",\"Names\":[\"/cb-svc-a1b2c3d4-x\"]},"
                + "{\"Id\":\"mine\",\"Names\":[\"/cb-svc-a1b2c3d4\"]}]");
        assertEquals("mine", c.findContainerIdByName("cb-svc-a1b2c3d4").block());
        assertEquals(List.of("all=true&filters={\"name\":[\"^/cb-svc-a1b2c3d4$\"]}"), queries);
    }

    @Test
    void anEngineThatIgnoresTheFilterStillCannotHandBackAnotherTenantsContainer() throws IOException {
        PortainerClient c = client("[{\"Id\":\"other\",\"Names\":[\"/cb-svc-zzzz\"]}]");
        assertNull(c.findContainerIdByName("cb-svc-a1b2c3d4").block());
    }
}
