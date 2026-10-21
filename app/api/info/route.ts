import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId, getPlayerData, pickAudioFormat, pickVideoFormats } from '@/lib/youtube';

export const runtime = 'nodejs';

export interface FormatOption {
  itag: number;
  quality: string;
  sizeBytes: number | null;
}

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

  const videoId = url ? extractVideoId(url) : null;
  if (!videoId) {
    return NextResponse.json({ error: 'Not a valid YouTube URL' }, { status: 400 });
  }

  try {
    const player = await getPlayerData(videoId);
    const audio = pickAudioFormat(player.adaptiveFormats);
    const formats: FormatOption[] = pickVideoFormats(player.adaptiveFormats).map((f) => ({
      itag: f.itag,
      quality: f.qualityLabel as string,
      sizeBytes: f.contentLength
        ? Number(f.contentLength) + Number(audio?.contentLength ?? 0)
        : null,
    }));

    return NextResponse.json({
      videoId: player.videoId,
      title: player.title,
      author: player.author,
      lengthSeconds: player.lengthSeconds,
      thumbnail: player.thumbnail,
      formats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch video info';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
