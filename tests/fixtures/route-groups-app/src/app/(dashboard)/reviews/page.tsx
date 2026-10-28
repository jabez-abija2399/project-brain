import { Header } from "@/components/app/Header";
import { ReviewList } from "@/components/reviews/ReviewList";
import { supabase } from "@/lib/supabase";

export default async function ReviewsPage() {
  const { data } = await supabase.from("reviews").select();
  return (
    <>
      <Header title="Reviews" />
      <ReviewList reviews={data ?? []} />
    </>
  );
}
