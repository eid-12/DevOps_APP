package com.cloudbase.portainer;

import com.cloudbase.service.PlatformSettingsService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Docker rejects a container start whose request is sent chunked, even when empty ("starting container with
 * non-empty request body ... removed in v1.24", HTTP 400), which is what a bodiless WebClient POST produces.
 * Start, stop and restart must send a sized body. Captured on a real HTTP server, as the wire sees it.
 */
class ContainerActionRequestTest {

    private HttpServer server;
    private final List<String> seen = new ArrayList<>();

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private PortainerClient client() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            seen.add(ex.getRequestURI().getPath().replaceAll(".*/", "") + " te=" + ex.getRequestHeaders().getFirst("Transfer-Encoding")
                    + " len=" + ex.getRequestHeaders().getFirst("Content-Length") + " body=" + body);
            ex.sendResponseHeaders(204, -1);
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
    void startStopAndRestartSendASizedJsonBody() throws IOException {
        PortainerClient c = client();
        c.startContainer("cb-svc-a").block();
        c.stopContainer("cb-svc-a").block();
        c.restartContainer("cb-svc-a").block();
        assertEquals(List.of("start te=null len=2 body={}", "stop te=null len=2 body={}", "restart te=null len=2 body={}"), seen);
    }
}
