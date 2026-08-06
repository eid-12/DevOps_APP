package com.cloudbase.email;

import com.resend.Resend;
import com.resend.core.exception.ResendException;
import com.resend.services.domains.model.CreateDomainOptions;
import com.resend.services.domains.model.CreateDomainResponse;
import com.resend.services.emails.model.CreateEmailOptions;
import com.resend.services.emails.model.CreateEmailResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class ResendEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger(ResendEmailService.class);

    private final ResendProperties properties;
    private final ObjectProvider<Resend> resendProvider;

    public ResendEmailService(ResendProperties properties, ObjectProvider<Resend> resendProvider) {
        this.properties = properties;
        this.resendProvider = resendProvider;
    }

    @Override
    public boolean isEnabled() {
        return properties.isReady() && resendProvider.getIfAvailable() != null;
    }

    @Override
    public void sendRegistrationPending(String toEmail, String name) {
        send(
                toEmail,
                "CloudBase — email verified",
                """
                <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">
                  <h2>Welcome, %s</h2>
                  <p>Your email is verified — you can <strong>sign in now</strong>.</p>
                  <p>Deployment stays <strong>disabled</strong> until an administrator enables it for your account.</p>
                  <p style="color:#64748b;font-size:13px">CloudBase · private cloud hosting</p>
                </div>
                """.formatted(escape(name))
        );
    }

    @Override
    public void notifyAdminNewRegistration(String userName, String userEmail) {
        String admin = properties.adminNotify();
        if (admin == null || admin.isBlank()) {
            log.info("Skipping admin notify — resend.admin-notify is empty");
            return;
        }
        send(
                admin,
                "CloudBase — new user pending activation",
                """
                <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">
                  <h2>New registration</h2>
                  <p><strong>%s</strong> (&lt;%s&gt;) registered and awaits activation.</p>
                  <p><a href="%s/admin">Open admin panel</a></p>
                </div>
                """.formatted(escape(userName), escape(userEmail), properties.appBaseUrl())
        );
    }

    @Override
    public void sendAccountActivated(String toEmail, String name) {
        send(
                toEmail,
                "CloudBase — account activated",
                """
                <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">
                  <h2>You're in, %s</h2>
                  <p>An administrator activated your CloudBase account. You can sign in and deploy now.</p>
                  <p><a href="%s/auth?mode=login">Sign in to CloudBase</a></p>
                </div>
                """.formatted(escape(name), properties.appBaseUrl())
        );
    }

    @Override
    public void sendPasswordReset(String toEmail, String name, String resetUrl) {
        send(
                toEmail,
                "CloudBase — reset your password",
                """
                <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">
                  <h2>Password reset</h2>
                  <p>Hi %s, click the link below to choose a new password (valid for 30 minutes):</p>
                  <p><a href="%s">Reset password</a></p>
                  <p style="color:#64748b;font-size:13px">If you didn’t request this, you can ignore this email.</p>
                </div>
                """.formatted(escape(name), resetUrl)
        );
    }

    @Override
    public void sendEmailVerificationCode(String toEmail, String name, String code) {
        if (!isEnabled()) {
            log.info("Email verification code for {} ({}): {}", toEmail, name, code);
        }
        send(
                toEmail,
                "CloudBase — your verification code",
                """
                <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">
                  <h2>Verify your email</h2>
                  <p>Hi %s, use this code to confirm your CloudBase account:</p>
                  <p style="font-size:32px;letter-spacing:0.35em;font-weight:700;margin:20px 0">%s</p>
                  <p style="color:#64748b;font-size:13px">The code expires in 15 minutes. If you didn’t sign up, ignore this email.</p>
                </div>
                """.formatted(escape(name), escape(code))
        );
    }

    @Override
    public Map<String, Object> createDomain() {
        Resend resend = requireClient();
        try {
            CreateDomainOptions params = CreateDomainOptions.builder()
                    .name(properties.domain())
                    .build();
            CreateDomainResponse domain = resend.domains().create(params);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", domain.getId());
            result.put("name", domain.getName());
            result.put("status", domain.getStatus());
            result.put("region", domain.getRegion());
            result.put("records", domain.getRecords());
            log.info("Resend domain created: {} ({})", domain.getName(), domain.getId());
            return result;
        } catch (ResendException e) {
            throw new IllegalStateException("Failed to create Resend domain: " + e.getMessage(), e);
        }
    }

    private void send(String to, String subject, String html) {
        if (!isEnabled()) {
            log.info("Email skipped (Resend disabled): to={} subject={}", to, subject);
            return;
        }
        Resend resend = requireClient();
        try {
            CreateEmailOptions params = CreateEmailOptions.builder()
                    .from(properties.from())
                    .to(to)
                    .subject(subject)
                    .html(html)
                    .build();
            CreateEmailResponse data = resend.emails().send(params);
            log.info("Email sent via Resend id={} to={}", data.getId(), to);
        } catch (ResendException e) {
            log.error("Resend send failed to={}: {}", to, e.getMessage());
        }
    }

    private Resend requireClient() {
        Resend resend = resendProvider.getIfAvailable();
        if (resend == null || !properties.isReady()) {
            throw new IllegalStateException("Resend is not configured. Set resend.api-key and resend.enabled=true");
        }
        return resend;
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
