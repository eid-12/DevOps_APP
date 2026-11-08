package com.cloudbase.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/** Tenant apps share the platform's domain, so names that impersonate the platform must not be claimable. */
class VanitySlugReservationTest {

    private final VanitySubdomainService service = new VanitySubdomainService(null, null, null, null);

    @Test
    void platformAndInfrastructureNamesAreRefused() {
        for (String slug : new String[] {"www", "api", "admin", "portainer", "mawrid"}) {
            assertNotNull(service.validateSlugOrNull(slug), slug);
        }
    }

    @Test
    void lookAlikesOfThePlatformAreRefused() {
        for (String slug : new String[] {"cloudbase1234", "cloudbase99", "cloudbase-login", "login-cloudbase",
                "mycloudbase", "c1oudbase-auth", "cloud-base", "signin", "verify", "password", "accounts"}) {
            assertNotNull(service.validateSlugOrNull(slug), slug);
        }
    }

    @Test
    void ordinaryNamesAreAllowed() {
        for (String slug : new String[] {"my-shop", "blog", "acme-api", "cloud-notes"}) {
            assertNull(service.validateSlugOrNull(slug), slug);
        }
    }
}
