import { ZipArchive } from 'archiver';
import ffmpegPath from 'ffmpeg-static';
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { extractPlaylistId, getPlaylistInfo } from '@/lib/playlist';
import { downloadToFile } from '@/lib/rangedDownload';
import { USER_AGENT, contentDisposition, getPlayerData, pickAudioFormat, safeFilename } from '@/lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 800;

// Videos are processed several at a time (not one by one), and each video's
// own video+audio streams are *also* pulled with the ranged-chunk downloader
// (several parallel connections per stream, bypassing YouTube's per-connection
// throttle) — two layers of parallelism stacked for playlist speed.
const VIDEO_CONCURRENCY = 4;

async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
}

export async function POST(req: NextRequest) {
  let url: string | undefined;
  let quality: string | undefined;
  let videoIds: string[] | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.url === 'string') url = body.url;
    if (typeof body.quality === 'string') quality = body.quality;
    if (Array.isArray(body.videoIds)) videoIds = body.videoIds.filter((v): v is string => typeof v === 'string');
  } catch {
    // fall through to validation error
  }

  const playlistId = url ? extractPlaylistId(url) : null;
  if (!playlistId) {
    return NextResponse.json({ error: 'Not a valid YouTube playlist URL' }, { status: 400 });
  }
  if (!ffmpegPath) {
    return NextResponse.json({ error: 'ffmpeg binary not available' }, { status: 500 });
  }

  let info;
  try {
    info = await getPlaylistInfo(playlistId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch playlist info';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const selected = videoIds ? info.videos.filter((v) => videoIds.includes(v.videoId)) : info.videos;
  if (selected.length === 0) {
    return NextResponse.json({ error: 'No videos selected' }, { status: 400 });
  }

  const rootDir = await mkdtemp(join(tmpdir(), 'ytdl-playlist-'));
  const passthrough = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (err) => console.error('archiver warning:', err));
  archive.on('error', (err) => passthrough.destroy(err));
  archive.pipe(passthrough);

  const usedNames = new Set<string>();
  const nameFor = (index: number, title: string) => {
    let base = `${String(index + 1).padStart(3, '0')} - ${safeFilename(title)}`;
    let name = `${base}.mp4`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${base} (${suffix}).mp4`;
      suffix++;
    }
    usedNames.add(name);
    return name;
  };

  const run = async () => {
    try {
      await runPool(selected, VIDEO_CONCURRENCY, async (video, index) => {
        const workDir = join(rootDir, video.videoId);
        try {
          await processVideo({ video, index, quality, workDir, archive, nameFor });
        } catch (err) {
          console.error(`playlist item failed (${video.videoId}):`, err);
          archive.append(
            `Failed: ${err instanceof Error ? err.message : 'unknown error'}\n`,
            { name: `${String(index + 1).padStart(3, '0')} - ${safeFilename(video.title)} (FAILED).txt` },
          );
        }
        // Per-video temp files are cleaned up once at the end, after
        // archive.finalize() resolves — archiver reads file contents
        // lazily/asynchronously, so deleting them earlier races the zip write.
      });
    } finally {
      await archive.finalize();
      await rm(rootDir, { recursive: true, force: true });
    }
  };
  void run();

  const filename = `${safeFilename(info.title)}.zip`;
  return new NextResponse(passthrough as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(filename),
    },
  });
}

interface ProcessArgs {
  video: { videoId: string; title: string; thumbnail: string | null };
  index: number;
  quality: string | undefined;
  workDir: string;
  archive: ZipArchive;
  nameFor: (index: number, title: string) => string;
}

async function processVideo({ video, index, quality, workDir, archive, nameFor }: ProcessArgs): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workDir, { recursive: true });

  const player = await getPlayerData(video.videoId);
  const videoCandidates = player.adaptiveFormats
    .filter((f) => f.mimeType.startsWith('video/mp4') && f.qualityLabel && f.url)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const videoFormat =
    (quality ? videoCandidates.find((f) => f.qualityLabel === quality) : undefined) ?? videoCandidates[0];
  const audioFormat = pickAudioFormat(player.adaptiveFormats);
  if (!videoFormat?.url || !audioFormat?.url) {
    throw new Error('No downloadable format found for this video');
  }

  const videoFile = join(workDir, 'video.mp4');
  const audioFile = join(workDir, 'audio.m4a');
  const outFile = join(workDir, 'out.mp4');

  await Promise.all([
    downloadToFile(videoFormat.url, videoFile, videoFormat.contentLength ? Number(videoFormat.contentLength) : null),
    downloadToFile(audioFormat.url, audioFile, audioFormat.contentLength ? Number(audioFormat.contentLength) : null),
  ]);

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

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath as string,
      [
        '-loglevel', 'error',
        '-i', videoFile,
        '-i', audioFile,
        ...(thumbPath ? ['-i', thumbPath] : []),
        '-map', '0:v:0',
        '-map', '1:a:0',
        ...(thumbPath ? ['-map', '2', '-disposition:v:1', 'attached_pic', '-c:v:1', 'mjpeg'] : []),
        '-c:v:0', 'copy',
        '-c:a:0', 'copy',
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y', outFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ffmpeg.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
    ffmpeg.on('error', reject);
  });

  archive.file(outFile, { name: nameFor(index, player.title || video.title) });
}
