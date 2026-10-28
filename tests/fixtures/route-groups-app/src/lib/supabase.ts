import { createClient } from "@supabase/supabase-js";

export const supabase = createClient("https://example.supabase.co", "public-anon-key");
