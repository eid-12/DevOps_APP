package com.cloudbase.config;

import com.cloudbase.github.GitHubOAuthException;
import com.cloudbase.github.GitHubOAuthProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(GitHubOAuthProperties.class)
public class GitHubOAuthConfig {
}
