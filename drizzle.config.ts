import type { Config } from "drizzle-kit";

/**
 * Migrations MUST use the direct (unpooled) endpoint.
 *
 * `DATABASE_URL` is the pooled `-pooler` hostname, which routes through PgBouncer
 * in transaction mode. That mode has no session affinity, so session-level
 * operations do not survive between statements — a migration that needs
 * `SET search_path`, or anything relying on transaction state, fails in ways that
 * never mention pooling ("relation does not exist", "prepared statement already
 * exists", SQLSTATE 25006 read-only transaction).
 *
 * Runtime keeps the pooled URL on purpose: lib/db.ts issues one-shot queries and
 * benefits from bursting on a free-tier project. See AGENTS.md.
 */
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. " +
      "Migrations need the direct endpoint — see .env.example.",
  );
}

if (url.includes("-pooler.") && !process.env.DATABASE_URL_UNPOOLED) {
  console.warn(
    "\n[drizzle] WARNING: only the pooled URL is set. Migrations over PgBouncer\n" +
      "transaction pooling can fail in ways that do not name pooling. Set\n" +
      "DATABASE_URL_UNPOOLED to the hostname without -pooler.\n",
  );
}

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
} satisfies Config;
