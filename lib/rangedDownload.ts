import { writeFile } from 'node:fs/promises';
import { ytFetch } from './http';
import { USER_AGENT } from './youtube';

// YouTube throttles each individual connection to roughly realtime playback
// speed, regardless of actual bandwidth. Splitting a stream into several
// concurrent range requests gets several throttled connections running at
// once instead of one — same trick yt-dlp uses. Verified: ~15x speedup on
// the iOS app using the identical technique.
const CHUNK_COUNT = 6;
const RANGED_THRESHOLD = 3_000_000; // below this, splitting isn't worth the overhead

export async function downloadToFile(url: string, destPath: string, contentLength?: number | null): Promise<void> {
  if (contentLength && contentLength >= RANGED_THRESHOLD) {
    try {
      await downloadRanged(url, destPath, contentLength);
      return;
    } catch {
      // Fall through to a plain single-connection download if ranges aren't honored.
    }
  }
  await downloadSingle(url, destPath);
}

async function downloadSingle(url: string, destPath: string): Promise<void> {
  const res = await ytFetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

async function downloadRanged(url: string, destPath: string, contentLength: number): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(contentLength / CHUNK_COUNT));
  const ranges = Array.from({ length: CHUNK_COUNT }, (_, i) => {
    const start = i * chunkSize;
    const end = i === CHUNK_COUNT - 1 ? contentLength - 1 : start + chunkSize - 1;
    return { start, end };
  });

  const chunks = await Promise.all(
    ranges.map(async ({ start, end }, index) => {
      const res = await ytFetch(url, {
        headers: { 'User-Agent': USER_AGENT, Range: `bytes=${start}-${end}` },
      });
      if (!res.ok) throw new Error(`Range chunk ${index} failed (HTTP ${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }),
  );
  await writeFile(destPath, Buffer.concat(chunks));
}
