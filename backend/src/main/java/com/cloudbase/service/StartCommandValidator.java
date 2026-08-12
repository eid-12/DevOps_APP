package com.cloudbase.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Hardens user-supplied container start commands.
 * <p>
 * Strategy: never run via {@code sh -c}. Tokenize into argv, allowlist the binary,
 * reject shell metacharacters / path traversal / dangerous tools. Compose uses exec form.
 */
public final class StartCommandValidator {

    public static final int MAX_LENGTH = 400;
    public static final int MAX_TOKENS = 32;

    private static final Pattern SAFE_TOKEN = Pattern.compile("^[a-zA-Z0-9._/=:+@%,\\-]+$");
    /** Quoted args may include spaces and a trailing semicolon (nginx -g "daemon off;"). */
    private static final Pattern SAFE_QUOTED = Pattern.compile("^[a-zA-Z0-9._/=:+@%,\\-; ]+$");

    private static final Set<String> ALLOWED_BINARIES = Set.of(
            "java", "python", "python3", "node", "npm", "npx", "yarn", "pnpm",
            "nginx", "httpd", "apache2-foreground", "dotnet", "php", "php-fpm",
            "uvicorn", "gunicorn", "streamlit", "pip", "pip3"
    );

    private static final Set<String> DENIED_TOKENS = Set.of(
            "sudo", "su", "doas", "chmod", "chown", "chroot", "mkfs", "mount", "umount",
            "docker", "podman", "kubectl", "crictl", "nsenter", "unshare",
            "curl", "wget", "nc", "ncat", "netcat", "socat", "ssh", "scp", "sftp", "ftp",
            "bash", "sh", "zsh", "fish", "csh", "dash", "busybox",
            "eval", "exec", "source", "perl", "ruby", "lua", "powershell", "pwsh",
            "apt", "apt-get", "apk", "yum", "dnf", "pacman", "brew",
            "rm", "dd", "mkfifo", "iptables", "nft", "systemctl", "service"
    );

    private StartCommandValidator() {
    }

    public record ValidatedStartCommand(String normalized, List<String> argv) {
    }

