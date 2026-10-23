import { NextRequest, NextResponse } from 'next/server';
import { extractPlaylistId, getPlaylistInfo } from '@/lib/playlist';

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
    return NextResponse.json({ playlistId, title: info.title, videos: info.videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch playlist info';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
