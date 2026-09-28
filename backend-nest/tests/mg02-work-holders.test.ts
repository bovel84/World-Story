/**
 * MG02 µ6 — Il gioco può ordinare un'opera: i detentori li risolve il server
 * ========================================================================
 * Il difetto misurato dalla terza revisione: `workOrder` si popolava solo dal
 * body HTTP di una rotta, e il client inviava solo il testo. La catena era
 * corretta e **irraggiungibile dal gioco**.
 *
 * Qui si difende il pezzo che la rende raggiungibile: il server **risolve** i
 * detentori dalla distinta e dallo stato economico, e li restituisce con la
 * valutazione. Il client non li inventa: li rimanda. Se li alterasse,
 * `applyWorkCommits` li rifiuterebbe perché non appartengono alla polity del
 * giocatore — ed è il test che lo verifica.
 *
 * Le regole:
 *  - **il pagatore è la tesoreria della polity**, come per ogni altro percorso
 *    economico;
 *  - **il detentore dei materiali è chi copre TUTTI i materiali dell'opera**;
 *    se nessuno li copre tutti, non c'è un detentore e si dice quanto manca —
 *    non si sceglie il primo attore a caso;
 *  - **la tesoreria non è il magazzino** (§4.3.1): chi paga non è chi custodisce.
 *
 * Guardia contro il falso verde: si verifica anche il caso che DEVE fallire —
 * nessun detentore — e che senza stato economico la risoluzione lo dichiari
 * invece di inventare un detentore.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';

const DB = path.join(os.tmpdir(), `world-story-mg02h-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg02h-world';
const REGION_ID = 'mg02h-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;
const road = () => catalog().works.find(w => w.id === 'w_road')!;

describe('MG02 µ6 — i detentori di un’opera', () => {
  let db: any;
  let gameId = '';
  let branchId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG02h', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());
    expect((db as { name?: string }).name, 'database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  it('il pagatore è la tesoreria, il detentore è chi copre i materiali', async () => {
    const { resolveWorkHolders } = await import('../src/game/WorkHolders');
    const holders = resolveWorkHolders(catalog(), branchId, 'ALPHA', road());

    // Il pagatore è la tesoreria della polity.
    expect(holders.payerActorId).toBe('alpha_treasury');
    // Il detentore è `alpha_steel_co`: ha acciaio (60) e utensili (20), e la
    // strada ne chiede 12 e 3. Non è la tesoreria: chi paga non è chi custodisce.
    expect(holders.materialActorId).toBe('alpha_steel_co');
    expect(holders.materialActorId).not.toBe(holders.payerActorId);
    expect(holders.missingMaterials).toEqual([]);
  });

  it('senza stato economico la risoluzione lo dichiara, non inventa un detentore', async () => {
    const { resolveWorkHolders } = await import('../src/game/WorkHolders');
    const holders = resolveWorkHolders(catalog(), null, 'ALPHA', road());
    expect(holders.materialActorId).toBeNull();
    expect(holders.note).toContain('non è verificabile');
  });

  it('la sua dichiarazione è quella che il commit accetta', async () => {
    // Il giro completo: il server risolve, il client rimanda, il motore impegna.
    const { resolveWorkHolders } = await import('../src/game/WorkHolders');
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const holders = resolveWorkHolders(catalog(), branchId, 'ALPHA', road());
    const declaration = {
      workId: 'w_road',
      payerActorId: holders.payerActorId,
      materialActorId: holders.materialActorId!,
      funded: true,
    };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [{ id: 'giro1', text: 'Costruisci una strada', createdAt: '1951-01-01', status: 'processing', workOrder: declaration }],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0].kind).toBe('committed');
  });

  it('una dichiarazione alterata dal client è rifiutata', async () => {
    // Il client rimanda i detentori, ma non li sceglie: se indicasse il conto di
    // un'altra nazione, il motore lo respinge.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [{
        id: 'giro2', text: 'Strada', createdAt: '1951-01-01', status: 'processing',
        workOrder: { workId: 'w_road', payerActorId: 'beta_treasury', materialActorId: 'beta_treasury', funded: true },
      }],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0].kind).toBe('unfunded');
    expect(outcomes[0].reason).toContain('non appartiene');
  });

  it('esaurita la scorta: nessun detentore, e la tesoreria non fa da magazzino', async () => {
    // QUESTO TEST È DISTRUTTIVO e per questo è l'ultimo: esaurisce la scorta di
    // acciaio della fixture. L'ordine non è un dettaglio — i test che lo
    // precedono leggono la disponibilità, e questo la consuma.
    //
    // Difende due cose insieme:
    //  - esaurita la disponibilità, NON c'è un detentore, e si dice quanto
    //    manca invece di scegliere un attore a caso;
    //  - la tesoreria della nazione — che ha la cassa — NON diventa il
    //    detentore dei materiali (§4.3.1: chi paga non è chi custodisce). Senza
    //    questa seconda verifica, la risoluzione potrebbe ripiegare sulla
    //    tesoreria e il deficit sparirebbe, sostituito da una prenotazione
    //    impossibile.
    const { resolveWorkHolders } = await import('../src/game/WorkHolders');
    const { createReservation, getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');

    expect(resolveWorkHolders(catalog(), branchId, 'ALPHA', road()).materialActorId).toBe('alpha_steel_co');

    // Si esaurisce l'acciaio presso ogni attore che potrebbe detenerlo.
    for (const actorId of ['alpha_steel_co', 'alpha_farms', 'alpha_bank', 'alpha_treasury']) {
      const target = { kind: 'material' as const, unitId: ledgerUnitId('steel'), holderRef: actorId };
      const available = getReservationAvailability(branchId, target).available;
      if (Number(available) > 0) {
        createReservation(gameId, branchId, { reservationId: `esaurisce-${actorId}`, target, amount: available });
      }
    }

    const holders = resolveWorkHolders(catalog(), branchId, 'ALPHA', road());
    expect(holders.payerActorId).toBe('alpha_treasury');
    expect(holders.materialActorId).toBeNull();
    expect(holders.materialActorId).not.toBe('alpha_treasury');
    expect(holders.note).toContain('copre tutti i materiali');
    // Il mancante è il fabbisogno TOTALE dell'opera: 12 kg (8 + 4).
    expect(holders.missingMaterials.find(m => m.resourceId === 'steel')?.missing).toBe('12');
  });
});
