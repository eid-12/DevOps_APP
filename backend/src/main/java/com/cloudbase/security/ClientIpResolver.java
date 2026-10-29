package com.cloudbase.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.InetAddress;
import java.util.regex.Pattern;

/**
 * The client IP for rate limiting.
 *
 * <p>Production traffic is Cloudflare -> tunnel -> NPM (-> nginx) -> API; the API is never published on a
 * host port, so its socket peer is always one of our proxies on a private network. Cloudflare sets
 * {@code CF-Connecting-IP} itself (overwriting any client value), so it is trusted only when the request
 * came from such a private peer. {@code X-Forwarded-For} is never used: its leftmost entries are whatever
 * the client sent, which would let an attacker rotate or spoof IPs to dodge or abuse a limit.
 */
public final class ClientIpResolver {

    static final String CF_CONNECTING_IP = "CF-Connecting-IP";
    private static final Pattern IP_LITERAL = Pattern.compile("^[0-9a-fA-F:.]{2,45}$");

    private ClientIpResolver() {
    }

    public static String current() {
        var attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes sra) {
            return resolve(sra.getRequest());
        }
        return "unknown";
    }

    public static String resolve(HttpServletRequest request) {
        String peer = request.getRemoteAddr();
        String cf = request.getHeader(CF_CONNECTING_IP);
        if (cf != null && IP_LITERAL.matcher(cf.trim()).matches() && isPrivatePeer(peer)) {
            return cf.trim();
        }
        return peer == null || peer.isBlank() ? "unknown" : peer;
    }

    /** Loopback, link-local or RFC1918/ULA address: one of our proxies, not an internet client. */
    static boolean isPrivatePeer(String address) {
        if (address == null || !IP_LITERAL.matcher(address).matches()) {
            return false;
        }
        try {
            InetAddress a = InetAddress.getByName(address); // literal only (validated above): no DNS lookup
            if (a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()) {
                return true;
            }
            byte[] b = a.getAddress();
            return b.length == 16 && (b[0] & 0xfe) == 0xfc; // IPv6 unique-local fc00::/7
        } catch (Exception e) {
            return false;
        }
    }
}
