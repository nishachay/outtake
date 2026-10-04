import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Keep Neon HTTP (not WebSocket) — one-shot queries, ideal for serverless, and the
// 1.1.x driver is HTTP-only anyway (the /ws subpath was removed in 1.0).
//
// Use the POOLED endpoint here. Transaction pooling has no session affinity, so
// anything needing session state must go through DATABASE_URL_UNPOOLED instead —
// see drizzle.config.ts.

const connectionString = process.env.DATABASE_URL || "";

/**
 * Lazy singleton, or null when DATABASE_URL is unset.
 *
 * null is a deliberate, narrow signal: only lib/queries.ts and the admin handlers
 * inspect it, and queries.ts converts it into a loud throw. Public page reads go
 * through queries.ts so a missing database fails the build instead of silently
 * serving a stale bundle.
 */
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!connectionString) return null;
  if (!cached) {
    cached = drizzle(neon(connectionString), { schema });
  }
  return cached;
}

export type DB = NonNullable<ReturnType<typeof getDb>>;
