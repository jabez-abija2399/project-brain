// Screenshots of the real pages for docs/portfolio, from the running demo server (demo-server.mjs). 1600x1200 (4:3),
// light mode, plus dark versions of the overview and the opened receipt. Every image's page text is checked for
// tokens, keys, emails and ids before it is saved.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = fileURLToPath(new URL("../../../docs/portfolio/", import.meta.url));
const state = JSON.parse(
  readFileSync(process.env.PORTFOLIO_STATE ?? "/tmp/codeceipt-portfolio-state.json", "utf8"),
);
const BASE = `http://localhost:${state.appPort}`;
const P = `/projects/${state.projectId}`;

// Nothing secret or identifying may be in an image: the session, the project token, the project id, a real email.
export function assertSafe(text, name) {
  const bad = [
    [state.cookieValue.split(".")[0], "session token"],
    [state.projectToken, "project token"],
    [state.projectId, "project id"],
  ].filter(([v]) => text.includes(v));
  if (/\bpb_[A-Za-z0-9_-]{16,}/.test(text)) bad.push(["pb_", "token-shaped text"]);
  if (/\bsk_(live|test)_[A-Za-z0-9]{8,}/.test(text)) bad.push(["sk_", "unmasked Stripe key"]);
  if (/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/.test(text))
    bad.push(["@", "an email that is not example.com"]);
  if (bad.length > 0)
    throw new Error(`${name}: refusing to save, page shows ${bad.map((b) => b[1]).join(", ")}`);
}

