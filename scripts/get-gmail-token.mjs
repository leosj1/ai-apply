// Get a Gmail OAuth refresh token for verification code retrieval
// Usage: node scripts/get-gmail-token.mjs
// 1. Make sure nothing is running on port 3003
// 2. Run this script — it opens the auth URL in your default browser
// 3. Sign in with Google and grant access
// 4. The refresh token is saved to .env.local automatically
import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
import { resolve } from 'path';
import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Must match the redirect URI registered in Google Cloud Console
const REDIRECT_URI = 'http://localhost:3003/api/email/gmail/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
});

// Start a tiny server to catch the OAuth callback
let resolveCode;
const codePromise = new Promise((resolve) => { resolveCode = resolve; });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:3003');
  if (url.pathname === '/api/email/gmail/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h1>Error: ${error}</h1>`);
      resolveCode(null);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>✅ Gmail authorized! You can close this tab.</h1>');
    resolveCode(code);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3003, async () => {
  console.log('\nListening on http://localhost:3003 for OAuth callback...');
  console.log('\n🔗 Opening browser — please sign in with your Google account:\n');
  // Open in default browser
  exec(`open "${authUrl}"`);
});

const code = await codePromise;
server.close();

if (!code) {
  console.error('❌ No authorization code received');
  process.exit(1);
}

try {
  const { tokens } = await oauth2Client.getToken(code);
  console.log('\n✅ Got tokens!');
  console.log(`Refresh Token: ${tokens.refresh_token ? 'YES' : 'NONE'}`);

  if (tokens.refresh_token) {
    const envPath = resolve(process.cwd(), '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    if (envContent.includes('GOOGLE_GMAIL_REFRESH_TOKEN=')) {
      const updated = envContent.replace(/GOOGLE_GMAIL_REFRESH_TOKEN=.*/, `GOOGLE_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      fs.writeFileSync(envPath, updated);
    } else {
      fs.appendFileSync(envPath, `\nGOOGLE_GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
    console.log('✅ Saved GOOGLE_GMAIL_REFRESH_TOKEN to .env.local\n');
  } else {
    console.log('⚠️  No refresh token. Revoke at https://myaccount.google.com/permissions and retry.\n');
  }
} catch (err) {
  console.error('Error exchanging code:', err.message);
}
process.exit(0);
