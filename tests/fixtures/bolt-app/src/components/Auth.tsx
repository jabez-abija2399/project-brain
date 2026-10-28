import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export function Auth() {
  const { signIn } = useAuth();
  return <button onClick={() => signIn(supabase)}>Sign in</button>;
}
