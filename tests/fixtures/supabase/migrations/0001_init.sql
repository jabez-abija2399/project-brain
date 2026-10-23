-- Initial migration: core tables (no RLS yet)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Posts" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  tags text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT posts_title_len CHECK (char_length(title) > 0)
);
