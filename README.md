# YT Downloader

Personal web app: paste a YouTube link, get the video as a single MP4 (video+audio) plus
its thumbnail.

## How it works

- `/api/info` — resolves the video via YouTube's InnerTube API using the **visionOS client
  identity** (mirrors yt-dlp's `visionos` config). That client still returns direct stream
  URLs — no SABR streaming, no signature deciphering, no Proof-of-Origin token.
- `/api/download` — YouTube only serves video and audio as separate streams, so the route
  fetches both and remuxes them with **ffmpeg stream-copy** (no re-encoding), embedding the
  video's thumbnail as MP4 cover art. Cover art doesn't survive fragmented/streamed output,
  so the file is muxed to a temp file first and then sent (which also gives the browser an
  exact Content-Length) — the download prompt appears once muxing finishes.
- `/api/thumbnail` — proxies the `i.ytimg.com` thumbnail with an attachment disposition
  (restricted to `*.ytimg.com`, so it is not an open proxy).

Quality picker prefers h264 (avc1) per resolution for playback compatibility and falls
back to AV1 where that's the only rendition (e.g. 4K).

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
```

## Deploy to Vercel

```bash
npx vercel
```

Notes for Vercel:

- `next.config.mjs` ships the ffmpeg binary with the function
  (`outputFileTracingIncludes`) and keeps `ffmpeg-static` unbundled so its binary path
  resolves.
- `/api/download` sets `maxDuration = 300`; long/high-quality videos may still hit the
  plan's function time limit, and YouTube throttles stream URLs to roughly realtime, so
  a 10-minute video takes a few minutes to pull.
- YouTube aggressively bot-checks datacenter IPs. This works from residential IPs; from
  Vercel's egress it may intermittently answer "Sign in to confirm you're not a bot".
  If that happens there is no clean fix short of a proxy.

## Caveats

- The visionOS client trick is the same cat-and-mouse yt-dlp plays; YouTube can close it
  at any time. If `/api/info` starts failing, check what client yt-dlp currently uses
  (`yt_dlp/extractor/youtube/_base.py`) and update `VISIONOS_CLIENT` in `lib/youtube.ts`.
- Personal use only, on content you have the right to download. Downloading most YouTube
  content violates YouTube's Terms of Service.
