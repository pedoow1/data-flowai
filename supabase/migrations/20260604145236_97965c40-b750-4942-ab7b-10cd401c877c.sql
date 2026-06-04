ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_chunks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_chunks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eta_seconds integer,
  ADD COLUMN IF NOT EXISTS last_heartbeat timestamptz;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_progress_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_progress_check CHECK (progress >= 0 AND progress <= 100);

CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON public.jobs (status, updated_at DESC);