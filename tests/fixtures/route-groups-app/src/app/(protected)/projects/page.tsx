import { supabase } from "@/lib/supabase";

export default async function ProjectsPage() {
  const { data } = await supabase.from("projects").select();
  return <p>{data?.length}</p>;
}
