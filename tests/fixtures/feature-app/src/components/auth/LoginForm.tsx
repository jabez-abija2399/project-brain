import { Button } from "@/components/ui/Button";
import { readSession } from "@/lib/session";

export const LoginForm = () => (
  <form>
    {readSession(null) ? "Signed in" : <Button label="Sign in" />}
  </form>
);
