import Link from "next/link";

const TABS = [
  { href: "features", label: "Features" },
  { href: "receipts", label: "Receipts" },
  { href: "proposals", label: "Proposals" },
  { href: "connect", label: "Connect" },
  { href: "", label: "Tokens" },
] as const;

export function ProjectNav({
  projectId,
  current,
  name,
}: { projectId: string; current: string; name: string }) {
  return (
    <>
      <Link href="/projects" style={{ fontSize: 13 }}>
        ← Projects
      </Link>
      <h1 className="wrap">{name}</h1>
      <nav className="project-nav" aria-label="Project">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={`/projects/${projectId}${t.href ? `/${t.href}` : ""}`}
            aria-current={t.href === current ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
