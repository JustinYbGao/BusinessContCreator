import type { WaitlistRepository } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

export class SupabaseWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: DatabaseClient) {}
  async upsert(email: string, source: string, rateLimitKey: string) {
    const { error } = await this.db.rpc("upsert_waitlist_entry", {
      p_email: email.trim().toLowerCase(), p_source: source, p_rate_limit_key: rateLimitKey,
    });
    if (error) throw databaseError(error);
  }
}
