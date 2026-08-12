package com.cloudbase.email;

import java.util.Map;

public interface EmailService {
    void sendRegistrationPending(String toEmail, String name);

    void notifyAdminNewRegistration(String userName, String userEmail);

    void sendAccountActivated(String toEmail, String name);

    /** Admin enabled deployment for this user. */
    void sendDeploymentEnabled(String toEmail, String name);

    void sendPasswordReset(String toEmail, String name, String resetUrl);

    /** 6-digit code to prove the user owns the inbox. */
    void sendEmailVerificationCode(String toEmail, String name, String code);

    /**
     * Send every transactional email template to {@code toEmail} for design QA.
     * @return summary of what was sent
     */
    Map<String, Object> sendPreviewTemplates(String toEmail);

    /** One-time Resend domain registration (DNS records returned). */
    Map<String, Object> createDomain();

    boolean isEnabled();
}
