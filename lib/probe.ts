import { extractYouTubeId, youtubeWatchUrl } from "./utils";

/**
 * Probe verdicts.
 *
 * The distinction that matters: a *transport* failure is not a *content* verdict.
 * `unknown` exists so a network timeout can never be mistaken for "the video is
 * gone" — which previously let one 300ms Vercel timeout mark a track dead and get
 * it deleted from the archive by the next catalog export.
 *
 * Mapped from oEmbed, verified empirically 2026-10-02 against live videos:
 *
 *   200 -> active    exists AND embeddable. NOT proof it plays: region-blocked,
 *                    Content-ID claimed and age-restricted videos also return 200.
 *   401 -> blocked   exists, but embedding is disabled (status.embeddable=false).
 *   404 -> unknown   private OR deleted OR nonexistent. YouTube will not
 *                    distinguish, so we refuse to guess. (YouTube's own docs
 *                    confirm a private video returns empty items to
 *                    unauthenticated videos.list calls.)
 *   400 -> invalid   malformed video id.
 *   throw/timeout -> unknown  never `dead`.
 *
 * `dead` is therefore only ever produced by a caller that has seen
 * DEAD_THRESHOLD consecutive `unknown` results, because the server cannot prove
 * a video is deleted. Player `onError` 100 is the same signal from the other side.
 */
export type ProbeStatus = "active" | "blocked" | "unknown" | "invalid";

export interface ProbeResult {
  /** True only for `active`. Derived convenience — `status` is authoritative. */
  playable: boolean;
  status: ProbeStatus;
  title: string;
  author: string;
  durationSec: number | null;
  thumbnailUrl: string;
  youtubeId: string;
  error?: string;
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeOptions {
  /**
   * Fetch duration. Costs 1 extra origin hit (watch page scrape, or a Data API
   * unit when YOUTUBE_API_KEY is set), so the bulk re-probe passes `false` and
   * only fills duration when a track is newly active or its duration is null.
   * Default true — single-track probes in the admin UI want it.
   */
  withDuration?: boolean;
}

/**
 * Video probe. Keyless-first: oEmbed truth-check (title/author + embeddability),
 * optionally boosted by the Data API for duration.
 * Never throws. Network failures degrade to `unknown`, never `dead`.
 */
export async function probeYouTube(
  input: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const youtubeId = extractYouTubeId(input);
  if (!youtubeId) {
    return verdict("invalid", input, "invalid YouTube id");
  }

  const watchUrl = youtubeWatchUrl(youtubeId);

  let oembed: Response;
  try {
    oembed = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    );
  } catch (err) {
    // Transport failure. We learned nothing about the video's existence.
    return verdict("unknown", youtubeId, `probe transport failure: ${String(err)}`);
  }

  if (oembed.status === 401) {
    return verdict("blocked", youtubeId, "exists but embedding disabled (401)");
  }
  if (oembed.status === 400) {
    return verdict("invalid", youtubeId, "malformed YouTube id (400)");
  }
  if (oembed.status >= 400) {
    // 404 is the ambiguous one: private, deleted, or nonexistent are identical.
    // Callers escalate this to `dead` only after DEAD_THRESHOLD repeats.
    return verdict("unknown", youtubeId, `not findable (${oembed.status})`);
  }

  let body: OEmbedResponse = {};
  try {
    body = (await oembed.json()) as OEmbedResponse;
  } catch {
    // Metadata parse failed but the 200 already told us it exists and embeds.
  }

  const durationSec =
    options.withDuration === false ? null : await fetchDurationSec(watchUrl, youtubeId);

  return {
    playable: true,
    status: "active",
    title: body.title ?? "",
    author: body.author_name ?? "",
    durationSec,
    thumbnailUrl: thumbnailFor(youtubeId),
    youtubeId,
  };
}

function thumbnailFor(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

function verdict(
  status: ProbeStatus,
  youtubeId: string,
  error: string,
  meta?: Partial<OEmbedResponse>,
): ProbeResult {
  return {
    playable: false,
    status,
    title: meta?.title ?? "",
    author: meta?.author_name ?? "",
    durationSec: null,
    thumbnailUrl: youtubeId ? thumbnailFor(youtubeId) : "",
    youtubeId,
    error,
  };
}

/**
 * Best-effort duration. Returns null when unavailable (never throws).
 *
 * Note: oEmbed sends no Cache-Control and `vary: Referer`, which defeats shared
 * caches — every call is a real origin hit on youtube.com. That is why the bulk
 * re-probe skips this unless it actually needs the value.
 */
async function fetchDurationSec(watchUrl: string, youtubeId: string): Promise<number | null> {
  try {
    if (process.env.YOUTUBE_API_KEY) {
      const res = await fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${youtubeId}&key=${process.env.YOUTUBE_API_KEY}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{ contentDetails?: { duration?: string } }>;
        };
        const iso = data.items?.[0]?.contentDetails?.duration;
        if (iso) {
          const secs = isoDurationToSeconds(iso);
          if (secs !== null) return secs;
        }
      }
    }

    const page = await fetchWithTimeout(watchUrl);
    if (!page.ok) return null;
    const html = await page.text();

    const exact = html.match(/"lengthSeconds":"?(\d+)"?/);
    if (exact) return Number(exact[1]);

    const approx = html.match(/"approxDurationMs":"?(\d+)"?/);
    if (approx) return Math.round(Number(approx[1]) / 1000);

    return null;
  } catch {
    return null;
  }
}

/** Returns null on an unparseable ISO-8601 duration rather than a misleading 0. */
function isoDurationToSeconds(iso: string): number | null {
  const match = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const d = Number(match[1] ?? 0);
  const h = Number(match[2] ?? 0);
  const m = Number(match[3] ?? 0);
  const s = Number(match[4] ?? 0);
  const total = d * 86400 + h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}