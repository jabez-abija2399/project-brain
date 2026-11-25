"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

// FEAT-028: a row of tabs that scrolls sideways on phones. The current tab is scrolled into view, and a fade at the
// right edge shows there is more until the row is scrolled to its end.
export function TabRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(
        0,
        current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2,
      );
    }
    const update = () => setAtEnd(nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4);
    update();
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      nav.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <nav ref={ref} className="project-nav" aria-label={label} data-end={atEnd ? "true" : "false"}>
      {children}
    </nav>
  );
}
