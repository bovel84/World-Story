/**
 * S2 — Un cantiere non resta un cantiere per sempre
 * =================================================
 * Il difetto misurato sul database di gioco (27 settembre 2026): su tutta la
 * base c'erano **51 cantieri aperti** e solo **19 opere finite**, e **zero
 * infrastrutture** — mentre 18 dei cantieri erano proprio opere infrastrutturali.
 * In tutte le partite recenti il giocatore aveva **solo** `construction_site`.
 *
 * La causa: il cantiere porta in `metadata` il tipo finale (`plannedType`) e la
 * data prevista (`expectedDate`), ma quella data la leggeva **solo il frontend**,
 * che la mostrava come «Previsione (non garantita)». Il motore non chiudeva mai
 * il cantiere. Per i **progetti nazionali** invece la stessa regola esisteva già
 * (`advanceProjects`): alla scadenza dichiarata, l'opera è consegnata.
 *
 * Qui si difende la regola estesa agli oggetti mappa, e i due limiti che la
 * rendono onesta: un cantiere **senza tipo finale** non si promuove (non si
 * inventa cosa sarebbe diventato), e un cantiere **non ancora scaduto** resta
 * aperto.
 *
 * Guardia contro il falso verde: il test non si limita a vedere che il tipo
 * cambia — verifica che il cantiere sia **scomparso** dalla regione e che
 * l'oggetto abbia una data di consegna, cioè che la trasformazione sia quella
 * vera e non un doppione lasciato lì accanto.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-construction-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'construction_world';
const REGION_ID = `${WORLD_ID}_CAP`;
const PID = 'CST';
const START = '2026-01-01';

let db: any;
let registry: any;
let repos: any;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) { onToken(1); return { content: '{}' }; },
  clearCache() {},
};

function createGame(): { gameId: string; session: any } {
  return registry.createSession(WORLD_ID, 'Player', REGION_ID, '#FF0000');
}

/** Semina un cantiere nella regione del giocatore, come farebbe un evento. */
function seedSite(session: any, site: {
  id: string; name: string; plannedType?: string; expectedDate?: string;
}): void {
  const region = (session as any).regions.get(REGION_ID);
  region.objects ||= [];
  region.objects.push({
    id: site.id,
    type: 'construction_site',
    name: site.name,
    level: 1,
    owner: PID,
    lat: 0,
    lng: 0,
    metadata: {
      status: 'under_construction',
      phase: 'structure',
      startedDate: START,
      ...(site.plannedType ? { plannedType: site.plannedType } : {}),
      ...(site.expectedDate ? { expectedDate: site.expectedDate } : {}),
    },
  });
}

function objectsOf(session: any): any[] {
  return (session as any).regions.get(REGION_ID).objects || [];
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    {
      id: WORLD_ID, name: 'Construction World', description: '', startDate: START,
      basePrompt: 'Test', historicalAccuracy: 0.8,
    },
    [{
      id: REGION_ID, name: 'Capitale', color: '#FF0000', owner: PID,
      population: 5_000_000, gdp: 40, militaryPower: 1, flag: PID,
      objects: [{ id: 'cap-1', type: 'capital', name: 'Capitale', level: 1 }],
    }],
  );
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

