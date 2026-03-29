// AI Agent Verification Code Retrieval
// Handles fetching verification codes from Gmail API or browser fallback.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Regex patterns for extracting verification codes from email text
// Ordered from most specific to least specific — stops at first match
// Supports both numeric-only and alphanumeric codes (Greenhouse uses alpha codes)
const VERIFICATION_CODE_PATTERNS = [
  // Alphanumeric codes in explicit "code" context (Greenhouse, Lever, etc.)
  /(?:code\s+(?:field|into).*?application)\s*:\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:security\s+code\s+field).*?:\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:security|verification)\s*(?:code|pin)\s*(?:is|:)?\s*([A-Za-z0-9]{4,8})\b/i,
  /\b([A-Za-z0-9]{4,8})\b\s*(?:is your|is the)\s*(?:security|verification)/i,
  /(?:your\s+(?:security|verification)\s+code\s+is)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:code)\s*[:=]\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:enter|use)\s+(?:this\s+)?(?:code|the\s+code)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
  // Code in bold/strong/heading tags (Greenhouse uses <h1>)
  /<(?:strong|b|h1|h2)>\s*([A-Za-z0-9]{4,8})\s*<\/(?:strong|b|h1|h2)>/i,
  // Code on its own line (common in HTML emails) — must contain at least one letter and one digit
  /^\s*([A-Za-z0-9]{4,8})\s*$/m,
  // Numeric-only codes
  /(?:verification|confirm|verify|security)\s*(?:code|pin|number)\s*(?:is|:)?\s*(\d{4,8})/i,
  /(?:code|pin|otp)\s*[:=]\s*(\d{4,8})/i,
  /(\d{4,8})\s*(?:is your|is the)\s*(?:verification|confirm|security)/i,
  /\b(\d{6})\b/,
];

// Known ATS and job-related email domains — used to prioritize the right verification email
const ATS_SENDER_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "smartrecruiters.com", "workable.com",
  "ashbyhq.com", "icims.com", "taleo.net", "myworkdayjobs.com",
  "workday.com", "jobvite.com", "bamboohr.com", "successfactors.com",
  "linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com",
  "mercury.com", "stripe.com", "airbnb.com", "amazon.com",
];

// Common English words (4-8 chars) that could false-match standalone code patterns
const COMMON_WORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one","our","out",
  "field","from","have","this","that","with","will","your","been","more","when","some","them",
  "than","each","make","like","long","look","many","most","over","such","take","into",
  "just","come","could","made","after","back","also","only","know","about","very","much",
  "time","work","first","last","name","email","phone","apply","here","click","view","jobs",
  "code","enter","below","above","dear","hello","please","thank","thanks","role","team",
  "data","need","help","what","which","their","would","there","these","other","being",
]);

export function extractCodeFromText(rawText: string): string | null {
  // Try patterns on raw HTML first (for bold/strong tags)
  for (const pattern of VERIFICATION_CODE_PATTERNS) {
    if (pattern.source.includes("strong") || pattern.source.includes("h1") || pattern.source.includes("^\\s")) {
      const match = rawText.match(pattern);
      if (match) {
        const val = match[1];
        if (/^(19|20)\d{2}$/.test(val)) continue;
        if (COMMON_WORDS.has(val.toLowerCase())) continue;
        // Must have digit or mixed case (not a plain English word)
        if (/\d/.test(val) || (/[a-z]/.test(val) && /[A-Z]/.test(val))) return val;
        // Accept from explicit code-context patterns
        if (pattern.source.includes("security") || pattern.source.includes("verification") || pattern.source.includes("h1")) return val;
      }
    }
  }
  // Then try on cleaned text
  const text = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const pattern of VERIFICATION_CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const val = match[1];
      if (/^(19|20)\d{2}$/.test(val)) continue;
      if (COMMON_WORDS.has(val.toLowerCase())) continue;
      // For non-context patterns (standalone line match), require mixed case or digits
      if (!pattern.source.includes("security") && !pattern.source.includes("verification") && !pattern.source.includes("code")) {
        if (!/\d/.test(val) && !(/[a-z]/.test(val) && /[A-Z]/.test(val))) continue;
      }
      return val;
    }
  }
  return null;
}

// Check if an email is from a known ATS/job-related domain
function isATSSender(fromEmail: string): boolean {
  const domain = fromEmail.split("@")[1]?.toLowerCase() || "";
  return ATS_SENDER_DOMAINS.some(d => domain.includes(d));
}

