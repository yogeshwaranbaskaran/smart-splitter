---
name: run-smart-splitter
description: Run, start, build, screenshot, or drive the Smart Splitter web app (Vite + React + Supabase bill-splitting PWA). Launches the dev server and drives the UI headlessly via the Playwright driver — guest flow, bill scan (Gemini), screenshots.
---

# Run Smart Splitter

Vite + React bill-splitting PWA. Backend is a **live production Supabase**
(hardcoded in `src/supabase.js`) — there is no local backend to start.
Drive it headlessly with the Playwright driver in this skill dir.
All paths below are relative to `frontend/` (the app root, a git repo).

## Prerequisites

- Node ≥ 20 (verified on v26). No system browser needed — the driver
  uses Playwright's downloaded headless Chromium.
- `frontend/.env` must contain `VITE_GEMINI_API_KEY=...` (already present
  on this machine; bill scanning silently hangs at "Reading bill…" without it).

One-time driver setup:

```bash
cd .claude/skills/run-smart-splitter
npm install                      # installs playwright (only dep)
npx playwright install chromium  # ~115 MB → ~/.cache/ms-playwright
```

## Build / install app deps

```bash
npm install        # in frontend/
```

## Run (agent path) — dev server + driver

Start the dev server in the background (readies in <1s):

```bash
npm run dev        # serves http://localhost:5173
```

Then pipe commands to the driver. This exact script does the full guest
flow — sign in as guest, fill the form, upload a real bill photo, wait
for Gemini to parse it (~30–45 s), screenshot the parsed items:

```bash
cd .claude/skills/run-smart-splitter
node driver.mjs <<'EOF'
goto http://localhost:5173
waitfor Continue as guest
ss 01-auth
click Continue as guest
waitfor Add your bill
fill input[placeholder="Your name"]|Yogesh
fill input[placeholder^="Split name"]|Driver Test
upload input[type=file]|/home/yogesh/Projects/smart-splitter/Data - Bills/IMG_20260414_160808334_HDR.jpg
waitfor Create split
ss 03-parsed-items
text
EOF
```

Screenshots land in `.claude/skills/run-smart-splitter/shots/<name>.png`.
Driver commands (one per line on stdin; see header of `driver.mjs`):
`goto <url>`, `click <visible text>`, `css <selector>`,
`fill <selector>|<text>`, `upload <selector>|<path>`, `press <key>`,
`waitfor <text>` (60 s timeout), `wait <ms>`, `text` (dump innerText),
`eval <js>`, `ss <name>`. Page console errors print as `[page-error]`.

## Run (human path)

`npm run dev` then open http://localhost:5173 in a browser. Ctrl-C to stop.

## Lint

```bash
npm run lint       # eslint; no test suite exists
```

As of 2026-07 this exits nonzero with 22 pre-existing problems
(13 errors, mostly `react-hooks`); a failing lint is not a signal that
your change broke something — compare against baseline.

## Gotchas

- **The backend is production.** Clicking **Create split** inserts real
  rows into the live Supabase DB (and group flows can send real emails
  via the notification webhook). Stop at the "Create split" screen unless
  you actually intend to create data. There is no staging environment.
- **Google OAuth is not scriptable headlessly** — always use
  "Continue as guest". Guests get the scan-a-bill flow only.
- **Guest mode skips the mode chooser.** The Scan/Manual tiles only
  render when a `?group=<id>` param is present; `ManualSplit` and groups
  require a logged-in user. As a guest you land directly on the scan form.
- **Don't screenshot right after `goto`.** `networkidle` fires while the
  Supabase session check is still resolving, so you capture the blank
  "Loading…" frame (just the floating-emoji background). `waitfor
  Continue as guest` first.
- **`fill`/`upload` use `|` as separator**, not space — CSS selectors
  like `input[placeholder="Your name"]` contain spaces.
- **Bill parsing takes ~30–45 s** (Gemini vision on a ~4 MB photo) and
  costs a real API call on the key in `.env`. `waitfor Create split`
  covers it; a 30 s timeout does not. Sample bills to upload live in
  `../Data - Bills/` (sibling of `frontend/`).

## Troubleshooting

- `fill: Unexpected token "" while parsing css selector` — you used a
  space instead of `|` between selector and value.
- `waitfor: Timeout ... exceeded` right after `upload` — Gemini parse
  still running (or `VITE_GEMINI_API_KEY` missing → page stays on
  "Reading bill…" forever; check `.env`).
- Port 5173 busy → a dev server is already running; just reuse it.
