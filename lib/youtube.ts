// Minimal InnerTube client using YouTube's visionOS app identity, which still
// serves direct (non-SABR) stream URLs and needs no signature deciphering or
// Proof-of-Origin token. Mirrors yt-dlp's `visionos` client config.

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const VISIONOS_CLIENT = {
  clientName: 'VISIONOS',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.5.23O471',
  hl: 'en',
  gl: 'US',
  utcOffsetMinutes: 0,
};

const ID_PATTERN = /^[\w-]{11}$/;

export function extractVideoId(input: string): string | null {
  if (ID_PATTERN.test(input)) return input;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_PATTERN.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && ID_PATTERN.test(v)) return v;
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (match) return match[1];
  }
  return null;
}

export function safeFilename(title: string): string {
  return (
    title
      .replace(/[^\p{L}\p{N} _.-]/gu, '')
      .trim()
      .slice(0, 120) || 'video'
  );
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

let visitorData: Promise<string> | null = null;

async function fetchVisitorData(): Promise<string> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify({ context: { client: VISIONOS_CLIENT } }),
  });
  if (!res.ok) throw new Error(`visitor_id request failed: ${res.status}`);
  const data = (await res.json()) as { responseContext?: { visitorData?: string } };
  const value = data.responseContext?.visitorData;
  if (!value) throw new Error('No visitorData in visitor_id response');
  return value;
}

function getVisitorData(): Promise<string> {
  visitorData ??= fetchVisitorData().catch((err: unknown) => {
    visitorData = null;
    throw err;
  });
  return visitorData;
}

export interface RawFormat {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  contentLength?: string;
  qualityLabel?: string;
  audioQuality?: string;
}

export interface PlayerData {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnail: string | null;
  adaptiveFormats: RawFormat[];
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    thumbnail?: { thumbnails?: Array<{ url: string; width: number; height: number }> };
  };
  streamingData?: { adaptiveFormats?: RawFormat[] };
}

export async function getPlayerData(videoId: string): Promise<PlayerData> {
  const visitor = await getVisitorData();
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-YouTube-Client-Name': '101',
      'X-YouTube-Client-Version': VISIONOS_CLIENT.clientVersion,
      'X-Goog-Visitor-Id': visitor,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify({
      context: { client: { ...VISIONOS_CLIENT, visitorData: visitor } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) throw new Error(`player request failed: ${res.status}`);
  const data = (await res.json()) as PlayerResponse;

  const status = data.playabilityStatus?.status;
  if (status !== 'OK') {
    throw new Error(data.playabilityStatus?.reason ?? `Video not playable (${status ?? 'unknown'})`);
  }

  const details = data.videoDetails;
  const thumbnails = details?.thumbnail?.thumbnails ?? [];
  const best = thumbnails.reduce<{ url: string; width: number } | null>(
    (acc, t) => (acc && acc.width >= t.width ? acc : t),
    null,
  );

  return {
    videoId: details?.videoId ?? videoId,
    title: details?.title ?? 'Untitled',
    author: details?.author ?? 'Unknown',
    lengthSeconds: Number(details?.lengthSeconds ?? 0),
    thumbnail: best?.url ?? null,
    adaptiveFormats: data.streamingData?.adaptiveFormats ?? [],
  };
}

function isMp4Video(f: RawFormat): boolean {
  return f.mimeType.startsWith('video/mp4') && Boolean(f.qualityLabel) && Boolean(f.url);
}

// Prefer h264 (avc1) per quality label for playback compatibility; fall back to
// av01 where no avc1 rendition exists (e.g. 4K).
export function pickVideoFormats(adaptive: RawFormat[]): RawFormat[] {
  const byLabel = new Map<string, RawFormat>();
  const candidates = adaptive
    .filter(isMp4Video)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  for (const f of candidates) {
    const label = f.qualityLabel as string;
    const current = byLabel.get(label);
    const isAvc = f.mimeType.includes('avc1');
    if (!current || (isAvc && !current.mimeType.includes('avc1'))) byLabel.set(label, f);
  }
  return [...byLabel.values()];
}

export function pickAudioFormat(adaptive: RawFormat[]): RawFormat | undefined {
  return adaptive
    .filter((f) => f.mimeType.startsWith('audio/mp4') && f.mimeType.includes('mp4a') && f.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}
