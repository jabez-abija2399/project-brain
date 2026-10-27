import { ReviewCard } from "@/components/reviews/ReviewCard";

export default function ReviewPage({ params }: { params: { id: string } }) {
  return <ReviewCard id={params.id} />;
}
