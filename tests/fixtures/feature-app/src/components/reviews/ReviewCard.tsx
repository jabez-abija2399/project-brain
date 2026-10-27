import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/format";

export const ReviewCard = ({ id }: { id: string }) => (
  <article>
    Review {id} {formatDate(new Date(0))}
    <Button label="Reply" />
  </article>
);
