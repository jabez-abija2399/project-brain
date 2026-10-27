import { ReviewCard } from "./ReviewCard";

export const ReviewList = ({ updated }: { updated: string }) => (
  <section>
    <p>{updated}</p>
    <ReviewCard id="1" />
  </section>
);
