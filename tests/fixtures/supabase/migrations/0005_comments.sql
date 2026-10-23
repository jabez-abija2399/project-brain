-- A later file after the broken one must still be read.
CREATE TABLE public.comments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_all ON public.comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
