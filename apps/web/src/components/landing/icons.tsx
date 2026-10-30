// Small line icons for the landing page's checks list. Decorative: the title next to each says what it is.
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  focusable: false,
};

export function KeyIcon() {
  return (
    <svg {...base} aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg {...base} aria-hidden="true">
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function TestIcon() {
  return (
    <svg {...base} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function PackageIcon() {
  return (
    <svg {...base} aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

export function ScopeIcon() {
  return (
    <svg {...base} aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <path d="M15 9h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}
