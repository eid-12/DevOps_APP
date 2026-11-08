package com.cloudbase.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Caps request bodies before anything reads them into memory. Neither Spring nor Tomcat limits a JSON body, and the
 * public webhook reads its whole body to check the signature, so without this one large request could exhaust memory.
 * A declared Content-Length over the limit is refused at once (413); a chunked body stops being read at the limit.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    /** Largest legitimate API body: 200 variables of up to 32 KB each, plus JSON overhead. */
    static final long MAX_API_BYTES = 8L * 1024 * 1024;
    /** GitHub workflow_run deliveries are tens of KB; anything this large is not a deploy event. */
    static final long MAX_WEBHOOK_BYTES = 5L * 1024 * 1024;

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        long limit = request.getRequestURI().startsWith("/api/webhooks/") ? MAX_WEBHOOK_BYTES : MAX_API_BYTES;
        long declared = request.getContentLengthLong();
        if (declared > limit) {
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType("application/json");
            response.getOutputStream().write(("{\"status\":413,\"error\":\"payload_too_large\",\"message\":"
                    + "\"Request body is too large\"}").getBytes(StandardCharsets.UTF_8));
            return;
        }
        chain.doFilter(new LimitedRequest(request, limit), response);
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {
        private final long limit;
        private ServletInputStream stream;

        LimitedRequest(HttpServletRequest request, long limit) {
            super(request);
            this.limit = limit;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                ServletInputStream in = super.getInputStream();
                stream = new ServletInputStream() {
                    private long read;

                    private void count(long n) throws IOException {
                        if (n > 0 && (read += n) > limit) {
                            throw new IOException("Request body exceeds " + limit + " bytes");
                        }
                    }

                    @Override
                    public int read() throws IOException {
                        int b = in.read();
                        if (b >= 0) count(1);
                        return b;
                    }

                    @Override
                    public int read(byte[] buf, int off, int len) throws IOException {
                        int n = in.read(buf, off, len);
                        count(n);
                        return n;
                    }

                    @Override
                    public boolean isFinished() {
                        return in.isFinished();
                    }

                    @Override
                    public boolean isReady() {
                        return in.isReady();
                    }

                    @Override
                    public void setReadListener(ReadListener listener) {
                        in.setReadListener(listener);
                    }
                };
            }
            return stream;
        }

        @Override
        public java.io.BufferedReader getReader() throws IOException {
            return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream(),
                    getCharacterEncoding() == null ? StandardCharsets.UTF_8.name() : getCharacterEncoding()));
        }
    }
}
