# «Победи дракона» Ярославль — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Yaroslavl edition of the Ulyanovsk «Победи дракона» office game: 8 groups ЕСЦ1…ЕСЦ8, no branch lead, a daily dragon with a per-day plan, holidays, and an on-screen «вчерашний итог» announced after the morning CRM import.

**Architecture:** Copy `..\sales vs dragon ulyanovsk` into this folder and change it in place. Backend `apps-script/Code.gs` (tested in Node via `apps-script/test/gas-harness.mjs`) switches from week to day and gains a `Plans` sheet; the Phaser game, the admin page and `rg.html` follow the new status shape.

**Tech Stack:** Phaser 4, Vite 6, TypeScript 5.7, Google Apps Script (V8), node:test.

**Spec:** `docs/superpowers/specs/2026-11-16-yaroslavl-design.md`

## Global Constraints

- Groups, in stage order: `ЕСЦ1, ЕСЦ2, ЕСЦ3, ЕСЦ4, ЕСЦ5, ЕСЦ6, ЕСЦ7, ЕСЦ8` → `slot_1…slot_8`. No `lead` slot anywhere.
- Counting payments (pieces), as in Ulyanovsk. 5 heads; head = 1/5 of the day's plan.
- Day = 00:00–24:00 in the sheet time zone (Europe/Moscow). Workday = Mon–Fri and not marked day-off. Saturdays are never workdays.
- Plan for a workday without its own plan = plan of the latest earlier workday that has one; else 0.
- RG page: today only, workdays only. Admin «Внести оплату»: any workday up to today.
- Secrets (admin PIN, group PINs, spreadsheet id) only in Script Properties — never in repo/docs/chat. Never commit a real CRM export. Default leader names empty.
- Spreadsheet title «победи дракона Ярославль»; page eyebrow «Победи дракона · Ярославль».
- Repo `KonturProject/sales-vs-dragon-yaroslavl`, site `https://konturproject.github.io/sales-vs-dragon-yaroslavl/` (admin `/admin.html`, RG `/rg.html`).
- Performance: no new always-running tweens; the result banner is temporary.

## Review Focus

