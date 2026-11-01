"use client";

import { Button } from "@/components/ui/button";

// Error state for every page without its own: what happened and what to do next, never internal details.
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="page page-narrow">
      <div className="empty error-state" role="alert">
        <h1 className="section-title">Something went wrong on this page</h1>
        <p className="muted">
          The server did not answer as expected. Try again; if it keeps failing, go back to your
          projects and check your connection.
        </p>
        <div className="row">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <a className="btn btn-ghost" href="/projects?all=1">
            Your projects
          </a>
        </div>
      </div>
    </main>
  );
}
