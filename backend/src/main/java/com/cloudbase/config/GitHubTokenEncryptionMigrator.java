package com.cloudbase.config;

import com.cloudbase.security.TokenCipher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Encrypts GitHub tokens that are still stored as plaintext (from before encryption at rest). Idempotent: only rows
 * without the {@link TokenCipher#PREFIX} are touched, each update is conditional on the value it read.
 */
@Component
public class GitHubTokenEncryptionMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(GitHubTokenEncryptionMigrator.class);

    private final JdbcTemplate jdbc;
    private final TokenCipher cipher;

    public GitHubTokenEncryptionMigrator(JdbcTemplate jdbc, TokenCipher cipher) {
        this.jdbc = jdbc;
        this.cipher = cipher;
    }

    @Override
    public void run(ApplicationArguments args) {
        var rows = jdbc.queryForList("select id, github_access_token from users "
                + "where github_access_token is not null and github_access_token <> '' "
                + "and github_access_token not like 'enc:v1:%'");
        int done = 0;
        for (var row : rows) {
            String plain = (String) row.get("github_access_token");
            done += jdbc.update("update users set github_access_token = ? where id = ? and github_access_token = ?",
                    cipher.encrypt(plain), row.get("id"), plain);
        }
        if (done > 0) {
            log.info("Encrypted {} stored GitHub token(s) at rest", done);
        }
    }
}
