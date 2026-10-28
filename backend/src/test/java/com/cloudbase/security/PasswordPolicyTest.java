package com.cloudbase.security;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PasswordPolicyTest {

    @Test
    void acceptsWhatTheSpaAccepts() {
        assertDoesNotThrow(() -> PasswordPolicy.require("Passw0rd!long"));
        assertDoesNotThrow(() -> PasswordPolicy.require("Aa1@aaaa"));
    }

    @Test
    void rejectsWeakPasswordsWith400() {
        for (String weak : List.of("a", "Aa1@aaa", "alllowercase1!", "ALLUPPER1!", "NoDigits!!", "NoSpecial11")) {
            ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> PasswordPolicy.require(weak), weak);
            assertEquals(400, ex.getStatusCode().value());
        }
        assertThrows(ResponseStatusException.class, () -> PasswordPolicy.require(null));
    }
}
