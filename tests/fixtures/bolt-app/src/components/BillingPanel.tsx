import { supabase } from "../lib/supabase";

export function BillingPanel() {
  void supabase.from("plans").select();
  return <section>Plan</section>;
}
