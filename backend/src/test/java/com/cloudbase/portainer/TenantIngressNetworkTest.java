package com.cloudbase.portainer;

import com.cloudbase.service.PlatformSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A project network is created and (for apps) joined by the proxy; a network holding platform containers is
 * refused; a stalled Portainer fails the preparation within its bound instead of leaving a deploy running.
 */
class TenantIngressNetworkTest {

    @Test
    void aStalledPortainerFailsWithinTheBound() {
        PortainerClient c = client(call -> null);
        c.networkPrepareTimeout = java.time.Duration.ofMillis(300);
        long started = System.nanoTime();
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> c.ensureProjectNetwork("project-p1", "nginx-proxy", true).block(java.time.Duration.ofSeconds(5)));
        assertTrue(e.getMessage().contains("Timed out") && e.getMessage().contains("nothing was deployed"), e.getMessage());
        assertTrue(System.nanoTime() - started < 3_000_000_000L);
    }

    private final List<String> calls = new ArrayList<>();

    private PortainerClient client(Function<String, ClientResponse> responder) {
        PlatformSettingsService settings = mock(PlatformSettingsService.class);
        when(settings.get(PlatformSettingsService.PORTAINER_URL)).thenReturn("http://portainer.test");
        when(settings.get(PlatformSettingsService.PORTAINER_API_KEY)).thenReturn("synthetic");
        when(settings.getInt(eq(PlatformSettingsService.PORTAINER_ENDPOINT_ID), anyInt())).thenReturn(3);
        WebClient.Builder builder = WebClient.builder().exchangeFunction(req -> {
            String call = req.method() + " " + req.url().getPath();
            calls.add(call);
            ClientResponse response = responder.apply(call);
            return response == null ? Mono.never() : Mono.just(response);
        });
        return new PortainerClient(settings, builder);
    }

    private static ClientResponse json(String body) {
        return ClientResponse.create(HttpStatus.OK).header("Content-Type", "application/json").body(body).build();
    }

    private static String network(String... members) {
        StringBuilder c = new StringBuilder();
        for (int i = 0; i < members.length; i++) {
            c.append(i == 0 ? "" : ",").append("\"id").append(i).append("\":{\"Name\":\"").append(members[i]).append("\"}");
        }
        return "{\"Name\":\"project-p1\",\"Containers\":{" + c + "}}";
    }

    @Test
    void createsTheNetworkAndConnectsTheProxyWhenMissing() {
        boolean[] created = {false};
        PortainerClient c = client(call -> switch (call) {
            case "GET /api/endpoints/3/docker/networks/project-p1" ->
                    created[0] ? json(network()) : ClientResponse.create(HttpStatus.NOT_FOUND).build();
            case "POST /api/endpoints/3/docker/networks/create" -> { created[0] = true; yield json("{\"Id\":\"n1\"}"); }
            case "POST /api/endpoints/3/docker/networks/project-p1/connect" -> json("{}");
            default -> ClientResponse.create(HttpStatus.INTERNAL_SERVER_ERROR).build();
        });
        c.ensureProjectNetwork("project-p1", "nginx-proxy", true).block();
        assertEquals(List.of(
                "GET /api/endpoints/3/docker/networks/project-p1",
                "POST /api/endpoints/3/docker/networks/create",
                "GET /api/endpoints/3/docker/networks/project-p1",
                "POST /api/endpoints/3/docker/networks/project-p1/connect"), calls);
    }

    @Test
    void readyNetworkNeedsNoChanges() {
        PortainerClient c = client(call -> json(network("nginx-proxy", "cb-svc-a", "cb-wt-svc-a")));
        c.ensureProjectNetwork("project-p1", "nginx-proxy", true).block();
        assertEquals(List.of("GET /api/endpoints/3/docker/networks/project-p1"), calls);
    }

    @Test
    void databaseDeploysDoNotJoinTheProxy() {
        PortainerClient c = client(call -> json(network("cb-svc-db")));
        c.ensureProjectNetwork("project-p1", "nginx-proxy", false).block();
        assertEquals(List.of("GET /api/endpoints/3/docker/networks/project-p1"), calls);
    }

    @Test
    void refusesANetworkThatAlsoHoldsPlatformContainers() {
        PortainerClient c = client(call -> json(network("nginx-proxy", "cloudbase-postgres", "portainer", "cb-svc-a")));
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> c.ensureProjectNetwork("project-p1", "nginx-proxy", true).block());
        assertTrue(e.getMessage().contains("cloudbase-postgres") && e.getMessage().contains("portainer"), e.getMessage());
        assertEquals(1, calls.size(), "nothing is connected to a refused network");
    }
}