// Browser-based Gmail reader fallback
async function fetchVerificationCodeViaBrowser(
  rootPage: any,
  email: string,
  waitSeconds: number = 45,
): Promise<string | null> {
  let gmailPage: any = null;
  try {
    const context = rootPage.context();
    gmailPage = await context.newPage();
    console.log("[AI-Agent] Gmail browser: Opening Gmail to read verification code...");

    const searchQuery = encodeURIComponent("subject:(security code OR verification code) newer_than:15m");
    await gmailPage.goto(`https://mail.google.com/mail/u/0/#search/${searchQuery}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await gmailPage.waitForTimeout(3000);

    const currentUrl = gmailPage.url();
    if (currentUrl.includes("accounts.google.com") || currentUrl.includes("signin")) {
      console.log("[AI-Agent] Gmail browser: Need to sign in — cannot complete automatically");
      await gmailPage.close().catch(() => {});
      return null;
    }

    const maxAttempts = Math.ceil(waitSeconds / 8);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await gmailPage.waitForTimeout(8000);
        await gmailPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        await gmailPage.waitForTimeout(2000);
      }

      try {
        const emailRow = await gmailPage.$('tr.zA, div[role="row"], .aDP');
        if (emailRow) {
          await emailRow.click();
          await gmailPage.waitForTimeout(2000);
          const bodyText = await gmailPage.evaluate(`document.body.innerText`).catch(() => "");
          const code = extractCodeFromText(String(bodyText));
          if (code) {
            console.log(`[AI-Agent] Gmail browser: Found verification code: ${code}`);
            await gmailPage.close().catch(() => {});
            return code;
          }
          await gmailPage.goBack().catch(() => {});
          await gmailPage.waitForTimeout(1000);
        } else {
          console.log(`[AI-Agent] Gmail browser: No emails found (attempt ${attempt + 1}/${maxAttempts})`);
        }
      } catch (clickErr) {
        console.log(`[AI-Agent] Gmail browser: Error reading email: ${(clickErr as Error).message.slice(0, 60)}`);
      }
    }

    console.log("[AI-Agent] Gmail browser: No verification code found after polling");
    await gmailPage.close().catch(() => {});
    return null;
  } catch (err) {
    console.log(`[AI-Agent] Gmail browser: Error: ${(err as Error).message.slice(0, 80)}`);
    if (gmailPage) await gmailPage.close().catch(() => {});
    return null;
  }
}

// Main verification code fetcher — tries Gmail API first, then browser fallback
export async function fetchVerificationCode(
  dbUserId: string | undefined,
  email: string,
  senderHint?: string,
  waitSeconds: number = 30,
  rootPage?: any,
  clerkId?: string,
): Promise<string | null> {
  // Try Gmail API first (production path)
  try {
    const { google } = await import("googleapis");

    let oauth2Client: InstanceType<typeof google.auth.OAuth2>;

    // Try DB token first (production path via Clerk auto-connect)
    let hasToken = false;
    if (dbUserId) {
      try {
        const { prisma } = await import("@/lib/prisma");
        let token = await prisma.gmailToken.findUnique({ where: { userId: dbUserId } });

        if (!token && clerkId) {
          console.log("[AI-Agent] No GmailToken in DB — trying Clerk auto-connect...");
          try {
            const { autoConnectGmailFromClerk } = await import("@/lib/email/gmail");
            const connected = await autoConnectGmailFromClerk(clerkId, dbUserId, email);
            if (connected) {
              console.log("[AI-Agent] Clerk auto-connect succeeded — Gmail token saved to DB");
              token = await prisma.gmailToken.findUnique({ where: { userId: dbUserId } });
            } else {
              console.log("[AI-Agent] Clerk auto-connect returned false");
            }
          } catch (clerkErr) {
            console.log(`[AI-Agent] Clerk auto-connect failed: ${(clerkErr as Error).message.slice(0, 80)}`);
          }
        }

        if (token) {
          oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
          );
          oauth2Client.setCredentials({
            access_token: token.accessToken,
            refresh_token: token.refreshToken || undefined,
          });
          hasToken = true;
        }
      } catch (dbErr) {
        console.log(`[AI-Agent] DB token lookup failed: ${(dbErr as Error).message.slice(0, 60)}`);
      }
    }

    // Fallback: use GOOGLE_GMAIL_REFRESH_TOKEN env var (for test scripts)
    if (!hasToken) {
      const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
      if (refreshToken) {
        oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          oauth2Client.setCredentials(credentials);
          console.log("[AI-Agent] Using Gmail token from GOOGLE_GMAIL_REFRESH_TOKEN env var");
          hasToken = true;
        } catch (refreshErr) {
          console.log(`[AI-Agent] Gmail token refresh failed: ${(refreshErr as Error).message.slice(0, 80)}`);
        }
      }
    }

    if (hasToken) {
      const gmail = google.gmail({ version: "v1", auth: oauth2Client! });

      const maxAttempts = Math.ceil(waitSeconds / 5);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 5000));
        }

        // Strategy: If we have a specific ATS sender hint, search TARGETED first
        // to avoid picking up unrelated verification emails (GitHub, LinkedIn, etc.)
        const isATSHint = senderHint && ATS_SENDER_DOMAINS.some(d => senderHint.includes(d.split(".")[0]));
        let messages: { id?: string | null }[] = [];

        if (isATSHint) {
          // TARGETED: Search specifically from this ATS sender — no broad subject terms
          const targetedQuery = `newer_than:10m from:${senderHint}`;
          console.log(`[AI-Agent] Gmail targeted search: ${targetedQuery}`);
          const targetedRes = await gmail.users.messages.list({
            userId: "me",
            q: targetedQuery,
            maxResults: 5,
          });
          messages = targetedRes.data.messages || [];
          if (messages.length > 0) {
            console.log(`[AI-Agent] Gmail: Found ${messages.length} emails from ATS sender ${senderHint}`);
          }
        }

        // BROAD fallback: search by subject terms (with sender hint if available)
        if (messages.length === 0) {
          const fromClause = senderHint ? `from:${senderHint}` : "";
          const subjectTerms = `(subject:"security code" OR subject:"verification code" OR subject:verify OR subject:"password reset" OR subject:"reset your password" OR subject:"account verification" OR "security code" OR "verification code" OR "reset your password")`;
          const query = `newer_than:10m to:${email} ${subjectTerms} ${fromClause}`.trim();
          console.log(`[AI-Agent] Gmail broad search: ${query}`);
          const listRes = await gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults: 5,
          });
          messages = listRes.data.messages || [];

          // If sender hint was used but no results, try without sender filter
          if (messages.length === 0 && senderHint) {
            const fallbackQuery = `newer_than:10m to:${email} ${subjectTerms}`.trim();
            const fallbackRes = await gmail.users.messages.list({
              userId: "me",
              q: fallbackQuery,
              maxResults: 5,
            });
            messages = fallbackRes.data.messages || [];
            if (messages.length > 0) {
              console.log(`[AI-Agent] Gmail: Found emails with broader search (no sender filter)`);
            }
          }
        }
        if (messages.length === 0) continue;

        const extractText = (part: any): string => {
          if (part.body?.data) {
            return Buffer.from(part.body.data, "base64url").toString("utf-8");
          }
          if (part.parts) {
            return part.parts.map(extractText).join(" ");
          }
          return "";
        };

        // Scan ALL matching emails, prioritize ATS senders over random services (e.g. GitHub)
        type EmailCandidate = { id: string; from: string; subject: string; body: string; isATS: boolean };
        const candidates: EmailCandidate[] = [];

        for (const msg of messages.slice(0, 5)) {
          try {
            const fullMsg = await gmail.users.messages.get({
              userId: "me",
              id: msg.id!,
              format: "full",
            });
            const payload = fullMsg.data.payload;
            const headers = (payload?.headers || []) as { name: string; value: string }[];
            const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "";
            const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
            const bodyText = extractText(payload);
            const fromEmail = fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader;
            candidates.push({
              id: msg.id!,
              from: fromEmail,
              subject: subjectHeader,
              body: bodyText,
              isATS: isATSSender(fromEmail),
            });
          } catch { /* skip unreadable messages */ }
        }

        // Sort: ATS senders first, then by recency (already sorted by Gmail)
        candidates.sort((a, b) => {
          if (a.isATS && !b.isATS) return -1;
          if (!a.isATS && b.isATS) return 1;
          // If sender hint matches, prioritize
          if (senderHint) {
            const aMatch = a.from.toLowerCase().includes(senderHint.toLowerCase());
            const bMatch = b.from.toLowerCase().includes(senderHint.toLowerCase());
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
          }
          return 0;
        });

        console.log(`[AI-Agent] Gmail: ${candidates.length} candidate emails: ${candidates.map(c => `${c.from.slice(0, 40)}${c.isATS ? " [ATS]" : ""}`).join(", ")}`);

        // Try to extract code from each candidate, preferring ATS senders
        for (const candidate of candidates) {
          console.log(`[AI-Agent] Gmail API: Checking email from ${candidate.from.slice(0, 50)} — subject: ${candidate.subject.slice(0, 80)}`);
          console.log(`[AI-Agent] Gmail API: Email body (first 500): ${candidate.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500)}`);

          const code = extractCodeFromText(candidate.body);
          if (code) {
            console.log(`[AI-Agent] Found verification code via Gmail API: ${code} (from: ${candidate.from.slice(0, 50)})`);
            return code;
          }

          // Also look for password reset / account activation links
          const resetLinkMatch = candidate.body.match(/https?:\/\/[^\s"<>]+(?:reset|password|verify|confirm|activate)[^\s"<>]*/i);
          if (resetLinkMatch) {
            console.log(`[AI-Agent] Found password reset link via Gmail API: ${resetLinkMatch[0].slice(0, 100)}`);
            return `RESET_LINK:${resetLinkMatch[0]}`;
          }
        }
      }

      console.log("[AI-Agent] Gmail API: No verification code found after polling");
      return null;
    }
  } catch (err) {
    console.log(`[AI-Agent] Gmail API error: ${(err as Error).message.slice(0, 80)}`);
  }

  // Fallback: browser-based Gmail reader
  if (rootPage) {
    console.log("[AI-Agent] No Gmail API token available — trying browser-based Gmail reader");
    return fetchVerificationCodeViaBrowser(rootPage, email, waitSeconds);
  }

  console.log("[AI-Agent] No Gmail token found and no browser available for verification code retrieval");
  return null;
}
