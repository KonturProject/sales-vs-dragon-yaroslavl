/**
 * Tests of the real Code.gs against fake Google services (see gas-harness.mjs).
 * Run:  node --test apps-script/test/
 *
 * The fake "now" is Wednesday 2026-09-23 10:00 Moscow time unless a test says otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from './gas-harness.mjs';

const PIN = '1234';
const byRopOf = (status) => Object.fromEntries(status.byRop.map(r => [r.ropName, r.amount]));
/** A backend whose fake clock stands at the given Moscow time. */
const at = (iso, opts = {}) => loadBackend({ startAt: Date.parse(iso + '+03:00'), ...opts });

/* ----------------------------------------------------------- public status */

test('public GET: today only — the payments of today, the plan in force, the last working day, commands and the clock', () => {
    const b = loadBackend({ plans: [['2026-09-22', 4, ''], ['2026-09-23', 10, '']] });
    const status = b.get();
    assert.equal(status.ok, true);
    assert.equal(status.day, '2026-09-23');
    assert.equal(status.isWorkday, true);
    assert.equal(status.plan, 10);
    assert.equal(status.planFrom, null);
    assert.equal(status.totalToday, 1, 'only today\'s row counts (Monday and Tuesday rows are other days)');
    assert.deepEqual(byRopOf(status), { 'ЕСЦ1': 1 });
    assert.deepEqual(status.lastResult, { day: '2026-09-22', total: 1, plan: 4, headsCut: 1, defeated: false });
    assert.deepEqual(status.commands, []);
    assert.equal(status.serverNow, b.now());
    assert.equal('totalThisWeek' in status, false);
});

test('the public GET never contains raw rows, the PIN or its hash', () => {
    const b = loadBackend();
    b.post({ action: 'changePin', pin: PIN, newPin: '987654' });
    const text = JSON.stringify(b.get());
    assert.ok(!text.includes('987654') && !text.includes('ADMIN_PIN') && !text.includes('$'));
    assert.ok(!('sales' in JSON.parse(text)));
});

test('a working day without its own plan takes the latest earlier one — over a weekend and over a day off', () => {
    const plans = [['2026-09-18', 30, ''], ['2026-09-21', 12, ''], ['2026-09-22', 99, 'TRUE']];
    // Monday after a Friday plan.
    assert.deepEqual([at('2026-09-21T09:00:00', { plans: plans.slice(0, 1) }).get().plan, at('2026-09-21T09:00:00', { plans: plans.slice(0, 1) }).get().planFrom], [30, '2026-09-18']);
    // Wednesday: Tuesday is a day off (its own plan does not count), Monday's plan is in force.
    const wed = loadBackend({ plans });
    assert.equal(wed.get().plan, 12);
    assert.equal(wed.get().planFrom, '2026-09-21');
    // No plan ever set: 0.
    assert.equal(loadBackend().get().plan, 0);
});

test('a day off and a weekend: no plan, nothing counted, the last working day\'s result', () => {
    const off = loadBackend({ plans: [['2026-09-21', 2, ''], ['2026-09-23', 10, 'TRUE']] });
    const status = off.get();
    assert.equal(status.isWorkday, false);
    assert.equal(status.plan, 0);
    assert.equal(status.totalToday, 0);
    assert.deepEqual(status.byRop, []);
    assert.equal(status.lastResult.day, '2026-09-22', 'Tuesday is the last working day before');
    assert.equal(status.lastResult.plan, 2, 'Tuesday borrowed Monday\'s plan');

    const sat = at('2026-09-26T12:00:00', { plans: [['2026-09-25', 3, '']] });
    assert.equal(sat.get().isWorkday, false);
    assert.equal(sat.get().lastResult.day, '2026-09-25', 'on Saturday the last working day is Friday');
});

test('Monday: the last working day is Friday, and its result is measured against Friday\'s plan', () => {
    const b = at('2026-09-28T10:00:00', { plans: [['2026-09-25', 2, ''], ['2026-09-28', 50, '']] });
    b.salesRows().push([b.day('2026-09-25T15:00'), 1000, 'ЕСЦ3'], [b.day('2026-09-25T16:00'), 1000, 'ЕСЦ4']);
    assert.deepEqual(b.get().lastResult, { day: '2026-09-25', total: 2, plan: 2, headsCut: 5, defeated: true });
    assert.equal(b.get().plan, 50);
});

/* ------------------------------------------------------------------ plans */

