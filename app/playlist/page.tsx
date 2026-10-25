'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string | null;
  durationSeconds: number | null;
}

interface PlaylistInfo {
  playlistId: string;
  title: string;
  videos: PlaylistVideo[];
}

interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  activeTitles: string[];
  finished: boolean;
}

const QUALITIES = ['1080p', '720p', '480p', '360p', '240p', '144p'];

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null) return '';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function PlaylistPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<PlaylistInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quality, setQuality] = useState(QUALITIES[1]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  async function fetchPlaylist(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    setDownloadError(null);
    try {
      const res = await fetch('/api/playlist-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as PlaylistInfo & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
      setInfo(data);
      setSelected(new Set(data.videos.map((v) => v.videoId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function toggle(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function toggleAll() {
    if (!info) return;
    setSelected((prev) => (prev.size === info.videos.length ? new Set() : new Set(info.videos.map((v) => v.videoId))));
  }

  async function downloadAll() {
    if (!info || selected.size === 0) return;
    setDownloading(true);
    setDownloadError(null);
    setProgress({ total: selected.size, completed: 0, failed: 0, activeTitles: [], finished: false });

    const jobId = crypto.randomUUID();
    const pollInterval = setInterval(() => {
      fetch(`/api/playlist-progress?jobId=${jobId}`)
        .then((r) => (r.ok ? (r.json() as Promise<JobProgress>) : null))
        .then((data) => {
          if (data) setProgress(data);
        })
        .catch(() => {});
    }, 1000);

    try {
      const res = await fetch('/api/playlist-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, quality, videoIds: [...selected], jobId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${info.title}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      clearInterval(pollInterval);
      setDownloading(false);
    }
  }

  return (
    <main>
      <h1>▶ Playlist Downloader</h1>
      <p className="subtitle">
        Paste a YouTube playlist link — get every video as one ZIP, downloaded in parallel.{' '}
        <Link href="/" style={{ color: 'inherit' }}>Single video? →</Link>
      </p>

      <form className="search-row" onSubmit={fetchPlaylist}>
        <input
          type="url"
          placeholder="https://www.youtube.com/playlist?list=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {downloadError && <div className="error">{downloadError}</div>}

      {info && (
        <>
          <div className="controls" style={{ marginBottom: 16 }}>
            <button type="button" className="btn-secondary" onClick={toggleAll}>
              {selected.size === info.videos.length ? 'Deselect all' : 'Select all'}
            </button>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}>
              {QUALITIES.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            <button type="button" className="btn" onClick={downloadAll} disabled={downloading || selected.size === 0}>
              {downloading ? 'Downloading…' : `⬇ Download ${selected.size} as ZIP`}
            </button>
          </div>

          {progress && (
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.9rem' }}>
                <span>
                  {progress.completed + progress.failed} / {progress.total} videos
                  {progress.failed > 0 && <span style={{ color: '#ffb4b4' }}> ({progress.failed} failed)</span>}
                </span>
                <span>{Math.round(((progress.completed + progress.failed) / Math.max(1, progress.total)) * 100)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${((progress.completed + progress.failed) / Math.max(1, progress.total)) * 100}%`,
                    background: progress.finished ? '#4caf50' : 'var(--accent)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              {progress.activeTitles.length > 0 && !progress.finished && (
                <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 6 }}>
                  Downloading now ({progress.activeTitles.length} at once): {progress.activeTitles.join(' · ')}
                </p>
              )}
              {progress.finished && (
                <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 6 }}>
                  All done — zipping and sending to your browser now…
                </p>
              )}
            </div>
          )}

          <h2 style={{ marginBottom: 12 }}>{info.title} ({info.videos.length} videos)</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {info.videos.map((video, i) => (
              <label
                key={video.videoId}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(video.videoId)}
                  onChange={() => toggle(video.videoId)}
                />
                <span style={{ color: 'var(--muted)', width: 28, textAlign: 'right' }}>{i + 1}</span>
                {video.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={video.thumbnail} alt="" style={{ width: 96, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6 }} />
                )}
                <span style={{ flex: 1 }}>{video.title}</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{formatDuration(video.durationSeconds)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <p className="hint">
        Each video is downloaded with several parallel connections, and several videos download at
        once — this is much faster than clicking download on each one, but a large playlist at high
        quality can still take a while and use real bandwidth. The ZIP starts streaming to your
        browser as soon as the first videos finish, so the download begins quickly even though the
        whole thing isn&apos;t done yet.
      </p>
    </main>
  );
}
