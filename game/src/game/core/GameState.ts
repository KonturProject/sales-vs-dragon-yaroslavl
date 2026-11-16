import { HEADS } from './Constants';

/** A group's total today. The game counts payments: `amount` is a NUMBER OF PAYMENTS, not money. */
export interface RopAmount {
    ropName: string;
    amount: number;
}

/** An admin "play this animation" request as the backend hands it to the displays. */
export interface BackendCommand {
    /** Rising counter — each display plays every id once. */
    id: number;
    type: string;
    args: Record<string, unknown>;
    /** Backend clock, ms. */
    issuedAt: number;
}

/** How a working day ended (backend `dayResult_`): payments against THAT day's plan. */
export interface DayResult {
    day: string;
    total: number;
    plan: number;
    /** 0..HEADS */
    headsCut: number;
    defeated: boolean;
}

export interface StatusResponse {
    ok: boolean;
    /** Today, 'yyyy-MM-dd' in the sheet's time zone — a new day is a new dragon. */
    day: string;
    /** false on Saturday, Sunday and the weekdays the admin marked a day off: no plan, nothing counted. */
    isWorkday: boolean;
    /** Today's plan in force (its own or borrowed from an earlier working day, see planFrom). */
    plan: number;
    planFrom?: string | null;
    totalToday: number;
    byRop: RopAmount[];
    /** The result of the last working day before today (shown on a day off, and in the morning announcement). */
    lastResult?: DayResult | null;
    lastUpdated: string;
    /** Recent admin animation requests (absent on an older backend). */
    commands?: BackendCommand[];
    /** Backend clock, ms — compared with `issuedAt` so a display's own clock does not matter. */
    serverNow?: number;
    /** Which character stands in each slot (slot -> character id), as chosen in the admin page; null/absent = defaults. */
    roster?: Record<string, string> | null;
    /** Group leader on each department's nameplate (slot -> «Фамилия И.»), edited in the admin page; null/absent = defaults. */
    leaders?: Record<string, string> | null;
    error?: string;
}

/**
 * Centralized mutable state, shared between the polling system and every scene.
 * Not a Phaser object — plain singleton, following the game-creator EventBus/GameState pattern.
 */
class GameStateStore {
    plan = 0;
    totalToday = 0;
    byRop: Record<string, number> = {};
    /** The day of the last status ('' before the first poll). */
    day = '';
    isWorkday = true;
    lastResult: DayResult | null = null;
    /** true once at least one poll has landed — first poll is a baseline, never diffed */
    hasBaseline = false;
    /** Heads the dragon had after the previous poll — diffed to fire head-loss animations. */
    lastHeads = HEADS;
    /** Latched once the day's plan is closed; released when ratio drops back under 1 (new day / raised plan). */
    dragonDefeated = false;
    lastFetchOk = false;
    lastUpdated: string | null = null;

    /**
     * Applies a fresh status response and returns the previous byRop snapshot
     * (for the caller to diff against) — null on the very first call.
     */
    applyStatus(status: StatusResponse): Record<string, number> | null {
        // A new day (or the first poll) is a baseline: the groups start again from zero, so nothing is diffed
        // against yesterday's numbers — no strikes, the heads simply regrow.
        // The same goes for a day that turns into a day off and back (the admin ticks «выходной» by mistake): the
        // day-off poll emptied byRop, and diffing against that would replay the whole day as strikes.
        const sameDay = status.day === this.day && (status.isWorkday !== false) === this.isWorkday;
        const previous = this.hasBaseline && sameDay ? this.byRop : null;

        const nextByRop: Record<string, number> = {};
        for (const row of status.byRop) {
            nextByRop[row.ropName] = row.amount;
        }

        this.byRop = nextByRop;
        this.plan = status.plan;
        this.totalToday = status.totalToday;
        this.day = status.day;
        this.isWorkday = status.isWorkday !== false;
        this.lastResult = status.lastResult ?? null;
        this.lastUpdated = status.lastUpdated;
        this.lastFetchOk = true;
        this.hasBaseline = true;

        return previous;
    }

    get ratio(): number {
        if (this.plan <= 0) return 0;
        return Math.min(1, Math.max(0, this.totalToday / this.plan));
    }

    /**
     * Dragon heads left: one is lost each time today's total crosses another
     * 1/HEADS of the day's plan, so 0% -> HEADS heads and 100% -> 0 heads.
     */
    get headsRemaining(): number {
        return HEADS - Math.floor(this.ratio * HEADS + 1e-9);
    }

    reset() {
        this.plan = 0;
        this.totalToday = 0;
        this.byRop = {};
        this.day = '';
        this.isWorkday = true;
        this.lastResult = null;
        this.hasBaseline = false;
        this.lastHeads = HEADS;
        this.dragonDefeated = false;
        this.lastFetchOk = false;
        this.lastUpdated = null;
    }
}

export const GameState = new GameStateStore();
