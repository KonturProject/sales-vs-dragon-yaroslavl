import { plateText, sanitiseLeaders } from '../src/game/systems/Groups';
import { paymentsText } from '../src/game/systems/Units';
import { BackendError, callAsGroup, newRequestId } from '../src-admin/api';
import { DayCounter, dayCaption, dayName } from '../src-admin/dayCounter';

/**
 * The group leaders' page: one thing only — how many payments the leader's own group has TODAY. The PIN says which
 * group it is (apps-script/Code.gs, groupLogin / groupSetCount); the leader never picks a group or a day, so cannot
 * touch another group or yesterday (yesterday is settled by the morning import of the CRM export). On a day off
 * (a weekend, a holiday marked in the admin page) nothing can be entered.
 */

interface GroupView {
    group: { slot: string; code: string; leader: string | null };
    today: { day: string; isWorkday: boolean; count: number; total: number };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pinForm = $<HTMLFormElement>('pin-form');
const pinInput = $<HTMLInputElement>('pin');
const panel = $<HTMLDivElement>('panel');
const statusEl = $<HTMLParagraphElement>('status');
const title = $<HTMLHeadingElement>('title');
const todayEl = $<HTMLParagraphElement>('rg-today');
const counterBox = $<HTMLDivElement>('rg-counter');
const hint = $<HTMLParagraphElement>('rg-hint');
const dayOffEl = $<HTMLParagraphElement>('rg-dayoff');

/** Kept in memory only for this page's lifetime — never stored, never in a URL. */
let pin = '';
let view: GroupView | null = null;

const counter = new DayCounter(saveCount);
counterBox.append(counter.el);

function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
    statusEl.textContent = text;
    statusEl.className = kind;
}

/** «ЕСЦ1 • Фамилия И.» — the leader's name as edited in the admin page, or just the code. */
function groupName(v: GroupView): string {
    const leaders = sanitiseLeaders(v.group.leader !== null ? { [v.group.slot]: v.group.leader } : null);
    return plateText(v.group.slot, leaders);
}

function show(v: GroupView) {
    view = v;
    title.textContent = groupName(v);
    const work = v.today.isWorkday;
    todayEl.textContent = work
        ? `Сегодня, ${dayName(v.today.day)}: у группы ${paymentsText(v.today.count)} · у всех групп ${paymentsText(v.today.total)}`
        : `Сегодня, ${dayName(v.today.day)}`;
    dayOffEl.hidden = work;
    counterBox.hidden = !work;
    hint.hidden = !work;
    if (work) {
        counter.setCaption(dayCaption(v.today.day));
        counter.setBase(v.today.count);
    }
}

function showLogin(message = '') {
    pin = '';
    view = null;
    pinInput.value = '';
    panel.hidden = true;
    pinForm.hidden = false;
    title.textContent = 'Оплаты группы';
    setStatus(message, message ? 'error' : '');
}

function reportError(err: unknown) {
    if (!(err instanceof BackendError)) {
        console.error(err);
        setStatus('Что-то пошло не так. Подробности в консоли браузера.', 'error');
        return;
    }
    switch (err.code) {
        case 'invalid_pin':
            showLogin('Неверный PIN. Введите его снова (если PIN недавно меняли — спросите новый у администратора).');
            break;
        case 'locked': {
            const minutes = Math.max(1, Math.ceil((err.detail?.retryAfterSec ?? 600) / 60));
            showLogin(`Слишком много неверных попыток. Подождите примерно ${minutes} мин.`);
            break;
        }
        case 'network':
            setStatus('Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.', 'error');
            break;
        case 'demo':
            setStatus('Демо-режим (config.json.useMock=true): сервер отключён.', 'error');
            break;
        case 'bad_request':
            if (err.detail?.field === 'dayoff') {
                if (view) show({ ...view, today: { ...view.today, isWorkday: false } });
                setStatus('Сегодня выходной — оплаты не вносятся.', 'error');
            } else setStatus('Число оплат — от 0 до 999.', 'error');
            break;
        default:
            setStatus(`Ошибка: ${err.code}`, 'error');
    }
}

async function saveCount(count: number) {
    if (!view) return;
    setStatus('Сохраняю…');
    try {
        const res = await callAsGroup<GroupView & { saved: { date: string; count: number; previous: number } }>('groupSetCount', pin, {
            count,
            requestId: newRequestId(),
        });
        show(res);
        const grew = res.saved.count > res.saved.previous;
        setStatus(`Сохранено: ${dayName(res.saved.date)} — ${paymentsText(res.saved.count)}.`
            + (grew ? ' Герой группы ударит на экранах в течение ~15 секунд.' : ''), 'ok');
    } catch (err) {
        reportError(err);
    }
}

pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Проверяю…');
    const typed = pinInput.value.trim();
    try {
        const res = await callAsGroup<GroupView>('groupLogin', typed);
        pin = typed;
        pinInput.value = '';
        pinForm.hidden = true;
        panel.hidden = false;
        show(res);
        setStatus('');
    } catch (err) {
        reportError(err);
    }
});

$('logout').addEventListener('click', () => showLogin());
