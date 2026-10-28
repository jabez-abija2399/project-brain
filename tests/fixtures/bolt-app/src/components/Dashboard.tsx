import { BillingPanel } from "./BillingPanel";
import { Header } from "./Header";
import { ReviewList } from "./ReviewList";

export function Dashboard() {
  return (
    <main>
      <Header />
      <ReviewList />
      <BillingPanel />
    </main>
  );
}
