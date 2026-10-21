import ffmpegPath from 'ffmpeg-static';
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ytFetch } from '@/lib/http';
import {
  USER_AGENT,
  contentDisposition,
  extractVideoId,
  getPlayerData,
  pickAudioFormat,
  safeFilename,
} from '@/lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 300;

// YouTube serves video and audio as separate streams. We fetch both, remux them
// with ffmpeg stream-copy and embed the thumbnail as cover art. Cover art does
// not survive fragmented/streamed MP4 output (the attached-pic track comes out
// broken), so we mux to a temp file first and then stream that to the client —
// which also lets us send a proper Content-Length.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const itagParam = req.nextUrl.searchParams.get('itag');
  const itag = itagParam ? Number(itagParam) : NaN;

  const videoId = url ? extractVideoId(url) : null;
  if (!videoId || !Number.isInteger(itag)) {
    return NextResponse.json({ error: 'Invalid url or itag' }, { status: 400 });
  }
  if (!ffmpegPath) {
    return NextResponse.json({ error: 'ffmpeg binary not available' }, { status: 500 });
  }

  let workDir: string | null = null;
  const cleanup = () => {
    if (workDir) void rm(workDir, { recursive: true, force: true });
  };

  try {
    const player = await getPlayerData(videoId);
    const videoFormat = player.adaptiveFormats.find(
      (f) => f.itag === itag && f.mimeType.startsWith('video/') && f.url,
    );
    const audioFormat = pickAudioFormat(player.adaptiveFormats);
    if (!videoFormat?.url || !audioFormat?.url) {
      return NextResponse.json({ error: 'Requested format not available' }, { status: 404 });
    }

    workDir = await mkdtemp(join(tmpdir(), 'ytdl-'));
    const outPath = join(workDir, 'out.mp4');

    // Thumbnail is best-effort; the download must not fail without it.
    let thumbPath: string | null = null;
    if (player.thumbnail) {
      try {
        const thumbRes = await fetch(player.thumbnail, { headers: { 'User-Agent': USER_AGENT } });
        if (thumbRes.ok) {
          thumbPath = join(workDir, 'thumb.img');
          await writeFile(thumbPath, Buffer.from(await thumbRes.arrayBuffer()));
        }
      } catch {
        thumbPath = null;
      }
    }

    const [videoRes, audioRes] = await Promise.all([
      ytFetch(videoFormat.url, { headers: { 'User-Agent': USER_AGENT } }),
      ytFetch(audioFormat.url, { headers: { 'User-Agent': USER_AGENT } }),
    ]);
    if (!videoRes.ok || !videoRes.body || !audioRes.ok || !audioRes.body) {
      cleanup();
      return NextResponse.json(
        { error: `Stream fetch failed (video ${videoRes.status}, audio ${audioRes.status})` },
        { status: 502 },
      );
    }

    const ffmpeg = spawn(
      ffmpegPath,
      [
        '-loglevel', 'error',
        '-i', 'pipe:3',
        '-i', 'pipe:4',
        ...(thumbPath ? ['-i', thumbPath] : []),
        '-map', '0:v:0',
        '-map', '1:a:0',
        ...(thumbPath ? ['-map', '2', '-disposition:v:1', 'attached_pic'] : []),
        '-c', 'copy',
        // Thumbnails arrive as jpg or webp; re-encode just the cover to mjpeg
        // so players recognize it. Video/audio stay stream-copied.
        ...(thumbPath ? ['-c:v:1', 'mjpeg'] : []),
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y', outPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
    );

    let stderr = '';
    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const abortAll = () => ffmpeg.kill('SIGKILL');
    const videoPipe = ffmpeg.stdio[3] as Writable;
    const audioPipe = ffmpeg.stdio[4] as Writable;
    for (const pipe of [videoPipe, audioPipe]) {
      // Early ffmpeg exit surfaces as EPIPE here; without a handler it crashes the process.
      pipe.on('error', abortAll);
    }
    Readable.fromWeb(videoRes.body as Parameters<typeof Readable.fromWeb>[0])
      .on('error', abortAll)
      .pipe(videoPipe);
    Readable.fromWeb(audioRes.body as Parameters<typeof Readable.fromWeb>[0])
      .on('error', abortAll)
      .pipe(audioPipe);

    const exitCode: number | null = await new Promise((resolve) => {
      ffmpeg.on('close', resolve);
      ffmpeg.on('error', () => resolve(null));
    });
    if (exitCode !== 0) {
      cleanup();
      return NextResponse.json(
        { error: `ffmpeg failed (${exitCode}): ${stderr.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const { size } = await stat(outPath);
    const fileStream = createReadStream(outPath);
    fileStream.on('close', cleanup);
    fileStream.on('error', cleanup);

    const filename = `${safeFilename(player.title)}.mp4`;
    return new NextResponse(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
        'Content-Disposition': contentDisposition(filename),
      },
    });
  } catch (err) {
    cleanup();
    const message = err instanceof Error ? err.message : 'Download failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
