-- Deliberately broken: unbalanced parentheses so parseStatement throws.
CREATE TABLE public.broken (
  id uuid PRIMARY KEY,
  payload text
;
