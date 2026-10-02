/**
 * WS-GOVUX-P6 (innesto) — La memoria del Consiglio persistita
 * =========================================================
 * Prova, sul database vero, le regole della fase che riguardano la persistenza:
 *  1. l'ordine è il **tempo del mondo** (data, poi turno): aggiornare un ricordo
 *     non lo sposta, e il timestamp tecnico non entra nell'ordine;
 *  2. la **revoca conserva la storia**: lo stato `revoked` viene scritto e
 *     riletto, e il ricordo non riemerge nel retrieval;
 *  3. lo scope è la **partita**: la memoria di un gioco non è visibile in un altro;
 *  4. il **fork** porta con sé anche i ricordi revocati.
 *
 * Nessuna migrazione: la tabella `minister_memory` è la stessa; `revoked` è uno
 * stato in più in una colonna `TEXT`, quindi i vecchi salvataggi restano validi.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  relevantMinisterMemory, type MinisterMemoryRecord,
} from '../src/core/government/MinisterMemory';

const TEST_DB = path.join(os.tmpdir(), `world-story-govux-p6-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'govux_p6_world';
let db: any;
let gameRepository: any;
let ministerMemoryRepository: any;
let gameId: string;
let mainBranch: string;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    const content = '{}';
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

function record(over: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'r1', kind: 'queued-decision', state: 'queued', summary: 'Strada di collegamento accodata',
    refs: { gameDate: '1951-01-01', turn: 1 },
    ...over,
  };
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  gameRepository = repos.gameRepository;
  ministerMemoryRepository = repos.ministerMemoryRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'GOVUX P6 World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{
      id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
      population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
      borders: [], objects: [],
    }],
  );
  const created = registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
  gameId = created.gameId;
  mainBranch = gameRepository.ensureMainBranch(gameId);
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* tmp */ }
});

const scope = () => ({ gameId, branchId: mainBranch, seat: 'tesoro' as const, mandate: 'tesoro@ITA:ind' });

describe('WS-GOVUX-P6 — il turno ordina la memoria, non il timestamp', () => {
  it('un ricordo del turno 1 precede uno del turno 3 anche se scritto dopo', () => {
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'tardi', refs: { gameDate: '1951-03-01', turn: 3 } }),
    ]);
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'presto', refs: { gameDate: '1951-01-01', turn: 1 } }),
    ]);
    expect(ministerMemoryRepository.listMemory(scope()).map((r: MinisterMemoryRecord) => r.id))
      .toEqual(['presto', 'tardi']);
  });

  it('aggiornare un ricordo non lo sposta: resta al suo turno', () => {
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'presto', state: 'executed', summary: 'Firmata', refs: { gameDate: '1951-01-01', turn: 1 } }),
    ]);
    const ordered = ministerMemoryRepository.listMemory(scope());
    expect(ordered.map((r: MinisterMemoryRecord) => r.id)).toEqual(['presto', 'tardi']);
    expect(ordered[0].state).toBe('executed');
  });

  it('un ricordo senza turno si àncora alla data', () => {
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'senza-turno', refs: { gameDate: '1951-02-01' } }),
    ]);
    expect(ministerMemoryRepository.listMemory(scope()).map((r: MinisterMemoryRecord) => r.id))
      .toEqual(['presto', 'senza-turno', 'tardi']);
  });
});

describe('WS-GOVUX-P6 — la revoca è persistita e conserva la storia', () => {
  it('lo stato revoked viene scritto e riletto, con la nota', () => {
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'presto', state: 'revoked', summary: 'Firmata', reason: 'revocata: il vincolo è caduto', refs: { gameDate: '1951-01-01', turn: 1 } }),
    ]);
    const reloaded = ministerMemoryRepository.listMemory(scope()).find((r: MinisterMemoryRecord) => r.id === 'presto');
    expect(reloaded?.state).toBe('revoked');
    expect(reloaded?.reason).toContain('il vincolo è caduto');
  });

  it('il ricordo revocato resta nello storico ma non riemerge nel retrieval', () => {
    const records = ministerMemoryRepository.listMemory(scope());
    expect(records.some((r: MinisterMemoryRecord) => r.id === 'presto')).toBe(true);
    const memory = { scope: scope(), records };
    expect(relevantMinisterMemory(memory).map(r => r.id)).not.toContain('presto');
  });
});

describe('WS-GOVUX-P6 — lo scope è la partita', () => {
  it('la memoria di una partita non è visibile in un’altra', () => {
    expect(ministerMemoryRepository.listMemory({ ...scope(), gameId: 'altro-gioco' })).toHaveLength(0);
    expect(ministerMemoryRepository.listMemory(scope()).length).toBeGreaterThan(0);
  });

  it('cancellare la memoria di una partita non tocca le altre', () => {
    const before = ministerMemoryRepository.listMemory(scope()).length;
    const removed = ministerMemoryRepository.deleteGameMemory(gameId);
    expect(removed).toBe(before);
    expect(ministerMemoryRepository.listMemory(scope())).toHaveLength(0);
  });
});

describe('WS-GOVUX-P6 — il fork porta con sé anche i revocati', () => {
  it('il ramo figlio eredita la memoria (revocati inclusi), il padre la conserva', () => {
    ministerMemoryRepository.upsertRecords(scope(), [
      record({ id: 'attiva', refs: { gameDate: '1951-04-01', turn: 4 } }),
      record({ id: 'revocata', state: 'revoked', reason: 'revocata dal Presidente', refs: { gameDate: '1951-04-02', turn: 5 } }),
    ]);
    gameRepository.createBranch({ id: 'p6-fork', gameId, name: 'ramo P6', parentBranchId: mainBranch });
    const forked = ministerMemoryRepository.listBranch({ gameId, branchId: 'p6-fork' });
    expect(forked.some((r: MinisterMemoryRecord) => r.id === 'attiva')).toBe(true);
    expect(forked.some((r: MinisterMemoryRecord) => r.id === 'revocata' && r.state === 'revoked')).toBe(true);
    // Il padre non viene svuotato.
    expect(ministerMemoryRepository.listBranch({ gameId, branchId: mainBranch }).some((r: MinisterMemoryRecord) => r.id === 'attiva')).toBe(true);
  });
});
