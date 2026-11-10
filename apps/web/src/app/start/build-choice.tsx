"use client";

import { BUILD_COOKIE, BUILD_LABELS, BUILD_STYLES, type BuildStyle } from "@brain/core";

// Roadmap Phase 9: "How do you build?" Each answer is a link (it works without JavaScript: the page reads ?build=),
// and is remembered in a cookie the server reads (a display preference only: it unlocks nothing). It can be changed
// at any time.
export function BuildChoice({ current }: { current: BuildStyle | null }) {
  return (
    <nav className="row wrap" aria-labelledby="build-how">
      {BUILD_STYLES.map((s) => (
        <a
          key={s}
          href={`/start?build=${s}`}
          className={`btn ${current === s ? "btn-primary" : "btn-secondary"}`}
          aria-current={current === s ? "true" : undefined}
          onClick={() => {
            const secure = window.location.protocol === "https:" ? "; secure" : "";
            document.cookie = `${BUILD_COOKIE}=${s}; path=/; max-age=31536000; samesite=lax${secure}`;
          }}
        >
          {BUILD_LABELS[s]}
        </a>
      ))}
    </nav>
  );
}
