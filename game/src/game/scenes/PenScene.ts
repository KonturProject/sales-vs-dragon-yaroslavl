import { Scene } from 'phaser';
import {
    EventBus, GameEvents, MoneyInPayload, ProgressChangedPayload, DragonHeadLostPayload, DragonDefeatedPayload, AdminCommandPayload,
    RosterChangedPayload, LeadersChangedPayload, DayStatePayload,
} from '../core/EventBus';
import { GameState } from '../core/GameState';
import { fitCameraToGame } from '../core/Render';
import { DRAGON, GAME, HERO, HUD, HeroSlug } from '../core/Constants';
import { RosterConfig, HeroDef } from '../systems/RosterConfig';
import { loadCharacters } from '../systems/CharacterLoader';
import { DataPollingService } from '../systems/DataPollingService';
import { Dragon } from '../objects/Dragon';
import { HeroSprite } from '../objects/HeroSprite';
import { NamePlate, PLATE_HEIGHT } from '../objects/NamePlate';
import { IdleMood } from '../systems/IdleMood';
import { LiveStand } from '../systems/LiveStand';
import { emitFloatingPayments, startIdleSway } from '../systems/Fx';
import { AudioSystem } from '../systems/Audio';

/** Above every hero (their depth is the feet's y, at most ~600), below the hit effects (1400). */
const PLATE_DEPTH = 1000;

/**
 * The tableau: eight department heroes on the left, the dragon on its gold mountain
 * on the right. Reacts to game events only —
 * decisions about *what* happens (which hero hit, how many heads are left) are
 * made upstream in DataPollingService / GameState.
 */
export class PenScene extends Scene {
    private dragon!: Dragon;
    private heroes = new Map<string, HeroSprite>();
    private plates = new Map<string, NamePlate>();
    private hasAppliedFirstProgress = false;
    private hasPlayedVictory = false;
    /** Falls asleep when nobody sells for a long time; makes the dragon growl (see systems/IdleMood.ts). */
    mood!: IdleMood;

    constructor() {
        super('PenScene');
    }

    create() {
        fitCameraToGame(this);
        this.cameras.main.setBackgroundColor('#08090f');

        // Background picture, built to exactly the canvas size by tools/build-scene.py.
        this.add.image(GAME.WIDTH / 2, GAME.HEIGHT / 2, 'bg_scene').setDisplaySize(GAME.WIDTH, GAME.HEIGHT).setDepth(-10);

        this.dragon = new Dragon(this);

        // Depth follows the feet's y so the front row draws over the back row.
        RosterConfig.fighters.forEach((def: HeroDef, i: number) => {
            const slot = HERO.SLOTS[i];
            const hero = new HeroSprite(this, slot.x, slot.y, def, slot.scale);
            hero.setDepth(slot.y);
            this.heroes.set(def.slug, hero);

            // The group and its leader: over the head in the back row, under the feet in the front row.
            const backRow = slot.y < HERO.SLOTS[1].y;
            const heroHeight = HERO.TEXTURE_HEIGHT * HERO.TEXTURE_SCALE * slot.scale;
            const plateY = backRow
                ? slot.y - heroHeight - HERO.PLATE_GAP - PLATE_HEIGHT / 2
                : slot.y + HERO.PLATE_GAP + PLATE_HEIGHT / 2;
            this.plates.set(def.slug, new NamePlate(this, slot.x, plateY, RosterConfig.plateText(def.slug)).setDepth(PLATE_DEPTH));
        });

        startIdleSway(this, [...this.heroes.values()]);
        // The live stand goes round: one of the eight breathes at a time (see systems/LiveStand.ts).
        new LiveStand(this, [...this.heroes.values()]);
        this.mood = new IdleMood(this, [...this.heroes.values()], this.dragon);

        EventBus.on(GameEvents.MONEY_IN, this.onMoneyIn, this);
        EventBus.on(GameEvents.PROGRESS_CHANGED, this.onProgressChanged, this);
        EventBus.on(GameEvents.DRAGON_HEAD_LOST, this.onDragonHeadLost, this);
        EventBus.on(GameEvents.DRAGON_DEFEATED, this.onDragonDefeated, this);
        EventBus.on(GameEvents.ADMIN_COMMAND, this.onAdminCommand, this);
        EventBus.on(GameEvents.ROSTER_CHANGED, this.onRosterChanged, this);
        EventBus.on(GameEvents.LEADERS_CHANGED, this.onLeadersChanged, this);
        EventBus.on(GameEvents.DAY_STATE, this.onDayState, this);

        this.events.once('shutdown', () => {
            EventBus.off(GameEvents.DAY_STATE, this.onDayState, this);
            EventBus.off(GameEvents.ROSTER_CHANGED, this.onRosterChanged, this);
            EventBus.off(GameEvents.LEADERS_CHANGED, this.onLeadersChanged, this);
            EventBus.off(GameEvents.ADMIN_COMMAND, this.onAdminCommand, this);
            EventBus.off(GameEvents.MONEY_IN, this.onMoneyIn, this);
            EventBus.off(GameEvents.PROGRESS_CHANGED, this.onProgressChanged, this);
            EventBus.off(GameEvents.DRAGON_HEAD_LOST, this.onDragonHeadLost, this);
            EventBus.off(GameEvents.DRAGON_DEFEATED, this.onDragonDefeated, this);
        });

        // Apply whatever GameState already holds (e.g. if a poll landed before this
        // scene finished creating), then start/continue polling.
        this.onProgressChanged({
            ratio: GameState.ratio,
            totalToday: GameState.totalToday,
            plan: GameState.plan,
            headsRemaining: GameState.headsRemaining,
        });

        DataPollingService.start();
    }

