package com.cloudbase.security;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Oversized bodies are refused before any controller reads them into memory. */
class RequestSizeLimitFilterTest {

    private final RequestSizeLimitFilter filter = new RequestSizeLimitFilter();

    @Test
    void declaredOversizedWebhookIsRefusedWithoutReachingTheController() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/webhooks/github") {
            @Override
            public long getContentLengthLong() {
                return RequestSizeLimitFilter.MAX_WEBHOOK_BYTES + 1; // as declared by the client
            }
        };
        req.setContent(new byte[16]);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, res, chain);
        assertEquals(413, res.getStatus());
        assertNull(chain.getRequest(), "the controller must never see it");
    }

    @Test
    void anUndeclaredBodyStopsBeingReadAtTheLimit() throws Exception {
        byte[] big = new byte[(int) RequestSizeLimitFilter.MAX_WEBHOOK_BYTES + 10];
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/webhooks/github") {
            @Override
            public long getContentLengthLong() {
                return -1; // chunked: no declared length
            }
        };
        req.setContent(big);
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        HttpServletRequest seen = (HttpServletRequest) chain.getRequest();
        assertThrows(IOException.class, () -> seen.getInputStream().readAllBytes());
    }

    @Test
    void normalBodiesPassUntouched() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("PUT", "/api/projects/p/variables");
        req.setContent("{\"key\":\"A\",\"value\":\"b\"}".getBytes());
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        assertEquals("{\"key\":\"A\",\"value\":\"b\"}",
                new String(((HttpServletRequest) chain.getRequest()).getInputStream().readAllBytes()));
    }
}
