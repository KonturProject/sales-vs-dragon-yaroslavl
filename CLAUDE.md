# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Победи дракона" — the **Yaroslavl branch** edition, forked on 2026-11-16 from `KonturProject/sales-vs-dragon-ulyanovsk` (itself a fork of the Moscow `sales-vs-dragon`). A Phaser 4 + Vite + TypeScript office-display game: **eight** department heroes (groups `ЕСЦ1 … ЕСЦ8`, no branch lead) hit a five-headed dragon whenever a group's payments grow in a private Google Sheet. It counts **PAYMENTS (pieces), not money**, and it is a **DAILY** game: every working day a new dragon with that day's own plan; each fifth of the day's plan cuts a head, 100 % is the day's victory. Yesterday's final numbers arrive with the morning CRM export (after 11:30); importing it settles yesterday and the screens announce its result ("Вчерашний дракон пал!"), while today's fight runs on the leaders' live counts. Live at https://konturproject.github.io/sales-vs-dragon-yaroslavl/ (admin `/admin.html`, group leaders `/rg.html`).

Design and rationale: `docs/superpowers/specs/2026-11-16-yaroslavl-design.md`, `docs/tech.md`; backend API: `apps-script/README.md`. The repos are independent: a fix made in Ulyanovsk must be ported here by hand and vice versa.

## Commands

All commands run from `game/`.

```bash
npm run dev            # dev server on :8080, hot reload
npm run build          # production build to game/dist (index.html + admin.html + rg.html)
npx tsc --noEmit -p tsconfig.json   # type-check
npm run test:backend   # runs the real apps-script/Code.gs against fake Google services (54 tests)
npm run mock-backend   # same Code.gs on http://localhost:8787/exec, admin PIN 1234, a plan of 20 for today, data in memory
npm run deploy         # build + publish dist/ to the gh-pages branch
```

Dev pages accept `?backend=http://localhost:8787/exec`. There is no linter and no browser test suite: `tsc --noEmit` + `npm run test:backend` + looking at it in the browser (`window.__debug`) is the verification routine.

## Architecture (as in Ulyanovsk unless noted)

**Three Vite entry points**: `index.html` (the Phaser game, `src/main.ts` → `src/game/`), `admin.html` (`src-admin/`), `rg.html` (`src-rg/`, styles from `src-admin/styles.css`).

**Data flow**: private Google Sheet → Apps Script Web App (`apps-script/Code.gs`, deployed by hand — the repo copy is the source) → `DataPollingService` polls every 15 s, diffs `byRop`, emits `MONEY_IN` / `PROGRESS_CHANGED` / `DRAGON_HEAD_LOST` / `DRAGON_DEFEATED` / `DATA_UPDATED` / `ADMIN_COMMAND` / `ROSTER_CHANGED` / `LEADERS_CHANGED` / **`DAY_STATE`** on the `EventBus`. `GameState` is the single source of truth; `headsRemaining = HEADS − floor(ratio × HEADS)`, `ratio = totalToday / plan`.

**The day (new here)**: the status is today's (`day`, `isWorkday`, `plan` in force, `totalToday`, `byRop` of today, `lastResult` of the last working day). A status whose `day` differs from the previous one is a **baseline** like the first poll: no strikes, `PROGRESS_CHANGED.reset` puts the dragon straight into today's state (heads may go up or down), the victory latch is released. `DAY_STATE` fires when `isWorkday` or `lastResult` changes: on a day off the dragon rests (`Dragon.setResting`, no growls), `IdleMood` pauses, the HUD shows the «ВЫХОДНОЙ» panel with the last working day's result and hides the leaderboard.

