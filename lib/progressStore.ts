// In-memory job progress for the playlist download endpoint. Single-process
// only (fine for the local launch-agent deployment; a multi-instance
// deployment, e.g. Vercel, would need a shared store instead).
export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  activeTitles: string[];
  finished: boolean;
  createdAt: number;
}

interface Job {
  total: number;
  completed: number;
  failed: number;
  active: Map<string, string>; // videoId -> title, for videos currently in flight
  finished: boolean;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const TTL_MS = 30 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createJob(jobId: string, total: number): void {
  sweep();
  jobs.set(jobId, { total, completed: 0, failed: 0, active: new Map(), finished: false, createdAt: Date.now() });
}

export function markStarted(jobId: string, videoId: string, title: string): void {
  jobs.get(jobId)?.active.set(videoId, title);
}

export function markCompleted(jobId: string, videoId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.active.delete(videoId);
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

export function getJob(jobId: string): JobProgress | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  return {
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    activeTitles: [...job.active.values()],
    finished: job.finished,
    createdAt: job.createdAt,
  };
}
