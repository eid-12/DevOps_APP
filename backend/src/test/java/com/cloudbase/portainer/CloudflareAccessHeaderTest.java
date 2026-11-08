package com.cloudbase.portainer;

import com.cloudbase.npm.NpmClient;
import com.cloudbase.service.PlatformSettingsService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * With a Cloudflare Access service token configured, every call to the admin hosts carries it, so putting Portainer
 * and NPM behind Access does not cut the API off. Without one, no Access headers are sent at all.
 */
class CloudflareAccessHeaderTest {

    private HttpServer server;
    private final List<String> seen = new ArrayList<>();

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private String serve() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            seen.add(ex.getRequestHeaders().getFirst("CF-Access-Client-Id") + "|" + ex.getRequestHeaders().getFirst("CF-Access-Client-Secret"));
            byte[] body = "[]".getBytes();
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private PlatformSettingsService settings(String url, Map<String, String> access) {
        PlatformSettingsService s = mock(PlatformSettingsService.class);
        when(s.get(anyString())).thenReturn("");
        when(s.get(PlatformSettingsService.PORTAINER_URL)).thenReturn(url);
        when(s.get(PlatformSettingsService.NPM_URL)).thenReturn(url);
        when(s.getInt(eq(PlatformSettingsService.PORTAINER_ENDPOINT_ID), anyInt())).thenReturn(1);
        when(s.cloudflareAccessHeaders()).thenReturn(access);
        when(s.getBoolean(PlatformSettingsService.NPM_ENABLED)).thenReturn(true);
        when(s.get(PlatformSettingsService.NPM_EMAIL)).thenReturn("admin@lab.test");
        when(s.get(PlatformSettingsService.NPM_PASSWORD)).thenReturn("synthetic");
        return s;
    }

    @Test
    void portainerAndNpmCallsCarryTheServiceToken() throws IOException {
        String url = serve();
        PlatformSettingsService s = settings(url, Map.of("CF-Access-Client-Id", "id.access", "CF-Access-Client-Secret", "s3cret"));
        new PortainerClient(s, WebClient.builder()).listStacks().block();
        new NpmClient(s, WebClient.builder()).getStatus().onErrorResume(e -> reactor.core.publisher.Mono.empty()).block();
        assertTrue(seen.size() >= 2, seen.toString());
        seen.forEach(h -> assertEquals("id.access|s3cret", h));
    }

    @Test
    void noTokenMeansNoAccessHeaders() throws IOException {
        String url = serve();
        new PortainerClient(settings(url, Map.of()), WebClient.builder()).listStacks().block();
        assertEquals(List.of("null|null"), seen);
    }
}
