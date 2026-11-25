// FEAT-040: the sidebar and bottom-bar icons (stroke icons drawn here, no icon package). Decorative: every link
// also has its word.
const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  focusable: false,
};

export type NavIconName =
  | "home"
  | "receipts"
  | "decide"
  | "features"
  | "blueprint"
  | "settings"
  | "docs"
  | "projects"
  | "account"
  | "more";

export function NavIcon({ name }: { name: NavIconName }) {
  switch (name) {
    case "home":
      return (
        <svg {...P}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
        </svg>
      );
    case "receipts":
      return (
        <svg {...P}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case "decide":
      return (
        <svg {...P}>
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M9 10.5l2 2 4-4" />
        </svg>
      );
    case "features":
      return (
        <svg {...P}>
          <rect x="3.5" y="4" width="17" height="4" rx="1.5" />
          <rect x="3.5" y="10" width="17" height="4" rx="1.5" />
          <rect x="3.5" y="16" width="11" height="4" rx="1.5" />
        </svg>
      );
    case "blueprint":
      return (
        <svg {...P}>
          <path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...P}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
        </svg>
      );
    case "docs":
      return (
        <svg {...P}>
          <path d="M5 4h10l4 4v12H5z" />
          <path d="M14 4v5h5" />
        </svg>
      );
    case "projects":
      return (
        <svg {...P}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
        </svg>
      );
    case "account":
      return (
        <svg {...P}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
        </svg>
      );
    default:
      return (
        <svg {...P}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
  }
}
