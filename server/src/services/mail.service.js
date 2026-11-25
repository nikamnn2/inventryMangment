/** Purpose: sends e-mails (account activation links) through SMTP, or prints them to the server log when SMTP is not configured. */
import nodemailer from 'nodemailer';

/**
 * Builds the mailer used for activation emails. `send()` resolves to true when the message was
 * handed to the SMTP server, false when SMTP is not configured or sending failed (the caller
 * decides what to tell the user). With no SMTP settings the message is printed to the server log
 * instead, so the activation link is still usable during development.
 */
export function createMailer(config) {
  const configured = !!config.smtpHost;
  const transport = configured
    ? nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    })
    : null;

  return {
    configured,
    /** Checks the SMTP connection and login without sending anything. Resolves to an error message, or null when ready. */
    async verify() {
      if (!transport) return 'SMTP_HOST is empty, so emails are only printed in this log and never sent.';
      try {
        await transport.verify();
        return null;
      } catch (err) {
        return err.message;
      }
    },
    async send({ to, subject, text, html }) {
      if (!transport) {
        console.log(`[mail] SMTP not configured. Would send to ${to}: "${subject}"\n${text}`);
        return false;
      }
      try {
        await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
        return true;
      } catch (err) {
        console.error('[mail] sending failed:', err.message);
        return false;
      }
    },
  };
}

/** Escapes user-supplied text before putting it in the HTML e-mail body. */
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The "activate your account" email. */
export function activationEmail({ name, role, link, company = 'Invenza', hours }) {
  const subject = `Activate your ${company} account`;
  const text = [
    `Hello ${name},`,
    '',
    `You have been added to ${company} as ${role}. Open this link to set your password and activate your account:`,
    link,
    '',
    `The link works for ${hours} hours. If you were not expecting this email, you can ignore it.`,
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(name)},</p>
<p>You have been added to <strong>${escapeHtml(company)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
<p><a href="${escapeHtml(link)}">Set your password and activate your account</a></p>
<p>The link works for ${hours} hours. If you were not expecting this email, you can ignore it.</p>`;
  return { subject, text, html };
}
