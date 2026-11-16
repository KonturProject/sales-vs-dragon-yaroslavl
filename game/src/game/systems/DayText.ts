import type { DayResult } from '../core/GameState';
import { HEADS } from '../core/Constants';
import { paymentsText, pluralWord } from './Units';

/**
 * Words for the daily game's announcements: «вчера» when the result is the calendar yesterday, otherwise the
 * weekday («в пятницу», after a weekend or holidays). Plain functions — no Phaser.
 */

const ACCUSATIVE = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const GENITIVE = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы'];

/** 'yyyy-MM-dd' -> local-midnight Date (only the weekday and the day count are read). */
function asDate(day: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function isDayBefore(day: string, today: string): boolean {
    const diff = Math.round((asDate(today).getTime() - asDate(day).getTime()) / 86400000);
    return diff === 1;
}

/** «вчера» / «в пятницу». */
export function whenText(result: DayResult, today: string): string {
    return today && isDayBefore(result.day, today) ? 'вчера' : `в ${ACCUSATIVE[asDate(result.day).getDay()]}`;
}

const headsText = (n: number) => `${n} из ${HEADS} ${pluralWord(HEADS, 'головы', 'голов', 'голов')}`;

/** The morning announcement after the import: { title, sub }. */
export function resultBanner(result: DayResult, today: string): { title: string; sub: string } {
    const yesterday = today !== '' && isDayBefore(result.day, today);
    if (result.defeated) {
        return {
            title: yesterday ? 'ВЧЕРАШНИЙ ДРАКОН ПАЛ!' : `ДРАКОН ${GENITIVE[asDate(result.day).getDay()].toUpperCase()} ПАЛ!`,
            sub: 'Отделы победили. Сегодня — новая битва!',
        };
    }
    return {
        title: `${whenText(result, today).toUpperCase()} СРУБЛЕНО ${headsText(result.headsCut).toUpperCase()}`,
        sub: result.plan > 0 ? `${paymentsText(result.total)} из ${result.plan} — сегодня добьём!` : 'Сегодня добьём!',
    };
}

/** The day-off line: «Итог пятницы: дракон пал!» / «Итог пятницы: срублено 3 из 5 голов». */
export function dayOffResultText(result: DayResult | null): string {
    if (!result) return 'Отдыхаем — дракон тоже спит';
    const of = `Итог ${GENITIVE[asDate(result.day).getDay()]}`;
    if (result.plan <= 0) return `${of}: ${paymentsText(result.total)}`;
    return result.defeated ? `${of}: дракон пал!` : `${of}: срублено ${headsText(result.headsCut)}`;
}