    /** The admin picked other characters: fetch what is missing, then swap them in place (slots keep their positions). */
    private onRosterChanged(payload: RosterChangedPayload) {
        const defs = payload.slots.map(slot => RosterConfig.heroDef(slot as never)).filter((d): d is HeroDef => !!d);
        loadCharacters(this, defs, () => {
            for (const def of defs) this.heroes.get(def.slug)?.setCharacter(def);
        });
    }

    /** The admin renamed group leaders: rewrite their plates (the plates stay where they are). */
    private onLeadersChanged(payload: LeadersChangedPayload) {
        for (const slot of payload.slots) this.plates.get(slot)?.setText(RosterConfig.plateText(slot as HeroSlug));
    }

    /** A day off: the dragon dozes and nobody gets bored; a working day wakes it. */
    private onDayState(payload: DayStatePayload) {
        this.dragon.setResting(!payload.isWorkday);
        this.mood.setPaused(!payload.isWorkday);
    }

    private onMoneyIn(payload: MoneyInPayload) {
        // The hero dashes to the dragon; the thud and the dragon's reaction land with the blow, not with the sale event.
        this.time.delayedCall(HERO.IMPACT_MS, () => AudioSystem.playHitThud());

        const hero = this.heroes.get(payload.heroSlug);
        if (hero) {
            hero.playHit(payload.delta);
            this.time.delayedCall(HERO.IMPACT_MS, () => this.dragon.reactToHit());
            emitFloatingPayments(
                this, hero.x, hero.y - 150, payload.delta,
                HUD.BAR_X + HUD.BAR_WIDTH / 2, HUD.BAR_Y + HUD.BAR_HEIGHT / 2
            );
        }

    }

    /**
     * An animation requested from the admin page. Everything here is visual only — no GameState,
     * no data. A `hit` goes through the normal MONEY_IN path (flagged `demo`, so it does not count as a sale).
     */
    private onAdminCommand(cmd: AdminCommandPayload) {
        switch (cmd.type) {
            case 'hit': {
                const rop = String(cmd.args.rop ?? '');
                const delta = Number(cmd.args.count) || 1;
                EventBus.emit(GameEvents.MONEY_IN, {
                    heroSlug: RosterConfig.heroSlugForRop(rop) ?? 'overflow', ropName: rop, delta, demo: true,
                } satisfies MoneyInPayload);
                break;
            }
            case 'fall':
                this.mood.drop(String(cmd.args.hero ?? 'random'), String(cmd.args.mode ?? 'random'));
                break;
            case 'wake':
                this.mood.wakeAll();
                break;
            case 'growl':
                this.dragon.growl();
                break;
            case 'celebrate':
                AudioSystem.playFanfare();
                this.heroes.forEach(hero => { if (hero.canSway()) hero.playCelebrate(); });
                break;
            case 'dayResult':
                // The last working day's dragon fell: the heroes cheer (the banner itself is HUDScene's).
                if (cmd.args.defeated) {
                    AudioSystem.playFanfare();
                    this.heroes.forEach(hero => { if (hero.canSway()) hero.playCelebrate(); });
                }
                break;
            // 'confetti' is drawn by HUDScene (full-screen effect).
        }
    }

    private onProgressChanged(payload: ProgressChangedPayload) {
        // Heads only ever *drop* through DRAGON_HEAD_LOST (animated, delayed so the
        // blows read first). Here we handle the baseline on load and regrowth
        // (a new day or a raised plan pushed the ratio back down).
        // The baseline is the first application made *after real data has landed*
        // (create() also calls this once with an empty GameState — that one must not
        // count, or the first poll's lower head count would be treated as a drop).
        if (!this.hasAppliedFirstProgress) {
            this.dragon.setHeads(payload.headsRemaining, false);
            this.hasAppliedFirstProgress = GameState.hasBaseline;
        } else if (payload.reset && payload.headsRemaining !== this.dragon.headCount) {
            // A new day: today's dragon, as it stands — no head-loss animation for payments made before this poll.
            this.dragon.setHeads(payload.headsRemaining, payload.headsRemaining > this.dragon.headCount);
        } else if (payload.headsRemaining > this.dragon.headCount) {
            this.dragon.setHeads(payload.headsRemaining, true);
        }

        if (this.hasPlayedVictory && payload.ratio < 1) this.hasPlayedVictory = false;
    }

    // Both handlers are delayed (so the blows read first), and the data can move
    // on in the meantime — e.g. the plan is raised mid-cascade and the ratio drops
    // back. A stale event must then be dropped, or the dragon would end up
    // headless/grey while GameState says it still has heads.
    private onDragonHeadLost(payload: DragonHeadLostPayload) {
        this.time.delayedCall(payload.delayMs, () => {
            if (payload.heads < GameState.headsRemaining) return;
            this.dragon.loseHead(payload.heads);
        });
    }

    private onDragonDefeated(payload: DragonDefeatedPayload) {
        this.time.delayedCall(payload.delayMs + DRAGON.HEAD_LOSS_DURATION_MS, () => {
            if (!GameState.dragonDefeated) return;
            AudioSystem.playFanfare();
            this.hasPlayedVictory = true;
            this.dragon.defeat();
            this.heroes.forEach(hero => hero.playCelebrate());
            this.cameras.main.shake(300, 0.008);
        });
    }
}
