import { supabase } from "@/lib/supabase";

export default async function SettingsPage() {
  const { data } = await supabase.auth.getUser();
  return <p>{data.user?.email}</p>;
}