    /**
     * @param raw user input (may be blank → empty optional result)
     * @return validated command, or null if blank (means “use image default”)
     */
    public static ValidatedStartCommand validateOrNull(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty() || "null".equalsIgnoreCase(trimmed)) {
            return null;
        }
        return validateRequired(trimmed);
    }

    public static ValidatedStartCommand validateRequired(String raw) {
        if (raw == null || raw.isBlank()) {
            throw reject("Start command is empty");
        }
        String cmd = raw.trim();
        if (cmd.length() > MAX_LENGTH) {
            throw reject("Start command is too long (max " + MAX_LENGTH + " characters)");
        }
        if (containsControlOrNewlines(cmd)) {
            throw reject("Start command must be a single line without control characters");
        }
        // Block obvious shell / expansion attempts early
        if (cmd.indexOf('`') >= 0 || cmd.indexOf('$') >= 0 || cmd.contains("$(") || cmd.contains("${")) {
            throw reject("Shell expansions ($ `) are not allowed in start command");
        }
        if (cmd.indexOf('|') >= 0 || cmd.indexOf('&') >= 0 || cmd.indexOf('>') >= 0 || cmd.indexOf('<') >= 0) {
            throw reject("Shell operators (| & < >) are not allowed");
        }
        if (cmd.indexOf('\\') >= 0) {
            throw reject("Backslashes are not allowed in start command");
        }

        List<String> argv = tokenize(cmd);
        if (argv.isEmpty()) {
            throw reject("Start command is empty");
        }
        if (argv.size() > MAX_TOKENS) {
            throw reject("Too many arguments (max " + MAX_TOKENS + ")");
        }

        for (String token : argv) {
            validateToken(token);
        }
        validateBinary(argv.get(0));

        return new ValidatedStartCommand(joinForStorage(argv), List.copyOf(argv));
    }

    /** Persist a safe, normalized form (quote tokens that need it). */
    public static String sanitizeForStorage(String raw) {
        ValidatedStartCommand v = validateOrNull(raw);
        return v == null ? null : v.normalized();
    }

    private static void validateBinary(String binary) {
        String b = binary.toLowerCase(Locale.ROOT);
        if (DENIED_TOKENS.contains(b)) {
            throw reject("Binary not allowed: " + binary);
        }
        if (ALLOWED_BINARIES.contains(b)) {
            return;
        }
        // App binaries only under /app/… or ./app (no host paths)
        if (b.startsWith("/app/") || b.equals("/app/app") || b.equals("./app") || b.equals("app")) {
            if (b.contains("..")) {
                throw reject("Path traversal is not allowed");
            }
            return;
        }
        throw reject(
                "Start binary must be a known runtime (java, python, node, nginx, …) "
                        + "or a path under /app/. Got: " + binary
        );
    }

    private static void validateToken(String token) {
        if (token.isEmpty()) {
            throw reject("Empty argument in start command");
        }
        String lower = token.toLowerCase(Locale.ROOT);
        if (DENIED_TOKENS.contains(lower)) {
            throw reject("Argument not allowed: " + token);
        }
        if (token.contains("..")) {
            throw reject("Path traversal (..) is not allowed");
        }
        // Block absolute paths outside /app (except the binary check already handled /app)
        if (token.startsWith("/") && !token.startsWith("/app/") && !token.equals("/app/app")) {
            // Allow common jar/workdir under /app only; flags like -Xmx don't start with /
            throw reject("Only paths under /app/ are allowed: " + token);
        }
        if (token.startsWith("-")) {
            // JVM / CLI flags: -Xmx512m, -jar, --host, -g, -m
            if (!SAFE_TOKEN.matcher(token).matches()) {
                throw reject("Unsafe flag: " + token);
            }
            return;
        }
        // Unquoted-style content after tokenization (quotes already stripped)
        if (!SAFE_QUOTED.matcher(token).matches()) {
            throw reject("Unsafe characters in argument: " + token);
        }
        // Semicolon only for nginx-style short directives, not command chaining
        if (token.indexOf(';') >= 0) {
            String compact = token.replace(" ", "").toLowerCase(Locale.ROOT);
            if (!compact.equals("daemonoff;") && !compact.endsWith("off;")) {
                throw reject("Semicolon is only allowed in simple nginx directives like \"daemon off;\"");
            }
        }
    }

    private static List<String> tokenize(String cmd) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        Character quote = null;
        for (int i = 0; i < cmd.length(); i++) {
            char c = cmd.charAt(i);
            if (quote != null) {
                if (c == quote) {
                    quote = null;
                } else {
                    cur.append(c);
                }
                continue;
            }
            if (c == '"' || c == '\'') {
                quote = c;
                continue;
            }
            if (Character.isWhitespace(c)) {
                if (!cur.isEmpty()) {
                    out.add(cur.toString());
                    cur.setLength(0);
                }
                continue;
            }
            // Bare semicolon = shell chaining
            if (c == ';') {
                throw reject("Bare ';' is not allowed (put nginx args in quotes, e.g. -g \"daemon off;\")");
            }
            if (c == '(' || c == ')' || c == '{' || c == '}' || c == '[' || c == ']'
                    || c == '!' || c == '?' || c == '*' || c == '~' || c == '#') {
                throw reject("Character '" + c + "' is not allowed in start command");
            }
            cur.append(c);
        }
        if (quote != null) {
            throw reject("Unclosed quote in start command");
        }
        if (!cur.isEmpty()) {
            out.add(cur.toString());
        }
        return out;
    }

    private static String joinForStorage(List<String> argv) {
        StringBuilder sb = new StringBuilder();
        for (String t : argv) {
            if (!sb.isEmpty()) {
                sb.append(' ');
            }
            if (t.indexOf(' ') >= 0 || t.indexOf(';') >= 0) {
                sb.append('"').append(t.replace("\"", "")).append('"');
            } else {
                sb.append(t);
            }
        }
        return sb.toString();
    }

    private static boolean containsControlOrNewlines(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\n' || c == '\r' || c == '\0' || c < 0x20 && c != '\t') {
                return true;
            }
            if (c == '\t') {
                return true; // force spaces only
            }
        }
        return false;
    }

    private static ResponseStatusException reject(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
