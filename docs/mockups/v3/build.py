"""Builds the v3 mock-up pages from one shell (sidebar, phone top bar and bottom bar). Run: python3 build.py"""

ICON = {
    "home": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/></svg>',
    "receipts": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    "decide": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M9 10.5l2 2 4-4"/></svg>',
    "features": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="4" rx="1.5"/><rect x="3.5" y="10" width="17" height="4" rx="1.5"/><rect x="3.5" y="16" width="11" height="4" rx="1.5"/></svg>',
    "blueprint": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    "settings": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>',
    "docs": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5"/></svg>',
    "more": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    "check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    "warn": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>',
    "key": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M18 5l2 2"/></svg>',
    "ask": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M12 9v3M12 14.5h.01"/></svg>',
}

NAV = [("home", "Home", "home.html", None), ("receipts", "Receipts", "receipts.html", None),
       ("decide", "To decide", "decide.html", 2), ("features", "Features", "features.html", None),
       ("blueprint", "Blueprint", "blueprint.html", None)]


def shell(current, title, body, theme="light"):
    nav = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if key == current else ""}>{ICON[key]}{label}'
        f'{f"<span class=count>{n}</span>" if n else ""}</a>'
        for key, label, href, n in NAV)
    tabs = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if key == current else ""}>{ICON[key]}{label.split()[0] if key != "decide" else "Decide"}'
        f'{f"<span class=count>{n}</span>" if n else ""}</a>'
        for key, label, href, n in NAV[:4]) + f'<a href="#">{ICON["more"]}More</a>'
    switcher = ('<button class="switcher" type="button"><span class="dot dot-wait"></span>'
                '<span><b>salon-booking</b><small>2 things need you</small></span><span class="chev">⌄</span></button>')
    return f"""<!doctype html>
<html lang="en" data-theme="{theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Codeceipt v3 mock-up</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="v3.css"></head>
<body><div class="app">
<aside class="rail" aria-label="Sidebar">
  <div class="brand"><span class="brand-mark">C</span>Codeceipt</div>
  {switcher}
  <nav class="nav" aria-label="Project">{nav}</nav>
  <div class="rail-foot nav">
    <a href="#">{ICON["settings"]}Settings</a><a href="#">{ICON["docs"]}Docs</a>
    <div class="me"><span class="avatar">M</span><span><b>Maya</b><br><small style="color:var(--muted)">Free beta</small></span></div>
  </div>
</aside>
<div>
<header class="topbar"><span class="brand-mark">C</span>{switcher}<span class="avatar">M</span></header>
<main class="main">{body}</main>
</div></div>
<nav class="tabbar" aria-label="Project">{tabs}</nav>
</body></html>"""


HOME = f"""<div class="page">
<p class="crumb">salon-booking</p>
<div class="verdict">
  <div class="seal seal-wait" aria-hidden="true"><b>2</b></div>
  <div class="verdict-text">
    <h2>Two things need you before your next session.</h2>
    <p>Your agent's last session did 4 of the 5 things you asked. Nothing unsafe was found.</p>
  </div>
</div>

<section class="section">
  <div class="section-head"><h3>Needs you</h3><a href="decide.html">Open To decide</a></div>
  <ul class="list panel">
    <li><span class="ico ico-wait">{ICON["ask"]}</span>
      <div class="grow"><div class="title">Your agent wants to delete the Old cart page</div><div class="sub">3 files and 1 table. Asked 20 minutes ago, expires in 23 hours.</div></div>
      <a class="btn btn-primary btn-sm" href="decide.html">Review</a></li>
    <li><span class="ico ico-missed">{ICON["warn"]}</span>
      <div class="grow"><div class="title">Missed: empty state when there are no reviews</div><div class="sub">From "Add reviews to the salon page". Give your agent the fix in one click.</div></div>
      <button class="btn btn-sm" type="button">Copy fix for your agent</button></li>
  </ul>
</section>

<div class="two">
<section class="section">
  <div class="section-head"><h3>Latest receipt</h3><a href="receipt.html">Open receipt</a></div>
  <div class="paper">
    <div class="paper-row muted"><span>Claude Code · 14 min</span><span>Today 10:42</span></div>
    <hr class="rule">
    <div class="ask">Add reviews to the salon page, newest first</div>
    <hr class="rule">
    <ul class="paper-lines">
      <li><span class="what">Reviews list on the salon page</span><span class="st st-done">Done</span></li>
      <li><span class="what">Sorted newest first</span><span class="st st-done">Done</span></li>
      <li><span class="what">Average star rating</span><span class="st st-partly">Partly</span></li>
      <li><span class="what">Empty state with no reviews</span><span class="st st-missed">Missed</span></li>
    </ul>
    <hr class="rule">
    <div class="paper-row"><span>Security checks</span><span class="st st-done">All clear</span></div>
  </div>
</section>

<section class="section">
  <div class="section-head"><h3>Your app, part by part</h3><a href="features.html">All features</a></div>
  <div class="panel" style="padding:6px 18px">
    <div style="padding:12px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between"><b>Reviews</b><span class="sub" style="color:var(--muted);font-size:13px">2 left</span></div>
      <div class="track"><span class="on"></span><span class="on"></span><span class="on"></span><span></span></div>
      <div class="track-labels"><span>Planned</span><span>Being built</span><span class="now">Checking</span><span>Done</span></div></div>
    <div style="padding:12px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between"><b>Booking</b><span style="color:var(--done);font-size:13px;font-weight:600">Done</span></div>
      <div class="track"><span class="on"></span><span class="on"></span><span class="on"></span><span class="on"></span></div>
      <div class="track-labels"><span>Planned</span><span>Being built</span><span>Checking</span><span class="now">Done</span></div></div>
    <div style="padding:12px 0"><div style="display:flex;justify-content:space-between"><b>Payments</b><span style="color:var(--muted);font-size:13px">Not started</span></div>
      <div class="track"><span class="on"></span><span></span><span></span><span></span></div>
      <div class="track-labels"><span class="now">Planned</span><span>Being built</span><span>Checking</span><span>Done</span></div></div>
  </div>
</section>
</div>
</div>"""