const browser = await chromium.launch();
async function page(scheme, signedIn = true, full = false) {
  const ctx = await browser.newContext({
    // 1600x1200 output: most pages at 125% for readability; the long receipt at 100% so the whole card fits.
    viewport: full ? { width: 1600, height: 1200 } : { width: 1280, height: 960 },
    deviceScaleFactor: full ? 1 : 1.25,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  // The browser keeps no __Secure- cookie for a plain-http host, so the session goes in each request's header.
  if (signedIn) {
    await ctx.setExtraHTTPHeaders({
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(state.cookieValue)}`,
    });
  }
  return ctx.newPage();
}

async function shot(name, path, { scheme = "light", prepare, signedIn = true, full = false } = {}) {
  const p = await page(scheme, signedIn, full);
  const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (!res || res.status() >= 400) throw new Error(`${path}: HTTP ${res?.status()}`);
  await p.evaluate(() => document.fonts.ready);
  if (prepare) await prepare(p);
  await p.waitForTimeout(300);
  assertSafe(await p.evaluate(() => document.body.innerText), name);
  await p.screenshot({ path: `${OUT}${name}`, animations: "disabled" });
  await p.context().close();
  console.log(`[portfolio] ${name}`);
}

// The opened receipt (the newest, open on page 1): the whole card, zoomed out just enough to fit the frame.
const openReceipt = async (p) => {
  const gap = await p.evaluate(() => {
    const card = document.querySelector('[id^="receipt-"]');
    if (!card) throw new Error("no receipt card");
    const head = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
    window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - head - 8);
    return window.innerHeight - head - 8 - card.getBoundingClientRect().height;
  });
  if (gap < 0) throw new Error(`the opened receipt is ${-gap}px taller than the frame`);
};

await shot("02-landing.png", "/", { signedIn: false });
await shot("03-receipt.png", `${P}/receipts`, { prepare: openReceipt, full: true });
await shot("04-overview.png", `${P}/overview`);
await shot("05-features.png", `${P}/features`);
await shot("06-start.png", "/start");
await shot("08-receipt-dark.png", `${P}/receipts`, {
  scheme: "dark",
  prepare: openReceipt,
  full: true,
});
await shot("09-overview-dark.png", `${P}/overview`, { scheme: "dark" });

// The opened receipt card alone, for the cover (the header made static so it never covers the card).
{
  const p = await page("light");
  await p.goto(`${BASE}${P}/receipts`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: "header{position:static!important}" });
  globalThis.receiptCrop = (await p.locator('[id^="receipt-"]').first().screenshot()).toString(
    "base64",
  );
  await p.context().close();
}

// Pages made of the app's own head (fonts and colour tokens) with our own body: terminals and the cover.
async function composed(name, html, scheme = "light") {
  const p = await page(scheme, false);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.evaluate((body) => {
    document.body.innerHTML = body;
    document.body.style.margin = "0";
  }, html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  assertSafe(await p.evaluate(() => document.body.innerText), name);
  await p.screenshot({ path: `${OUT}${name}`, animations: "disabled" });
  await p.context().close();
  console.log(`[portfolio] ${name}`);
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The real CLI's output, with the demo project and receipt ids in the link left out.
const output = (file) =>
  readFileSync(file, "utf8")
    .replace(/(\/projects\/)[0-9a-f-]{36}/g, "$1…")
    .replace(/(#receipt-)[0-9a-f-]{36}/g, "$1…")
    .trimEnd();
const terminal = (command, text) => `
  <div style="min-height:100vh;box-sizing:border-box;padding:56px;background:var(--bg);display:flex;align-items:center;justify-content:center">
    <div style="width:100%;border-radius:14px;overflow:hidden;background:var(--ink);box-shadow:var(--shadow-md)">
      <div style="display:flex;gap:8px;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)">
        <span style="width:12px;height:12px;border-radius:50%;background:#e5534b"></span>
        <span style="width:12px;height:12px;border-radius:50%;background:#d29922"></span>
        <span style="width:12px;height:12px;border-radius:50%;background:#3fb950"></span>
        <span style="margin-left:12px;color:var(--on-ink-muted);font:13px var(--font-mono)">~/salon-booking</span>
      </div>
      <pre style="margin:0;padding:24px 28px 30px;color:var(--on-ink);font:15.5px/1.6 var(--font-mono);white-space:pre-wrap;word-break:break-word"><span style="color:var(--on-ink-muted)">$</span> ${esc(command)}
${esc(text)}
<span style="color:var(--on-ink-muted)">$</span> <span style="display:inline-block;width:9px;height:18px;vertical-align:-3px;background:var(--on-ink)"></span></pre>
    </div>
  </div>`;
const TMP = process.env.PORTFOLIO_CLI_OUT ?? "/tmp/codeceipt-portfolio-cli";
await composed("07-terminal-last.png", terminal("codeceipt last", output(`${TMP}/last.txt`)));
await composed(
  "10-terminal-evidence.png",
  terminal("codeceipt last --evidence", output(`${TMP}/evidence.txt`)),
);

await composed(
  "01-cover.png",
  `<div style="height:100vh;box-sizing:border-box;padding:64px 0 0 64px;background:var(--bg);display:grid;grid-template-columns:520px 1fr;grid-template-rows:1136px;gap:44px;font-family:var(--font-ui);color:var(--text);overflow:hidden">
    <div style="align-self:center;padding-bottom:64px">
      <div style="font-size:76px;font-weight:700;letter-spacing:-0.03em;line-height:1">Codeceipt</div>
      <div style="margin-top:22px;font-size:34px;line-height:1.2;font-weight:600">A receipt for every AI change</div>
      <p style="margin:24px 0 0;font-size:20px;line-height:1.55;color:var(--muted)">Every Claude Code or Cursor session ends with a receipt: what you asked, what changed, what was missed. Built from git, not the agent's word.</p>
      <div style="margin-top:30px;display:inline-block;padding:12px 18px;border-radius:10px;background:var(--ink);color:var(--on-ink);font:18px var(--font-mono)">$ npx codeceipt</div>
    </div>
    <div style="align-self:start;border-radius:12px 0 0 0;overflow:hidden;box-shadow:var(--shadow-md);border:1px solid var(--border);border-right:0;height:100%">
      <img alt="" style="display:block;width:1060px" src="data:image/png;base64,${globalThis.receiptCrop}">
    </div>
  </div>`,
);
await browser.close();
