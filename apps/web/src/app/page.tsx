export default function HomePage() {
  return (
    <main
      style={{
        padding: "48px 32px",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Project Brain</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        Walking skeleton. The dashboard, sign-in and MCP endpoint arrive in later features.
      </p>
      <p style={{ marginTop: 24, fontSize: 14, color: "var(--muted)" }}>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
