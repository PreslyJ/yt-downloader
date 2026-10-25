// In-memory job state for playlist downloads. Single-process only (fine for
// the local launch-agent deployment; a multi-instance deployment, e.g.
// Vercel, would need a shared store instead).
//
// Each video becomes its own file on disk the moment it's done, served
// individually rather than bundled into one all-or-nothing zip — if the
// browser/connection drops partway through a large playlist, everything
// already finished is already a completed download, not lost.
export interface JobProgressView {
  total: number;
  completed: number;
  failed: number;
  activeTitles: string[];
  finished: boolean;
  ready: Array<{ videoId: string; filename: string }>;
}

interface Job {
  total: number;
  completed: number;
  failed: number;
  active: Map<string, string>; // videoId -> title, for videos currently in flight
  ready: Map<string, { path: string; filename: string }>; // videoId -> completed file
  finished: boolean;
  outputDir: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const TTL_MS = 60 * 60 * 1000; // an hour to actually click each download

function sweep(onExpire: (job: Job) => void) {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
      onExpire(job);
    }
  }
}

export function createJob(jobId: string, total: number, outputDir: string, onExpire: (job: { outputDir: string }) => void): void {
  sweep(onExpire);
  jobs.set(jobId, { total, completed: 0, failed: 0, active: new Map(), ready: new Map(), finished: false, outputDir, createdAt: Date.now() });
}

export function markStarted(jobId: string, videoId: string, title: string): void {
  jobs.get(jobId)?.active.set(videoId, title);
}

export function markCompleted(jobId: string, videoId: string, path: string, filename: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.active.delete(videoId);
  job.ready.set(videoId, { path, filename });
  job.completed += 1;
}

export function markFailed(jobId: string, videoId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.active.delete(videoId);
  job.failed += 1;
}

export function markFinished(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.finished = true;
}

export function getJob(jobId: string): JobProgressView | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  return {
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    activeTitles: [...job.active.values()],
    finished: job.finished,
    ready: [...job.ready.entries()].map(([videoId, f]) => ({ videoId, filename: f.filename })),
  };
}

export function getReadyFilePath(jobId: string, videoId: string): string | undefined {
  return jobs.get(jobId)?.ready.get(videoId)?.path;
}
