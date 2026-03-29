// Type stub for optional imapflow dependency
// Install with: npm install imapflow
declare module "imapflow" {
  export class ImapFlow {
    constructor(options: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      logger: boolean | object;
    });
    connect(): Promise<void>;
    logout(): Promise<void>;
    getMailboxLock(mailbox: string): Promise<{ release: () => void }>;
    fetch(
      query: Record<string, unknown>,
      options: Record<string, unknown>,
    ): AsyncIterable<{
      uid: number;
      envelope?: {
        from?: { name?: string; address?: string }[];
        to?: { name?: string; address?: string }[];
        subject?: string;
        date?: Date;
        messageId?: string;
      };
      source?: Buffer;
      bodyStructure?: unknown;
    }>;
  }
}
