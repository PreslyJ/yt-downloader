import ffmpegPath from 'ffmpeg-static';
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJob, markCompleted, markFailed, markFinished, markStarted } from '@/lib/progressStore';
import { downloadToFile } from '@/lib/rangedDownload';
import { USER_AGENT, getPlayerData, pickAudioFormat, safeFilename } from '@/lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 800;

// Each video is its own independent file, written to disk and marked ready
// the moment it finishes — not bundled into one all-or-nothing zip. If the
// browser or network drops mid-playlist, everything already finished is
// already a real completed download; only what hadn't started yet is lost.
// This endpoint just kicks the job off and returns immediately; the actual
// work continues in the background regardless of whether this HTTP
// connection stays open, and progress/files are pulled separately.
// Tuned against this machine's actual measured bandwidth (~24 Mbps / 3 MB/s —
// a genuinely modest home connection), not a theoretical "more parallelism is
// always faster" assumption. Each video's own 4-way chunked download can pull
// several hundred KB/s on its own; stacking too many videos *and* too many
// chunks each on top of that oversubscribes the real pipe, which looks like
// slow progress and random connection resets, not a YouTube-side limit.
const VIDEO_CONCURRENCY = 2;

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

interface SelectedVideo {
  videoId: string;
  title: string;
}

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
  let quality: string | undefined;
  let videos: SelectedVideo[] | undefined;
  let jobId: string | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.quality === 'string') quality = body.quality;
    if (typeof body.jobId === 'string') jobId = body.jobId;
    if (Array.isArray(body.videos)) {
      videos = body.videos
        .filter((v): v is { videoId: unknown; title: unknown } => typeof v === 'object' && v !== null)
        .map((v) => ({
          videoId: typeof v.videoId === 'string' ? v.videoId : '',
          title: typeof v.title === 'string' ? v.title : '',
        }))
        .filter((v) => VIDEO_ID_PATTERN.test(v.videoId));
    }
  } catch {
    // fall through to validation error
  }

  // Takes the video list straight from the client — it already has this from
  // when it called /api/playlist-info. Re-walking the whole playlist here
  // would mean several sequential continuation-page fetches (each depends on
  // the previous page's token, so they can't run in parallel) before any
  // video download even starts.
  const selected = videos ?? [];
  if (selected.length === 0 || !jobId) {
    return NextResponse.json({ error: 'No videos selected' }, { status: 400 });
  }
  if (!ffmpegPath) {
    return NextResponse.json({ error: 'ffmpeg binary not available' }, { status: 500 });
  }

  const outputDir = await mkdtemp(join(tmpdir(), 'ytdl-playlist-'));
  createJob(jobId, selected.length, outputDir, (job) => {
    void rm(job.outputDir, { recursive: true, force: true });
  });

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
    const workRoot = await mkdtemp(join(tmpdir(), 'ytdl-work-'));
    try {
      await runPool(selected, VIDEO_CONCURRENCY, async (video, index) => {
        const workDir = join(workRoot, video.videoId);
        markStarted(jobId!, video.videoId, video.title);
        try {
          const { tempOutFile, title } = await processVideo({ video, quality, workDir });
          const filename = nameFor(index, title);
          const finalPath = join(outputDir, filename);
          await rename(tempOutFile, finalPath);
          markCompleted(jobId!, video.videoId, finalPath, filename);
        } catch (err) {
          console.error(`playlist item failed (${video.videoId}):`, err);
          markFailed(jobId!, video.videoId);
        } finally {
          await rm(workDir, { recursive: true, force: true });
        }
      });
    } finally {
      markFinished(jobId!);
      await rm(workRoot, { recursive: true, force: true });
    }
  };
  void run();

  return NextResponse.json({ jobId, total: selected.length });
}

interface ProcessArgs {
  video: SelectedVideo;
  quality: string | undefined;
  workDir: string;
}

async function processVideo({ video, quality, workDir }: ProcessArgs): Promise<{ tempOutFile: string; title: string }> {
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

  return { tempOutFile: outFile, title: player.title || video.title };
}
