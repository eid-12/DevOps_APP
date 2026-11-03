package com.cloudbase.portainer;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Only a working probe that could not reach the canary counts as protection. */
class TenantIsolationVerifierTest {

    @Test
    void protectedOnlyWhenBlockedAndTheControlWorked() {
        assertEquals(TenantIsolationVerifier.Result.PROTECTED, TenantIsolationVerifier.interpret("BLOCKED\nCONTROL_OK\n").result());
        assertEquals(TenantIsolationVerifier.Result.EXPOSED, TenantIsolationVerifier.interpret("EXPOSED\nCONTROL_OK\n").result());
    }

    @Test
    void aBrokenOrSilentProbeIsNeverProtection() {
        for (String out : new String[]{"BLOCKED\nCONTROL_FAIL\n", "", null, "garbage", "EXPOSED\nCONTROL_FAIL"}) {
            assertEquals(TenantIsolationVerifier.Result.UNVERIFIED, TenantIsolationVerifier.interpret(out).result(), String.valueOf(out));
        }
    }
}
