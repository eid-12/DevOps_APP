package com.cloudbase.config;

import com.cloudbase.github.GitHubOAuthException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Maps domain errors to JSON bodies the Angular client can show.
 * Avoids opaque 500s for expected OAuth failures (expired code, bad secret, …).
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(GitHubOAuthException.class)
    public ResponseEntity<Map<String, Object>> handleGitHubOAuth(GitHubOAuthException ex) {
        if (ex.getStatus().is5xxServerError()) {
            log.warn("GitHub OAuth error [{}]: {}", ex.getErrorCode(), ex.getMessage());
        } else {
            log.info("GitHub OAuth client error [{}]: {}", ex.getErrorCode(), ex.getMessage());
        }
        return ResponseEntity.status(ex.getStatus()).body(errorBody(
                ex.getStatus().value(),
                ex.getErrorCode(),
                ex.getMessage()
        ));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException ex) {
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        if (status == null) {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
        }
        String message = ex.getReason() != null ? ex.getReason() : status.getReasonPhrase();
        // Never leak Spring's "404 NOT_FOUND \"…\"" getMessage() form to clients
        if (message != null && message.matches("(?s)^\\d{3}\\s+[A-Z_]+\\s.*")) {
            int q = message.indexOf('"');
            int q2 = message.lastIndexOf('"');
            if (q >= 0 && q2 > q) {
                message = message.substring(q + 1, q2);
            } else {
                message = status.getReasonPhrase();
            }
        }
        return ResponseEntity.status(status).body(errorBody(
                status.value(),
                status.name().toLowerCase(),
                message
        ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        String details = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(errorBody(
                HttpStatus.BAD_REQUEST.value(),
                "validation_error",
                details.isBlank() ? "Validation failed" : details
        ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(errorBody(
                HttpStatus.BAD_REQUEST.value(),
                "bad_request",
                ex.getMessage() != null ? ex.getMessage() : "Bad request"
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        log.error("Unhandled error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorBody(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "internal_error",
                "An unexpected error occurred"
        ));
    }

    private static Map<String, Object> errorBody(int status, String error, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status);
        body.put("error", error);
        body.put("message", message);
        return body;
    }
}
