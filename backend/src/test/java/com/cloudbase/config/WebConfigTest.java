package com.cloudbase.config;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WebConfigTest {

    @Test
    void parsesExactOriginsAndTrimsBlanks() {
        assertEquals(
                List.of("https://www.cloudbase.website", "https://cloudbase.website", "http://localhost:4200"),
                WebConfig.parseAllowedOrigins(" https://www.cloudbase.website, https://cloudbase.website ,,http://localhost:4200")
        );
    }

    @Test
    void refusesWildcardsPathsAndEmptyLists() {
        for (String bad : List.of("*", "https://*.cloudbase.website", "https://www.cloudbase.website/app",
                "cloudbase.website", "ftp://cloudbase.website", "", " , ")) {
            assertThrows(IllegalStateException.class, () -> WebConfig.parseAllowedOrigins(bad), bad);
        }
    }
}
