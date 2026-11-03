package com.cloudbase.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.naming.NameNotFoundException;
import javax.naming.NamingEnumeration;
import javax.naming.NamingException;
import javax.naming.directory.Attribute;
import javax.naming.directory.Attributes;
import javax.naming.directory.InitialDirContext;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.List;

/**
 * Proof that the requester controls a custom domain: a DNS TXT record
 * {@code _cloudbase-challenge.<domain>} whose value is {@code cloudbase-verify=<token>}.
 */
@Component
public class DomainOwnershipVerifier {

    private static final Logger log = LoggerFactory.getLogger(DomainOwnershipVerifier.class);
    public static final String CHALLENGE_PREFIX = "_cloudbase-challenge.";
    public static final String VALUE_PREFIX = "cloudbase-verify=";

    private final String dnsServer;

    public DomainOwnershipVerifier(@Value("${cloudbase.domains.dns-server:}") String dnsServer) {
        this.dnsServer = dnsServer == null ? "" : dnsServer.trim();
    }

    public static String recordName(String domain) {
        return CHALLENGE_PREFIX + domain;
    }

    public static String recordValue(String token) {
        return VALUE_PREFIX + token;
    }

    /** True when the challenge record carries this token. DNS errors count as "not proven". */
    public boolean proves(String domain, String token) {
        String expected = recordValue(token);
        return txt(recordName(domain)).stream().anyMatch(v -> v.equals(expected));
    }

    List<String> txt(String name) {
        Hashtable<String, String> env = new Hashtable<>();
        env.put("java.naming.factory.initial", "com.sun.jndi.dns.DnsContextFactory");
        env.put("java.naming.provider.url", dnsServer.isEmpty() ? "dns:" : dnsServer);
        env.put("com.sun.jndi.dns.timeout.initial", "2000");
        env.put("com.sun.jndi.dns.timeout.retries", "2");
        List<String> values = new ArrayList<>();
        try {
            Attributes attrs = new InitialDirContext(env).getAttributes(name, new String[]{"TXT"});
            Attribute txt = attrs.get("TXT");
            if (txt == null) {
                return values;
            }
            NamingEnumeration<?> all = txt.getAll();
            while (all.hasMore()) {
                // JNDI returns each TXT record as its strings, quoted when it holds spaces; join and unquote.
                values.add(String.valueOf(all.next()).replace("\" \"", "").replace("\"", "").trim());
            }
        } catch (NameNotFoundException e) {
            return values;
        } catch (NamingException e) {
            log.info("TXT lookup for {} failed: {}", name, e.getMessage());
        }
        return values;
    }
}