RECEIPT = f"""<div class="page">
<p class="crumb"><a href="receipts.html">Receipts</a> / Today 10:42</p>
<div class="verdict" style="padding-top:14px">
  <div class="seal seal-wait" aria-hidden="true">{ICON["warn"]}</div>
  <div class="verdict-text">
    <h2>4 of 5 done. One thing was missed.</h2>
    <p>Built from your code changes, not your agent's word. Nothing unsafe was found.</p>
  </div>
</div>
<div class="paper" style="margin-bottom:34px">
  <div class="paper-row muted"><span>salon-booking · Claude Code · 14 min</span><span>Commit 3f9c2ab</span></div>
  <hr class="rule">
  <div class="muted">You asked</div>
  <div class="ask">Add reviews to the salon page, sorted newest first, with the average rating</div>
  <hr class="rule">
  <ul class="paper-lines">
    <li><span class="what">Empty state when there are no reviews</span><span class="st st-missed chip">Missed</span></li>
    <li><span class="what">Average star rating, shown with one decimal</span><span class="st st-partly chip">Partly done</span></li>
    <li><span class="what">Reviews list on the salon page</span><span class="st st-done chip">Done</span></li>
    <li><span class="what">Sorted newest first</span><span class="st st-done chip">Done</span></li>
    <li><span class="what">Loading spinner while reviews load</span><span class="st st-unchecked chip">Not checked</span></li>
  </ul>
  <hr class="rule">
  <div class="paper-row"><span>Security: secret keys, open tables, tests</span><span class="st st-done">All clear</span></div>
  <div class="paper-row"><span>Changed outside your request</span><span>1 file</span></div>
</div>

<section class="section">
  <div class="section-head"><h3>Fix what was missed</h3></div>
  <div class="panel" style="padding:18px;display:grid;gap:12px">
    <p style="margin:0">Paste this into Claude Code or Cursor. It names the missed item and the files involved.</p>
    <div class="mono" style="font-size:13px;background:var(--canvas);border:1px solid var(--line);border-radius:10px;padding:12px 14px;color:var(--muted)">Show an empty state on the salon page when there are no reviews yet. Files: src/pages/Salon.tsx…</div>
    <div class="actions"><button class="btn btn-primary" type="button">Copy fix for your agent</button><button class="btn btn-quiet" type="button">Share a read-only link</button></div>
  </div>
</section>

<section class="section">
  <details class="panel" style="padding:14px 18px"><summary style="cursor:pointer;font-weight:600">Changed outside your request (1 file)</summary>
  <p class="mono" style="margin:10px 0 0;font-size:13px">src/pages/checkout.tsx <span style="color:var(--muted);font-family:var(--ui)">changed a button label; nothing to do with reviews</span></p></details>
</section>
</div>"""

