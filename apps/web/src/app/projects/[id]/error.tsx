"use client";

import { Button } from "@/components/ui/button";

// Error state for every project page: what happened and what to do next, never internal details.
export default function ProjectError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <div className="card stack" role="alert">
        <h2 style={{ fontSize: 16, margin: 0 }}>This page could not be loaded</h2>
        <p className="muted" style={{ margin: 0 }}>
          The server did not answer as expected. Try again; if it keeps failing, check your
          connection.
        </p>
        <div>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