test('listPlans: Monday to Friday of this week and the next, with borrowed plans and days off marked', () => {
    const b = loadBackend({ plans: [['2026-09-21', 12, ''], ['2026-09-24', '', 'TRUE']] });
    const res = b.post({ action: 'listPlans', pin: PIN });
    assert.equal(res.ok, true);
    assert.equal(res.today, '2026-09-23');
    assert.deepEqual(res.days.map(d => d.day), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    assert.deepEqual(res.days[0], { day: '2026-09-21', weekday: 1, plan: 12, dayOff: false, effectivePlan: 12, planFrom: null });
    assert.deepEqual(res.days[2], { day: '2026-09-23', weekday: 3, plan: null, dayOff: false, effectivePlan: 12, planFrom: '2026-09-21' });
    assert.deepEqual(res.days[3], { day: '2026-09-24', weekday: 4, plan: null, dayOff: true, effectivePlan: 0, planFrom: null });
    assert.equal(b.post({ action: 'listPlans', pin: 'bad' }).error, 'invalid_pin');
});

test('setDayPlans: creates the Plans sheet, sets plans and days off, clears a plan, leaves unsent fields alone', () => {
    const b = loadBackend();
    assert.equal(b.plansRows(), null, 'no Plans sheet yet');
    const res = b.post({ action: 'setDayPlans', pin: PIN, days: [{ day: '2026-09-23', plan: 8 }, { day: '2026-09-24', dayOff: true }, { day: '2026-09-28', plan: 15 }] });
    assert.equal(res.ok, true);
    assert.deepEqual(b.plansRows()[0], ['Date', 'Plan', 'DayOff']);
    assert.equal(b.get().plan, 8);
    assert.equal(res.days.find(d => d.day === '2026-09-24').dayOff, true);

    b.post({ action: 'setDayPlans', pin: PIN, days: [{ day: '2026-09-23', dayOff: true }] });
    assert.equal(b.get().isWorkday, false);
    const again = b.post({ action: 'setDayPlans', pin: PIN, days: [{ day: '2026-09-23', dayOff: false }, { day: '2026-09-28', plan: null }] });
    assert.equal(b.get().plan, 8, 'the plan was kept while the day was off');
    assert.equal(again.days.find(d => d.day === '2026-09-28').plan, null);
    assert.equal(b.plansRows().slice(1).filter(r => r[0] !== '').length, 3, 'one row per day, never duplicated');
});

test('setDayPlans refuses weekends, bad numbers and bad lists, and writes nothing', () => {
    const b = loadBackend({ plans: [['2026-09-23', 10, '']] });
    const before = JSON.stringify(b.plansRows());
    const cases = [
        [undefined, 'days'], [[], 'days'], ['x', 'days'], [Array(32).fill({ day: '2026-09-23', plan: 1 }), 'days'],
        [[{ day: '2026-09-26', plan: 5 }], 'days'], [[{ day: '2026-09-27', dayOff: true }], 'days'],
        [[{ day: '23.09.2026', plan: 5 }], 'days'], [[{ day: '2026-02-30', plan: 5 }], 'days'], [[{ day: '2028-09-25', plan: 5 }], 'days'],
        [[{ day: '2026-09-23', plan: -1 }], 'plan'], [[{ day: '2026-09-23', plan: 1.5 }], 'plan'], [[{ day: '2026-09-23', plan: 100000 }], 'plan'], [[{ day: '2026-09-23', plan: 'abc' }], 'plan'],
        [[{ day: '2026-09-23', dayOff: 'yes' }], 'dayOff'],
        [[{ day: '2026-09-23', plan: 5 }, { day: '2026-09-26', plan: 5 }], 'days'],
    ];
    for (const [days, field] of cases) assert.equal(b.post({ action: 'setDayPlans', pin: PIN, days }).field, field, JSON.stringify(days)?.slice(0, 80));
    assert.equal(b.post({ action: 'setDayPlans', pin: 'bad', days: [{ day: '2026-09-23', plan: 1 }] }).error, 'invalid_pin');
    assert.equal(JSON.stringify(b.plansRows()), before);
});

test('the weekly setPlan and the legacy { pin, plan } form are gone', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'setPlan', pin: PIN, plan: 5 }).error, 'bad_request');
    assert.equal(b.post({ pin: PIN, plan: 5 }).error, 'bad_request');
});

/* -------------------------------------------------------------------- PIN */

test('wrong PIN is refused and changes nothing', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'setDayPlans', pin: '0000', days: [{ day: '2026-09-23', plan: 1 }] }), { ok: false, error: 'invalid_pin' });
    assert.equal(b.plansRows(), null);
});

test('login checks the PIN; missing or absurd PINs fail', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'login', pin: PIN }), { ok: true });
    assert.equal(b.post({ action: 'login' }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'login', pin: 'x'.repeat(500) }).error, 'invalid_pin');
});

test('five wrong PINs lock the API; even the right PIN waits; it unlocks after the lock time', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) assert.equal(b.post({ action: 'login', pin: 'bad' + i }).error, 'invalid_pin');
    const fifth = b.post({ action: 'login', pin: 'bad5' });
    assert.equal(fifth.error, 'locked');
    assert.ok(fifth.retryAfterSec > 0 && fifth.retryAfterSec <= 600);
    assert.equal(b.post({ action: 'login', pin: PIN }).error, 'locked');
    b.advance(601 * 1000);
    assert.deepEqual(b.post({ action: 'login', pin: PIN }), { ok: true });
});

test('a right PIN clears the failure count', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) b.post({ action: 'login', pin: 'bad' });
    assert.equal(b.post({ action: 'login', pin: PIN }).ok, true);
    for (let i = 0; i < 4; i++) assert.equal(b.post({ action: 'login', pin: 'bad' }).error, 'invalid_pin');
});

