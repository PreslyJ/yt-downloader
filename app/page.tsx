'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

interface FormatOption {
  itag: number;
  quality: string;
  sizeBytes: number | null;
}

interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnail: string | null;
  formats: FormatOption[];
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? ` · ${(mb / 1024).toFixed(1)} GB` : ` · ${mb.toFixed(1)} MB`;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [itag, setItag] = useState<number | null>(null);

  async function fetchInfo(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as Record<string, unknown>).error)
            : 'Something went wrong';
        throw new Error(message);
      }
      const video = data as VideoInfo;
      setInfo(video);
      setItag(video.formats[0]?.itag ?? null);
      if (video.formats.length === 0) {
        setError('No downloadable MP4 format found for this video.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const downloadHref =
    info && itag !== null
      ? `/api/download?url=${encodeURIComponent(url)}&itag=${itag}`
      : undefined;

  const thumbnailHref = info?.thumbnail
    ? `/api/thumbnail?src=${encodeURIComponent(info.thumbnail)}&name=${encodeURIComponent(info.title)}`
    : undefined;

  function triggerDownload(href: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadBoth() {
    if (thumbnailHref) triggerDownload(thumbnailHref);
    // Stagger so the browser registers two separate downloads.
    if (downloadHref) setTimeout(() => triggerDownload(downloadHref), 400);
  }

  return (
    <main>
      <h1>▶ YT Downloader</h1>
      <p className="subtitle">
        Paste a YouTube link — get the MP4 and the thumbnail.{' '}
        <Link href="/playlist" style={{ color: 'inherit' }}>Got a playlist? →</Link>
      </p>

      <form className="search-row" onSubmit={fetchInfo}>
        <input
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {info && (
        <div className="card">
          {info.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.thumbnail} alt={info.title} />
          )}
          <div className="card-body">
            <h2>{info.title}</h2>
            <p className="meta">
              {info.author} · {formatDuration(info.lengthSeconds)}
            </p>
            <div className="controls">
              <select
                value={itag ?? ''}
                onChange={(e) => setItag(Number(e.target.value))}
                disabled={info.formats.length === 0}
              >
                {info.formats.map((f) => (
                  <option key={f.itag} value={f.itag}>
                    {f.quality} MP4{formatSize(f.sizeBytes)}
                  </option>
                ))}
              </select>
              {downloadHref && (
                <button type="button" className="btn" onClick={downloadBoth}>
                  ⬇ Download MP4 + thumbnail
                </button>
              )}
              {thumbnailHref && (
                <a className="btn btn-secondary" href={thumbnailHref}>
                  🖼 Thumbnail
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="hint">
        Video and audio streams are remuxed into a single MP4 on the fly (no re-encoding). For
        personal use on content you have the right to download.
      </p>
    </main>
  );
}
