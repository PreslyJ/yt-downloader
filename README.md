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

## Run permanently on a Mac (launch agent)

YouTube trusts a home IP, so running it on your own machine is the no-proxy option. A
launch agent (`~/Library/LaunchAgents/com.presly.yt-downloader.plist`) starts the built app
at login, restarts it if it dies, binds to `127.0.0.1:3210` only, and logs to
`~/Library/Logs/yt-downloader.log`.

It runs from a **copy** in `~/.local/share/yt-downloader`, not from this repo: macOS blocks
background agents from reading `~/Documents` (a privacy prompt nobody can answer, so the
process hangs silently). After changing code, redeploy the copy:

```bash
npm run build
rsync -a --delete --exclude .git --exclude '.env*' ./ ~/.local/share/yt-downloader/
launchctl kickstart -k gui/$(id -u)/com.presly.yt-downloader
```

Stop it with `launchctl bootout gui/$(id -u)/com.presly.yt-downloader`. The plist pins the
nvm node path (`v20.19.0`); update it if that version is removed.

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
- YouTube blocks datacenter IPs outright: from Vercel (any region) every request is
  answered "Sign in to confirm you're not a bot". Set the `YT_PROXY_URL` env var to a
  residential proxy (see below) and the deployment works.
- `/api/download` muxes into the function's `/tmp` (512 MB limit), so very large
  videos (roughly >400 MB, e.g. long 1080p+) will fail on Vercel.

## Proxy (`YT_PROXY_URL`)

When set, every YouTube request (player lookup and the video/audio downloads) goes through
the proxy. Thumbnails (`i.ytimg.com`) are not blocked and bypass it.

```bash
YT_PROXY_URL=http://USERNAME:PASSWORD@proxy.example.com:8000
```

- Use a **residential** proxy; datacenter proxies get the same bot wall.
- It must be a **sticky session**: YouTube stream URLs are bound to the IP that requested
  them, so a proxy that rotates the exit IP per connection makes the media fetch fail with
  403. Providers usually expose stickiness as a session id in the username
  (e.g. `user-session-abc123`) or a dedicated sticky port.
- All video bytes flow through the proxy, so you are billed per GB (a 100 MB video costs
  100 MB of proxy traffic).
- Vercel: Project → Settings → Environment Variables → add `YT_PROXY_URL`, then redeploy.
- Locally: `YT_PROXY_URL=... npm run dev` (or put it in `.env.local`).

## Caveats

- The visionOS client trick is the same cat-and-mouse yt-dlp plays; YouTube can close it
  at any time. If `/api/info` starts failing, check what client yt-dlp currently uses
  (`yt_dlp/extractor/youtube/_base.py`) and update `VISIONOS_CLIENT` in `lib/youtube.ts`.
- Personal use only, on content you have the right to download. Downloading most YouTube
  content violates YouTube's Terms of Service.
