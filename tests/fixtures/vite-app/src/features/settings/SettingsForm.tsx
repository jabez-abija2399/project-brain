import { supabase } from "@/integrations/supabase/client";

export const SettingsForm = () => <form onSubmit={() => supabase.auth.signOut()} />;
