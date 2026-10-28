import type { Review } from "../types";

export function ReviewCard({ review }: { review: Review }) {
  return <article>{review.id}</article>;
}
