package com.cloudbase.service.impl;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AuthServiceImplEmailTest {

    @Test
    void newAccountEmailsAreTrimmedAndLowercased() {
        assertEquals("carol@e2e.test", AuthServiceImpl.normalizeEmail("  Carol@E2E.Test "));
        assertEquals("", AuthServiceImpl.normalizeEmail(null));
    }
}