test('unknown action and malformed body are bad requests', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'dropTable', pin: PIN }).error, 'bad_request');
    assert.equal(b.post({ action: 'toString', pin: PIN }).error, 'bad_request', 'inherited object members are not actions');
    assert.equal(b.post({ action: 'constructor', pin: PIN }).error, 'bad_request');
    assert.equal(b.postRaw('not json').error, 'bad_request');
    assert.equal(b.postRaw('null').error, 'bad_request');
    assert.equal(b.postRaw('42').error, 'bad_request');
});

test('a fault on the server side is reported as server_error, not blamed on the request', () => {
    const b = loadBackend();
    b.renameSheet('Sales', 'Sales-broken');
    const res = b.post({ action: 'listSales', pin: PIN });
    assert.equal(res.error, 'server_error');
    assert.match(res.detail, /Sales/);
    assert.equal(b.post({ action: 'login', pin: PIN }).ok, true, 'and the PIN check itself still works');
});

test('changePin: needs the old PIN, a 4-12 digit new one; then only the new one works and the old plain PIN is gone', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'changePin', pin: 'nope', newPin: '5555' }).error, 'invalid_pin');
    for (const newPin of ['12', '1234567890123', 'abcd', '12 34', '', undefined]) {
        assert.equal(b.post({ action: 'changePin', pin: PIN, newPin }).error, 'bad_request', String(newPin));
    }
    assert.equal(b.post({ action: 'changePin', pin: PIN, newPin: PIN }).error, 'bad_request');
    assert.equal(b.props.get('ADMIN_PIN'), PIN);
    assert.deepEqual(b.post({ action: 'changePin', pin: PIN, newPin: '482913' }), { ok: true });
    assert.equal(b.post({ action: 'login', pin: PIN }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'login', pin: '482913' }).ok, true);
    assert.equal(b.props.has('ADMIN_PIN'), false);
    assert.match(b.props.get('ADMIN_PIN_HASH'), /^[0-9a-f-]{36}\$[0-9a-f]{64}$/);
    assert.ok(![...b.props.values()].some(v => v.includes('482913')));
});

test('setAdminPin_ (editor recovery path) stores a hash too', () => {
    const b = loadBackend({ legacyPin: null });
    assert.equal(b.post({ action: 'login', pin: '0000' }).error, 'invalid_pin');
    b.run('setAdminPin_');
    assert.equal(b.post({ action: 'login', pin: '0000' }).ok, true);
});

/* ------------------------------------------------------------- sales rows */

/** A sheet like a fresh real one: tidy Date | Amount | ROP, no Invoice/Count column yet. */
function yaroslavlBackend(opts) {
    const b = loadBackend(opts);
    const rows = b.salesRows();
    rows.length = 0;
    rows.push(
        ['Date', 'Amount', 'ROP'],
        [b.day('2026-09-15'), 90000, 'ЕСЦ1'], // last week: outside any period below
        [b.day('2026-09-21'), 400000, 'ЕСЦ1'],
        [b.day('2026-09-22T11:30'), 250000, 'ЕСЦ4'], // typed in by hand, with a time
        [b.day('2026-09-23'), 120000, 'ЕСЦ5'],
    );
    return b;
}

