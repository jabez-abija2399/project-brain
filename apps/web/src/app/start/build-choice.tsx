"use client";

import { BUILD_COOKIE, BUILD_LABELS, BUILD_STYLES, type BuildStyle } from "@brain/core";

// Roadmap Phase 9: "How do you build?" Each answer is a link (it works without JavaScript: the page reads ?build=),
// and is remembered in a cookie the server reads (a display preference only: it unlocks nothing). It can be changed
// at any time.
export function BuildChoice({ current }: { current: BuildStyle | null }) {
  return (
    <fieldset className="row wrap build-choice">
      <legend className="lp-visually-hidden">How do you build?</legend>
      {BUILD_STYLES.map((s) => (
        <a
          key={s}
          href={`/start?build=${s}`}
          className={`btn ${current === s ? "btn-primary" : "btn-secondary"}`}
          aria-current={current === s ? "true" : undefined}
          onClick={() => {
            document.cookie = `${BUILD_COOKIE}=${s}; path=/; max-age=31536000; samesite=lax`;
          }}
        >
          {BUILD_LABELS[s]}
        </a>
      ))}
    </fieldset>
  );
}
