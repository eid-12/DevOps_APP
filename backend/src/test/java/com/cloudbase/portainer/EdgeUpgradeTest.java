package com.cloudbase.portainer;

import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** An edge built from an older pinned image is replaced once; a current one, or none at all, is left alone. */
class EdgeUpgradeTest {

    private final PortainerClient portainer = mock(PortainerClient.class);
    private final EdgeRouter edge = new EdgeRouter(portainer, "cloudbase-edge", "cloudbase-edge", "nginx-proxy");

    private static Map<String, Object> container(Map<String, String> labels) {
        return Map.of("Name", "/cloudbase-edge", "Config", Map.of("Labels", labels)); // inspect format
    }

    @Test
    void anEdgeFromAnOlderImageIsRetired() {
        when(portainer.findContainer("cloudbase-edge")).thenReturn(Mono.just(container(Map.of("cloudbase.role", "edge"))));
        when(portainer.removeContainer("cloudbase-edge")).thenReturn(Mono.empty());
        assertTrue(edge.retireIfOutdated().block());
        verify(portainer).removeContainer("cloudbase-edge");
    }

    @Test
    void anEdgeOnTheCurrentImageIsKept() {
        when(portainer.findContainer("cloudbase-edge")).thenReturn(Mono.just(container(
                Map.of("cloudbase.role", "edge", EdgeRouter.IMAGE_LABEL, EdgeRouter.imageRef()))));
        assertFalse(edge.retireIfOutdated().block());
        verify(portainer, never()).removeContainer("cloudbase-edge");
    }

    @Test
    void noEdgeMeansNothingToRetire() {
        when(portainer.findContainer("cloudbase-edge")).thenReturn(Mono.empty());
        assertFalse(edge.retireIfOutdated().block());
    }
}
