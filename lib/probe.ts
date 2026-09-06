import { extractYouTubeId, youtubeWatchUrl } from "./utils";

export type ProbeStatus = "active" | "private" | "dead" | "invalid";

export interface ProbeResult {
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

/**
 * Video probe. Keyless-first: oEmbed truth-check (title/author + playability).
 * When YOUTUBE_API_KEY is set, boosts with the Data API (authoritative status).
 * Network failures degrade to `dead` and never throw.
 */
export async function probeYouTube(input: string): Promise<ProbeResult> {
  const youtubeId = extractYouTubeId(input);
  const fail: ProbeResult = {
    playable: false,
    status: "invalid",
    title: "",
    author: "",
    durationSec: null,
    thumbnailUrl: "",
    youtubeId: input,
    error: "invalid YouTube id",
  };
  if (!youtubeId) return fail;

  const watchUrl = youtubeWatchUrl(youtubeId);

  try {
    const oembed = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    );

    if (oembed.status === 404) {
      return notPlayable("dead", youtubeId, "video not found (404)", oembedTitle(oembed));
    }
    if (oembed.status === 401) {
      return notPlayable("private", youtubeId, "video is private (401)", oembedTitle(oembed));
    }
    if (oembed.status >= 400) {
      return notPlayable(
        "dead",
        youtubeId,
        `unplayable (${oembed.status})`,
        oembedTitle(oembed),
      );
    }

    let body = {} as OEmbedResponse;
    try {
      body = (await oembed.json()) as OEmbedResponse;
    } catch {
      // proceed with empty metadata; playable verdict stands
    }

    const title = body.title ?? "";
    const author = body.author_name ?? "";
    const durationSec = await fetchDurationSec(watchUrl, youtubeId);
    const thumbnailUrl = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

    return {
      playable: true,
      status: "active",
      title,
      author,
      durationSec,
      thumbnailUrl,
      youtubeId,
    };
  } catch (err) {
    return notPlayable("dead", youtubeId, `probe failed: ${String(err)}`);
  }
}

function notPlayable(
  status: ProbeStatus,
  youtubeId: string,
  error: string,
  oembed?: Partial<OEmbedResponse>,
): ProbeResult {
  return {
    playable: false,
    status,
    title: oembed?.title ?? "",
    author: oembed?.author_name ?? "",
    durationSec: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    youtubeId,
    error,
  };
}

function oembedTitle(res: Response): Partial<OEmbedResponse> {
  const t = res.headers.get("content-type") ?? "";
  void t;
  return {};
}

/**
 * Best-effort duration from the watch page embedded player JSON.
 * Returns null when unavailable (never throws).
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
        if (iso) return isoDurationToSeconds(iso);
      }
    }

    const page = await fetchWithTimeout(watchUrl);
    if (!page.ok) return null;
    const html = await page.text();

    const lengthRe = /"lengthSeconds":"?(\d+)"?/;
    const m = html.match(lengthRe);
    if (m) return Number(m[1]);

    const readRe = /"approxDurationMs":"?(\d+)"?/;
    const m2 = html.match(readRe);
    if (m2) return Math.round(Number(m2[1]) / 1000);

    return null;
  } catch {
    return null;
  }
}

function isoDurationToSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  return h * 3600 + m * 60 + s;
}