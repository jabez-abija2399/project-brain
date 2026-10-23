-- Boundary case AC-005-03: enable RLS on Posts, created in an earlier file.
ALTER TABLE "Posts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY posts_author_write ON "Posts"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);
