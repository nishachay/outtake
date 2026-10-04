/**
 * Build/disaster-recovery artifact. NOT a runtime read path.
 *
 * `db:export` writes scripts/catalog.json so that a fresh clone can `npm run db:import`
 * and reproduce the verified catalog, and so a database loss is recoverable from git
 * history. Nothing in app/ or the request path reads it — pages go through
 * lib/queries.ts, which throws when DATABASE_URL is absent rather than silently
 * serving this file.
 *
 * scripts/catalog.json carries video ids and titles, which YouTube Developer
 * Policies III.E.4.d place under a 30-day refresh-or-delete rule. It is committed
 * for reproducibility, so treat it as a snapshot to regenerate (npm run db:export),
 * never as something to hand-edit: a hand edit is a production bug that the next
 * export silently reverts.
 *
 * The only remaining consumer is scripts/prefilter-pending.ts, which needs a
 * dedupe set that spans both the database and this bundle.
 */
import catalog from "../scripts/catalog.json";

interface RawCatalog {
  songs: Array<{ youtubeId: string }>;
}

const raw = catalog as RawCatalog;

/** Every youtube id the bundle has ever shipped, for dedupe during prefilter. */
export function bundledYoutubeIds(): string[] {
  return raw.songs.map((s) => s.youtubeId);
}
