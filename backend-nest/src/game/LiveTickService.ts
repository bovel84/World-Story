/**
 * World Story — LiveTickService
 * =============================
 * Battito del mondo in modalità live (Fase 1: estratto da `game-session.ts`):
 * data avanti, eventi casuali, tick economico deterministico e broadcast,
 * senza toccare la coda degli ordini del giocatore.
 *
 * Lo **stato vivo** è posseduto da `SessionStateStore` (iniettato). Lo stato
 * di abilitazione del timer resta in `GameSession` (`startLiveSim`).
 */

import { gameRepository } from '../repositories';
import { WorldStateEngine } from '../core/simulation/WorldStateEngine';
import { addDays } from '../core/simulation/calendar';
import { shortId } from '../utils/short-id';
import type { SimulationCoordinator } from './SimulationCoordinator';
import type { SessionStateStore } from './SessionStateStore';
import type { RegionState, TurnResultRecord } from '../game-session';

export interface LiveTickContext {
  gameId: string;
  state: SessionStateStore;
  coordinator: SimulationCoordinator;
  isStrictGame(): boolean;
  publicText(value: unknown): string;
  publicPolityName(polityId: string): string;
  broadcast(type: any, data: any): boolean | void;
  applyRandomEvents(): string[];
  /** WORLD-ALIVE P3: conflitti deterministici del mondo (NPC), senza LLM. */
  applyWorldConflicts(): string[];
  worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> };
  syncRegionsToDB(): Promise<void> | void;
  withLock<T>(fn: () => Promise<T>): Promise<T | null>;
}

export class LiveTickService {
  static readonly LIVE_TICK_DAYS = 7;

  constructor(private readonly ctx: LiveTickContext) {}

  private get state(): SessionStateStore { return this.ctx.state; }

