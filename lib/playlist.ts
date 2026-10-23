import { USER_AGENT } from './youtube';

// Playlist listing uses the plain WEB client — unlike single-video playback,
// listing metadata isn't SABR-gated, so no visionOS trick or stream URLs are
// needed here. Response shape verified live: pages render each video as a
// `lockupViewModel` with a trailing `continuationItemViewModel` carrying the
// token for the next page.
const WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20241201.00.00', hl: 'en', gl: 'US' };

const PLAYLIST_ID_PATTERN = /^[\w-]{10,64}$/;

export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (PLAYLIST_ID_PATTERN.test(trimmed) && !trimmed.includes('://')) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const list = url.searchParams.get('list');
  return list && PLAYLIST_ID_PATTERN.test(list) ? list : null;
}

export interface PlaylistVideoSummary {
  videoId: string;
  title: string;
  thumbnail: string | null;
  durationSeconds: number | null;
}

export interface PlaylistInfo {
  title: string;
  videos: PlaylistVideoSummary[];
}

interface LockupItem {
  lockupViewModel?: {
    contentId?: string;
    metadata?: { lockupMetadataViewModel?: { title?: { content?: string } } };
    contentImage?: {
      thumbnailViewModel?: {
        image?: { sources?: Array<{ url: string; width: number }> };
        overlays?: Array<{
          thumbnailBottomOverlayViewModel?: {
            badges?: Array<{ thumbnailBadgeViewModel?: { text?: string } }>;
          };
        }>;
      };
    };
  };
  continuationItemViewModel?: {
    continuationCommand?: { innertubeCommand?: { continuationCommand?: { token?: string } } };
  };
}

function parseDurationText(text?: string): number | null {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseItem(item: LockupItem): PlaylistVideoSummary | { continuationToken: string } | null {
  if (item.continuationItemViewModel) {
    const token = item.continuationItemViewModel.continuationCommand?.innertubeCommand?.continuationCommand?.token;
    return token ? { continuationToken: token } : null;
  }
  const lv = item.lockupViewModel;
  const videoId = lv?.contentId;
  const title = lv?.metadata?.lockupMetadataViewModel?.title?.content;
  if (!videoId || !title) return null;

  const sources = lv?.contentImage?.thumbnailViewModel?.image?.sources ?? [];
  const thumbnail = sources.length > 0 ? sources[sources.length - 1].url : null;

  const badgeText = lv?.contentImage?.thumbnailViewModel?.overlays
    ?.flatMap((o) => o.thumbnailBottomOverlayViewModel?.badges ?? [])
    .map((b) => b.thumbnailBadgeViewModel?.text)
    .find((t): t is string => Boolean(t));

  return { videoId, title, thumbnail, durationSeconds: parseDurationText(badgeText) };
}

async function browse(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ context: { client: WEB_CLIENT }, ...body }),
  });
  if (!res.ok) throw new Error(`Playlist browse failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const MAX_PAGES = 30; // safety cap: ~3000 videos

export async function getPlaylistInfo(playlistId: string): Promise<PlaylistInfo> {
  const first = await browse({ browseId: `VL${playlistId}` });

  const alert = (first.alerts as Array<{ alertRenderer?: { text?: { runs?: Array<{ text?: string }> } } }> | undefined)
    ?.find((a) => a.alertRenderer)?.alertRenderer?.text?.runs?.map((r) => r.text).join('');
  if (alert) throw new Error(alert);

  const title =
    (first.metadata as { playlistMetadataRenderer?: { title?: string } } | undefined)?.playlistMetadataRenderer
      ?.title ?? 'Playlist';

  const tabs = (first.contents as any)?.twoColumnBrowseResultsRenderer?.tabs as any[] | undefined;
  let items: LockupItem[] =
    tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents ?? [];

  const videos: PlaylistVideoSummary[] = [];
  let continuationToken: string | undefined;
  let pageCount = 0;

  const consume = (pageItems: LockupItem[]) => {
    continuationToken = undefined;
    for (const item of pageItems) {
      const parsed = parseItem(item);
      if (!parsed) continue;
      if ('continuationToken' in parsed) {
        continuationToken = parsed.continuationToken;
      } else {
        videos.push(parsed);
      }
    }
  };

  consume(items);
  pageCount++;

  while (continuationToken && pageCount < MAX_PAGES) {
    const page = await browse({ continuation: continuationToken });
    const actions = page.onResponseReceivedActions as
      | Array<{ appendContinuationItemsAction?: { continuationItems?: LockupItem[] } }>
      | undefined;
    items = actions?.[0]?.appendContinuationItemsAction?.continuationItems ?? [];
    consume(items);
    pageCount++;
  }

  if (videos.length === 0) throw new Error('No videos found in this playlist (it may be private or empty).');
  return { title, videos };
}
