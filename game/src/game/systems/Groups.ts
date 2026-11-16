import ropMapping from '../config/ropMapping.json';

/**
 * The branch's sales groups: how a group name from the sheet or a CRM export maps to a department slot, its short
 * code, and the group leader on its nameplate («ЕСЦ1 • Фамилия И.»). Plain data and functions — no Phaser — so the
 * admin page uses exactly the same matching as the game.
 */

const mapping = ropMapping.mapping as Record<string, string>;
const labels = ropMapping.labels as Record<string, string>;

/** The six department slots, left to right on the stage. */
export const GROUP_SLOTS = Object.keys(labels);

/** Built-in group leaders; the admin page can override them at run time (backend `leaders`). */
export const DEFAULT_LEADERS = ropMapping.leaders as Record<string, string>;

/** Cyrillic and look-alike Latin letters are all written in sheets by hand — fold them so «ЕСЦ5» matches however it was typed. */
const LOOKALIKE: Record<string, string> = { E: 'Е', e: 'е', C: 'С', c: 'с' };
function normalise(name: string): string {
    return name.trim().replace(/\s+/g, ' ').replace(/[EeCc]/g, c => LOOKALIKE[c]).toUpperCase();
}
const normalisedMapping = new Map<string, string>();
const slotByNumber = new Map<string, string>();
for (const [name, slot] of Object.entries(mapping)) {
    normalisedMapping.set(normalise(name), slot);
    if (/^ЕСЦ\d+$/.test(normalise(name))) slotByNumber.set(normalise(name).slice(3), slot);
}

/** The slot of a group, from its name as written in the sheet or an export («ЕСЦ6», «…_ЕСЦ6_…»); null if it is not one of ours. */
export function slotForGroup(name: string): string | null {
    const exact = mapping[name];
    if (exact) return exact;
    const folded = normalise(name);
    const hit = normalisedMapping.get(folded);
    if (hit) return hit;
    // A full CRM name is recognised by its «ЕСЦ<число>» part.
    const m = /(?:^|[^А-ЯЁ0-9])ЕСЦ(\d+)(?![0-9])/.exec(folded);
    return m ? slotByNumber.get(m[1]) ?? null : null;
}

/** The short code of a slot («ЕСЦ5») — what goes into the sheet. */
export function groupCode(slot: string): string | undefined {
    return labels[slot];
}

/** A leader's name as the admin may type or paste it: «Измайлова Ильвира Дамировна» -> «Измайлова И.»; «Измайлова И.» stays. */
export function shortPersonName(full: string): string {
    const words = full.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length < 2 || /\./.test(words[1])) return words.join(' ');
    return `${words[0]} ${words[1][0].toUpperCase()}.`;
}

/** Only known slots with a string name count; anything else keeps the built-in name, so a bad entry never blanks a plate. */
export function sanitiseLeaders(raw: unknown): Record<string, string> {
    const out = { ...DEFAULT_LEADERS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const slot of GROUP_SLOTS) {
            const name = (raw as Record<string, unknown>)[slot];
            if (typeof name === 'string') out[slot] = name.replace(/\s+/g, ' ').trim().slice(0, 40);
        }
    }
    return out;
}

/** «ЕСЦ1 • Фамилия И.», or just «ЕСЦ1» while the group has no leader set. */
export function plateText(slot: string, leaders: Record<string, string>): string {
    const code = labels[slot] ?? slot;
    const leader = leaders[slot];
    return leader ? `${code} • ${leader}` : code;
}
