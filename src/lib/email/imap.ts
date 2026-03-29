// IMAP-based email sync for non-Gmail providers (Outlook, Yahoo, etc.)
// Uses node-imap to connect to any IMAP server and sync job-related emails
//
// This is a fallback for users who don't use Gmail.
// Users provide their IMAP credentials in Settings.

import { prisma } from "@/lib/prisma";
import { classifyEmail } from "./gmail";

// Known IMAP server configurations for popular providers
const IMAP_CONFIGS: Record<string, { host: string; port: number; tls: boolean }> = {
  "outlook.com": { host: "outlook.office365.com", port: 993, tls: true },
  "hotmail.com": { host: "outlook.office365.com", port: 993, tls: true },
  "live.com": { host: "outlook.office365.com", port: 993, tls: true },
  "yahoo.com": { host: "imap.mail.yahoo.com", port: 993, tls: true },
  "yahoo.co.uk": { host: "imap.mail.yahoo.com", port: 993, tls: true },
  "aol.com": { host: "imap.aol.com", port: 993, tls: true },
  "icloud.com": { host: "imap.mail.me.com", port: 993, tls: true },
  "me.com": { host: "imap.mail.me.com", port: 993, tls: true },
  "zoho.com": { host: "imap.zoho.com", port: 993, tls: true },
  "protonmail.com": { host: "127.0.0.1", port: 1143, tls: false }, // ProtonMail Bridge
};

export function getImapConfig(email: string): { host: string; port: number; tls: boolean } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  return IMAP_CONFIGS[domain] || null;
}

export function getSupportedProviders(): string[] {
  return Object.keys(IMAP_CONFIGS);
}

// For non-Gmail providers, we store IMAP credentials in the GmailToken table
// (reusing the same table with a different "provider" concept)
// The accessToken field stores the IMAP password/app password
// The refreshToken field stores the IMAP host
// The email field stores the user's email address

export interface ImapCredentials {
  email: string;
  password: string; // App password for the email provider
  host: string;
  port: number;
  tls: boolean;
}

// Store IMAP credentials for a user
export async function saveImapCredentials(userId: string, creds: ImapCredentials) {
  await prisma.gmailToken.upsert({
    where: { userId },
    update: {
      accessToken: creds.password,
      refreshToken: `imap://${creds.host}:${creds.port}`,
      email: creds.email,
      expiresAt: new Date("2099-12-31"), // IMAP doesn't expire like OAuth
    },
    create: {
      userId,
      accessToken: creds.password,
      refreshToken: `imap://${creds.host}:${creds.port}`,
      email: creds.email,
      expiresAt: new Date("2099-12-31"),
    },
  });
}

// Check if a stored token is IMAP-based (vs Gmail OAuth)
export function isImapToken(refreshToken: string): boolean {
  return refreshToken.startsWith("imap://");
}

// Parse IMAP host/port from stored refreshToken
export function parseImapConfig(refreshToken: string): { host: string; port: number } | null {
  const match = refreshToken.match(/^imap:\/\/(.+):(\d+)$/);
  if (!match) return null;
  return { host: match[1], port: parseInt(match[2], 10) };
}

// Note: Actual IMAP sync requires the `imapflow` npm package.
// For now, this module provides the credential management and configuration.
// The sync implementation will be added when `imapflow` is installed.
//
// To install: npm install imapflow
//
// The sync flow will be:
// 1. Connect to IMAP server with stored credentials
// 2. Search INBOX for emails from known ATS domains (last 30 days)
// 3. Parse each email (headers, body, attachments)
// 4. Link to job applications using company/domain matching
// 5. Classify and store in EmailMessage table
// 6. Same auto-status-update logic as Gmail

export async function syncImapInbox(userId: string): Promise<{ synced: number; linked: number }> {
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token || !isImapToken(token.refreshToken)) {
    return { synced: 0, linked: 0 };
  }

  // IMAP sync requires imapflow package — check if available
  try {
    // Use eval'd require to prevent webpack from resolving at build time
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-eval
    const { ImapFlow } = eval('require')("imapflow") as typeof import("imapflow");
    const config = parseImapConfig(token.refreshToken);
    if (!config) return { synced: 0, linked: 0 };

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: true,
      auth: {
        user: token.email,
        pass: token.accessToken,
      },
      logger: false,
    });

    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    let synced = 0;
    let linked = 0;

    try {
      // Search for recent emails from known ATS domains
      const atsDomains = [
        "greenhouse.io", "lever.co", "smartrecruiters.com", "workable.com",
        "ashbyhq.com", "icims.com", "taleo.net", "myworkdayjobs.com",
        "linkedin.com", "indeed.com",
      ];

      // Search last 30 days
      const since = new Date();
      since.setDate(since.getDate() - 30);

      for await (const message of client.fetch(
        { since, seen: false },
        { envelope: true, bodyStructure: true, source: true },
      )) {
        const from = message.envelope?.from?.[0];
        const to = message.envelope?.to?.[0];
        if (!from || !to) continue;

        const fromEmail = `${from.address}`;
        const fromDomain = fromEmail.split("@")[1]?.toLowerCase() || "";

        // Only process emails from ATS domains or with job-related subjects
        const isAts = atsDomains.some((d) => fromDomain.includes(d));
        const subject = message.envelope?.subject || "";
        const isJobRelated = /application|interview|offer|position|role|candidate/i.test(subject);

        if (!isAts && !isJobRelated) continue;

        // Check if already synced (use message ID as unique key)
        const messageId = message.envelope?.messageId || `imap-${message.uid}`;
        const existing = await prisma.emailMessage.findUnique({
          where: { gmailMessageId: messageId },
        });
        if (existing) continue;

        // Parse body text from source
        const bodyText = message.source?.toString("utf-8") || "";
        const category = classifyEmail(subject, bodyText);

        // Link to job application
        const { default: linkFn } = await import("./gmail").then(() => ({ default: null }));
        void linkFn; // linking handled below

        // Simple company matching for linking
        const jobs = await prisma.jobApplication.findMany({
          where: { userId, status: { in: ["applied", "phone_screen", "interview", "offer"] } },
          select: { id: true, company: true },
          orderBy: { appliedAt: "desc" },
        });

        let jobApplicationId: string | null = null;
        for (const job of jobs) {
          const companyLower = job.company.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (companyLower.length >= 3 && (fromDomain.includes(companyLower) || subject.toLowerCase().includes(companyLower))) {
            jobApplicationId = job.id;
            break;
          }
        }

        await prisma.emailMessage.create({
          data: {
            userId,
            jobApplicationId,
            gmailMessageId: messageId,
            threadId: null,
            direction: "inbound",
            fromEmail,
            fromName: from.name || null,
            toEmail: `${to.address}`,
            toName: to.name || null,
            subject,
            bodyText: bodyText.substring(0, 50000), // Limit stored body size
            bodyHtml: null,
            category,
            proxyTag: null,
            isRead: false,
            hasAttachments: false,
            sentAt: message.envelope?.date || new Date(),
          },
        });

        synced++;
        if (jobApplicationId) linked++;
      }
    } finally {
      lock.release();
    }

    await client.logout();

    await prisma.gmailToken.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });

    return { synced, linked };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If imapflow is not installed, return gracefully
    if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
      console.log("[IMAP] imapflow package not installed — skipping IMAP sync. Run: npm install imapflow");
      return { synced: 0, linked: 0 };
    }
    console.error("[IMAP] Sync error:", err);
    return { synced: 0, linked: 0 };
  }
}
