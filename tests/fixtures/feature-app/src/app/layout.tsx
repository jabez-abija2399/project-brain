import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Button label="Menu" />
        {children}
      </body>
    </html>
  );
}
