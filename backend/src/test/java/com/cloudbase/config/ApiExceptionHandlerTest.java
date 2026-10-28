package com.cloudbase.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ApiExceptionHandlerTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @Test
    void springClientErrorsKeepTheir4xxStatus() {
        assertEquals(404, handler.handleGeneric(new NoResourceFoundException(HttpMethod.GET, "api/nope")).getStatusCode().value());
        assertEquals(405, handler.handleGeneric(new HttpRequestMethodNotSupportedException("DELETE")).getStatusCode().value());
        assertEquals(415, handler.handleGeneric(new HttpMediaTypeNotSupportedException("text/plain")).getStatusCode().value());
    }

    @Test
    void malformedJsonIs400NotInternalError() {
        ResponseEntity<Map<String, Object>> res = handler.handleUnreadableRequest(
                new HttpMessageNotReadableException("bad json", new MockHttpInputMessage(new byte[0])));
        assertEquals(400, res.getStatusCode().value());
        assertEquals("bad_request", res.getBody().get("error"));
    }

    @Test
    void unexpectedErrorsStay500WithoutLeakingDetails() {
        ResponseEntity<Map<String, Object>> res = handler.handleGeneric(new IllegalStateException("db password=secret"));
        assertEquals(500, res.getStatusCode().value());
        assertEquals("An unexpected error occurred", res.getBody().get("message"));
    }
}
