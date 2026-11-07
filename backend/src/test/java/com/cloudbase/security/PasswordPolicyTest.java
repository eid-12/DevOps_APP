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

    @Test
    void capsAtBcryptsSeventyTwoBytes() {
        String base = "Aa1@";
        assertDoesNotThrow(() -> PasswordPolicy.require(base + "a".repeat(68)));
        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> PasswordPolicy.require(base + "a".repeat(69)));
        assertEquals(400, ex.getStatusCode().value());
        // 2-byte characters count by bytes, not chars: 4 + 35*2 = 74 bytes in 39 chars.
        assertThrows(ResponseStatusException.class, () -> PasswordPolicy.require(base + "é".repeat(35)));
    }
}
