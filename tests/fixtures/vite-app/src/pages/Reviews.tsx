import { Navbar } from "@/components/Navbar";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { supabase } from "@/integrations/supabase/client";

const Reviews = () => {
  void supabase.from("reviews").select();
  return (
    <>
      <Navbar />
      <ReviewCard />
    </>
  );
};
export default Reviews;