test('listSales: newest first, limited, with today\'s status', () => {
    const b = loadBackend();
    const res = b.post({ action: 'listSales', pin: PIN, limit: 2 });
    assert.equal(res.totalRows, 3, 'the empty rows that only hold the drop-down list in column F are not sales');
    assert.equal(res.shown, 2);
    assert.deepEqual(res.sales.map(s => [s.rop, s.count, s.row]), [['ЕСЦ1', 1, 4], ['ЕСЦ2', 1, 3]]);
    assert.match(res.sales[0].date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(res.status.totalToday, 1);
    assert.equal(b.post({ action: 'listSales', pin: 'no' }).error, 'invalid_pin');
});

test('dayCount / setDayCount: a group\'s payments on a day; that day\'s rows of the group become one row with the count', () => {
    const b = yaroslavlBackend();
    assert.equal(b.post({ action: 'dayCount', pin: PIN, rop: 'ЕСЦ4', date: '2026-09-22' }).count, 1, 'an old row without a count is one payment');
    const res = b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ4', date: '2026-09-22', count: 3 });
    assert.deepEqual(res.saved, { rop: 'ЕСЦ4', date: '2026-09-22', count: 3, previous: 1 });
    assert.equal(res.status.lastResult.total, 3, 'yesterday changed');
    assert.equal(res.status.totalToday, 1, 'today did not');
    assert.equal(b.salesSheet().setValuesCalls, 1, 'one write for the whole table');
    const rows = b.salesRows();
    assert.deepEqual(rows[0], ['Date', 'Amount', 'ROP', 'Invoice', 'Count']);
    const group = rows.slice(1).filter(r => r[2] === 'ЕСЦ4');
    assert.deepEqual([group.length, group[0][1], group[0][3], group[0][4]], [1, '', '', 3]);
    assert.equal(b.post({ action: 'dayCount', pin: PIN, rop: 'ЕСЦ4', date: '2026-09-22' }).count, 3);
});

test('setDayCount: 0 clears the day, a day without rows gets one, the other columns stay', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-23', count: 0 }).saved.previous, 1);
    assert.equal(b.get().totalToday, 0);
    assert.equal(b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ6', date: '2026-09-23', count: 2 }).status.totalToday, 2);
    const rows = b.salesRows();
    assert.deepEqual([rows[0][6], rows[0][7]], ['Invoice', 'Count'], 'added after the last used column (F)');
    assert.deepEqual(rows.map(r => r[5]), ['', 'ЕСЦ1', 'ЕСЦ2', 'ЕСЦ3', 'ЕСЦ5', 'ЕСЦ6', 'ЕСЦ8'], 'column F untouched');
});

test('setDayCount refuses other groups, days off, future or impossible days and bad numbers, and writes nothing', () => {
    const b = yaroslavlBackend({ plans: [['2026-09-22', '', 'TRUE']] });
    const before = JSON.stringify(b.salesRows());
    const ok = { rop: 'ЕСЦ1', date: '2026-09-21', count: 2 };
    const cases = [
        [{ ...ok, rop: 'ЕСЦ9' }, 'rop'], [{ ...ok, rop: '=1+1' }, 'rop'],
        [{ ...ok, date: '2026-09-24' }, 'date'], [{ ...ok, date: '22.09.2026' }, 'date'], [{ ...ok, date: '2026-02-30' }, 'date'],
        [{ ...ok, date: '2026-09-20' }, 'dayoff'], [{ ...ok, date: '2026-09-22' }, 'dayoff'],
        [{ ...ok, count: -1 }, 'count'], [{ ...ok, count: 1.5 }, 'count'], [{ ...ok, count: 1000 }, 'count'], [{ ...ok, count: '' }, 'count'],
    ];
    for (const [payload, field] of cases) assert.equal(b.post({ action: 'setDayCount', pin: PIN, ...payload }).field, field, JSON.stringify(payload));
    assert.equal(b.post({ action: 'dayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-22' }).field, 'dayoff');
    assert.equal(b.post({ action: 'setDayCount', pin: 'bad', ...ok }).error, 'invalid_pin');
    assert.equal(JSON.stringify(b.salesRows()), before);
    assert.equal(b.post({ action: 'setDayCount', pin: PIN, ...ok, date: '2026-09-23' }).ok, true, 'today is fine');
});

test('a retried setDayCount (same requestId) writes once', () => {
    const b = yaroslavlBackend();
    const first = b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ7', date: '2026-09-23', count: 2, requestId: 'c-1' });
    const writes = b.salesSheet().setValuesCalls;
    assert.deepEqual(b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ7', date: '2026-09-23', count: 2, requestId: 'c-1' }), first);
    assert.equal(b.salesSheet().setValuesCalls, writes);
});

/* ---------------------------------------------------------------- commands */

test('commands: validated, queued with rising ids, visible on the public GET, never touch the sheets', () => {
    const b = loadBackend();
    const salesBefore = JSON.stringify(b.salesRows());
    assert.equal(b.post({ action: 'command', pin: PIN, type: 'growl' }).id, 1);
    assert.deepEqual(b.post({ action: 'command', pin: PIN, type: 'hit', args: { rop: 'ЕСЦ5', count: 3 } }).args, { rop: 'ЕСЦ5', count: 3 });
    assert.equal(b.post({ action: 'command', pin: PIN, type: 'fall', args: { hero: 'slot_8', mode: 'doze' } }).id, 3);
    b.post({ action: 'command', pin: PIN, type: 'fall' });
    b.post({ action: 'command', pin: PIN, type: 'wake' });
    b.post({ action: 'command', pin: PIN, type: 'confetti' });
    b.post({ action: 'command', pin: PIN, type: 'celebrate' });
    const commands = b.get().commands;
    assert.deepEqual(commands.map(c => c.type), ['growl', 'hit', 'fall', 'fall', 'wake', 'confetti', 'celebrate']);
    assert.deepEqual(commands.map(c => c.id), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(commands[3].args, { hero: 'random', mode: 'random' });
    assert.equal(JSON.stringify(b.salesRows()), salesBefore);
});

test('commands: a hit shows one payment by default; bad types/args and a wrong PIN are refused', () => {
    const b = loadBackend();
    b.post({ action: 'command', pin: PIN, type: 'hit', args: { rop: 'ЕСЦ1' } });
    assert.equal(b.get().commands[0].args.count, 1);
    for (const [type, args] of [['explode', {}], ['hit', {}], ['hit', { rop: 'ЕСЦ1', count: 0 }], ['hit', { rop: '=1+1' }], ['fall', { hero: 'lead' }], ['fall', { hero: 'slot_9' }], ['fall', { mode: 'die' }]]) {
        assert.equal(b.post({ action: 'command', pin: PIN, type, args }).error, 'bad_request', type + JSON.stringify(args));
    }
    assert.equal(b.post({ action: 'command', pin: 'bad', type: 'growl' }).error, 'invalid_pin');
    assert.equal(b.get().commands.length, 1);
});

test('commands: only the last 10 are kept, and old ones drop off the public list', () => {
    const b = loadBackend();
    for (let i = 0; i < 13; i++) b.post({ action: 'command', pin: PIN, type: 'growl' });
    assert.deepEqual(b.get().commands.map(c => c.id), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    b.advance(11 * 60 * 1000);
    assert.deepEqual(b.get().commands, []);
    assert.equal(b.post({ action: 'command', pin: PIN, type: 'wake' }).id, 14, 'ids keep rising');
});

test('a retried command (same requestId) is queued once', () => {
    const b = loadBackend();
    b.post({ action: 'command', pin: PIN, type: 'growl', requestId: 'r1' });
    b.post({ action: 'command', pin: PIN, type: 'growl', requestId: 'r1' });
    assert.equal(b.get().commands.length, 1);
});

test('the dayResult command is worked out by the server — the last working day, whatever the page sent', () => {
    const b = at('2026-09-28T09:00:00', { plans: [['2026-09-25', 4, '']] });
    b.salesRows().push([b.day('2026-09-25T12:00'), 1, 'ЕСЦ2'], [b.day('2026-09-25T13:00'), 1, 'ЕСЦ2']);
    const res = b.post({ action: 'command', pin: PIN, type: 'dayResult', args: { day: '2026-09-28', total: 999, defeated: true } });
    assert.deepEqual(res.args, { day: '2026-09-25', total: 2, plan: 4, headsCut: 2, defeated: false });
    assert.deepEqual(b.get().commands[0].args, res.args);
});

/* --------------------------------------------------------- roster, leaders */

test('roster: nothing chosen yet -> the public status carries null', () => {
    assert.equal(loadBackend().get().roster, null);
});

test('roster: setRoster stores the choice for the eight slots, merges later changes; there is no lead', () => {
    const b = loadBackend();
    const first = b.post({ action: 'setRoster', pin: PIN, roster: { slot_1: 'viking', slot_8: 'wizard' } });
    assert.deepEqual(first, { ok: true, roster: { slot_1: 'viking', slot_8: 'wizard' }, leaders: null });
    assert.deepEqual(b.post({ action: 'setRoster', pin: PIN, roster: { slot_8: 'ninja' } }).roster, { slot_1: 'viking', slot_8: 'ninja' });
    assert.equal(b.post({ action: 'setRoster', pin: PIN, roster: { lead: 'ninja' } }).error, 'bad_request');
    assert.deepEqual(b.get().roster, { slot_1: 'viking', slot_8: 'ninja' });
});

test('roster: it needs the PIN and rejects malformed choices without changing anything', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'setRoster', pin: 'bad', roster: { slot_1: 'viking' } }).error, 'invalid_pin');
    for (const roster of [undefined, null, [], 'viking', {}, { slot_9: 'viking' }, { slot_1: 'Viking!' }, { slot_1: '' }, { slot_1: 'a'.repeat(40) }, { slot_1: '=1+1' }]) {
        assert.equal(b.post({ action: 'setRoster', pin: PIN, roster }).error, 'bad_request', JSON.stringify(roster));
    }
    assert.equal(b.get().roster, null);
});

