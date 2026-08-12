package com.cloudbase.config;

import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import io.netty.resolver.DefaultAddressResolverGroup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import reactor.netty.http.client.HttpClient;

import javax.net.ssl.TrustManagerFactory;
import java.security.KeyStore;
import java.util.Locale;

/**
 * WebClient tuning for Windows Mini-PC environments:
 * <ul>
 *   <li>JDK DNS resolver (Netty async DNS often fails on some routers)</li>
 *   <li>Windows certificate store trust (AV SSL inspection like Norton installs a local CA
 *       that browsers trust but Java cacerts does not — causing PKIX path failures to GitHub)</li>
 * </ul>
 */
@Configuration
public class WebClientConfig {

    private static final Logger log = LoggerFactory.getLogger(WebClientConfig.class);

    @Bean
    public WebClientCustomizer jdkDnsWebClientCustomizer() {
        return builder -> {
            HttpClient httpClient = HttpClient.create()
                    .resolver(DefaultAddressResolverGroup.INSTANCE);

            SslContext windowsTrust = tryWindowsTrustSslContext();
            if (windowsTrust != null) {
                httpClient = httpClient.secure(spec -> spec.sslContext(windowsTrust));
                log.info("WebClient SSL: using Windows certificate store (AV/proxy roots trusted)");
            }

            builder.clientConnector(new ReactorClientHttpConnector(httpClient));
        };
    }

    private static SslContext tryWindowsTrustSslContext() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        if (!os.contains("win")) {
            return null;
        }
        try {
            KeyStore windowsRoot = KeyStore.getInstance("Windows-ROOT");
            windowsRoot.load(null, null);
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(windowsRoot);
            return SslContextBuilder.forClient().trustManager(tmf).build();
        } catch (Exception e) {
            log.warn("Could not load Windows-ROOT trust store; falling back to JVM cacerts: {}", e.getMessage());
            return null;
        }
    }
}
