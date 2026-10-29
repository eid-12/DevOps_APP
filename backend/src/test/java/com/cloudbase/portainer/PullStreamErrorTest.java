package com.cloudbase.portainer;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** Docker returns HTTP 200 for failed pulls and reports the failure inside the JSON stream. */
class PullStreamErrorTest {

    @Test
    void successfulPullStreamHasNoError() {
        String ok = "{\"status\":\"Pulling from tenant/app\",\"id\":\"abc1234\"}\n"
                + "{\"status\":\"Digest: sha256:aaaa\"}\n"
                + "{\"status\":\"Status: Downloaded newer image for ghcr.io/tenant/app:abc1234\"}\n";
        assertNull(PortainerClient.pullStreamError(ok));
    }

    @Test
    void deniedPullIsReportedAsAnError() {
        String denied = "{\"status\":\"Pulling from tenant/app\"}\n"
                + "{\"errorDetail\":{\"message\":\"denied\"},\"error\":\"Head \\\"https://ghcr.io/v2/tenant/app/manifests/abc1234\\\": denied\"}\n";
        assertEquals("Head \"https://ghcr.io/v2/tenant/app/manifests/abc1234\": denied", PortainerClient.pullStreamError(denied));
        String plain = "{\"error\":\"unauthorized: authentication required\"}";
        assertEquals("unauthorized: authentication required", PortainerClient.pullStreamError(plain));
    }

    @Test
    void emptyOrTruncatedStreamsCannotAuthorizeUseOfACachedPrivateImage() {
        for (String body : new String[]{"", "\n", "{}", "null", "{\"status\":\"Pulling from tenant/app\"}\n",
                "{\"status\":\"Digest: sha256:aaaa\"}\n", "not-json"}) {
            assertNotNull(PortainerClient.pullStreamError(body), body);
        }
    }

    @Test
    void aConfirmedUpToDateImageIsSuccessful() {
        assertNull(PortainerClient.pullStreamError(
                "{\"status\":\"Status: Image is up to date for ghcr.io/tenant/app:abc1234\"}\n"));
    }

    @Test
    void errorDetailWithoutTopLevelErrorStillFails() {
        assertEquals("denied", PortainerClient.pullStreamError("{\"errorDetail\":{\"message\":\"denied\"}}"));
    }
}