test('roster and leaders never touch the spreadsheet', () => {
    const b = loadBackend();
    const before = JSON.stringify(b.salesRows());
    b.post({ action: 'setRoster', pin: PIN, roster: { slot_3: 'pirate' }, leaders: { slot_3: 'Иванова А.' } });
    assert.equal(JSON.stringify(b.salesRows()), before);
    assert.equal(b.plansRows(), null);
});

test('leaders: names for the nameplates are stored, merged and handed out; the roster is left alone', () => {
    const b = loadBackend();
    assert.equal(b.get().leaders, null);
    const first = b.post({ action: 'setRoster', pin: PIN, leaders: { slot_1: 'Иванова А.', slot_8: '  Петров   Б. ' } });
    assert.deepEqual(first, { ok: true, roster: null, leaders: { slot_1: 'Иванова А.', slot_8: 'Петров Б.' } });
    const second = b.post({ action: 'setRoster', pin: PIN, roster: { slot_2: 'ninja' }, leaders: { slot_1: '' } });
    assert.deepEqual(second.leaders, { slot_1: '', slot_8: 'Петров Б.' });
    assert.deepEqual(b.get().leaders, second.leaders);
});

test('leaders: bad slots and names are refused without changing anything', () => {
    const b = loadBackend();
    for (const leaders of [null, [], 'Иванов', { lead: 'Иванов И.' }, { slot_9: 'Иванов И.' }, { slot_1: '=HYPERLINK("x")' }, { slot_1: 'И'.repeat(41) }, { slot_1: 'Иванов <b>' }]) {
        assert.equal(b.post({ action: 'setRoster', pin: PIN, leaders }).error, 'bad_request', JSON.stringify(leaders));
    }
    assert.equal(b.get().leaders, null);
});

/* ------------------------------------------------------------- importSales */

const importRows = [
    { date: '2026-09-22', amount: 21990, rop: 'ЕСЦ1', invoice: '568010911' },
    { date: '2026-09-22', amount: 30, rop: 'ЕСЦ4', invoice: '568465060' },
    { date: '2026-09-23', amount: 112147.38, rop: 'ЕСЦ8', invoice: '567674920' },
];

