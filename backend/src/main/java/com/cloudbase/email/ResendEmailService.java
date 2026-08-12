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

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
        String body = """
                <p style="margin:0 0 12px;font-size:16px;color:#0f172a">Hi %s,</p>
                <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6">
                  Your email is verified - you can <strong>sign in</strong> to CloudBase now.
                </p>
                <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6">
                  Creating and deploying projects stays locked until an administrator approves deployment for your account. We'll email you as soon as you're cleared.
                </p>
                %s
                """.formatted(
                escape(name),
                cta(properties.appBaseUrl() + "/auth?mode=login", "Sign in to CloudBase")
        );
        send(toEmail, "CloudBase - email verified", wrap("Welcome", "You're verified", body));
    }

    @Override
    public void notifyAdminNewRegistration(String userName, String userEmail) {
        String admin = properties.adminNotify();
        if (admin == null || admin.isBlank()) {
            log.info("Skipping admin notify - resend.admin-notify is empty");
            return;
        }
        String body = """
                <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6">
                  <strong>%s</strong> (&lt;%s&gt;) just verified their email and is waiting for deployment approval.
                </p>
                %s
                """.formatted(
                escape(userName),
                escape(userEmail),
                cta(properties.appBaseUrl() + "/admin", "Review in admin")
        );
        send(admin, "CloudBase - new user awaiting approval", wrap("Admin alert", "New registration", body));
    }

    @Override
    public void sendAccountActivated(String toEmail, String name) {
        String body = """
                <p style="margin:0 0 12px;font-size:16px;color:#0f172a">Hi %s,</p>
                <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6">
                  An administrator marked your CloudBase account as <strong>active</strong>. You can sign in and explore the platform.
                </p>
                %s
                """.formatted(
                escape(name),
                cta(properties.appBaseUrl() + "/auth?mode=login", "Sign in to CloudBase")
        );
        send(toEmail, "CloudBase - account activated", wrap("Account", "Account activated", body));
    }

    @Override
    public void sendDeploymentEnabled(String toEmail, String name) {
        String body = """
                <p style="margin:0 0 12px;font-size:16px;color:#0f172a">Good news, %s.</p>
                <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6">
                  An administrator enabled <strong>deployment</strong> for your account. You're cleared to create projects, add services, and ship to your private cloud.
                </p>
                <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6">
                  Open your dashboard to get started - Free plan limits apply to RAM, CPU, storage, and monthly deploys.
                </p>
                %s
                """.formatted(
                escape(name),
                cta(properties.appBaseUrl() + "/dashboard", "Open dashboard")
        );
        send(toEmail, "CloudBase - you're ready to deploy", wrap("Deploy access", "Deployment unlocked", body));
    }

    @Override
    public void sendPasswordReset(String toEmail, String name, String resetUrl) {
        String body = """
                <p style="margin:0 0 12px;font-size:16px;color:#0f172a">Hi %s,</p>
                <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6">
                  We received a request to reset your CloudBase password. This link is valid for
                  <strong>30 minutes</strong>.
                </p>
                %s
                <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.5">
                  If you didn't ask for this, you can safely ignore this email - your password won't change.
                </p>
                """.formatted(escape(name), cta(resetUrl, "Reset password"));
        send(toEmail, "CloudBase - reset your password", wrap("Security", "Password reset", body));
    }

    @Override
    public void sendEmailVerificationCode(String toEmail, String name, String code) {
        if (!isEnabled()) {
            log.info("Email verification code for {} ({}): {}", toEmail, name, code);
        }
        String body = """
                <p style="margin:0 0 12px;font-size:16px;color:#0f172a">Hi %s,</p>
                <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6">
                  Use this code to confirm your CloudBase account:
                </p>
                <div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,#4f46e5 0%%,#7c3aed 55%%,#6366f1 100%%);border-radius:12px;text-align:center">
                  <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;letter-spacing:0.28em;font-weight:700;color:#f8fafc">%s</span>
                </div>
                <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5">
                  Expires in 15 minutes. If you didn't sign up, ignore this email.
                </p>
                """.formatted(escape(name), escape(code));
        send(toEmail, "CloudBase - your verification code", wrap("Verify email", "Confirm your address", body));
    }

    @Override
    public Map<String, Object> sendPreviewTemplates(String toEmail) {
        String target = toEmail == null || toEmail.isBlank() ? properties.adminNotify() : toEmail.trim();
        if (target == null || target.isBlank()) {
            throw new IllegalArgumentException("No destination email - pass ?to= or set resend.admin-notify");
        }
        String demoUrl = properties.appBaseUrl() + "/auth/reset-password?token=preview-demo-token";
        List<String> sent = new ArrayList<>();

        sendPasswordReset(target, "Eid", demoUrl);
        sent.add("password-reset");

        sendEmailVerificationCode(target, "Eid", "482913");
        sent.add("verification-code");

        sendRegistrationPending(target, "Eid");
        sent.add("welcome-verified");

        sendAccountActivated(target, "Eid");
        sent.add("account-activated");

        sendDeploymentEnabled(target, "Eid");
        sent.add("deployment-enabled");

        notifyAdminNewRegistration("Eid Rawaf", target);
        sent.add("admin-new-registration");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("to", target);
        result.put("templates", sent);
        result.put("count", sent.size());
        return result;
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

    private static String wrap(String eyebrow, String title, String bodyHtml) {
        // Brand tokens aligned with frontend/src/styles.scss
        // --bg #020617 - --primary #6366f1 - --violet #8b5cf6 - --primary-light #a5b4fc
        return """
                <!DOCTYPE html>
                <html lang="en">
                <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
                <body style="margin:0;padding:0;background:#e8eaf6">
                  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#e8eaf6;padding:28px 12px">
                    <tr><td align="center">
                      <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(99,102,241,0.22)">
                        <tr>
                          <td style="padding:22px 28px;background:#020617;background-image:linear-gradient(135deg,#020617 0%%,#0d1526 55%%,#1e1b4b 100%%)">
                            <table role="presentation" width="100%%" cellspacing="0" cellpadding="0">
                              <tr>
                                <td style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#f8fafc;letter-spacing:-0.02em">
                                  Cloud<span style="color:#a5b4fc">Base</span>
                                </td>
                                <td align="right" style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:#a5b4fc;text-transform:uppercase;letter-spacing:0.08em">
                                  %s
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:28px 28px 8px;font-family:Segoe UI,Helvetica,Arial,sans-serif">
                            <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700">%s</h1>
                            %s
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:8px 28px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif">
                            <div style="margin-top:20px;padding-top:18px;border-top:1px solid rgba(99,102,241,0.16)">
                              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5">
                                CloudBase - private cloud hosting<br>
                                This message was sent by an automated system.
                              </p>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td></tr>
                  </table>
                </body>
                </html>
                """.formatted(escape(eyebrow), escape(title), bodyHtml);
    }

    private static String cta(String href, String label) {
        return """
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0">
                  <tr>
                    <td style="border-radius:10px;background:#6366f1;background-image:linear-gradient(135deg,#4f46e5 0%%,#7c3aed 50%%,#6366f1 100%%)">
                      <a href="%s" style="display:inline-block;padding:12px 22px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">
                        %s
                      </a>
                    </td>
                  </tr>
                </table>
                """.formatted(href, escape(label));
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
            throw new IllegalStateException("Failed to send email: " + e.getMessage(), e);
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