1. Day rollover on an always-on screen: first poll of a new day must not fire hits (group numbers drop to 0, then a group already at 2 must not count as +2 from yesterday's 7) and must regrow heads / clear the victory banner. → Task 4 test via `__debug.injectStatus`.
2. Morning import of yesterday while today already has RG counts: today's numbers and heads on screen unchanged, no hits. → Task 3 test (status before/after import identical for today).
3. Plan fallback across a holiday and a weekend (Mon after Fri plan, holiday Wed with its own plan set but marked day-off). → Task 2 test.
4. «Итог вчера» on Monday = Friday; after a holiday = last workday before it; never compared with today's plan. → Task 3 test.
5. Weekend/holiday: RG save refused with a clear message, screens show «Выходной» + last result, IdleMood and growls idle. → Task 3 test (backend), Task 6/8 manual check.

---

### Task 1: Copy and rebrand to Yaroslavl (8 groups)

**Files:** copy all of `..\sales vs dragon ulyanovsk` except `node_modules`, `dist`, `.git`, `.superpowers`, `.claude`, `__pycache__`. Modify: `apps-script/Code.gs` (constants), `game/src/game/config/ropMapping.json`, `heroRoster.json`, `game/src/game/systems/Groups.ts`, `game/package.json`, `game/index.html`, `admin.html`, `rg.html`, `game/public/config.json`, `game/public/assets/mock/mock-status.json`, `.claude/launch.json`, `apps-script/test/*`.

**Interfaces — Produces:** `DEPARTMENT_CODES = ['ЕСЦ1',…,'ЕСЦ8']`, `LEADER_SLOTS = slot_1…slot_8`, `ROSTER_SLOTS = LEADER_SLOTS` (no lead), `COMMAND_HEROES = ['random', ...LEADER_SLOTS]`; `slotForGroup('АП_..._ЕСЦ3_...') === 'slot_3'`; lookalike fold `E→Е, C→С` (both cases).

- [ ] Copy files; `git init`; `npm ci` in `game/`.
- [ ] Constants/config/labels/mapping to ЕСЦ; `leaders` all `""`; `heroRoster.json` 8 slots: knight, hooded_blade, rogue, mage, druid, alchemist, ninja, knight_gold. `config.json` `appsScriptUrl: ""`, `useMock: true` until the Yaroslavl Web App exists. Titles/eyebrows/package name/homepage to Yaroslavl.
- [ ] Tests and harness: ВШ→ЕСЦ codes, 8 group PINs where tests enumerate them; `npm run test:backend` green (still weekly at this point).
- [ ] `npx tsc --noEmit` may fail on lead references — acceptable only until Task 5; commit «Yaroslavl copy: 8 ЕСЦ groups».

### Task 2: Backend — daily status, Plans sheet, workdays

**Files:** `apps-script/Code.gs`, `apps-script/test/gas-harness.mjs` (add `Plans` FakeSheet, `insertSheet`), `apps-script/test/backend.test.mjs`.

**Interfaces — Produces:**
- Sheet `Plans`: `Date | Plan | DayOff` (Date text `yyyy-MM-dd`, Plan int ≥0 or blank, DayOff `TRUE`/blank). Created by `setupSpreadsheet()` and on first write if missing (`getPlansSheet_(create)`).
- `readPlans_(): {[day]: {plan: number|null, dayOff: boolean}}`, `isWorkday_(day, plans?) : boolean`, `planFor_(day, plans?) : {plan: number, from: string|null}` (`from` = day the plan was taken from when borrowed, else null), `previousWorkday_(day, plans?) : string` (search back ≤ 60 days), `dayTotals_(day): {total, byRop:{code:n}}`, `dayResult_(day): {day, total, plan, headsCut, defeated}` with `headsCut = min(5, floor(total/plan*5))` (plan 0 → 0, defeated false).
- GET status: `{ok, day, isWorkday, plan, planFrom, totalToday, byRop:[{ropName, amount}], lastResult, commands, roster, leaders, serverNow, lastUpdated}`; on a non-workday `plan:0, totalToday:0, byRop:[]`. `lastResult = dayResult_(previousWorkday_(today))`.
- Actions: `listPlans {pin, from?, to?}` → `{ok, days:[{day, plan, planFrom, dayOff, weekday}]}` for Mon–Fri of current+next week by default; `setDayPlans {pin, days:[{day, plan?, dayOff?}]}` (weekday days only, plan int 0..99999 or null to clear, ≤ 31 entries) → `{ok, days}`. Remove `setPlan` and the legacy `{pin, plan}` form.

- [ ] Tests (fake now Wed 2026-09-23): status day fields & today-only totals; plan fallback over weekend (Mon uses Fri) and over a day-off; day-off Wed → `isWorkday:false`; `lastResult` on Monday = Friday; `setDayPlans` validation (Saturday, non-int, >31 entries, bad pin) writes nothing; `listPlans` marks borrowed plans.
- [ ] Implement; update existing week-based tests to day semantics; all green; commit.

### Task 3: Backend — input rules and «итог вчера»

**Files:** `apps-script/Code.gs`, tests.

**Interfaces — Produces:**
- `groupLogin` → `{ok, group:{slot,code,leader}, today:{day, isWorkday, count, total}}` (`count` = group's today, `total` = all groups today). `groupSetCount {groupPin, count, requestId?}` writes today only; date param ignored; non-workday → `bad_request field:'dayoff'`. Answer = groupLogin view + `saved`.
- `setDayCount` / `dayCount`: non-workday → `bad_request field:'dayoff'`.
- Command `dayResult` args filled by the server: `{day, total, plan, headsCut, defeated}`; admin sends `command {type:'dayResult'}` (args ignored) → result of `previousWorkday_(today)`.
- `importSales` (real run): if `from ≤ previousWorkday_(today) ≤ to`, queue `dayResult` for that day after writing; answer gains `announced: dayResult|null`. Dry run `current` gains `todayPayments` (payments of today inside the period) and `dayOffPayments` (incoming rows dated on non-workdays).

- [ ] Tests: RG saves today only (yesterday refused, date ignored); weekend refused `dayoff`; import of yesterday queues one `dayResult` with yesterday's plan; import not covering yesterday queues none; today's status unchanged by importing yesterday; manual `dayResult` on Monday names Friday.
- [ ] Implement; green; commit.

### Task 4: Game data layer (day, weekend, result)

**Files:** `game/src/game/core/GameState.ts`, `EventBus.ts`, `systems/DataPollingService.ts`, `public/assets/mock/mock-status.json`, `src/main.ts` (`__debug`).

**Interfaces — Produces:** `StatusResponse` = Task 2 shape; `GameState.day`, `GameState.isWorkday`, `GameState.lastResult`, `GameState.totalToday` (rename from `totalThisWeek`; `ProgressChangedPayload.totalToday`). `applyStatus` returns `null` (baseline, no hits) when `status.day !== this.day` after the first poll. Events: `DAY_STATE: 'day:state'` payload `{isWorkday: boolean, lastResult: DayResult|null}` emitted when either changes; `ADMIN_COMMAND` with `type:'dayResult'` carries `DayResult`.

- [ ] Implement; `npx tsc --noEmit` errors only in files Task 5/6 rewrite; commit with Task 5.

### Task 5: Stage — 8 heroes, no lead

**Files:** `core/Constants.ts` (`HERO_SLUGS` slot_1…slot_8, `HERO.SLOTS` 8 entries, delete `HERO.LEAD`, `IDLE_ANIM.LEAD_*`), delete `objects/LeadSprite.ts`, `scenes/PenScene.ts`, `systems/RosterConfig.ts` (no `lead`/`LEAD_SLOT`; `fighters` = all), `systems/IdleMood.ts` (no obstacles arg), `tools/build-scene.py` untouched.

- Layout start values (tune on screen): 8 slots x from 110 to 726 step 88, back row y 508 scale 0.70 (odd index 0,2,4,6), front y 578 scale 0.77. Plates must not overlap neighbours; dragon unchanged.
- [ ] Implement; `npx tsc --noEmit` clean; dev server with mock; screenshot; commit.

### Task 6: HUD — daily texts, leaderboard 8, weekend screen, result banner

**Files:** `scenes/HUDScene.ts`, `objects/Leaderboard.ts`, `scenes/PenScene.ts` (dragon sleeps on weekend), `systems/IdleMood.ts` (paused when `!isWorkday`).

- Title «ДНЕВНОЙ ПЛАН — ПОБЕДИ ДРАКОНА»; label «N / M оплат сегодня»; bar marks «голова 1…5»; victory sub «План дня выполнен».
- Weekend: bar hidden-dimmed, centre panel «ВЫХОДНОЙ» + «Итог <день недели, dd.mm>: дракон пал!» / «срублено N из 5 голов»; dragon sleeps (no growl).
- Result banner on `dayResult` command, ~60 s, depth 3000, same panel style as victory: defeated → «ВЧЕРАШНИЙ ДРАКОН ПАЛ!» / «Отделы победили. Сегодня — новая битва!» + confetti + fanfare; else → «ВЧЕРА СРУБЛЕНО N ИЗ 5 ГОЛОВ» / «Сегодня добьём!». «Вчера» → «В пятницу» etc. when the result day is not the calendar yesterday. Victory banner hidden while it shows.
- [ ] Implement; check via `__debug.command('dayResult', {...})` and `injectStatus` weekend; screenshots; commit.

### Task 7: Admin page

**Files:** `game/admin.html`, `src-admin/main.ts`, `src-admin/styles.css`.

- «План»: grid of Mon–Fri for current and next week (`listPlans`), each row: day name + date, number input, «выходной» checkbox, hint «не задан — взят с <день>»; one «Сохранить» → `setDayPlans` with changed rows; current day highlighted with «Сейчас: X / Y оплат».
- «Внести оплату»: date input `max` today; `dayoff` error message «Это выходной день».
- «Импорт»: notes for `todayPayments > 0` (warn: today's RG numbers will be replaced) and `dayOffPayments > 0` (not counted in the game); success line mentions the announcement when `announced`.
- «Анимации»: button «Показать итог вчерашнего дня» (`command dayResult`); fall list without lead.
- «Герои»: 8 slots, no «Лидер филиала»; leader names field unchanged.
- [ ] Implement; check against mock backend in the browser; commit.

### Task 8: RG page

**Files:** `game/rg.html`, `src-rg/main.ts`.

- No day chips; caption «Оплат за сегодня, <день, dd.mm>»; «Группа сегодня: N · все группы: M»; non-workday → counter hidden, «Сегодня выходной — оплаты не вносятся»; `dayoff` error → same text.
- [ ] Implement; check against mock backend; commit.

### Task 9: Docs, build, publish

- [ ] Rewrite `CLAUDE.md`, `docs/tech.md` (Yaroslavl differences: day game, plans, holidays, result announcement), `apps-script/README.md` (API table) and README; `npm run build` clean; `npm run test:backend` green.
- [ ] `gh repo create KonturProject/sales-vs-dragon-yaroslavl --public --source . --push`; `npm run deploy`; enable Pages on `gh-pages`; open the site.
- [ ] Apps Script: create project with the user (setupSpreadsheet, ADMIN_PIN set by the user, deploy Web App); put the URL into `config.json`, `useMock:false`; redeploy; verify GET JSON.
