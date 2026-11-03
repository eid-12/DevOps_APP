package com.cloudbase.portainer;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The edge only routes known tenant hosts to tenant containers, listens on :80, and serves only its network. */
class EdgeRouterTest {

    @Test
    void routeTableKeepsOnlyValidTenantRoutes() {
        Map<String, String> routes = new LinkedHashMap<>();
        routes.put("cloudbase1234.cloudbase.website", "cb-svc-a1:8080");
        routes.put("App.Example.COM", "cb-svc-b2:80");
        routes.put("evil.test; include /etc/passwd", "cb-svc-a1:80");
        routes.put("admin.example.com", "nginx-proxy:81");
        routes.put("db.example.com", "cloudbase-postgres:5432");
        assertEquals("app.example.com cb-svc-b2:80;\ncloudbase1234.cloudbase.website cb-svc-a1:8080;\n",
                EdgeRouter.routeTable(routes));
    }

    @Test
    void configListensOnlyOnPort80AndAllowsOnlyTheEdgeNetwork() {
        String script = EdgeRouter.startScript("10.77.0.0/24");
        String b64 = script.replaceAll("(?s).*printf %s (\\S+) \\| base64.*", "$1");
        String conf = new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
        assertTrue(conf.contains("listen 80;") && !conf.matches("(?s).*listen (?!80;).*"), conf);
        assertTrue(conf.contains("allow 10.77.0.0/24;\n  deny all;"), conf);
        assertTrue(conf.contains("return 421"), "unknown hosts are not forwarded");
    }
}