describe('S2 — il cantiere si consegna alla scadenza dichiarata', () => {
  it('alla data prevista il cantiere diventa l’opera del suo plannedType', () => {
    const { session } = createGame();
    seedSite(session, {
      id: 'road-1', name: 'Strada provinciale 12',
      plannedType: 'infrastructure', expectedDate: '2026-03-01',
    });

    // Un salto che supera la scadenza.
    session.advanceWorldState(90, '2026-04-01');

    const objects = objectsOf(session);
    const site = objects.find((o: any) => o.id === 'road-1');
    expect(site, 'il cantiere deve esistere ancora, trasformato').toBeTruthy();
    // Non è più un cantiere: è l'opera.
    expect(site.type).toBe('infrastructure');
    // E non ne resta un doppione accanto.
    expect(objects.filter((o: any) => o.id === 'road-1')).toHaveLength(1);
    expect(objects.some((o: any) => o.type === 'construction_site' && o.id === 'road-1')).toBe(false);
    // La consegna è datata e dichiarata: non è un oggetto che cambia tipo di nascosto.
    expect(site.metadata.status).toBe('operational');
    expect(site.metadata.phase).toBe('completed');
    expect(site.metadata.completedDate).toBe('2026-04-01');
    // `plannedType` ha finito il suo compito: non deve restare a confondere.
    expect(site.metadata.plannedType).toBeUndefined();
  });

  it('la consegna finisce in cronaca, non resta muta', () => {
    const { session } = createGame();
    seedSite(session, {
      id: 'factory-1', name: 'Stabilimento di prova',
      plannedType: 'factory', expectedDate: '2026-02-01',
    });

    const lines = session.advanceWorldState(60, '2026-03-01');

    expect(lines.some((line: string) => line.includes('Stabilimento di prova'))).toBe(true);
    expect(lines.some((line: string) => line.includes('Opera consegnata'))).toBe(true);
  });

  it('un cantiere non ancora scaduto resta aperto', () => {
    const { session } = createGame();
    seedSite(session, {
      id: 'port-1', name: 'Molo in costruzione',
      plannedType: 'port', expectedDate: '2027-01-01',
    });

    session.advanceWorldState(30, '2026-02-01');

    const site = objectsOf(session).find((o: any) => o.id === 'port-1');
    expect(site.type).toBe('construction_site');
    expect(site.metadata.completedDate).toBeUndefined();
  });

  it('senza tipo finale il cantiere resta aperto: non si inventa cosa diventa', () => {
    const { session } = createGame();
    // Un cantiere di cui il modello non ha detto cosa sarà: 45 dei 51 cantieri
    // misurati in produzione sono in questa condizione.
    seedSite(session, { id: 'vague-1', name: 'Lavori non specificati', expectedDate: '2026-02-01' });

    session.advanceWorldState(90, '2026-05-01');

    const site = objectsOf(session).find((o: any) => o.id === 'vague-1');
    expect(site.type, 'promuovere qui significherebbe inventare un tipo').toBe('construction_site');
    expect(site.metadata.completedDate).toBeUndefined();
  });

  it('anche il percorso in pausa consegna le opere scadute', () => {
    // Il playback chiama lo stesso `advanceWorldState`: la regola non deve
    // vivere solo nel percorso ordinario, o il difetto tornerebbe nel salto
    // «un evento alla volta» — che è quello che il giocatore usa di più.
    const { session } = createGame();
    seedSite(session, {
      id: 'uni-1', name: 'Ateneo di provincia',
      plannedType: 'university', expectedDate: '2026-06-30',
    });

    session.advanceWorldState(40, '2026-07-15');

    const site = objectsOf(session).find((o: any) => o.id === 'uni-1');
    expect(site.type).toBe('university');
    expect(site.metadata.status).toBe('operational');
  });

  it('la consegna sopravvive alla persistenza: si rilegge dal database', () => {
    const { session, gameId } = createGame();
    seedSite(session, {
      id: 'road-2', name: 'Strada costiera',
      plannedType: 'infrastructure', expectedDate: '2026-02-15',
    });
    session.advanceWorldState(60, '2026-03-01');
    session.syncRegionsToDB();

    // Rilettura indipendente dallo stato in RAM: è ciò che il client e la
    // Timeline vedono davvero.
    const row = repos.gameRepository.getGameRegions(gameId)
      .find((region: any) => region.id === REGION_ID);
    const persisted = (row.objects || []).find((o: any) => o.id === 'road-2');
    expect(persisted, 'l’opera deve essere nel DB, non solo in memoria').toBeTruthy();
    expect(persisted.type).toBe('infrastructure');
    expect(persisted.metadata.status).toBe('operational');
  });
});
