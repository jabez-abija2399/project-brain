import { PlanPicker } from "@/components/billing/PlanPicker";
import { formatDate } from "@/lib/format";

export default function BillingPage() {
  return <PlanPicker renews={formatDate(new Date(0))} />;
}
