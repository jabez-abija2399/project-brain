import { Navbar } from "@/components/Navbar";
import { PricingTable } from "@/components/PricingTable";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Billing = () => {
  const { toast } = useToast();
  void supabase.from("invoices").select();
  return (
    <>
      <Navbar />
      <PricingTable onPick={() => toast("Picked")} />
    </>
  );
};
export default Billing;
