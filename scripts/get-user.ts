import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../.env.local') });

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const result = await client.execute({
    sql: 'SELECT * FROM User WHERE email = ?',
    args: ['johnsonseun15@gmail.com'],
  });
  console.log(JSON.stringify(result.rows[0], null, 2));
  // Also get resume/profile data
  const userId = result.rows[0]?.id as string;
  if (userId) {
    const resumeResult = await client.execute({
      sql: 'SELECT * FROM Resume WHERE userId = ? LIMIT 1',
      args: [userId],
    });
    console.log('\nResume row:', JSON.stringify(resumeResult.rows[0], null, 2));
  }
}
main().catch(console.error);
