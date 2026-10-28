package com.cloudbase.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.InsufficientAuthenticationException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JsonSecurityErrorHandlerTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final JsonSecurityErrorHandler handler = new JsonSecurityErrorHandler(mapper);

    @Test
    void missingOrExpiredTokenIs401JsonSoTheSpaLogsOut() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        handler.commence(new MockHttpServletRequest(), res, new InsufficientAuthenticationException("no token"));

        assertEquals(401, res.getStatus());
        assertTrue(res.getContentType().startsWith("application/json"));
        JsonNode body = mapper.readTree(res.getContentAsString());
        assertEquals(401, body.get("status").asInt());
        assertEquals("unauthorized", body.get("error").asText());
        assertTrue(body.hasNonNull("message"));
        assertTrue(body.hasNonNull("timestamp"));
    }

    @Test
    void nonAdminOnAdminRouteIs403Json() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        handler.handle(new MockHttpServletRequest(), res, new AccessDeniedException("nope"));

        assertEquals(403, res.getStatus());
        JsonNode body = mapper.readTree(res.getContentAsString());
        assertEquals("forbidden", body.get("error").asText());
    }
}
