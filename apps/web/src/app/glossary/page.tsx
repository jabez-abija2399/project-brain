import { DocPage } from "@/components/landing/doc-page";
import { GLOSSARY } from "@/lib/glossary";
import { isSignedIn } from "@/server/signed-in";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Glossary | Codeceipt",
  description: "The words Codeceipt uses, each in one plain sentence.",
};

// FEAT-028: every word the dashboard underlines, in one place.
export default async function GlossaryPage() {
  return (
    <DocPage signedIn={await isSignedIn()} title="Glossary">
      <p>The words Codeceipt uses, each in one plain sentence.</p>
      <dl className="glossary">
        {GLOSSARY.map((t) => (
          <div key={t.key} id={t.key.replaceAll(" ", "-")}>
            <dt>
              <strong>{t.label}</strong>
            </dt>
            <dd>{t.text}</dd>
          </div>
        ))}
      </dl>
    </DocPage>
  );
}