  async worldTick(): Promise<void> {
    if (this.ctx.isStrictGame()) throw new Error('strict_legacy_path_forbidden: worldTick');
    if (this.ctx.coordinator.isProcessing) return;
    // Dopo il collasso il mondo non batte più: la partita è finita.
    if (this.state.ending) return;

    await this.ctx.withLock(async () => {
      // Snapshot owner/colore per il diff (regioni cambiate)
      const before = new Map<string, Pick<RegionState, 'owner' | 'color' | 'population' | 'gdp' | 'militaryPower'>>();
      for (const r of this.state.regions.values()) {
        before.set(r.id, { owner: r.owner, color: r.color, population: r.population,
          gdp: r.gdp, militaryPower: r.militaryPower });
      }

      // Avanza il tempo (nessuna azione del giocatore)
      this.state.currentTurn++;
      this.state.currentDate = addDays(this.state.currentDate, LiveTickService.LIVE_TICK_DAYS);

      // Il battito live non deve attendere una chiamata LLM: una risposta lenta
      // degli NPC bloccava il lock, quindi data, dispacci e mappa sembravano
      // fermi. Le reazioni NPC ragionate restano nel turno degli ordini; qui
      // registriamo esclusivamente fatti deterministici e immediati.
      const randomEvents = this.ctx.applyRandomEvents();
      // WORLD-ALIVE P3: il mondo si muove anche senza ordini. Questo passo è
      // **deterministico** (seme partita+turno) e non attende la LLM: usa le
      // politiche esistenti (`indexPolities`, `canNpcCapture`, `transferRegion`)
      // e le relazioni già registrate. Le conquiste entrano nel diff sotto,
      // quindi finiscono su mappa, timeline e dispacci come qualsiasi altro
      // cambiamento di proprietario.
      const conflictEvents = this.ctx.applyWorldConflicts();
      // Anche senza ordini il tempo ha un costo/effetto: economia, popolazione
      // e prontezza vengono aggiornate dal motore, non dal narratore.
      const tick = WorldStateEngine.advance(this.state.regions.values(), LiveTickService.LIVE_TICK_DAYS, this.ctx.worldStateOptions());

      const playerAccount = tick.accounts[this.state.playerPolityId];
      const playerName = this.ctx.publicPolityName(this.state.playerPolityId);
      const balance = playerAccount?.monthlyBalance || 0;
      // Il titolo resta una notizia breve; cifre e qualifiche appartengono al
      // corpo del dispaccio, non alla riga che deve essere letta sulla mappa.
      const quietHeadline = playerAccount
        ? `${playerName}: aggiornamento dei conti nazionali`
        : 'Settimana senza svolte nel teatro di gioco';
      const quietDispatch = playerAccount
        ? `Il ministero delle Finanze di ${playerName} stima una crescita annua del ${(playerAccount.annualGrowthRate * 100).toFixed(1)}%. Il saldo pubblico mensile resta ${balance >= 0 ? 'positivo' : 'negativo'} per ${Math.abs(balance).toFixed(2)} miliardi di dollari.`
        : 'I governi mantengono le posizioni e non emergono nuove svolte politiche o territoriali.';
      const worldEvents = [...conflictEvents, ...randomEvents];
      const events = (worldEvents.length > 0 ? worldEvents : [quietHeadline]).map(event => this.ctx.publicText(event));
      const id = shortId();
      // Dettaglio per riga: i primi `conflictEvents.length` sono sviluppi
      // militari, gli altri eventi casuali (o la riga di quiete).
      const details = (worldEvents.length > 0 ? worldEvents : [quietHeadline]).map((_, index) => (
        index < conflictEvents.length
          ? 'Le cancellerie confermano il movimento delle forze e ne valutano le conseguenze.'
          : randomEvents.length > 0
            ? 'Le autorità locali confermano lo sviluppo e ne valutano le conseguenze immediate.'
            : quietDispatch
      ));
      const narration = conflictEvents.length > 0
        ? `${conflictEvents.length} ${conflictEvents.length === 1 ? 'sviluppo militare' : 'sviluppi militari'} nel teatro: il mondo non resta fermo.`
        : randomEvents.length > 0
          ? `Il mondo procede: ${randomEvents.length} ${randomEvents.length === 1 ? 'evento' : 'eventi'} registrati in questo periodo.`
          : quietDispatch;

      const turnResult: TurnResultRecord = {
        id,
        turn: this.state.currentTurn - 1,
        narration,
        countryResponse: '',
        events,
        date: this.state.currentDate,
        timelineEvents: events.map((headline, index) => ({
          id: `${id}-${index}`,
          date: this.state.currentDate,
          headline,
          detail: details[index],
          source: 'world' as const,
        })),
      };
      this.state.results.push(turnResult);

      await this.ctx.syncRegionsToDB();
      gameRepository.addTurnResult({
        id: turnResult.id,
        gameId: this.ctx.gameId,
        turn: turnResult.turn,
        narration: turnResult.narration,
        countryResponse: '',
        events: turnResult.events,
        timelineEvents: turnResult.timelineEvents,
        date: turnResult.date,
      });
      gameRepository.updateTurnAndDate(this.ctx.gameId, this.state.currentTurn, this.state.currentDate);

      // Regioni cambiate (owner/colore) — il client le merge nello stato locale
      const changedRegions: any[] = [];
      for (const r of this.state.regions.values()) {
        const prev = before.get(r.id);
        if (prev && (prev.owner !== r.owner || prev.color !== r.color || prev.population !== r.population
          || prev.gdp !== r.gdp || prev.militaryPower !== r.militaryPower)) {
          changedRegions.push({
            id: r.id,
            owner: r.owner,
            color: r.color,
            population: r.population,
            gdp: r.gdp,
            militaryPower: r.militaryPower,
          });
        }
      }

      this.ctx.broadcast('world_event', {
        narration,
        events,
        eventDetails: turnResult.timelineEvents,
        newTurn: this.state.currentTurn,
        newDate: this.state.currentDate,
        changedRegions,
      });
      console.log('[GameSession] Live tick →', this.state.currentDate, `(${events.length} eventi)`);
    });
  }
}
