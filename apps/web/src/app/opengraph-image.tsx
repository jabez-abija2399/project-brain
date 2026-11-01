import { HERO_ASKED, HERO_CHECKS, HERO_ITEMS } from "@/components/landing/content";
import { ImageResponse } from "next/og";

// The Open Graph image: the landing page's hero receipt on the warm ground. Satori renders it to a PNG with no CSS
// variables, so the light-mode token values from globals.css are repeated here (and only here).
export const alt =
  "A Codeceipt receipt: what you asked, what was done, what was missed and the checks, built from git.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const T = {
  bg: "#f7f5f0",
  paper: "#ffffff",
  ink: "#17181c",
  muted: "#5c5850",
  border: "#e6e2d8",
  accent: "#4f46e5",
  done: "#047857",
  partial: "#a14a07",
  missed: "#c11f1f",
};

// The bundled font has no check or cross glyphs, so each status is its word (still never colour alone).
const LOOK: Record<string, { word: string; color: string }> = {
  done: { word: "Done", color: T.done },
  done_untested: { word: "Done, no test proves it", color: T.partial },
  missed: { word: "Missed", color: T.missed },
  warning: { word: "Check", color: T.partial },
};

function Row({ status, label, text }: { status: string; label?: string; text: string }) {
  const look = LOOK[status] ?? LOOK.warning;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 }}>
      <div
        style={{
          display: "flex",
          color: look?.color,
          border: `2px solid ${look?.color}`,
          borderRadius: 999,
          padding: "2px 12px",
          fontSize: 18,
        }}
      >
        {label ?? look?.word}
      </div>
      <div style={{ display: "flex", color: T.ink }}>{text}</div>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: T.bg,
        padding: "56px 64px",
        gap: 56,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 440, gap: 24 }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: T.ink }}>
          Codeceipt
        </div>
        <div style={{ display: "flex", fontSize: 50, lineHeight: 1.1, color: T.ink }}>
          Your AI agent says it's done. Codeceipt checks.
        </div>
        <div style={{ display: "flex", fontSize: 24, color: T.muted }}>
          A receipt for every AI change, built from git.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          background: T.paper,
          border: `1px solid ${T.border}`,
          padding: "28px 32px",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", color: T.muted }}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: T.ink }}>
            Receipt
          </div>
          <div style={{ display: "flex", fontSize: 18 }}>salon-booking</div>
        </div>
        <div style={{ display: "flex", fontSize: 20, color: T.muted }}>
          {`Asked: "${HERO_ASKED.text}"`}
        </div>
        {HERO_ITEMS.map((l) => (
          <Row
            key={l.id}
            status={l.status}
            label={l.label}
            text={[l.text, l.path].filter(Boolean).join(" ")}
          />
        ))}
        {HERO_CHECKS.slice(0, 2).map((l) => (
          <Row
            key={l.id}
            status={l.status}
            label={l.label}
            text={[l.text, l.path].filter(Boolean).join(" ")}
          />
        ))}
      </div>
    </div>,
    size,
  );
}
