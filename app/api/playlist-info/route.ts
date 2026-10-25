import { homedir } from 'node:os';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getDownloadedVideoIds } from '@/lib/manifest';
import { extractPlaylistId, getPlaylistInfo } from '@/lib/playlist';
import { safeFilename } from '@/lib/youtube';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let url: string | undefined;
  try {
    const body: unknown = await req.json();
    if (typeof body === 'object' && body !== null && 'url' in body) {
      const candidate = (body as Record<string, unknown>).url;
      if (typeof candidate === 'string') url = candidate;
    }
  } catch {
    // fall through to validation error
  }

  const playlistId = url ? extractPlaylistId(url) : null;
  if (!playlistId) {
    return NextResponse.json({ error: 'Not a valid YouTube playlist URL' }, { status: 400 });
  }

  try {
    const info = await getPlaylistInfo(playlistId);

    // Checked against a per-playlist-folder manifest file on disk (not any
    // in-memory job state), so this survives app/laptop restarts — a video
    // already downloaded in a previous run shows as already-downloaded and
    // starts unchecked, instead of needing to redownload the whole playlist.
    const folderName = safeFilename(info.title);
    const outputDir = join(homedir(), 'Downloads', folderName);
    const downloadedIds = await getDownloadedVideoIds(outputDir);

    const videos = info.videos.map((v) => ({ ...v, alreadyDownloaded: downloadedIds.has(v.videoId) }));
    return NextResponse.json({ playlistId, title: info.title, videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch playlist info';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
