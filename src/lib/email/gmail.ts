// Gmail API integration for Email Hub
// Handles OAuth, inbox sync, email sending, and email classification
//
// Required env vars:
//   GOOGLE_CLIENT_ID     — from Google Cloud Console
//   GOOGLE_CLIENT_SECRET — from Google Cloud Console
//   NEXT_PUBLIC_APP_URL  — app base URL for OAuth redirect

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

// ── OAuth Client ──

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3003";
  const redirectUri = `${appUrl}/api/email/gmail/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGmailAuthUrl(state?: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: state || "",
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// ── Auto-Connect from Clerk ──
// If the user signed in with Google via Clerk, we can grab their OAuth token
// and auto-provision Gmail access — no manual "Connect Gmail" step needed.

export async function autoConnectGmailFromClerk(
  clerkId: string,
  dbUserId: string,
  userEmail: string
): Promise<boolean> {
  try {
    // Check if already connected
    const existing = await prisma.gmailToken.findUnique({ where: { userId: dbUserId } });
    if (existing) return true; // Already connected

    // Import clerkClient dynamically to avoid circular deps
    const { clerkClient } = await import("@clerk/nextjs/server");

    // Try to get Google OAuth token from Clerk
    let accessToken: string | undefined;
    const providers = ["oauth_google", "oauth_custom_google"] as const;
    for (const provider of providers) {
      try {
        const tokens = await clerkClient.users.getUserOauthAccessToken(clerkId, provider as `oauth_custom_${string}`);
        accessToken = tokens.data?.[0]?.token;
        if (accessToken) {
          console.log(`[Gmail] Got token from Clerk provider: ${provider}`);
          break;
        }
      } catch (e) {
        console.log(`[Gmail] Provider ${provider} failed:`, (e as Error).message);
      }
    }
    if (!accessToken) {
      console.log("[Gmail] No Google OAuth token found in Clerk for user", clerkId);
      return false;
    }

    // Verify the token actually has Gmail API scopes before saving
    let gmailEmail = userEmail;
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      gmailEmail = profile.data.emailAddress || userEmail;
    } catch (verifyErr) {
      // Token doesn't have Gmail scopes — do NOT save it
      // User needs to either re-sign-in with Google (to get new scopes) or use manual Connect Gmail
      console.log("[Gmail] Clerk token lacks Gmail scopes, skipping auto-connect:", (verifyErr as Error).message);
      return false;
    }

    // Token verified — save to GmailToken table
    await prisma.gmailToken.upsert({
      where: { userId: dbUserId },
      update: {
        accessToken,
        refreshToken: "", // Clerk manages refresh
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
        email: gmailEmail,
      },
      create: {
        userId: dbUserId,
        accessToken,
        refreshToken: "", // Clerk manages refresh
        expiresAt: new Date(Date.now() + 3600000),
        email: gmailEmail,
      },
    });

    console.log(`[Gmail] Auto-connected for ${gmailEmail} via Clerk OAuth`);
    return true;
  } catch (err) {
    // Not an error — user may not have signed in with Google
    console.log("[Gmail] Auto-connect skipped:", (err as Error).message);
    return false;
  }
}

// Refresh the Clerk-provided Google OAuth token
export async function refreshClerkGmailToken(
  clerkId: string,
  dbUserId: string
): Promise<boolean> {
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const tokens = await clerkClient.users.getUserOauthAccessToken(clerkId, "oauth_google");
    const accessToken = tokens.data?.[0]?.token;
    if (!accessToken) return false;

    await prisma.gmailToken.update({
      where: { userId: dbUserId },
      data: {
        accessToken,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return true;
  } catch {
    return false;
  }
}

// ── Token Management ──

async function getAuthenticatedClient(userId: string) {
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) return null;

  const isClerkManaged = !token.refreshToken; // Clerk-provisioned tokens have empty refreshToken

  // Auto-refresh if expired
  if (token.expiresAt.getTime() < Date.now()) {
    if (isClerkManaged) {
      // Clerk-managed token: refresh via Clerk API
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { clerkId: true } });
      if (user?.clerkId) {
        const refreshed = await refreshClerkGmailToken(user.clerkId, userId);
        if (!refreshed) {
          console.error("[Gmail] Clerk token refresh failed");
          return null;
        }
      } else {
        return null;
      }
      // Re-fetch updated token
      const updated = await prisma.gmailToken.findUnique({ where: { userId } });
      if (!updated) return null;
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: updated.accessToken });
      return oauth2Client;
    } else {
      // Standard Google OAuth refresh
      try {
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          expiry_date: token.expiresAt.getTime(),
        });
        const { credentials } = await oauth2Client.refreshAccessToken();
        await prisma.gmailToken.update({
          where: { userId },
          data: {
            accessToken: credentials.access_token!,
            expiresAt: new Date(credentials.expiry_date!),
          },
        });
        oauth2Client.setCredentials(credentials);
        return oauth2Client;
      } catch (err) {
        console.error("[Gmail] Token refresh failed:", err);
        return null;
      }
    }
  }

  // Token still valid
  if (isClerkManaged) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token.accessToken });
    return oauth2Client;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime(),
  });
  return oauth2Client;
}

// ── Inbox Sync ──

// Extract the plus-address tag from an email address
// e.g. "user+google-swe@gmail.com" → "google-swe"
function extractProxyTag(email: string): string | null {
  const match = email.match(/\+([^@]+)@/);
  return match ? match[1] : null;
}

// Classify email content using keyword matching
function classifyEmail(subject: string, bodyText: string): string {
  const text = `${subject} ${bodyText}`.toLowerCase();

  // Interview invite patterns
  if (/interview|schedule.*call|phone screen|video call|meet.*team|availability/.test(text)) {
    return "interview_invite";
  }
  // Offer patterns
  if (/offer letter|congratulations.*offer|pleased to offer|compensation package|start date/.test(text)) {
    return "offer";
  }
  // Rejection patterns
  if (/unfortunately|not moving forward|other candidates|not a fit|position.*filled|decided not to/.test(text)) {
    return "rejection";
  }
  // Confirmation patterns
  if (/application.*received|thank.*applying|successfully submitted|application.*confirmed|we.*received.*application/.test(text)) {
    return "confirmation";
  }
  // Follow-up patterns
  if (/follow.?up|checking in|next steps|update.*application|status.*application/.test(text)) {
    return "follow_up";
  }

  return "general";
}

// Link an email to a job application using multiple strategies:
// 1. Match sender domain/name against company name in applied jobs
// 2. Match subject line against company or role in applied jobs
// 3. Fall back to tracking tag matching (internal proxy tag on JobApplication)
async function linkEmailToJob(
  userId: string,
  fromEmail: string,
  fromName: string | null,
  subject: string,
  proxyTag: string | null,
): Promise<string | null> {
  // Get all applied/active jobs for this user
  const jobs = await prisma.jobApplication.findMany({
    where: { userId, status: { in: ["applied", "phone_screen", "interview", "offer"] } },
    select: { id: true, company: true, role: true, proxyEmail: true, appliedAt: true },
    orderBy: { appliedAt: "desc" },
  });

  if (jobs.length === 0) return null;

  const senderDomain = fromEmail.split("@")[1]?.toLowerCase() || "";
  const senderName = (fromName || "").toLowerCase();
  const subjectLower = subject.toLowerCase();

  // Strategy 1: Match sender domain against company name
  // e.g. "noreply@google.com" matches job at "Google"
  for (const job of jobs) {
    const companyLower = job.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Check if company name appears in sender domain
    if (companyLower.length >= 3 && senderDomain.includes(companyLower)) return job.id;
    // Check if company name appears in sender display name
    if (companyLower.length >= 3 && senderName.includes(companyLower)) return job.id;
  }

  // Strategy 2: Match company or role in subject line
  // e.g. "Your application to Google - Software Engineer"
  for (const job of jobs) {
    const companyLower = job.company.toLowerCase();
    const roleLower = job.role.toLowerCase();
    if (companyLower.length >= 3 && subjectLower.includes(companyLower)) return job.id;
    if (roleLower.length >= 5 && subjectLower.includes(roleLower)) return job.id;
  }

  // Strategy 3: Fall back to internal tracking tag
  if (proxyTag) {
    for (const job of jobs) {
      if (job.proxyEmail) {
        const jobTag = extractProxyTag(job.proxyEmail);
        if (jobTag === proxyTag) return job.id;
      }
    }
  }

  return null;
}

// Parse a Gmail message into our EmailMessage format
function parseGmailHeaders(headers: { name: string; value: string }[]) {
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  return {
    from: get("From"),
    to: get("To"),
    subject: get("Subject"),
    date: get("Date"),
  };
}

function parseEmailAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/"/g, "").trim(), email: match[2].trim() };
  return { name: null, email: raw.trim() };
}

// Decode base64url encoded content from Gmail API
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): { text: string; html: string } {
  let text = "";
  let html = "";

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") text = decoded;
    if (payload.mimeType === "text/html") html = decoded;
  }

  if (payload.parts) {
    for (const part of payload.parts as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[]) {
      const sub = extractBody(part);
      if (sub.text) text = sub.text;
      if (sub.html) html = sub.html;
    }
  }

  return { text, html };
}

export async function syncGmailInbox(userId: string): Promise<{ synced: number; linked: number }> {
  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) return { synced: 0, linked: 0 };

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) return { synced: 0, linked: 0 };

  let synced = 0;
  let linked = 0;

  try {
    // Search for job-application-related emails broadly
    // Since we use the user's original email on forms, we search by common ATS senders
    // and application-related keywords in subject lines
    const atsPatterns = [
      "from:greenhouse.io",
      "from:lever.co",
      "from:smartrecruiters.com",
      "from:workable.com",
      "from:ashbyhq.com",
      "from:icims.com",
      "from:taleo.net",
      "from:myworkdayjobs.com",
      "from:linkedin.com subject:application",
      "from:indeed.com subject:application",
      "subject:\"your application\"",
      "subject:\"application received\"",
      "subject:\"thank you for applying\"",
      "subject:\"interview invitation\"",
      "subject:\"interview schedule\"",
      "subject:\"we received your application\"",
      "subject:\"application confirmation\"",
    ];
    const query = `newer_than:30d (${atsPatterns.join(" OR ")})`;

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
    });

    const messages = listRes.data.messages || [];

    for (const msg of messages) {
      // Skip if already synced
      const existing = await prisma.emailMessage.findUnique({
        where: { gmailMessageId: msg.id! },
      });
      if (existing) continue;

      // Fetch full message
      const fullMsg = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });

      const headers = parseGmailHeaders(
        (fullMsg.data.payload?.headers || []) as { name: string; value: string }[]
      );
      const fromParsed = parseEmailAddress(headers.from);
      const toParsed = parseEmailAddress(headers.to);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = extractBody((fullMsg.data.payload || {}) as any);

      // Determine direction
      const isOutbound = fromParsed.email.toLowerCase() === token.email.toLowerCase() ||
        fromParsed.email.toLowerCase().includes(token.email.split("@")[0].toLowerCase());
      const direction = isOutbound ? "outbound" : "inbound";

      // Extract proxy tag from the relevant address (for fallback linking)
      const relevantEmail = isOutbound ? toParsed.email : toParsed.email;
      const proxyTag = extractProxyTag(relevantEmail);

      // Link to job application using multi-strategy matching:
      // 1. Company name in sender domain/name, 2. Company/role in subject, 3. Tracking tag
      const jobApplicationId = await linkEmailToJob(
        userId,
        fromParsed.email,
        fromParsed.name,
        headers.subject,
        proxyTag,
      );

      // Classify the email
      const category = classifyEmail(headers.subject, body.text);

      // Check for attachments
      const attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
      const parts = fullMsg.data.payload?.parts || [];
      for (const part of parts as { filename?: string; mimeType?: string; body?: { size?: number; attachmentId?: string } }[]) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType || "application/octet-stream",
            size: part.body.size || 0,
            attachmentId: part.body.attachmentId,
          });
        }
      }

      // Store the email
      await prisma.emailMessage.create({
        data: {
          userId,
          jobApplicationId,
          gmailMessageId: msg.id!,
          threadId: fullMsg.data.threadId || null,
          direction,
          fromEmail: fromParsed.email,
          fromName: fromParsed.name,
          toEmail: toParsed.email,
          toName: toParsed.name,
          subject: headers.subject,
          bodyText: body.text || null,
          bodyHtml: body.html || null,
          category,
          proxyTag,
          isRead: !(fullMsg.data.labelIds || []).includes("UNREAD"),
          hasAttachments: attachments.length > 0,
          attachments: attachments.length > 0 ? JSON.stringify(attachments) : null,
          sentAt: new Date(headers.date || Date.now()),
        },
      });

      synced++;
      if (jobApplicationId) linked++;

      // Auto-update job status based on email category
      if (jobApplicationId && category !== "general") {
        await autoUpdateJobStatus(jobApplicationId, category);
      }
    }

    // Update last sync time
    await prisma.gmailToken.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });
  } catch (err) {
    console.error("[Gmail] Sync error:", err);
  }

  return { synced, linked };
}

// ── Auto-Update Job Status ──

async function autoUpdateJobStatus(jobApplicationId: string, emailCategory: string) {
  const statusMap: Record<string, string> = {
    interview_invite: "phone_screen",
    offer: "offer",
    rejection: "rejected",
  };

  const newStatus = statusMap[emailCategory];
  if (!newStatus) return;

  const job = await prisma.jobApplication.findUnique({
    where: { id: jobApplicationId },
    select: { status: true, userId: true, company: true, role: true },
  });
  if (!job) return;

  // Only advance status, never go backwards
  const statusOrder = ["matched", "ready", "applied", "phone_screen", "interview", "offer", "rejected"];
  const currentIdx = statusOrder.indexOf(job.status);
  const newIdx = statusOrder.indexOf(newStatus);

  if (newIdx > currentIdx || newStatus === "rejected") {
    await prisma.jobApplication.update({
      where: { id: jobApplicationId },
      data: { status: newStatus },
    });

    // Create notification
    const titles: Record<string, string> = {
      phone_screen: `Interview invite: ${job.role} at ${job.company}`,
      offer: `Offer received: ${job.role} at ${job.company}!`,
      rejected: `Update: ${job.role} at ${job.company}`,
    };

    await prisma.notification.create({
      data: {
        userId: job.userId,
        type: "status_change",
        title: titles[newStatus] || `Status update: ${job.role}`,
        message: `Automatically updated based on email from ${job.company}.`,
      },
    });
  }
}

// ── Send Email ──

export async function sendEmailViaGmail(
  userId: string,
  to: string,
  subject: string,
  bodyHtml: string,
  jobApplicationId?: string,
  replyToMessageId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) return { success: false, error: "Gmail not connected" };

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) return { success: false, error: "Gmail token not found" };

  // Build the proxy email for this job if we have one
  let fromEmail = token.email;
  let proxyTag: string | null = null;
  if (jobApplicationId) {
    const job = await prisma.jobApplication.findUnique({
      where: { id: jobApplicationId },
      select: { proxyEmail: true },
    });
    if (job?.proxyEmail) {
      fromEmail = job.proxyEmail;
      proxyTag = extractProxyTag(job.proxyEmail);
    }
  }

  // Build RFC 2822 email
  const headers = [
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
  ];

  if (replyToMessageId) {
    headers.push(`In-Reply-To: ${replyToMessageId}`);
    headers.push(`References: ${replyToMessageId}`);
  }

  const rawEmail = `${headers.join("\r\n")}\r\n\r\n${bodyHtml}`;
  const encodedEmail = Buffer.from(rawEmail).toString("base64url");

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail },
    });

    // Store outbound email in our DB
    await prisma.emailMessage.create({
      data: {
        userId,
        jobApplicationId: jobApplicationId || null,
        gmailMessageId: res.data.id || null,
        threadId: res.data.threadId || null,
        direction: "outbound",
        fromEmail,
        fromName: null,
        toEmail: to,
        toName: null,
        subject,
        bodyText: null,
        bodyHtml: bodyHtml,
        category: "general",
        proxyTag,
        isRead: true,
        sentAt: new Date(),
      },
    });

    return { success: true, messageId: res.data.id || undefined };
  } catch (err) {
    console.error("[Gmail] Send error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

// ── Get Emails for a Job ──

export async function getEmailsForJob(userId: string, jobApplicationId: string) {
  return prisma.emailMessage.findMany({
    where: { userId, jobApplicationId },
    orderBy: { sentAt: "asc" },
  });
}

export async function getEmailThread(userId: string, threadId: string) {
  return prisma.emailMessage.findMany({
    where: { userId, threadId },
    orderBy: { sentAt: "asc" },
  });
}

export async function getAllEmails(userId: string, options?: { category?: string; unreadOnly?: boolean; limit?: number }) {
  return prisma.emailMessage.findMany({
    where: {
      userId,
      ...(options?.category ? { category: options.category } : {}),
      ...(options?.unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: options?.limit || 50,
    include: {
      jobApplication: {
        select: { id: true, company: true, role: true, status: true },
      },
    },
  });
}

export { extractProxyTag, classifyEmail };