test('importSales dry run: what the sheet holds for the period now (today\'s part too), nothing written', () => {
    const b = yaroslavlBackend({ plans: [['2026-09-21', 5, 'TRUE']] });
    const before = JSON.stringify(b.salesRows());
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-23', rows: [{ ...importRows[0], date: '2026-09-21' }, ...importRows], dryRun: true });
    assert.equal(res.dryRun, true);
    assert.deepEqual(res.current, { rows: 3, payments: 3, manualPayments: 3, todayPayments: 1, byRop: { 'ЕСЦ1': 1, 'ЕСЦ4': 1, 'ЕСЦ5': 1 } });
    assert.equal(res.dayOffPayments, 1, 'one row falls on Monday, marked a day off');
    assert.equal(res.announces, '2026-09-22');
    assert.equal(JSON.stringify(b.salesRows()), before);
});

test('importSales replaces every payment of the period (typed in by hand too) and keeps the other days', () => {
    const b = yaroslavlBackend();
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows, requestId: 'imp-1' });
    assert.deepEqual(res.removed, { rows: 2, payments: 2 });
    assert.deepEqual(res.added, { payments: 3 });
    assert.equal(b.salesSheet().setValuesCalls, 1, 'one write for the whole table');
    const sales = b.salesRows().slice(1).filter(r => r[0] !== '');
    assert.deepEqual(sales.map(r => [r[1], r[2], r[3], r[4]]), [
        [90000, 'ЕСЦ1', '', ''],
        [400000, 'ЕСЦ1', '', ''],
        [21990, 'ЕСЦ1', '568010911', 1],
        [30, 'ЕСЦ4', '568465060', 1],
        [112147.38, 'ЕСЦ8', '567674920', 1],
    ]);
    assert.ok(sales.every(r => typeof r[0].getTime === 'function'), 'dates are real dates');
    assert.deepEqual(byRopOf(b.get()), { 'ЕСЦ8': 1 }, 'today = the file\'s row of the 23rd');
});

test('the morning import of yesterday settles yesterday, announces its result and leaves today alone', () => {
    const b = yaroslavlBackend({ plans: [['2026-09-22', 2, ''], ['2026-09-23', 10, '']] });
    b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ3', date: '2026-09-23', count: 4 });
    const todayBefore = b.get();
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-22', rows: importRows.slice(0, 2) });
    assert.deepEqual(res.announced, { day: '2026-09-22', total: 2, plan: 2, headsCut: 5, defeated: true });
    const after = b.get();
    assert.deepEqual([after.totalToday, after.plan, byRopOf(after)], [todayBefore.totalToday, todayBefore.plan, byRopOf(todayBefore)]);
    assert.deepEqual(after.commands.map(c => [c.type, c.args.day]), [['dayResult', '2026-09-22']]);
    assert.deepEqual(after.lastResult, res.announced);
});

test('an import that does not cover the last working day announces nothing', () => {
    const b = yaroslavlBackend();
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-21', rows: [{ ...importRows[0], date: '2026-09-21' }] });
    assert.equal(res.announced, null);
    assert.deepEqual(b.get().commands, []);
    assert.equal(b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-21', rows: [], dryRun: true }).announces, null);
});

test('on Monday the import of Friday announces Friday', () => {
    const b = at('2026-09-28T11:40:00', { plans: [['2026-09-25', 1, '']] });
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-25', to: '2026-09-25', rows: [{ date: '2026-09-25', amount: 500, rop: 'ЕСЦ6', invoice: '9' }] });
    assert.deepEqual(res.announced, { day: '2026-09-25', total: 1, plan: 1, headsCut: 5, defeated: true });
});

test('importSales again with the same or a fresher overlapping file never counts a payment twice', () => {
    const b = yaroslavlBackend();
    b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows });
    b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows });
    assert.equal(b.post({ action: 'listSales', pin: PIN }).totalRows, 2 + 3);
    const fresher = [{ date: '2026-09-21', amount: 5000, rop: 'ЕСЦ6', invoice: '1' }, importRows[0]];
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-23', rows: fresher });
    assert.deepEqual(res.removed, { rows: 4, payments: 4 });
    assert.equal(b.post({ action: 'listSales', pin: PIN }).totalRows, 1 + 2);
});

test('an import replaces the counts saved for its period; a count saved later replaces that day\'s invoices', () => {
    const b = yaroslavlBackend();
    b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-22', count: 4 });
    b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows });
    assert.equal(b.post({ action: 'dayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-22' }).count, 1);
    b.post({ action: 'setDayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-22', count: 2 });
    const sales = b.post({ action: 'listSales', pin: PIN }).sales;
    assert.equal(sales.filter(s => s.invoice === '568010911').length, 0);
    assert.equal(sales.filter(s => s.invoice === '567674920').length, 1);
});

test('importSales with fewer rows than before blanks the leftover rows and leaves other columns alone', () => {
    const b = loadBackend();
    const res = b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-23', rows: [importRows[0]] });
    assert.equal(res.removed.rows, 3);
    const rows = b.salesRows();
    assert.deepEqual([rows[1][1], rows[1][2], rows[1][6], rows[1][7]], [21990, 'ЕСЦ1', '568010911', 1]);
    for (const r of rows.slice(2, 4)) assert.deepEqual([r[0], r[1], r[2], r[6], r[7]], ['', '', '', '', '']);
    assert.deepEqual(rows.map(r => r[5]), ['', 'ЕСЦ1', 'ЕСЦ2', 'ЕСЦ3', 'ЕСЦ5', 'ЕСЦ6', 'ЕСЦ8']);
});

