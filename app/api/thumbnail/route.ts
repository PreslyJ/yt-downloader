import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Proxies a YouTube thumbnail so the browser gets a same-origin response with
// an attachment disposition. Restricted to ytimg.com to avoid being an open proxy.
export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('src');
  const name = req.nextUrl.searchParams.get('name') ?? 'thumbnail';

  let parsed: URL;
  try {
    parsed = new URL(src ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid src' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.ytimg.com')) {
    return NextResponse.json({ error: 'Only ytimg.com thumbnails allowed' }, { status: 400 });
  }

  const upstream = await fetch(parsed, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
  const safeName = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 120) || 'thumbnail';

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="thumbnail.${ext}"; filename*=UTF-8''${encodeURIComponent(`${safeName}.${ext}`)}`,
    },
  });
}
