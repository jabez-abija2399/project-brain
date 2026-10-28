import { StarRating } from "./StarRating";

export function ReviewCard({ title, rating }: { title: string; rating: number }) {
  return (
    <article>
      <h3>{title}</h3>
      <StarRating value={rating} />
    </article>
  );
}
