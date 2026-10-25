import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Tracks which videoIds have already been downloaded into a given playlist
// folder, so a later run (even after a restart, since this is a file on disk,
// not in-memory job state) can skip videos that already succeeded instead of
// re-downloading the whole playlist.
const MANIFEST_FILENAME = '.ytdl-manifest.json';

interface ManifestEntry {
  filename: string;
  title: string;
}

type Manifest = Record<string, ManifestEntry>;

function manifestPath(outputDir: string): string {
  return join(outputDir, MANIFEST_FILENAME);
}

async function readManifest(outputDir: string): Promise<Manifest> {
  try {
    const raw = await readFile(manifestPath(outputDir), 'utf8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return {};
  }
}

export async function recordDownloaded(outputDir: string, videoId: string, filename: string, title: string): Promise<void> {
  const manifest = await readManifest(outputDir);
  manifest[videoId] = { filename, title };
  await writeFile(manifestPath(outputDir), JSON.stringify(manifest, null, 2));
}

export async function getDownloadedVideoIds(outputDir: string): Promise<Set<string>> {
  const manifest = await readManifest(outputDir);
  return new Set(Object.keys(manifest));
}

export async function getManifestEntry(outputDir: string, videoId: string): Promise<ManifestEntry | undefined> {
  const manifest = await readManifest(outputDir);
  return manifest[videoId];
}