**Plans and days off (new here)**: sheet `Plans` (`Date | Plan | DayOff`). A working day = Mon–Fri not marked DayOff (Saturdays are never working days — the user's rule). A working day without its own plan takes the latest earlier working day's plan (`planFor_`), so a forgotten plan never shows a dragon "of 0". A day's result is always measured against THAT day's plan. Admin tab «План» = a grid of this and next week's weekdays (`listPlans` / `setDayPlans`).

**The morning result (new here)**: `importSales` of a period that covers the last working day before today queues a `dayResult` command (args computed by the server: `{day, total, plan, headsCut, defeated}`); the admin can also send it by hand (tab «Анимации»; the server ignores the page's args). `HUDScene.showResultBanner` shows it for 60 s (`systems/DayText.ts`: «Вчерашний дракон пал!» / «Дракон пятницы пал!» / «Вчера срублено N из 5 голов — сегодня добьём!»); a defeated result also gets confetti and the heroes cheer. Today's numbers are untouched by an import of yesterday.

**Entering payments**: group leaders (`rg.html`) set their own group's number for **today only** (`groupSetCount` ignores any date; refused on a day off). The admin's «Внести оплату» sets any working day up to today. A day's number replaces that group's rows of that day with one row with `Count`; an import replaces its whole period; whoever saves last wins. Every sheet write goes through `rewriteSales_` (one `setValues`, rows sorted by date, leftovers blanked).

**Strikes one after another**: one poll can bring payments for several groups; `diffAndEmit` adds the deltas up per slot and fires the `MONEY_IN`s left to right, `HERO.HIT_STAGGER_MS` (1.2 s) apart; head loss waits for the last blow.

**Baseline gotcha**: the first poll after page load (and the first poll of a new day) is a baseline. `PenScene.create()` also calls `onProgressChanged` once with an empty state, which must not consume the baseline. Delayed events (head loss, victory) re-check `GameState` before showing anything.

**Slots vs characters**: the stage has eight slots `slot_1…slot_8` (left to right = `HERO.SLOTS` = the order of `ropMapping.json` `labels`), two staggered rows. Everything that identifies a hero (events, leaderboard, idle mood, backend) is the slot id. The character in a slot is a runtime choice (`systems/RosterConfig.ts`, admin «Герои» → `setRoster` → Script Properties `ROSTER` → GET `roster`); `config/heroRoster.json` holds the defaults. There is no `lead` slot anywhere.

**Group names**: `systems/Groups.ts` (no Phaser; shared by game and admin) maps a name to a slot: exact, look-alike Latin letters folded (E, C; «ESC5» typed in Latin), or any name containing `ЕСЦ<число>` (full CRM names). Full CRM names of the Yaroslavl groups are not known yet — add a synonym to `ropMapping.json` `mapping` if the first real export reports a group of ours as foreign.

**Nameplates**: «ЕСЦ1 • Фамилия И.» (`objects/NamePlate.ts`); names are edited in the admin «Герои» tab (a pasted full name is shortened by `Groups.shortPersonName`) → `setRoster {leaders}` → Script Properties `LEADERS` → GET `leaders`. Defaults in `ropMapping.json` are empty (just the code) — the repo and the site are public.

**Payment import**: admin «Импорт» reads the CRM export «Детальные данные по оплаченным счетам» (.xlsx) in the browser (`src-admin/paymentsFile.ts`, SheetJS 0.20.3, lazy chunk); one invoice = one payment, invoices under 100 ₽ are left out; only date / amount / group code / invoice number go to the backend. The dry run shows "now → after" per group and warns when the file reaches today or has payments dated on a day off.

**Characters, render scale, performance, idle mood, live stand**: unchanged from Ulyanovsk (see `docs/tech.md`); the live stand rotates over the eight heroes. Don't hand-edit `public/assets/sprites/chars/` — rebuild with `tools/build-characters.py`.

**Debug hooks** (`window.__debug`, dev builds only): `hit(slot, delta)`, `setRatio(0..1)`, `injectStatus(status)`, `dayOff(true|false)`, `poller.stop()` (call first when testing by hand), `power()`, `mood()`, `growl()`, `command(type, args)` (e.g. `command('dayResult', {day, total, plan, headsCut, defeated})`), `roster({slot_1: 'ninja'})`.

## Backend / secrets

The admin PIN lives only in the Apps Script project's Script Properties (salted hash after the first change in the admin page) — never in this repo, docs, memory files or chat logs. Group PINs are made in the admin page and shown once. The spreadsheet id lives only in Script Properties (`SPREADSHEET_ID`, written by `setupSpreadsheet()`). The Web App URL in `game/public/config.json` is public by design. Never commit a real CRM export (clients' names and INNs) — test with a synthetic file.
**`config.json` must point at the Yaroslavl backend** — the Ulyanovsk one answers in the old weekly format and would show Ulyanovsk's numbers.
