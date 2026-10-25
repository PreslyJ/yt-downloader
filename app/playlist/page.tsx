'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';

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

interface ReadyFile {
  videoId: string;
  filename: string;
}

interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  activeTitles: string[];
  finished: boolean;
  ready: ReadyFile[];
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

function fileUrl(jobId: string, videoId: string): string {
  return `/api/playlist-download/file?jobId=${encodeURIComponent(jobId)}&videoId=${encodeURIComponent(videoId)}`;
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());

  // Each ready file auto-triggers its own browser download as soon as it
  // shows up — so if the tab closes or the network drops mid-playlist,
  // whatever already finished is already sitting in your Downloads folder,
  // not lost inside one all-or-nothing archive.
  useEffect(() => {
    if (!jobId || !progress) return;
    for (const file of progress.ready) {
      if (triggeredRef.current.has(file.videoId)) continue;
      triggeredRef.current.add(file.videoId);
      const a = document.createElement('a');
      a.href = fileUrl(jobId, file.videoId);
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [jobId, progress]);

  useEffect(() => {
    if (!jobId || !downloading) return;
    const interval = setInterval(() => {
      fetch(`/api/playlist-progress?jobId=${jobId}`)
        .then((r) => (r.ok ? (r.json() as Promise<JobProgress>) : null))
        .then((data) => {
          if (!data) return;
          setProgress(data);
          if (data.finished) setDownloading(false);
        })
        .catch(() => {});
    }, 1200);
    return () => clearInterval(interval);
  }, [jobId, downloading]);

  async function fetchPlaylist(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    setDownloadError(null);
    setJobId(null);
    setProgress(null);
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

  async function startDownload() {
    if (!info || selected.size === 0) return;
    setDownloadError(null);
    triggeredRef.current = new Set();
    const newJobId = crypto.randomUUID();
    const videos = info.videos.filter((v) => selected.has(v.videoId)).map((v) => ({ videoId: v.videoId, title: v.title }));

    try {
      const res = await fetch('/api/playlist-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos, quality, jobId: newJobId }),
      });
      const data = (await res.json()) as { error?: string; total?: number };
      if (!res.ok) throw new Error(data.error ?? `Failed to start (HTTP ${res.status})`);
      setJobId(newJobId);
      setProgress({ total: data.total ?? videos.length, completed: 0, failed: 0, activeTitles: [], finished: false, ready: [] });
      setDownloading(true);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to start download');
    }
  }

  const doneCount = progress ? progress.completed + progress.failed : 0;
  const totalCount = progress?.total ?? 0;

  return (
    <main>
      <h1>▶ Playlist Downloader</h1>
      <p className="subtitle">
        Paste a YouTube playlist link — each video downloads individually, as its own file, the
        moment it&apos;s ready.{' '}
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
            <button type="button" className="btn-secondary" onClick={toggleAll} disabled={downloading}>
              {selected.size === info.videos.length ? 'Deselect all' : 'Select all'}
            </button>
            <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={downloading}>
              {QUALITIES.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            <button type="button" className="btn" onClick={startDownload} disabled={downloading || selected.size === 0}>
              {downloading ? 'Downloading…' : `⬇ Download ${selected.size} videos`}
            </button>
          </div>

          {progress && (
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.9rem' }}>
                <span>
                  {doneCount} / {totalCount} videos
                  {progress.failed > 0 && <span style={{ color: '#ffb4b4' }}> ({progress.failed} failed)</span>}
                </span>
                <span>{Math.round((doneCount / Math.max(1, totalCount)) * 100)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${(doneCount / Math.max(1, totalCount)) * 100}%`,
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
                  Done. Each finished video already triggered its own download — check your
                  Downloads folder. If your browser blocked some as pop-ups, use the links below.
                </p>
              )}
              {progress.ready.length > 0 && jobId && (
                <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: '0.85rem' }}>
                  {progress.ready.map((f) => (
                    <li key={f.videoId}>
                      <a href={fileUrl(jobId, f.videoId)} download={f.filename} style={{ color: 'inherit' }}>
                        {f.filename}
                      </a>
                    </li>
                  ))}
                </ul>
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
                  disabled={downloading}
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
        Each video downloads with several parallel connections, and several videos download at
        once — every finished video becomes its own download immediately, instead of waiting for
        the whole playlist to bundle into one file. If something interrupts the page partway
        through (closed tab, lost connection), everything that already finished is already in your
        Downloads folder; just come back and download the rest separately.
      </p>
    </main>
  );
}
