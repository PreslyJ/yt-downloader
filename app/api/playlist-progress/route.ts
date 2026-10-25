import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/progressStore';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Unknown job (it may have expired)' }, { status: 404 });
  }
  return NextResponse.json(job);
}