test('importSales grows the sheet when the rows do not fit', () => {
    const b = yaroslavlBackend();
    b.salesSheet().maxRows = 5;
    const many = Array.from({ length: 20 }, (_, i) => ({ date: '2026-09-22', amount: 1000 + i, rop: 'ЕСЦ7', invoice: String(i) }));
    assert.equal(b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-22', rows: many }).added.payments, 20);
    assert.equal(b.post({ action: 'listSales', pin: PIN }).totalRows, 3 + 20);
});

test('importSales refuses bad periods and rows (formulas too) and writes nothing', () => {
    const b = yaroslavlBackend();
    const before = JSON.stringify(b.salesRows());
    const ok = { date: '2026-09-22', amount: 100, rop: 'ЕСЦ1', invoice: '1' };
    const cases = [
        [{ from: '2026-09-23', to: '2026-09-22', rows: [] }, 'period'],
        [{ from: '22.09.2026', to: '2026-09-23', rows: [] }, 'period'],
        [{ from: '2026-09-21', to: '2030-01-01', rows: [] }, 'period'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: 'x' }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: Array(5001).fill(ok) }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: [ok, { ...ok, date: '2026-09-20' }] }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: [{ ...ok, rop: 'ВШ1' }] }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: [{ ...ok, rop: '=1+1' }] }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: [{ ...ok, amount: 0 }] }, 'rows'],
        [{ from: '2026-09-21', to: '2026-09-23', rows: [{ ...ok, invoice: '=IMPORTXML("http://x")' }] }, 'rows'],
    ];
    for (const [payload, field] of cases) {
        const res = b.post({ action: 'importSales', pin: PIN, ...payload });
        assert.equal(res.field, field, JSON.stringify(payload).slice(0, 120));
    }
    assert.equal(b.post({ action: 'importSales', pin: PIN, from: '2026-09-21', to: '2026-09-23', rows: [ok, { ...ok, rop: 'ЕСЦ9' }] }).row, 1);
    assert.equal(JSON.stringify(b.salesRows()), before);
});

test('a retried importSales (same requestId) runs once and announces once', () => {
    const b = yaroslavlBackend();
    const first = b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows, requestId: 'r-imp' });
    const writes = b.salesSheet().setValuesCalls;
    assert.deepEqual(b.post({ action: 'importSales', pin: PIN, from: '2026-09-22', to: '2026-09-23', rows: importRows, requestId: 'r-imp' }), first);
    assert.equal(b.salesSheet().setValuesCalls, writes);
    assert.equal(b.get().commands.length, 1);
});

/* ------------------------------------------------- group leaders' PINs (rg.html) */

const GROUP_PINS = { slot_1: '111111', slot_2: '222222', slot_3: '333333', slot_4: '444444', slot_5: '555555', slot_6: '666666', slot_7: '777777', slot_8: '888888' };
const NONE_SET = Object.fromEntries(Object.keys(GROUP_PINS).map(s => [s, false]));

function withGroupPins(opts) {
    const b = loadBackend(opts);
    assert.equal(b.post({ action: 'setGroupPins', pin: PIN, pins: GROUP_PINS }).ok, true);
    return b;
}

test('group PINs: set by the admin, stored only as hashes, status shows which groups have one', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'groupPinStatus', pin: PIN }).set, NONE_SET);
    const res = b.post({ action: 'setGroupPins', pin: PIN, pins: { slot_1: '111111', slot_8: '888888' } });
    assert.deepEqual(res, { ok: true, set: { ...NONE_SET, slot_1: true, slot_8: true } });
    const stored = b.props.get('GROUP_PINS');
    assert.ok(!stored.includes('111111') && !stored.includes('888888'));
    assert.ok(!JSON.stringify(b.get()).includes(stored.slice(0, 20)));
});

test('group PINs: bad slots and PINs, duplicates and the admin PIN are refused', () => {
    const b = withGroupPins();
    for (const pins of [null, [], {}, { lead: '999999' }, { slot_9: '999999' }, { slot_1: '12345' }, { slot_1: 'abcdef' }]) {
        assert.equal(b.post({ action: 'setGroupPins', pin: PIN, pins }).error, 'bad_request', JSON.stringify(pins));
    }
    const dup = (pins) => b.post({ action: 'setGroupPins', pin: PIN, pins }).field;
    assert.equal(dup({ slot_1: '999999', slot_2: '999999' }), 'pins_duplicate');
    assert.equal(dup({ slot_1: '222222' }), 'pins_duplicate');
    b.post({ action: 'changePin', pin: PIN, newPin: '864200' });
    assert.equal(b.post({ action: 'setGroupPins', pin: '864200', pins: { slot_3: '864200' } }).field, 'pins_duplicate');
    assert.equal(b.post({ action: 'changePin', pin: '864200', newPin: '777777' }).field, 'newPin_group');
});

