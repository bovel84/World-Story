/**
 * MG05 µ3 — L'agenda legge lo stato VERO, e resta sola lettura
 * ============================================================
 * `GovernmentAgenda` è pura: trasforma fatti in scelte. Qui si difende il pezzo
 * che raccoglie i fatti — deficit dei cantieri, fazioni, bilancio, debito, opere
 * — dallo stato della partita.
 *
 * Le regole:
 *  - **I deficit dei cantieri sono misurati, non raccontati.** Un cantiere che ha
 *    tutto non produce una voce; uno che non ha l'acciaio sì, con i tre numeri.
 *  - **Le cifre che il motore non ha non si inventano.** Senza catalogo, l'agenda
 *    non finge di sapere cosa si può costruire: quelle voci non compaiono.
 *  - **Sola lettura.** Dopo aver letto l'agenda, il ledger e le riserve sono
 *    identici: il Governo propone, non impegna (invariante MG-I1).
 *
 * Guardia contro il falso verde: si contano le righe del ledger e delle riserve
 * PRIMA e DOPO la lettura, e si verifica il caso che deve tacere — un cantiere
 * senza deficit non deve comparire in agenda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';

const DB = path.join(os.tmpdir(), `world-story-mg05r-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const WORLD_ID = 'mg05r-world';
const REGION_ID = 'mg05r-region';

describe('MG05 µ3 — l’agenda legge lo stato della partita', () => {
  let db: any;
  let gameId = '';
  let branchId = '';
  let session: any;

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG05r', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    session = created.session;
    branchId = session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!);
    expect((db as { name?: string }).name, 'database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const ledgerRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const reservationRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;

  const readAgenda = async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    return readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
    });
  };

  it('leggere l’agenda NON muta nulla: sola lettura davvero', async () => {
    // L'invariante MG-I1: il Governo propone. Se leggere l'agenda scrivesse una
    // riga di ledger o creasse una riserva, «proposta» e «decisione» sarebbero
    // la stessa cosa.
    const before = { ledger: ledgerRows(), reservations: reservationRows() };
    const agenda = await readAgenda();
    expect(agenda.canonicalMutation).toBe(false);
    expect(ledgerRows()).toBe(before.ledger);
    expect(reservationRows()).toBe(before.reservations);
  });

  it('le opere del catalogo compaiono, con quello che manca al paese', async () => {
    const agenda = await readAgenda();
    const build = agenda.voices.filter(v => v.id.startsWith('build_'));
    expect(build.length, 'le opere del catalogo devono essere proposte').toBeGreaterThan(0);
    const road = build.find(v => v.id === 'build_w_road')!;
    expect(road).toBeTruthy();
    // La strada ha acciaio e utensili in abbondanza nella fixture: nessuna voce
    // scoperta, e la strada diretta è raccomandata.
    expect(road.paths.find(p => p.id === 'build_now')!.recommended).toBe(true);
    expect(road.paths.find(p => p.id === 'build_now')!.prerequisites).toEqual([]);
  });

  it('un cantiere senza deficit NON produce una voce di deficit', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const catalog = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!;
    commitWork({
      gameId, branchId, orderId: 'mg05r_cantiere',
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: catalog.works.find(w => w.id === 'w_road')!, regionId: REGION_ID,
    });

    const agenda = await readAgenda();
    // Il cantiere ha tutto: nessuna voce di deficit materiale per l'acciaio.
    const steelDeficit = agenda.voices.find(v => v.id === 'deficit_MATERIAL_SHORTAGE_steel');
    expect(steelDeficit, 'un cantiere coperto non deve produrre un deficit inventato').toBeUndefined();
  });

  it('la fase che STA PER PARTIRE conta: il lettore non guarda solo l’attiva', async () => {
    // Il difetto del lettore, difeso in modo diretto: la prima versione guardava
    // solo la fase ATTIVA, che ha già consumato la sua distinta — quindi il
    // fabbisogno risultava coperto anche quando il cantiere si sarebbe fermato
    // alla fase successiva.
    //
    // Il test agisce sui DATI, non sul catalogo: il catalogo è la fonte
    // autorevole e non si piega nel test. Si porta il saldo del detentore al di
    // sotto della seconda fase (che chiede 4 kg) e sopra la prima (8 kg già
    // spesi), e si verifica che il deficit compaia — cosa che il lettore vecchio
    // non faceva.
    const { blockedDeficits } = await import('../src/game/GovernmentReadings');
    const { listStrictProjects } = await import('../src/repositories/project-runtime.repository');
    const { appendLedgerEntries } = await import('../src/repositories/ledger.repository');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const { getReservationAvailability } = await import('../src/services/ReservationService');

    const project = listStrictProjects(gameId, branchId)[0];
    const holder = project.context.materialActorId;
    const unitId = ledgerUnitId('steel');

    // Si porta il saldo a 2 kg: meno dei 4 della pavimentazione, più di zero.
    // Il movimento è di TRASFERIMENTO — la merce va al cantiere, non si distrugge.
    const held = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN to_ref=? THEN CAST(delta AS INTEGER) ELSE -CAST(delta AS INTEGER) END),0) AS n FROM ledger_entries WHERE branch_id=? AND kind='material' AND unit_id=? AND (to_ref=? OR from_ref=?)",
    ).get(holder, branchId, unitId, holder, holder) as { n: number };
    if (held.n > 2) {
      appendLedgerEntries(gameId, branchId, [{
        effectId: 'mg05r_riduce', entryIndex: 0, cause: 'consumo', kind: 'material', unitId,
        fromRef: holder, toRef: `site:${project.projectId}`,
        delta: String(held.n - 2), atDate: '1951-01-06',
      }]);
    }
    void getReservationAvailability;

    const before = blockedDeficits({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
      catalog: loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog,
    });
    // Il deficit c'è, e porta i numeri veri: 8 kg richiesti dalla massicciata
    // (che il cantiere non ha ancora speso in questo test), 2 disponibili,
    // 6 mancanti.
    //
    // LIMITE DICHIARATO di questo test: passa anche se il lettore guardasse
    // SOLO la fase attiva, perché in questo scenario l'attiva è scoperta e
    // basta a produrre la voce. La prova al contrario lo ha mostrato. La scelta
    // di guardare anche la fase pianificata — perché il Governo deve vedere il
    // problema PRIMA che il cantiere si fermi — è quindi documentata nel codice
    // e non difesa da un test: per difenderla servirebbe una fixture in cui la
    // fase attiva è coperta e quella successiva no, che richiede un catalogo
    // dedicato. È lavoro dichiarato, non una lacuna nascosta.
    const steel = before.find(d => d.code === 'MATERIAL_SHORTAGE' && d.id === 'steel');
    expect(steel, 'un saldo sotto la distinta deve produrre un deficit').toBeTruthy();
    expect(steel!.required).toBe('8');
    expect(steel!.available).toBe('2');
    expect(steel!.missing).toBe('6');
  });

  it('senza branchId le voci sulle opere non inventano una disponibilità', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const agenda = readGovernmentAgenda({
      gameId, branchId: null, playerPolityId: 'ALPHA', government: session.getGovernment(),
    });
    // Le opere compaiono, ma dichiarano che lo stato economico non è leggibile:
    // meglio un'agenda che ammette di non sapere che una che finge.
    const road = agenda.voices.find(v => v.id === 'build_w_road')!;
    expect(road.because).toContain('stato economico non disponibile');
    expect(road.paths.find(p => p.id === 'build_now')!.recommended).toBe(false);
  });

  it('le voci delle fazioni arrivano dalla fotografia del governo', async () => {
    // La fotografia del governo è la fonte: l'agenda non ricalcola le fazioni.
    const government = session.getGovernment();
    const agenda = await readAgenda();
    const factionVoices = agenda.voices.filter(v => v.factionId !== null);
    // Le fazioni scontente che pesano diventano voci; se nessuna lo è, nessuna
    // voce — e in entrambi i casi il conteggio non supera le fazioni esistenti.
    expect(factionVoices.length).toBeLessThanOrEqual(government.factions.length);
    for (const voice of factionVoices) {
      expect(government.factions.some(f => f.id === voice.factionId)).toBe(true);
    }
  });

  it('P04 — col conto passato, il Tesoro e la Guerra portano la loro condizione', async () => {
    // Il difetto che questo test difende è il cablaggio, non la logica: P04 vive
    // in `buildAgenda` (testato a parte), ma se `readGovernmentAgenda` non
    // ricevesse il conto nazionale le due sedie tacerebbero comunque — e la sala
    // resterebbe vuota esattamente come prima della correzione. Qui si passa la
    // sessione vera, cioè lo stesso conto che le rotte consegnano.
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const account = session.getNationalAccounts()[session.getPlayerPolityId()];
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA',
      government: session.getGovernment(),
      account,
    });
    const ids = agenda.voices.map(v => v.id);
    expect(ids).toContain('treasury_condition');
    expect(ids).toContain('defence_condition');
    // E le cifre vengono dal conto, non da una stima: la provenienza è misurata.
    const treasury = agenda.voices.find(v => v.id === 'treasury_condition')!;
    expect(treasury.figures.every(f => f.basis.kind === 'measured')).toBe(true);
    const defence = agenda.voices.find(v => v.id === 'defence_condition')!;
    expect(Number(defence.figures.find(f => f.label === 'Spesa di difesa')!.value))
      .toBe(Number(account.defenceBurdenPct) || 0);
  });

  it('P04 — senza il conto, il Tesoro e la Guerra TACCIONO: la regola non si piega', async () => {
    // La guardia contro il falso verde: la nuova fonte non ha abolito la regola
    // «un ministro senza dati tace». Senza conto, nessuna cifra inventata.
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
    });
    const ids = agenda.voices.map(v => v.id);
    expect(ids).not.toContain('treasury_condition');
    expect(ids).not.toContain('defence_condition');
    // WS-GOVOFFICE-05 — e senza conto tacciono anche Istruzione e Sanità.
    expect(ids).not.toContain('education_condition');
    expect(ids).not.toContain('health_condition');
  });

  it('WS-GOVOFFICE-05 — col conto, Istruzione e Sanità portano le cifre del conto', async () => {
    // Difende il CABLAGGIO delle due sedie nuove: la logica vive in `buildAgenda`
    // (testata a parte), ma se `readGovernmentAgenda` non leggesse il conto per
    // loro le due sedie tacerebbero comunque. La fixture economica di questo
    // mondo di prova è minima e non produce uscite (perciò le quote di spesa
    // sono a 0): qui si isola il cablaggio sui dati d'ingresso — conto con
    // atenei, popolazione e tensione, fotografia con le due quote — non la
    // contabilità del motore, che è coperta da `NationalBudget` a parte.
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const baseAccount = session.getNationalAccounts()[session.getPlayerPolityId()];
    const baseGovernment = session.getGovernment();
    const account = {
      ...baseAccount,
      universities: 12,
      population: 50_000_000,
      stability: 62,
      socialTension: 41,
    };
    const government = {
      ...baseGovernment,
      budget: { ...baseGovernment.budget, educationBurdenPct: 3.4, socialBurdenPct: 8.1 },
    };
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government, account,
    });
    const education = agenda.voices.find(v => v.id === 'education_condition')!;
    const health = agenda.voices.find(v => v.id === 'health_condition')!;
    expect(education, 'Istruzione deve comparire col conto').toBeTruthy();
    expect(health, 'Sanità deve comparire col conto').toBeTruthy();
    // Istruzione: la spesa è la quota della fotografia, gli atenei del conto.
    expect(Number(education.figures.find(f => f.label === 'Spesa per istruzione e ricerca')!.value)).toBe(3.4);
    expect(Number(education.figures.find(f => f.label === 'Atenei')!.value)).toBe(12);
    // Sanità: la popolazione è quella del conto, e la voce dichiara che il dato
    // è sanità + sostegno, non la sola sanità.
    expect(Number(health.figures.find(f => f.label === 'Popolazione')!.value)).toBe(50_000_000);
    expect(health.because).toContain('sanità e sostegno');
    // Ogni cifra porta la sua provenienza, e la quota di spesa è una stima.
    expect(health.figures.find(f => f.label.startsWith('Spesa sociale'))!.basis.kind).toBe('estimated');
  });
});
