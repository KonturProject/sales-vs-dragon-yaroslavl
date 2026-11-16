import { Events } from 'phaser';
import type { DayResult } from './GameState';

export interface MoneyInPayload {
    heroSlug: string;
    ropName: string;
    delta: number;
    /** A strike shown on request from the admin page — it is not a real sale, so it must not count as one (idle timer etc.). */
    demo?: boolean;
}

/**
 * An animation the admin page asked the displays to play (see apps-script/Code.gs, action 'command').
 * Purely visual — handlers must not touch GameState.
 *   hit {rop, count} | fall {hero, mode} | wake | growl | confetti | celebrate | dayResult {DayResult}
 */
export interface AdminCommandPayload {
    type: string;
    args: Record<string, unknown>;
}

export interface ProgressChangedPayload {
    ratio: number;
    totalToday: number;
    plan: number;
    /** Dragon heads left after this poll (HEADS at 0%, 0 at 100%). */
    headsRemaining: number;
    /** A baseline (first poll, or a new day): show the state as it is, without hit/head-loss animations. */
    reset?: boolean;
}

export interface FetchErrorPayload {
    consecutiveFailures: number;
    error: string;
}

export interface DragonHeadLostPayload {
    /** Heads left once this one is gone. */
    heads: number;
    /** Wait this long before playing it — lets the hit animations from the same poll read first. */
    delayMs: number;
}

export interface DragonDefeatedPayload {
    delayMs: number;
}

export interface LiveStandPayload {
    active: boolean;
}

/** Whether today is a working day, and how the last working day ended — sent when either changes. */
export interface DayStatePayload {
    isWorkday: boolean;
    lastResult: DayResult | null;
}

/** The admin chose other characters for some slots (slot ids as in HERO_SLUGS). */
export interface RosterChangedPayload {
    slots: string[];
}

/** The admin renamed the group leaders of some department slots (their nameplates and leaderboard rows). */
export interface LeadersChangedPayload {
    slots: string[];
}

/**
 * Single shared emitter connecting DataPollingService (data layer) to the
 * Phaser scenes (PenScene draws hits and the dragon, HUDScene draws the bar and the victory banner).
 */
export const EventBus = new Events.EventEmitter();

export const GameEvents = {
    DATA_UPDATED: 'data:updated',
    MONEY_IN: 'money:in',
    PROGRESS_CHANGED: 'progress:changed',
    FETCH_ERROR: 'data:fetch-error',
    DRAGON_HEAD_LOST: 'dragon:head-lost',
    DRAGON_DEFEATED: 'dragon:defeated',
    ADMIN_COMMAND: 'admin:command',
    ROSTER_CHANGED: 'roster:changed',
    LEADERS_CHANGED: 'roster:leaders-changed',
    /** A working day / a day off began, or the last working day's result changed (DayStatePayload). */
    DAY_STATE: 'day:state',
    /** Someone is breathing (the live-stand rotation): the game should draw at least at the ambient frame rate. */
    LIVE_STAND: 'stand:live',
} as const;
