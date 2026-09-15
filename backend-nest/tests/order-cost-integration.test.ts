/**
 * Integrazione: la cassa segue le scelte del giocatore.
 *   - un ordine eseguito costa (una tantum, dal conto nazionale);
 *   - un ordine rifiutato non costa;
 *   - il tetto del debito non viene mai sfondato da un ordine;
 *   - un progetto in corso ha sempre una percentuale di avanzamento leggibile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-ordercost-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'ordercost_world';
const ORDER = 'Costruire una ferrovia nazionale verso il confine';
let db: any;
let createGame: () => { gameId: string; session: any };

/** Risposta della meccanica `jump`: accettata, parziale o rifiutata. */
let jumpMode: 'accepted' | 'partial' | 'voided' = 'accepted';

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const base: any = {
      events: [{ headline: 'Parte il cantiere', description: 'Le opere iniziano.', date: '1951-01-15', mapChanges: [] }],
      narration: 'Il cantiere è stato avviato.',
      voided: [],
      startChat: [],
      worldChanges: { regionOwners: {}, regionColors: {} },
    };
    if (jumpMode === 'accepted') {
      base.actionOutcomes = [{ action: ORDER, status: 'accepted', summary: 'L’opera è stata approvata e avviata.', eventHeadlines: ['Parte il cantiere'] }];
    } else if (jumpMode === 'partial') {
      base.actionOutcomes = [{
        action: ORDER, status: 'partial', summary: 'Solo il primo tratto è finanziato.',
        expectedDate: '1952-01-01', eventHeadlines: ['Parte il cantiere'],
      }];
    } else {
      base.events = [];
      base.voided = [{ action: ORDER, reason: 'Il consiglio rifiuta la spesa' }];
    }
    const content = JSON.stringify(base);
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();

  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Order Cost World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{
      id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
      population: 59_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
      objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
    }],
  );

  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('la cassa segue le scelte del giocatore', () => {
  /** Spesa effettiva dell'ordine: differenza rispetto a un ordine rifiutato. */
  const spendOf = async (mode: 'accepted' | 'partial' | 'voided') => {
    jumpMode = mode;
    const { gameId, session } = createGame();
    const before = session.getResources().stock.money;
    session.queueAction(ORDER);
    await session.processNextAction(30);
    return { session, gameId, spent: before - session.getResources().stock.money };
  };

  it('un ordine accettato addebita la tesoreria dell’importo stimato', async () => {
    const accepted = await spendOf('accepted');
    const rejected = await spendOf('voided');
    const estimate = accepted.session.estimateOrderCost(ORDER);
    expect(estimate.amountMld).toBeGreaterThan(0);
    // Tutto ciò che non è saldo mensile è la spesa ordinata.
    expect(accepted.spent - rejected.spent).toBeCloseTo(estimate.amountMld, 1);

    // Il dispaccio del periodo dichiara la spesa con la categoria dell'ordine.
    const events = accepted.session.getResults().flatMap((result: any) => result.events) as string[];
    expect(events.join(' | ')).toContain('Spesa ordinata');
    expect(events.join(' | ')).toContain(estimate.label);
    // ...e il punto storico della tesoreria coincide con il nuovo saldo.
    const history = accepted.session.getNationalHistory(5);
    expect(Number(history[history.length - 1].account.money))
      .toBeCloseTo(accepted.session.getResources().stock.money, 1);
  });

  it('un ordine rifiutato non costa nulla', async () => {
    const rejected = await spendOf('voided');
    const events = rejected.session.getResults().flatMap((result: any) => result.events) as string[];
    expect(events.join(' | ')).not.toContain('Spesa ordinata');
    // Solo il saldo mensile ha mosso la cassa (nessuna spesa ordinata).
    expect(Math.abs(rejected.spent)).toBeLessThan(30);
  });

  it('un progetto in corso nasce con una percentuale leggibile', async () => {
    const partial = await spendOf('partial');
    const processes = partial.session.getOngoingProcesses();
    expect(processes.length).toBe(1);
    expect(processes[0].status).toBe('ongoing');
    expect(Number.isFinite(processes[0].progress)).toBe(true);
    expect(processes[0].progress).toBeGreaterThanOrEqual(0);
    expect(processes[0].progress).toBeLessThanOrEqual(100);

    // Persistito, non calcolato solo in lettura.
    const stored = db.prepare('SELECT progress FROM ongoing_processes WHERE game_id = ?').get(partial.gameId) as { progress: number | null };
    expect(stored.progress).not.toBeNull();

    // Anche un progetto con percentuale persistita a zero legge la data:
    // l'avanzamento del motore non resta cieco su un cantiere già avviato.
    db.prepare('UPDATE ongoing_processes SET progress = 0 WHERE game_id = ?').run(partial.gameId);
    expect(partial.session.getOngoingProcesses()[0].progress).toBeGreaterThan(0);

    // Un salto di tempo rinfresca la percentuale (il progetto avanza).
    const before = partial.session.getOngoingProcesses()[0].progress;
    await partial.session.processWorldAdvance(120);
    const after = partial.session.getOngoingProcesses()[0].progress;
    expect(after).toBeGreaterThan(before);
  });

  it('alla scadenza il progetto è chiuso e passa tra i «Completati»', async () => {
    const partial = await spendOf('partial');
    expect(partial.session.getOngoingProcesses()).toHaveLength(1);

    // Oltre la scadenza dichiarata (1952-01-01) il motore chiude il progetto:
    // non resta «in corso» al 99% per sempre.
    const bulletins = partial.session.refreshProjectProgress('1952-02-01');
    expect(bulletins.join(' ')).toContain('completato');
    expect(partial.session.getOngoingProcesses()).toHaveLength(0);

    const completed = partial.session.getCompletedProcesses();
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe('completed');
    expect(completed[0].progress).toBe(100);
    // La data di chiusura è quella di GIOCO, non il timestamp reale.
    expect(completed[0].completed_date).toBe('1952-02-01');
  });

  it('un ordine che la cassa non può coprire è annullato dal motore', async () => {
    jumpMode = 'accepted';
    const { session } = createGame();
    // Cassa scoperta oltre il tetto del credito: la realtà non si aggira.
    // Il modello ha dichiarato l’ordine «accepted», ma i soldi non ci sono.
    const stock = session.getResources().stock;
    stock.money = -100;

    session.queueAction(ORDER);
    const action = await session.processNextAction(30);

    // Il motore declassa l’esito: niente successo senza copertura.
    expect(action?.result?.outcome?.status).toBe('voided');
    const events = session.getResults().flatMap((result: any) => result.events).join(' | ');
    expect(events).toContain('ordine annullato');
    expect(events).toContain('non attua la direttiva');
  });
});
