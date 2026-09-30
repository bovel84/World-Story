/**
 * MG01 µ3 — Il deficit misurato, e il possesso che conta
 * =====================================================
 * La prima metà di MG01 ha chiuso il verde spurio «costo ignoto = fattibile».
 * Questa chiude il secondo: **«non so se ce l'hai» non è «puoi farlo»**. Il
 * preflight legge il ledger del ramo e dice quanto manca, con i tre numeri
 * (richiesto, disponibile, mancante) e la fase che lo richiede.
 *
 * Tre cose che i test difendono, tutte misurate sul motore:
 *  - **Il detentore conta, non la nazione.** Nel ledger della fixture l'acciaio
 *    sta presso `beta_treasury`: ALPHA non costruisce con merce che non è sua.
 *  - **Le riserve contano.** `available` è `total − committed`: ciò che è già
 *    impegnato da un altro ordine non è disponibile per questo. È una
 *    fotografia, non una prenotazione — la prenotazione è MG02.
 *  - **La manodopera non si inventa.** Non è materializzata nel ledger: il
 *    requisito resta dichiarato *non verificato*, né disponibile né assente.
 *
 * Guardia contro il falso verde: il test non si accontenta di `status !==
 * 'feasible'`. Verifica che il deficit porti i NUMERI giusti, che un deficit
 * coperto non compaia, e che la lettura non muti nulla: due chiamate di fila
 * danno lo stesso risultato e il ledger non cresce di una riga.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { measureDeficits } from '../src/core/feasibility/Availability';
import type { AvailabilityReadings } from '../src/core/feasibility/Availability';
import { FeasibilityService } from '../src/core/feasibility/FeasibilityService';
import { normalizeOrderIntent, type OrderIntent } from '../src/core/feasibility/intent';

const DB = path.join(os.tmpdir(), `world-story-mg01b-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg01b-world';
const REGION_ID = 'mg01b-region';

function roadIntent(): OrderIntent {
  const normalized = normalizeOrderIntent({
    id: 'ord_road', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
    actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
    priority: 1, dependencyIds: [],
    authorization: { allowPartialStart: false, allowedPhaseIds: [] },
  });
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.clarifications));
  return normalized.intent;
}

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

// ─── Il modulo puro ──────────────────────────────────────────────────────────

describe('MG01 µ3 — misura del deficit sulla distinta', () => {
  it('senza nulla in casa il deficit è il fabbisogno TOTALE dell’opera, con la fase che lo scopre', () => {
    const empty: AvailabilityReadings = { money: [], stock: [] };
    const { deficits, unknown } = measureDeficits(roadIntent(), catalog(), empty, 'alpha_treasury');

    // Acciaio: 8 kg (massicciata) + 4 kg (pavimentazione) = 12 kg. Il deficit è
    // il totale dell'unità, non la differenza della singola fase: l'opera non
    // parte se il fabbisogno complessivo non c'è. La fase nominata è la prima
    // che il disponibile non riesce a coprire, che a zero è la prima.
    const steel = deficits.filter(d => d.id === 'steel');
    expect(steel).toHaveLength(1);
    expect(steel[0]).toMatchObject({ code: 'MATERIAL_SHORTAGE', phaseId: 'subgrade', required: '12', available: '0', missing: '12' });

    // Fondi: 12000 + 8000 = 20000 unità minime.
    const cash = deficits.filter(d => d.code === 'INSUFFICIENT_CASH');
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ required: '20000', available: '0', missing: '20000' });

    // Utensili: 2 + 1 = 3 pezzi.
    expect(deficits.filter(d => d.id === 'tools')).toHaveLength(1);
    expect(deficits.find(d => d.id === 'tools')!.required).toBe('3');

    // La manodopera non è nel ledger: dichiarata ignota, non presunta
    // disponibile, e una volta sola per qualifica.
    expect(unknown.map(u => u.id)).toEqual(['operaio']);
  });

  it('un requisito coperto non produce deficit', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '25000' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '50' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '10' },
      ],
    };
    const { deficits } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    expect(deficits).toEqual([]);
  });

  it('il deficit NON è la differenza della fase, ed è per questo che non si conta per fase', () => {
    // Il caso che ha smontato la prima versione di questo modulo: cassa 15000
    // contro un fabbisogno di 12000 + 8000. Contando fase per fase con un
    // residuo che avanza, il residuo dopo la prima fase è 3000, la seconda
    // risulta scoperta di 5000, e la fase incolpata è quella sbagliata
    // (`paving`) mentre il vero scoperto è 5000 sulla CASSA TOTALE. Con 10000
    // la sottostima è evidente: per fase direbbe «mancano 2000», mentre ne
    // mancano 10000. Il numero che il giocatore deve leggere è 10000.
    const cashShort: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '10000' }],
      stock: [],
    };
    const { deficits } = measureDeficits(roadIntent(), catalog(), cashShort, 'alpha_treasury');
    const cash = deficits.find(d => d.code === 'INSUFFICIENT_CASH')!;
    expect(`${cash.required}/${cash.available}/${cash.missing}`).toBe('20000/10000/10000');
    // E la fase nominata è quella che il disponibile copre fino in fondo più
    // lontano: 10000 coprono i 12000 della prima? NO — quindi è la prima.
    expect(cash.phaseId).toBe('subgrade');
  });

  it('il deficit materiale non dipende dall’ordine di dichiarazione delle fasi', () => {
    // Con il consumo progressivo l'attribuzione della fase dipendeva dall'ordine
    // nel catalogo: invertendolo, gli stessi numeri migravano sulla fase opposta.
    // Qui il fabbisogno è aggregato per unità e la fase nominata è deterministica.
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [{ holder: 'alpha_treasury', unitId: 'steel', available: '6' }],
    };
    const { deficits } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    const steel = deficits.find(d => d.id === 'steel')!;
    // 6 disponibili contro 12 richiesti: mancano 6, non 2.
    expect(`${steel.required}/${steel.available}/${steel.missing}`).toBe('12/6/6');
    expect(steel.phaseId).toBe('subgrade');
  });

  it('una disponibilità pari alla somma dei fabbisogni copre tutto', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '20000' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '12' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '3' },
      ],
      workforce: [{ qualification: 'operaio', available: '30' }],
    };
    expect(measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury').deficits).toEqual([]);
  });

  it('la merce di un altro detentore non è disponibilità', () => {
    // L'acciaio della fixture sta presso beta_treasury: per ALPHA non esiste.
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [{ holder: 'beta_treasury', unitId: 'steel', available: '150' }],
    };
    const { deficits } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    const steel = deficits.filter(d => d.id === 'steel');
    expect(steel).toHaveLength(1);
    expect(steel[0].available).toBe('0');
    expect(steel[0].holder).toBe('alpha_treasury');
  });

  it('la manodopera, se letta, produce un deficit misurato', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '999' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '999' },
      ],
      workforce: [{ qualification: 'operaio', available: '20' }],
    };
    const { deficits, unknown } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    expect(unknown).toEqual([]);
    const work = deficits.filter(d => d.code === 'WORKFORCE_SHORTAGE');
    // Le due fasi chiedono 30 e 18 operai, il bacino ne ha 20. La manodopera è
    // CAPACITÀ, non consumo: le fasi sono sequenziali nel tempo e gli stessi
    // operai tornano il giorno dopo. Quindi la fase che decide è quella che
    // chiede di PIÙ (30) e ne mancano 10 — non 10 + 0 come sarebbe contando un
    // residuo, che avrebbe reso scoperta anche la seconda fase.
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ id: 'operaio', phaseId: 'subgrade', required: '30', available: '20', missing: '10' });
  });

  it('la manodopera non è un consumo fra fasi, e il test lo difende davvero', () => {
    // Se qualcuno rendesse il bacino un residuo che si consuma fra le fasi, la
    // seconda fase (18 operai) risulterebbe scoperta per colpa della prima
    // (30), che nel frattempo ha già finito. Con 20 operai e picco 30, il
    // deficit è UNO solo: 10. Questo test fallisce se il bacino diventa un
    // residuo — provato togliendo la differenza fra capacità e consumo.
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '20000' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '12' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '3' },
      ],
      workforce: [{ qualification: 'operaio', available: '20' }],
    };
    const { deficits } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    const work = deficits.filter(d => d.code === 'WORKFORCE_SHORTAGE');
    expect(work).toHaveLength(1);
    expect(work[0].missing).toBe('10');
    // Materiali e fondi: esattamente coperti.
    expect(deficits.filter(d => d.code !== 'WORKFORCE_SHORTAGE')).toEqual([]);
  });

  it('`workforce: []` e `workforce` assente dicono la stessa cosa: non lo so', () => {
    // L'array vuoto è il modo naturale di dire «non ho letture sulla
    // manodopera». Trattarlo come «zero operai» bloccherebbe l'opera e farebbe
    // sparire l'avviso: un blocco inventato al posto di un'ignoranza dichiarata.
    const base = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '999' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '999' },
      ],
    };
    const assente = measureDeficits(roadIntent(), catalog(), base, 'alpha_treasury');
    const vuoto = measureDeficits(roadIntent(), catalog(), { ...base, workforce: [] }, 'alpha_treasury');
    expect(vuoto.deficits).toEqual([]);
    expect(vuoto.unknown).toEqual(assente.unknown);
    expect(vuoto.unknown.map(u => u.id)).toEqual(['operaio']);
  });

  it('una qualifica assente dalle letture è ignoranza, non una qualifica a zero', () => {
    // Avere letto la manodopera e non trovarci la qualifica richiesta NON
    // significa che di quella qualifica ce ne siano zero: significa che quella
    // parte non l'abbiamo letta.
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '999' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '999' },
      ],
      workforce: [{ qualification: 'minatore', available: '50' }],
    };
    const { deficits, unknown } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    expect(deficits.filter(d => d.code === 'WORKFORCE_SHORTAGE')).toEqual([]);
    expect(unknown.map(u => u.id)).toEqual(['operaio']);
  });

  it('le unità sono confrontate nell’unità del ledger, non nella grafia del catalogo', () => {
    // Il catalogo dichiara `TEST`; il ledger usa `test`. La lettura arriva già
    // canonicalizzata: se il confronto usasse la stringa del catalogo, il
    // deficit sarebbe per costruzione sempre presente.
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '999999' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '999' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '999' },
      ],
    };
    expect(measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury').deficits).toEqual([]);
  });
});

// ─── La valutazione, con i deficit dentro ────────────────────────────────────

describe('MG01 µ3 — il preflight usa i deficit', () => {
  const service = () => new FeasibilityService(catalog());
  const facts = (extra: Record<string, unknown>) => ({
    actorId: 'alpha_steel_co', verifiedPolityId: 'ALPHA',
    approvals: ['institutional'] as string[], rights: [], knowledgeIds: [] as string[], capabilityIds: [] as string[],
    ...extra,
  });

  it('con un deficit la costruzione non è fattibile, e il blocco dice quanto manca', () => {
    const { deficits, unknown } = measureDeficits(roadIntent(), catalog(), { money: [], stock: [] }, 'alpha_steel_co');
    const assessment = service().evaluate(roadIntent(), facts({ deficits, unknownRequirements: unknown }));
    expect(assessment.status).toBe('blocked');
    const shortage = assessment.blockers.find(b => b.code === 'MATERIAL_SHORTAGE');
    expect(shortage, 'il blocco del materiale deve esserci').toBeTruthy();
    expect(shortage!.detail).toContain('subgrade');
    // 12 kg è il fabbisogno TOTALE dell'opera (8 + 4), non quello della prima
    // fase: è il numero che serve al giocatore per procurarsi il materiale.
    expect(shortage!.detail).toContain('richiesti 12');
    expect(shortage!.detail).toContain('mancano 12');
    // La manodopera ignota resta un avviso, non un blocco inventato.
    expect(assessment.warnings.join(' ')).toContain('requisito non verificato');
  });

  it('senza letture la costruzione non è «fattibile» senza condizioni', () => {
    // Il caso di prima di µ3: distinta completa, nessuna lettura del possesso.
    const assessment = service().evaluate(roadIntent(), facts({}));
    expect(assessment.status).toBe('feasible_with_conditions');
    expect(assessment.warnings.join(' ')).toContain('disponibilità non verificata');
    expect(assessment.warnings.join(' ')).toContain('steel');
  });

  it('con i deficit coperti e le letture fatte, la costruzione è fattibile', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_steel_co', unitId: 'test', available: '999999' }],
      stock: [
        { holder: 'alpha_steel_co', unitId: 'steel', available: '999' },
        { holder: 'alpha_steel_co', unitId: 'tools', available: '999' },
      ],
      workforce: [{ qualification: 'operaio', available: '999' }],
    };
    const { deficits, unknown } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_steel_co');
    const assessment = service().evaluate(roadIntent(), facts({ deficits, unknownRequirements: unknown }));
    expect(deficits).toEqual([]);
    expect(assessment.status).toBe('feasible');
    expect(assessment.blockers).toEqual([]);
  });
});

// ─── Il percorso vivo: la rotta legge il ledger e misura il deficit ──────────

describe('MG01 µ3 — la rotta evaluate misura il deficit della strada', () => {
  let router: { stack: unknown[] };
  let gameId = '';
  let db: any;

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: 'mg01r-world', name: 'MG01r', templateId: 'realism_test_world' },
      [{ id: 'mg01r-region', name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession('mg01r-world', 'P', 'mg01r-region');
    gameId = created.gameId;
    router = (await import('../src/routes/games.routes')).gamesRouter as unknown as { stack: unknown[] };

    // La partita nasce strict: il test dichiara la modalità invece di assumerla,
    // perché è la condizione con cui la rotta legge il ledger.
    expect((await import('../src/repositories/game.repository')).gameRepository.getEconomyMode(gameId)).toBe('strict');
    const world = (await import('../src/repositories/world.repository')).worldRepository.findById('mg01r-world') as any;
    expect(world.template_id).toBe('realism_test_world');
    // Il bootstrap del catalogo avviene al primo turno; qui si materializza a
    // mano lo stato iniziale, che è esattamente ciò che il gioco fa nascendo.
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, (await import('../src/session-registry')).getSessionRegistry().getSessionOrThrow(gameId).fenceContext().branchId, catalog());
  });

  function evaluate(body: unknown, id: string = gameId): Promise<{ status: number; payload: any }> {
    return new Promise((resolve, reject) => {
      const req = { method: 'POST', params: { id }, body };
      const res = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: unknown) { resolve({ status: this.statusCode, payload }); },
      };
      for (const raw of router.stack) {
        const layer = raw as { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (a: unknown, b: unknown) => void }> } };
        if (layer.route?.path === '/:id/actions/evaluate' && layer.route.methods.post) {
          layer.route.stack[layer.route.stack.length - 1]?.handle(req, res);
          return;
        }
      }
      reject(new Error('route missing'));
    });
  }

  it('dalla rotta la strada mostra il deficit reale della tesoreria della fixture', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }).n;
    const result = await evaluate({
      intent: {
        id: 'ord_rotta', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
        actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
        priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
      },
    });
    expect(result.status).toBe(200);
    expect(result.payload.canonicalMutation).toBe(false);

    const blockers = result.payload.orders[0].blockers as any[];
    const codes = blockers.map(b => b.code);

    // La tesoreria di ALPHA ha 1000000 di unità minime e la strada ne chiede
    // 20000: la cassa NON è il problema. Il materiale sì — e questo è il punto.
    expect(codes).not.toContain('INSUFFICIENT_CASH');
    expect(codes).toContain('MATERIAL_SHORTAGE');

    // Il deficit dice quanto manca davvero: la tesoreria ALPHA non ha acciaio
    // né utensili (l'acciaio della fixture è di BETA), quindi manca tutto.
    const steel = blockers.find(b => b.code === 'MATERIAL_SHORTAGE' && b.targetId === 'steel');
    expect(steel).toBeTruthy();
    expect(steel!.detail).toContain('subgrade');
    // Il fabbisogno totale dell'opera: 8 kg (massicciata) + 4 kg (pavimentazione).
    expect(steel!.detail).toContain('richiesti 12');
    expect(steel!.detail).toContain('mancano 12');

    // E la manodopera resta dichiarata ignota, non presunta.
    expect(result.payload.orders[0].warnings.join(' ')).toContain('requisito non verificato');

    // Nessun movimento: il preflight non prenota e non spende (MAT13).
    expect((db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }).n).toBe(before);
  });

  it('un ramo senza stato economico non produce un deficit inventato', async () => {
    // Trovato dalla revisione indipendente: il bootstrap del catalogo avviene
    // al PRIMO TURNO. Chiedendo il preflight di una partita strict appena
    // creata, il ledger è vuoto e la lettura direbbe «disponibili 0» su una
    // cassa che il catalogo dichiara piena — un deficit inventato, lo specchio
    // del verde spurio che questa fase chiude.
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: 'mg01fresh-world', name: 'Fresh', templateId: 'realism_test_world' },
      [{ id: 'mg01fresh-region', name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    const created = registry.getSessionRegistry().createSession('mg01fresh-world', 'P', 'mg01fresh-region');
    const { ledgerHasState } = await import('../src/game/FeasibilityReadings');

    // Il ramo esiste, ma il ledger non ha ancora nulla: la lettura è spenta e
    // il preflight dichiara il requisito NON VERIFICATO, non «mancante».
    const branchId = created.session.fenceContext().branchId!;
    expect(ledgerHasState(branchId)).toBe(false);

    const fresh = await evaluate({
      intent: {
        id: 'ord_fresh', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
        actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
        priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
      },
    }, created.gameId);
    const codes = fresh.payload.orders[0].blockers.map((b: any) => b.code);
    expect(codes).not.toContain('MATERIAL_SHORTAGE');
    expect(codes).not.toContain('INSUFFICIENT_CASH');
    expect(fresh.payload.orders[0].warnings.join(' ')).toContain('disponibilità non verificata');
  });

  it('due valutazioni di fila danno lo stesso esito: la lettura è una fotografia', async () => {
    const body = {
      intent: {
        id: 'ord_rotta2', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
        actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
        priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
      },
    };
    const first = await evaluate(body);
    const second = await evaluate(body);
    expect(second.payload.orders[0].blockers).toEqual(first.payload.orders[0].blockers);
    expect(second.payload.orders[0].status).toBe(first.payload.orders[0].status);
  });
});

// ─── Le letture dal ledger vero ──────────────────────────────────────────────

describe('MG01 µ3 — le letture vengono dal ledger del ramo, in sola lettura', () => {
  let db: any;
  let branchId = '';
  let gameId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG01b', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId;
  });

  it('l’acciaio è presso il suo proprietario, non presso la tesoreria', async () => {
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());
    const { readAvailability } = await import('../src/game/FeasibilityReadings');

    // Il bootstrap mette ogni lotto sul SUO attore: l'acciaio è di beta_treasury.
    const alpha = readAvailability(branchId, 'alpha_steel_co', catalog());
    const beta = readAvailability(branchId, 'beta_treasury', catalog());

    // ALPHA ha 240 kg di acciaio **proprio** (aggiunti alla fixture perché senza
    // il cantiere non è finanziabile; portati a 240 quando i test di MG03 hanno
    // mostrato che 60 non bastavano a più cantieri in sequenza), BETA ne ha 150:
    // le due giacenze sono
    // distinte, ed è il punto — la merce di BETA non costruisce la strada di ALPHA.
    expect(alpha.stock.find(s => s.unitId === 'steel')?.available).toBe('240');
    expect(beta.stock.find(s => s.unitId === 'steel')?.available).toBe('150');
    // ALPHA ha le sue 500 unità di minerale, non quelle di BETA.
    expect(alpha.stock.find(s => s.unitId === 'iron_ore')?.available).toBe('500');
  });

  it('le unità sono quelle del ledger: la valuta `TEST` del catalogo diventa `test`', async () => {
    const { readAvailability } = await import('../src/game/FeasibilityReadings');
    // Chi ha il conto in valuta, non chi ha solo merce: la tesoreria ALPHA ha
    // ricevuto lo stanziamento del bootstrap.
    const treasury = readAvailability(branchId, 'alpha_treasury', catalog());
    expect(treasury.money.map(m => m.unitId)).toContain('test');
    expect(treasury.money.map(m => m.unitId)).not.toContain('TEST');

    // E l'impresa, che ha solo lotti materiali, non ha conti monetari: le due
    // letture non si mescolano, perché un lotto non è cassa.
    const enterprise = readAvailability(branchId, 'alpha_steel_co', catalog());
    expect(enterprise.money).toEqual([]);
    // Nota misurata: l'impresa ALPHA ha acciaio, utensili, carbone, minerale e
    // le scorte delle opere (WS-GOVOFFICE-06: cemento, mattoni, legname,
    // macchinari, carburante, libri, medicinali). L'acciaio di BETA (150 kg)
    // resta di BETA e non compare qui: se questa riga cambiasse, cambierebbe la
    // premessa del deficit di ALPHA.
    expect(enterprise.stock.map(s => s.unitId).sort()).toEqual([
      'books', 'bricks', 'cement', 'coal', 'fuel', 'iron_ore', 'machinery', 'medicine', 'steel', 'timber', 'tools',
    ]);
  });

  it('una riserva attiva riduce il disponibile senza toccare il totale', async () => {
    const { createReservation, getReservationAvailability } = await import('../src/services/ReservationService');
    const before = getReservationAvailability(branchId, { kind: 'material', unitId: 'steel', holderRef: 'beta_treasury' });
    createReservation(gameId, branchId, {
      reservationId: 'mg01b-reserve', target: { kind: 'material', unitId: 'steel', holderRef: 'beta_treasury' }, amount: '50',
    });
    const after = getReservationAvailability(branchId, { kind: 'material', unitId: 'steel', holderRef: 'beta_treasury' });
    expect(after.total).toBe(before.total);
    expect(before.available).toBe('150');
    expect(after.available).toBe('100');

    // E la lettura del preflight vede il disponibile, non il totale.
    const { readAvailability } = await import('../src/game/FeasibilityReadings');
    const beta = readAvailability(branchId, 'beta_treasury', catalog());
    expect(beta.stock.find(s => s.unitId === 'steel')?.available).toBe('100');
  });

  it('leggere due volte non muta nulla: nessun movimento, nessuna riserva', async () => {
    const { readAvailability } = await import('../src/game/FeasibilityReadings');
    const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?').get(branchId) as { n: number }).n;
    const reservations = () => (db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?').get(branchId) as { n: number }).n;

    const entriesBefore = rows();
    const reservesBefore = reservations();
    const first = readAvailability(branchId, 'beta_treasury', catalog());
    const second = readAvailability(branchId, 'beta_treasury', catalog());

    expect(second).toEqual(first);
    expect(rows()).toBe(entriesBefore);
    expect(reservations()).toBe(reservesBefore);
  });
});

// Pulizia unica: la copia di lavoro condivide un solo database, e cancellarlo
// dentro un blocco lo toglierebbe sotto i piedi a quello successivo
// (`SQLITE_READONLY_DBMOVED`). Lo si rimuove una volta sola, alla fine.
afterAll(() => {
  try { fs.rmSync(DB); } catch { /* tmp */ }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
  }
});