test('groupLogin: the PIN says which group; it carries today and the leader once edited', () => {
    const b = withGroupPins();
    const res = b.post({ action: 'groupLogin', groupPin: '111111' });
    assert.deepEqual(res.group, { slot: 'slot_1', code: 'ЕСЦ1', leader: null });
    assert.deepEqual(res.today, { day: '2026-09-23', isWorkday: true, count: 1, total: 1 });
    assert.equal(b.post({ action: 'groupLogin', groupPin: '888888' }).group.code, 'ЕСЦ8');
    b.post({ action: 'setRoster', pin: PIN, leaders: { slot_8: 'Петров Б.' } });
    assert.equal(b.post({ action: 'groupLogin', groupPin: '888888' }).group.leader, 'Петров Б.');
});

test('group PINs open only the group page, and the admin PIN does not open it', () => {
    const b = withGroupPins();
    assert.equal(b.post({ action: 'groupLogin', groupPin: PIN }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'groupLogin', pin: '111111' }).error, 'invalid_pin');
    const sheet = JSON.stringify(b.salesRows());
    for (const action of ['login', 'listSales', 'setDayPlans', 'importSales', 'setRoster', 'setGroupPins', 'setDayCount']) {
        assert.ok(['invalid_pin', 'locked'].includes(b.post({ action, pin: '111111', rop: 'ЕСЦ1', count: 1 }).error), action);
    }
    assert.equal(JSON.stringify(b.salesRows()), sheet);
});

test('groupSetCount sets TODAY\'s payments of the PIN\'s own group, whatever group or day the request names', () => {
    const b = withGroupPins();
    const res = b.post({ action: 'groupSetCount', groupPin: '444444', rop: 'ЕСЦ1', date: '2026-09-21', count: 3, requestId: 'g1' });
    assert.deepEqual(res.saved, { rop: 'ЕСЦ4', date: '2026-09-23', count: 3, previous: 0 });
    assert.deepEqual(res.today, { day: '2026-09-23', isWorkday: true, count: 3, total: 4 });
    assert.equal(byRopOf(b.get())['ЕСЦ4'], 3);
    assert.equal(b.post({ action: 'dayCount', pin: PIN, rop: 'ЕСЦ1', date: '2026-09-21' }).count, 1, 'Monday untouched');
    const writes = b.salesSheet().setValuesCalls;
    assert.deepEqual(b.post({ action: 'groupSetCount', groupPin: '444444', count: 3, requestId: 'g1' }), res, 'a retry writes nothing');
    assert.equal(b.salesSheet().setValuesCalls, writes);
    assert.equal(b.post({ action: 'groupSetCount', groupPin: '444444', count: 1 }).today.count, 1, 'a mistake is fixed with a lower number');
    for (const count of [-1, 1.5, 1000, 'abc', '', undefined]) assert.equal(b.post({ action: 'groupSetCount', groupPin: '444444', count }).field, 'count', String(count));
});

test('groupSetCount on a weekend or a day off is refused; groupLogin says it is a day off', () => {
    const sat = at('2026-09-26T12:00:00');
    sat.post({ action: 'setGroupPins', pin: PIN, pins: { slot_2: '222222' } });
    assert.equal(sat.post({ action: 'groupSetCount', groupPin: '222222', count: 1 }).field, 'dayoff');
    assert.deepEqual(sat.post({ action: 'groupLogin', groupPin: '222222' }).today, { day: '2026-09-26', isWorkday: false, count: 0, total: 0 });

    const holiday = withGroupPins({ plans: [['2026-09-23', '', 'TRUE']] });
    const before = JSON.stringify(holiday.salesRows());
    assert.equal(holiday.post({ action: 'groupSetCount', groupPin: '222222', count: 1 }).field, 'dayoff');
    assert.equal(JSON.stringify(holiday.salesRows()), before);
});

test('group PIN guessing locks only the group page, a new PIN replaces the old one', () => {
    const b = withGroupPins();
    for (let i = 0; i < 4; i++) assert.equal(b.post({ action: 'groupLogin', groupPin: '00000' + i }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'groupLogin', groupPin: '000009' }).error, 'locked');
    assert.equal(b.post({ action: 'groupLogin', groupPin: '111111' }).error, 'locked');
    assert.equal(b.post({ action: 'login', pin: PIN }).ok, true, 'the admin page is not locked');
    b.post({ action: 'setGroupPins', pin: PIN, pins: { slot_1: '121212' } });
    assert.equal(b.post({ action: 'groupLogin', groupPin: '121212' }).group.code, 'ЕСЦ1');
    assert.equal(b.post({ action: 'groupLogin', groupPin: '111111' }).error, 'invalid_pin');
});

test('the group lock wears off after the lock time', () => {
    const b = withGroupPins();
    for (let i = 0; i < 5; i++) b.post({ action: 'groupLogin', groupPin: 'x' + i });
    assert.equal(b.post({ action: 'groupLogin', groupPin: '333333' }).error, 'locked');
    b.advance(601 * 1000);
    assert.equal(b.post({ action: 'groupLogin', groupPin: '333333' }).ok, true);
});
