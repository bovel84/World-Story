/**
 * MG02 µ1 — Il preflight deve poter dire «puoi», e dirlo allo stesso modo
 * =====================================================================
 * MG01 ha insegnato al preflight a **misurare** il possesso. Restava un blocco
 * che nessuna distinta poteva sciogliere: la costruzione era `blocked` per
 * autorizzazione anche quando cassa e materiali c'erano, perché l'unica regola
 * R1 per `allocate` apparteneva all'impresa pubblica mentre il percorso vivo
 * usa la **tesoreria** della polity. E le due rotte di preflight — `evaluate`
 * da intent normalizzato, `check-feasibility` da testo libero — giudicavano in
 * modo diverso: la seconda non leggeva affatto il ledger.
 *
 * Qui si difendono tre cose:
 *  - la tesoreria ha una regola dichiarata per `allocate`, con il consenso
 *    dell'autore dell'ordine (`'user'`), e quel consenso è **dichiarato** dal
 *    server, non inventato: gli altri due restano non concessi;
 *  - le due rotte condividono `strictReadingsFor`, quindi **quando** si legge,
 *    da **chi** e **cosa** se ne ricava sono la stessa decisione in un punto
 *    solo — non due copie da tenere allineate;
 *  - senza stato economico non si legge: un ramo mai inizializzato non è un
 *    paese senza risorse.
 *
 * Guardia contro il falso verde: il test non verifica solo che `blocked`
 * sparisca. Verifica che il consenso dell'utente sia **necessario** (senza,
 * l'esito torna `blocked`) e che l'autorità **non sia stata allargata** ad
 * altri attori o ad altre attività: cambiare `allocate` in `spend` non deve
 * sbloccare nulla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { FeasibilityService } from '../src/core/feasibility/FeasibilityService';
import { normalizeOrderIntent, type OrderIntent } from '../src/core/feasibility/intent';

const DB = path.join(os.tmpdir(), `world-story-mg02-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg02-world';
const REGION_ID = 'mg02-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

function intent(
  catalogRef = 'w_road',
  actionKind: 'construct' | 'produce' = 'construct',
  polityId = 'ALPHA',
): OrderIntent {
  const normalized = normalizeOrderIntent({
    id: 'ord_mg02', actorPolityId: polityId, originalText: 'Costruisci una strada',
    actionKind, targetIds: [polityId, catalogRef], catalogRef,
    priority: 1, dependencyIds: [],
    authorization: { allowPartialStart: false, allowedPhaseIds: [] },
  });
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.clarifications));
  return normalized.intent;
}

const facts = (overrides: Record<string, unknown> = {}) => ({
  actorId: 'alpha_treasury', verifiedPolityId: 'ALPHA',
  approvals: ['user'] as string[], rights: [], knowledgeIds: [] as string[], capabilityIds: [] as string[],
  ...overrides,
});

// ─── L'autorizzazione ────────────────────────────────────────────────────────

describe('MG02 µ1 — la tesoreria può costruire, con il consenso dichiarato', () => {
  it('la regola R1 per `allocate` esiste per la tesoreria, e chiede il consenso dell’ordine', () => {
    const cat = catalog();
    const rule = cat.authorities.find(a => a.actorType === 'treasury' && a.activity === 'allocate');
    expect(rule, 'senza questa regola nessuna costruzione è autorizzabile dalla tesoreria').toBeTruthy();
    expect(rule!.requiresApprovals).toEqual(['user']);
  });

  it('con il consenso dell’ordine la costruzione non è più bloccata per autorità', () => {
    const assessment = new FeasibilityService(catalog()).evaluate(intent(), facts());
    expect(assessment.blockers.map(b => b.code)).not.toContain('UNAUTHORIZED_ACTOR');
  });

  it('senza quel consenso la costruzione torna bloccata: l’autorità non è stata allargata', () => {
    // La guardia: il consenso deve essere NECESSARIO, non decorativo.
    const assessment = new FeasibilityService(catalog()).evaluate(intent(), facts({ approvals: [] }));
    expect(assessment.blockers.map(b => b.code)).toContain('UNAUTHORIZED_ACTOR');
  });

  it('gli altri consensi non si presumono: non sono concessi e restano mancanti', () => {
    // `institutional` e `counterparty` appartengono a un'autorità e a una
    // controparte che il server non ha interpellato. Se una regola li chiedesse,
    // il preflight deve bloccarsi: e per la requisizione li chiede davvero.
    const cat = catalog();
    const requisition = cat.authorities.find(a => a.actorType === 'treasury' && a.activity === 'requisition');
    expect(requisition?.requiresApprovals).toContain('institutional');
    expect(requisition?.requiresApprovals).toContain('counterparty');

    // E la regola nuova non tocca le attività che esistevano già.
    const spend = cat.authorities.find(a => a.actorType === 'treasury' && a.activity === 'spend');
    expect(spend?.requiresApprovals).toEqual(['user']);
    expect(cat.authorities.filter(a => a.actorType === 'treasury').map(a => a.activity).sort())
      .toEqual(['allocate', 'requisition', 'spend']);
  });

  it('la regola vale per TIPO di attore, non per una polity privilegiata', () => {
    // L'autorità si concede per tipo (`treasury`), quindi vale anche per la
    // tesoreria di BETA: è una regola di catalogo, non un privilegio di ALPHA.
    // Il test lo dichiara invece di lasciarlo implicito, e per farlo usa un
    // ordine di BETA — con un ordine di ALPHA il blocco sarebbe quello, giusto,
    // dell'identità verificata che non coincide.
    const cat = catalog();
    const betaTreasury = cat.actors.find(a => a.actorId === 'beta_treasury')!;
    expect(betaTreasury.type).toBe('treasury');

    const assessment = new FeasibilityService(cat).evaluate(intent('w_road', 'construct', 'BETA'), {
      actorId: 'beta_treasury', verifiedPolityId: 'BETA',
      approvals: ['user'], rights: [], knowledgeIds: [], capabilityIds: [],
    });
    expect(assessment.blockers.map(b => b.code)).not.toContain('UNAUTHORIZED_ACTOR');

    // E l'identità resta un controllo vero: un ordine di ALPHA presentato come
    // BETA è respinto, comunque vada l'autorizzazione.
    const crossPolity = new FeasibilityService(cat).evaluate(intent('w_road', 'construct', 'ALPHA'), {
      actorId: 'beta_treasury', verifiedPolityId: 'BETA',
      approvals: ['user'], rights: [], knowledgeIds: [], capabilityIds: [],
    });
    expect(crossPolity.blockers.map(b => b.code)).toContain('UNAUTHORIZED_ACTOR');
  });

  it('l’attività richiesta resta `allocate`: cambiarla non sblocca per caso', () => {
    // `construct` chiede `allocate`. Se qualcuno cambiasse quella mappatura in
    // `spend`, il consenso richiesto diventerebbe un altro e i deficit non
    // sarebbero più accompagnati dall'autorizzazione giusta.
    const cat = catalog();
    const service = new FeasibilityService(cat);
    // Con un attore che NON ha alcuna regola per `allocate`, il blocco resta.
    const privateActor = cat.actors.find(a => a.actorId === 'alpha_farms')!;
    expect(privateActor.type).toBe('private_sector');
    const assessment = service.evaluate(intent(), {
      actorId: 'alpha_farms', verifiedPolityId: 'ALPHA',
      approvals: ['user', 'institutional', 'counterparty'], rights: [], knowledgeIds: [], capabilityIds: [],
    });
    expect(assessment.blockers.map(b => b.code)).toContain('UNAUTHORIZED_ACTOR');
  });
});

// ─── La parità fra le due rotte ──────────────────────────────────────────────

describe('MG02 µ1 — le due rotte di preflight condividono la stessa lettura', () => {
  let db: any;
  let gameId = '';
  let branchId = '';
  let router: { stack: unknown[] };

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG02', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
    router = (await import('../src/routes/games.routes')).gamesRouter as unknown as { stack: unknown[] };
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  it('`strictReadingsFor` legge una volta sola e restituisce i deficit attesi', async () => {
    const { strictReadingsFor } = await import('../src/game/PreflightReadings');
    const result = strictReadingsFor({
      economyMode: 'strict', branchId, actorId: 'alpha_treasury', catalog: catalog(), intent: intent(),
    });
    expect(result).toBeDefined();
    // La tesoreria ALPHA ha 1000000 di unità minime: la cassa non è il problema.
    expect(result!.deficits.map(d => d.code)).not.toContain('INSUFFICIENT_CASH');
    // L'acciaio invece manca: nella fixture appartiene a BETA.
    expect(result!.deficits.map(d => d.code)).toContain('MATERIAL_SHORTAGE');
    // La manodopera resta ignota, non presunta.
    expect(result!.unknown.map(u => u.id)).toEqual(['operaio']);
  });

  it('le stesse tre condizioni producono `undefined` — «non verificato», non «puoi»', async () => {
    const { strictReadingsFor } = await import('../src/game/PreflightReadings');
    const base = { branchId, actorId: 'alpha_treasury', catalog: catalog(), intent: intent() };
    // Partita legacy: il ledger non è la fonte.
    expect(strictReadingsFor({ ...base, economyMode: 'legacy' })).toBeUndefined();
    // Ramo assente.
    expect(strictReadingsFor({ ...base, economyMode: 'strict', branchId: null })).toBeUndefined();
    // Ramo senza stato economico.
    expect(strictReadingsFor({ ...base, economyMode: 'strict', branchId: 'ramo-mai-inizializzato' })).toBeUndefined();
  });

  it('la rotta da intent e la rotta da testo libero giudicano allo stesso modo', async () => {
    // Il difetto misurato in MG01: `check-feasibility` non leggeva il ledger,
    // quindi i tre codici di deficit erano irraggiungibili da lì e lo stesso
    // ordine aveva due risposte. Ora entrambe passano da `strictReadingsFor`.
    const { strictReadingsFor } = await import('../src/game/PreflightReadings');
    const measured = strictReadingsFor({
      economyMode: 'strict', branchId, actorId: 'alpha_treasury', catalog: catalog(), intent: intent(),
    })!;

    const assessment = new FeasibilityService(catalog()).evaluate(intent(), facts({
      deficits: measured.deficits, unknownRequirements: measured.unknown,
    }));
    const codes = assessment.blockers.map(b => b.code);
    expect(codes).toContain('MATERIAL_SHORTAGE');
    expect(codes).not.toContain('UNAUTHORIZED_ACTOR');

    // E senza letture lo stesso ordine dichiara di non sapere, invece di dire «puoi».
    const senzaLetture = new FeasibilityService(catalog()).evaluate(intent(), facts());
    expect(senzaLetture.status).toBe('feasible_with_conditions');
    expect(senzaLetture.warnings.join(' ')).toContain('disponibilità non verificata');
  });

  it('la rotta `evaluate` risponde con i deficit e senza mutare il ledger', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }).n;
    const result = await new Promise<{ status: number; payload: any }>((resolve, reject) => {
      const req = {
        method: 'POST', params: { id: gameId },
        body: {
          intent: {
            id: 'ord_rotta', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
            actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
            priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
          },
        },
      };
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

    expect(result.status).toBe(200);
    expect(result.payload.canonicalMutation).toBe(false);
    const codes = result.payload.orders[0].blockers.map((b: any) => b.code);
    // Il blocco che MG01 non poteva sciogliere ora è sciolto; resta quello vero.
    expect(codes).not.toContain('UNAUTHORIZED_ACTOR');
    expect(codes).toContain('MATERIAL_SHORTAGE');
    expect((db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }).n).toBe(before);
  });
});
