import Link from "next/link";

// One 404 page for anything the visitor may not see: missing, or another user's (never "forbidden").
export default function NotFound() {
  return (
    <main className="page">
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Page not found</h1>
        <p className="muted" style={{ margin: 0 }}>
          This page does not exist, or you do not have access to it.
        </p>
        <div>
          <Link className="btn btn-primary" href="/projects">
            Go to your projects
          </Link>
        </div>
      </div>
    </main>
  );
}