DECIDE = f"""<div class="page-wide">
<div class="head"><div><h1>To decide</h1><p class="purpose">Your agent waits for you on these. Nothing changes until you choose.</p></div></div>
<div class="split">
  <div class="queue"><ul class="list">
    <li aria-current="true"><span class="ico ico-missed">{ICON["warn"]}</span><div class="grow"><div class="title">Delete the Old cart page</div><div class="sub">High risk · 20 min ago</div></div></li>
    <li><span class="ico ico-wait">{ICON["ask"]}</span><div class="grow"><div class="title">Reword a checklist item</div><div class="sub">"Average rating with one decimal" · 1 h ago</div></div></li>
  </ul></div>
  <div class="pane">
    <span class="st st-missed chip" style="justify-self:start">High risk</span>
    <h2>Your agent wants to delete the Old cart page: 3 files and the <span class="mono">carts</span> table.</h2>
    <p style="margin:0;color:var(--muted)">Agent says: "The old cart is replaced by the new checkout, so these files are unused."</p>
    <div class="why"><h4>Why we're asking</h4><ul>
      <li>Deleting a table removes its data for good.</li>
      <li>Your Blueprint says: "Orders are never deleted." The <span class="mono">carts</span> table holds 12 unpaid orders.</li>
      <li>Files: src/pages/OldCart.tsx, src/lib/cart.ts, supabase/migrations/0007_carts.sql</li></ul></div>
    <div class="suggest">{ICON["check"].replace('<svg', '<svg width="18" height="18" style="color:var(--accent);flex:none"')}<span><b>Codeceipt suggests: Reject.</b> It conflicts with a Blueprint rule. Ask your agent to keep the table and delete only the page.</span></div>
    <div class="actions"><button class="btn btn-primary" type="button">Approve</button><button class="btn" type="button">Reject</button><button class="btn btn-quiet" type="button">Ask agent to explain</button><button class="btn btn-quiet" type="button">Decide later</button></div>
    <label class="always"><input type="checkbox"> Always allow deleting unused pages in this project. Tables still ask every time.</label>
  </div>
</div>
</div>"""

FEATURES = f"""<div class="page-wide">
<div class="head"><div><h1>Features</h1><p class="purpose">Every part of your app, how far along it is, and what comes next.</p></div><button class="btn" type="button">Plan a new feature</button></div>
<ul class="list panel">
""" + "".join(f"""<li style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) auto;gap:22px">
  <div><div class="title">{n}</div><div class="sub">{nxt}</div></div>
  <div><div class="track">{''.join('<span class="on"></span>' if i < stage else '<span></span>' for i in range(4))}</div>
  <div class="track-labels">{''.join(f'<span class="{"now" if i == stage-1 else ""}">{lab}</span>' for i, lab in enumerate(["Planned", "Being built", "Checking", "Done"]))}</div></div>
  <span class="st {cls} chip">{word}</span></li>""" for n, nxt, stage, cls, word in [
    ("Reviews", "Next: empty state when there are no reviews", 3, "st-partly", "1 missed"),
    ("Booking", "All 6 items done and checked", 4, "st-done", "Done"),
    ("Payments", "Next: ask your agent to plan the Payments feature", 1, "st-unchecked", "Not started"),
    ("Staff calendar", "Next: show each stylist's free slots", 2, "st-done", "On track"),
]) + "</ul></div>"

BLUEPRINT = """<div class="page">
<div class="head"><div><h1>Blueprint</h1><p class="purpose">What your app must always do and must never do. Every receipt checks these.</p></div><button class="btn" type="button">Suggest promises</button></div>
<div class="two">
<section class="panel" style="padding:18px 20px"><h3 style="margin:0 0 10px;font-size:15px">Always</h3><ul class="list">
<li style="padding:12px 0;display:block"><div class="title">A customer can book a free slot in 3 taps</div><div class="sub"><span class="st st-done">Kept</span> in today's receipt</div></li>
<li style="padding:12px 0;display:block"><div class="title">Prices show in the salon's currency</div><div class="sub"><span class="st st-unchecked">Not checked yet</span></div></li></ul></section>
<section class="panel" style="padding:18px 20px"><h3 style="margin:0 0 10px;font-size:15px">Never</h3><ul class="list">
<li style="padding:12px 0;display:block"><div class="title">Orders are never deleted</div><div class="sub"><span class="st st-done">Kept</span> · your agent asked to break it today</div></li>
<li style="padding:12px 0;display:block"><div class="title">A full slot can never be booked twice</div><div class="sub"><span class="st st-missed">Broken</span> in the 21 Nov receipt</div></li></ul></section>
</div></div>"""

for name, cur, title, body in [("home", "home", "Home", HOME), ("receipt", "receipts", "Receipt", RECEIPT),
                               ("decide", "decide", "To decide", DECIDE), ("features", "features", "Features", FEATURES),
                               ("blueprint", "blueprint", "Blueprint", BLUEPRINT)]:
    open(f"{name}.html", "w").write(shell(cur, title, body))
open("home-dark.html", "w").write(shell("home", "Home", HOME, theme="dark"))
open("receipt-dark.html", "w").write(shell("receipts", "Receipt", RECEIPT, theme="dark"))
print("built")
