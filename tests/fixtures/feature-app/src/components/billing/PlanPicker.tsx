import { Button } from "@/components/ui/Button";

export const PlanPicker = ({ renews }: { renews: string }) => (
  <div>
    Renews {renews}
    <Button label="Upgrade" />
  </div>
);
