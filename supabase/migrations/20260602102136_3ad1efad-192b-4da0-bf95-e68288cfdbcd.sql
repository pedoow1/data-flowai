-- Generic updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- job_status enum (idempotent)
DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('pending','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Jobs table
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'extraction',
  status public.job_status NOT NULL DEFAULT 'pending',
  file_name text,
  input jsonb NOT NULL,
  output jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Grants (Data API access)
GRANT SELECT, INSERT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;

-- RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own jobs"
  ON public.jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins read all jobs"
  ON public.jobs FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helpful index for polling/listing
CREATE INDEX idx_jobs_user_created ON public.jobs (user_id, created_at DESC);