package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ClientIpResolverTest {

    private static MockHttpServletRequest request(String peer) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr(peer);
        return r;
    }

    @Test
    void usesCloudflareClientIpWhenTheRequestCameThroughOurPrivateProxyChain() {
        MockHttpServletRequest r = request("172.18.0.5"); // NPM / nginx on the Docker network
        r.addHeader("CF-Connecting-IP", "203.0.113.7");
        assertEquals("203.0.113.7", ClientIpResolver.resolve(r));
    }

    @Test
    void ignoresClientControlledXForwardedFor() {
        MockHttpServletRequest r = request("172.18.0.5");
        r.addHeader("X-Forwarded-For", "1.2.3.4, 5.6.7.8");
        assertEquals("172.18.0.5", ClientIpResolver.resolve(r));

        r.addHeader("CF-Connecting-IP", "203.0.113.7");
        assertEquals("203.0.113.7", ClientIpResolver.resolve(r));
    }

    @Test
    void doesNotTrustCloudflareHeaderFromAPublicPeer() {
        MockHttpServletRequest r = request("198.51.100.20"); // not one of our proxies
        r.addHeader("CF-Connecting-IP", "203.0.113.7");
        assertEquals("198.51.100.20", ClientIpResolver.resolve(r));
    }

    @Test
    void rejectsMalformedHeaderValues() {
        MockHttpServletRequest r = request("10.0.0.2");
        r.addHeader("CF-Connecting-IP", "evil.example.com");
        assertEquals("10.0.0.2", ClientIpResolver.resolve(r));
    }
}
