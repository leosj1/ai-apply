// Quick test: directly import and run the crawler to verify all sources
// Run with: node --loader ts-node/esm scripts/test-crawl.mjs
// Or just check the server logs after triggering from the UI

import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./prisma/dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Clear scraped jobs to force a fresh crawl
async function clearAndCheck() {
  console.log("=== Clearing ScrapedJob cache ===");
  await client.execute("DELETE FROM ScrapedJob");
  
  const count = await client.execute("SELECT COUNT(*) as cnt FROM ScrapedJob");
  console.log("ScrapedJob count after clear:", count.rows[0].cnt);
  
  console.log("\n=== Done. Now trigger a scan from the dashboard to test all sources. ===");
  console.log("Watch the server logs for:");
  console.log("  [crawl] Scraping linkedin ...");
  console.log("  [crawl] Scraping indeed ...");
  console.log("  [crawl] Scraping glassdoor ...");
  console.log("  [crawl] Scraping ziprecruiter ...");
  console.log("  [crawl] greenhouse/... ...");
  console.log("  [crawl] lever/... ...");
}

clearAndCheck().then(() => process.exit(0)).catch(console.error);
