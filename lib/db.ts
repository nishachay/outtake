import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Keep Neon HTTP (not WebSocket) — one-shot queries, ideal for serverless.
neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL || "";

// Lazy singleton. Absent DATABASE_URL -> db is null and the app falls back
// to the bundled catalog (see lib/dataloader.ts). Never throws on import.
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!connectionString) return null;
  if (!cached) {
    const sql = neon(connectionString);
    cached = drizzle(sql, { schema });
  }
  return cached;
}

export type DB = NonNullable<ReturnType<typeof getDb>>;