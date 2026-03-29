// Email notification service for high-match job alerts
// Uses nodemailer — configure SMTP via environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

import nodemailer from "nodemailer";

interface JobMatch {
  role: string;
  company: string;
  location?: string;
  salary?: string;
  matchScore: number;
  url?: string;
}

interface EmailNotificationOptions {
  to: string;
  subject: string;
  jobs: JobMatch[];
  userName?: string;
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildHighMatchEmailHtml(options: EmailNotificationOptions): string {
  const { jobs, userName } = options;
  const greeting = userName ? `Hi ${userName},` : "Hi,";

  const jobRows = jobs
    .map(
      (j) => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px 8px;">
        <strong style="color: #1f2937; font-size: 14px;">${j.role}</strong><br/>
        <span style="color: #6b7280; font-size: 12px;">${j.company}${j.location ? ` · ${j.location}` : ""}${j.salary ? ` · ${j.salary}` : ""}</span>
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        <span style="background: ${j.matchScore >= 95 ? "#dcfce7" : "#f3e8ff"}; color: ${j.matchScore >= 95 ? "#166534" : "#6b21a8"}; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
          ${j.matchScore}% match
        </span>
      </td>
      <td style="padding: 12px 8px; text-align: right;">
        ${j.url ? `<a href="${j.url}" style="color: #7c3aed; text-decoration: none; font-size: 12px; font-weight: 500;">View Job →</a>` : ""}
      </td>
    </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #7c3aed, #6d28d9); padding: 24px 32px;">
      <h1 style="color: white; margin: 0; font-size: 20px;">🎯 High-Match Jobs Found!</h1>
      <p style="color: #e9d5ff; margin: 8px 0 0; font-size: 13px;">${jobs.length} excellent match${jobs.length > 1 ? "es" : ""} found for you</p>
    </div>
    <div style="padding: 24px 32px;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${greeting}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        Our AI found ${jobs.length} job${jobs.length > 1 ? "s" : ""} with a <strong>90%+ match score</strong> for your profile. These are excellent fits — review them soon!
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <thead>
          <tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="text-align: left; padding: 8px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Position</th>
            <th style="text-align: center; padding: 8px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Match</th>
            <th style="text-align: right; padding: 8px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Link</th>
          </tr>
        </thead>
        <tbody>
          ${jobRows}
        </tbody>
      </table>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3003"}/dashboard/auto-apply" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
          Review in Dashboard
        </a>
      </div>
    </div>
    <div style="background: #f9fafb; padding: 16px 32px; text-align: center;">
      <p style="color: #9ca3af; font-size: 11px; margin: 0;">
        You're receiving this because you have email notifications enabled for high-match jobs.
        <br/>Manage your preferences in Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendHighMatchEmail(options: EmailNotificationOptions): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log("[Email] SMTP not configured — skipping email notification");
    return false;
  }

  try {
    const html = buildHighMatchEmailHtml(options);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html,
    });
    console.log(`[Email] Sent high-match notification to ${options.to} (${options.jobs.length} jobs)`);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send notification:", err);
    return false;
  }
}

// ── Application Confirmation Email ──
// Sent to the user after a successful auto-apply

interface ApplicationConfirmationOptions {
  to: string;
  userName?: string;
  role: string;
  company: string;
  platform: string;
  proxyEmail: string;
  confirmationDetected: boolean;
  confirmationText?: string;
  url?: string;
  stepsCompleted?: string[];
}

function buildApplicationConfirmationHtml(opts: ApplicationConfirmationOptions): string {
  const greeting = opts.userName ? `Hi ${opts.userName},` : "Hi,";
  const confirmBadge = opts.confirmationDetected
    ? `<span style="background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">✓ Confirmed by ${opts.platform}</span>`
    : `<span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">⏳ Pending confirmation</span>`;

  const stepsHtml = opts.stepsCompleted?.length
    ? `<div style="margin-top: 16px; padding: 12px 16px; background: #f9fafb; border-radius: 8px;">
        <p style="color: #6b7280; font-size: 11px; text-transform: uppercase; margin: 0 0 8px;">Steps Completed</p>
        ${opts.stepsCompleted.map((s) => `<div style="color: #374151; font-size: 12px; padding: 2px 0;">✓ ${s}</div>`).join("")}
      </div>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #059669, #047857); padding: 24px 32px;">
      <h1 style="color: white; margin: 0; font-size: 20px;">✅ Application Submitted!</h1>
      <p style="color: #a7f3d0; margin: 8px 0 0; font-size: 13px;">${opts.role} at ${opts.company}</p>
    </div>
    <div style="padding: 24px 32px;">
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">${greeting}</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.6;">
        Your application for <strong>${opts.role}</strong> at <strong>${opts.company}</strong> has been submitted via <strong>${opts.platform}</strong>.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px; color: #6b7280; font-size: 12px;">Status</td>
          <td style="padding: 8px; text-align: right;">${confirmBadge}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px; color: #6b7280; font-size: 12px;">Platform</td>
          <td style="padding: 8px; text-align: right; color: #374151; font-size: 13px; font-weight: 500;">${opts.platform}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px; color: #6b7280; font-size: 12px;">Applied as</td>
          <td style="padding: 8px; text-align: right; color: #374151; font-size: 12px; font-family: monospace;">${opts.proxyEmail}</td>
        </tr>
        ${opts.confirmationText ? `<tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px; color: #6b7280; font-size: 12px;">Confirmation</td>
          <td style="padding: 8px; text-align: right; color: #374151; font-size: 12px;">${opts.confirmationText}</td>
        </tr>` : ""}
      </table>
      ${stepsHtml}
      <div style="text-align: center; margin-top: 24px;">
        ${opts.url ? `<a href="${opts.url}" style="display: inline-block; background: white; color: #059669; border: 1px solid #059669; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500; margin-right: 8px;">View Job Posting</a>` : ""}
        <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3003"}/dashboard/auto-apply" style="display: inline-block; background: #059669; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
          View in Dashboard
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 11px; margin-top: 20px; line-height: 1.5;">
        💡 <strong>Tip:</strong> Confirmation emails from ${opts.company} will be sent to <code style="background: #f3f4f6; padding: 2px 4px; border-radius: 3px;">${opts.proxyEmail}</code>. 
        You can filter these in your inbox using the +tag.
      </p>
    </div>
    <div style="background: #f9fafb; padding: 16px 32px; text-align: center;">
      <p style="color: #9ca3af; font-size: 11px; margin: 0;">
        You're receiving this because you applied via Auto Apply.
        <br/>Manage your preferences in Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendApplicationConfirmationEmail(opts: ApplicationConfirmationOptions): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log("[Email] SMTP not configured — skipping application confirmation email");
    return false;
  }

  try {
    const html = buildApplicationConfirmationHtml(opts);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: `✅ Applied: ${opts.role} at ${opts.company}`,
      html,
    });
    console.log(`[Email] Sent application confirmation to ${opts.to} for ${opts.role} at ${opts.company}`);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send application confirmation:", err);
    return false;
  }
}

export type { JobMatch, EmailNotificationOptions, ApplicationConfirmationOptions };
