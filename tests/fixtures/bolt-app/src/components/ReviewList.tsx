import { supabase } from "../lib/supabase";
import type { Review } from "../types";
import { ReviewCard } from "./ReviewCard";

export function ReviewList({ reviews = [] as Review[] }) {
  void supabase.from("reviews").select();
  return reviews.map((r) => <ReviewCard key={r.id} review={r} />);
}
