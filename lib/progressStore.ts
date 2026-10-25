// In-memory job progress for the playlist download endpoint. Single-process
// only (fine for the local launch-agent deployment; a multi-instance
// deployment, e.g. Vercel, would need a shared store instead).
export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  currentTitle: string | null;
  finished: boolean;
  createdAt: number;
}

const jobs = new Map<string, JobProgress>();
const TTL_MS = 30 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createJob(jobId: string, total: number): void {
  sweep();
  jobs.set(jobId, { total, completed: 0, failed: 0, currentTitle: null, finished: false, createdAt: Date.now() });
}

export function setCurrentTitle(jobId: string, title: string): void {
  const job = jobs.get(jobId);
  if (job) job.currentTitle = title;
}

export function markCompleted(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.completed += 1;
}

export function markFailed(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.failed += 1;
}

export function markFinished(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.finished = true;
}

export function getJob(jobId: string): JobProgress | undefined {
  return jobs.get(jobId);
}
