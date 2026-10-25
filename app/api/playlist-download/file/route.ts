import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getReadyFilePath } from '@/lib/progressStore';
import { contentDisposition } from '@/lib/youtube';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  const videoId = req.nextUrl.searchParams.get('videoId');
  if (!jobId || !videoId) {
    return NextResponse.json({ error: 'Missing jobId or videoId' }, { status: 400 });
  }

  const filePath = getReadyFilePath(jobId, videoId);
  if (!filePath) {
    return NextResponse.json({ error: 'That file is not ready (or the job has expired)' }, { status: 404 });
  }

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: 'File is missing on disk' }, { status: 404 });
  }

  const filename = filePath.split('/').pop() ?? 'video.mp4';
  const stream = createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Disposition': contentDisposition(filename),
    },
  });
}
