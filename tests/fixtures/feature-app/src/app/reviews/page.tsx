import { ReviewList } from "@/components/reviews/ReviewList";
import { formatDate } from "@/lib/format";

export default function ReviewsPage() {
  return <ReviewList updated={formatDate(new Date(0))} />;
}
