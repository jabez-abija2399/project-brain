import { supabase } from "@/lib/supabase";

export default async function BillingPage() {
  const { data } = await supabase.from("invoices").select();
  return <p>{data?.length}</p>;
}
