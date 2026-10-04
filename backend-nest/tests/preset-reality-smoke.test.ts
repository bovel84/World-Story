/**
 * WS-GOV-PRESET-REALITY-PIPELINE — Smoke test sulla realtà nazionale.
 *
 * Caso di riferimento: un paese presente tra i selezionabili ma SENZA dati
 * dedicati nel preset (come KHM in `millennium_dawn`: assente da
 * `simulation/polities.json`, `treasuries=[]`, `inventory=[]`, provinces senza
 * oggetti). Verifica che:
 *  1. il paese venga bootstrapato in UNA sola realtà (capacità ↔ inventario);
 *  2. il briefing nazionale NON sia il solo `base_prompt` e cambi tra paesi;
 *  3. il Consulente non emetta linguaggio tecnico.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `world-story-preset-reality-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

let db: typeof import('../src/database').default;
let registry: import('../src/session-registry').SessionRegistry;
let session: import('../src/game-session').GameSession;
let buildOpeningContext: typeof import('../src/core/government/OpeningNarrative').buildOpeningContext;
let buildDeterministicOpeningResponse: typeof import('../src/core/government/OpeningNarrative').buildDeterministicOpeningResponse;
let nationalSituationLines: typeof import('../src/core/government/RealitySignals').nationalSituationLines;
let nationalQuestions: typeof import('../src/core/government/RealitySignals').nationalQuestions;
let hasTechnicalVocabulary: typeof import('../src/core/government/RealitySignals').hasTechnicalVocabulary;
let verifiedRequestCorrection: typeof import('../src/core/government/RealityAdvisor').verifiedRequestCorrection;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream() { return { content: '{}' }; },
  clearCache() {},
};

const PREMISE = 'Il mondo entra nel nuovo millennio. La NATO e gli Stati Uniti restano il perno dell\'ordine internazionale.';

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repos = await import('../src/repositories');
  ({ buildOpeningContext, buildDeterministicOpeningResponse } = await import('../src/core/government/OpeningNarrative'));
  ({ nationalQuestions, nationalSituationLines, hasTechnicalVocabulary } = await import('../src/core/government/RealitySignals'));
  ({ verifiedRequestCorrection } = await import('../src/core/government/RealityAdvisor'));
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();

  // KHM: una sola provincia costiera, NESSUN oggetto (il caso del preset).
  repos.worldRepository.createWithRegions(
    { id: 'preset_khm', name: 'Millennium Dawn (sonda KHM)', description: '', startDate: '2000-01-01', basePrompt: PREMISE, historicalAccuracy: 0.7 },
    // `coastal` si deriva dal GeoJSON canonico: una provincia di costa reale.
    [{ id: 'preset_khm_capital', name: 'Phnom Penh', color: '#123456', owner: 'KHM', population: 12_000_000, gdp: 3_600, militaryPower: 30, flag: 'KHM', coastal: true, borders: [], objects: [],
      geojson: JSON.stringify({ type: 'Feature', properties: { surface_type: 'Coastal' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }) }],
  );
  // USA: più province, con infrastrutture canoniche già presenti.
  repos.worldRepository.createWithRegions(
    { id: 'preset_usa', name: 'Millennium Dawn (sonda USA)', description: '', startDate: '2000-01-01', basePrompt: PREMISE, historicalAccuracy: 0.7 },
    [{ id: 'preset_usa_capital', name: 'Washington', color: '#223344', owner: 'USA', population: 280_000_000, gdp: 9_800_000, militaryPower: 900, flag: 'USA', coastal: true, borders: [], objects: [{ id: 'usa-port', type: 'port', name: 'Porto di New York' }],
      geojson: JSON.stringify({ type: 'Feature', properties: { surface_type: 'Coastal' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }) }],
  );
});
afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

const create = (worldId: string, regionId: string, polity: string) => {
  const created = registry.createSession(worldId, 'Presidente', regionId, '#123456');
  return registry.getSession(created.gameId)!;
};

const briefingFor = (target: import('../src/game-session').GameSession) => {
  const snapshot = target.getVerifiedWorldSnapshot();
  const context = buildOpeningContext({
    worldName: 'Millennium Dawn', date: '2000-01-01', premise: PREMISE, rules: '',
    nationName: target.getPlayer()?.polityId ?? '', polityId: target.getPlayer()?.polityId ?? '',
    verifiedSituation: nationalSituationLines(snapshot), questions: nationalQuestions(snapshot),
  });
  return { snapshot, briefing: buildDeterministicOpeningResponse(context) };
};

describe('WS-GOV-PRESET-REALITY-PIPELINE', () => {
  let khm: import('../src/game-session').GameSession;
  let usa: import('../src/game-session').GameSession;
  beforeEach(() => {
    khm = create('preset_khm', 'preset_khm_capital', 'KHM');
    usa = create('preset_usa', 'preset_usa_capital', 'USA');
  });

  it('nessun conflitto capacità/inventario: la capacità diventa inventario canonico', () => {
    const { snapshot } = briefingFor(khm);
    const account = khm.getNationalAccounts()['KHM'];
    const capacityPorts = Number(account?.ports ?? 0);
    // Prima: capacity 1 e inventario vuoto (due realtà). Ora coincidono.
    expect(capacityPorts).toBeGreaterThan(0);
    expect(snapshot.infrastructure.ports).toHaveLength(capacityPorts);
    expect(snapshot.facts.ports.value).toContain('Porto di Phnom Penh');
    // Prova interna della materializzazione (il giocatore non la vede).
    expect(snapshot.infrastructure.ports![0].raw).toMatchObject({ metadata: { derivedFrom: 'national_capacity' } });
    // Un paese con infrastrutture authored: si materializza SOLO la parte
    // mancante della capacità (per tipo), e l'inventario resta quello authored
    // più il mancante. `Σ level` = capacità dichiarata, senza doppio conteggio.
    const usaSnapshot = briefingFor(usa).snapshot;
    const usaAccount = usa.getNationalAccounts()['USA'];
    const portCapacity = (assets?: typeof usaSnapshot.infrastructure.ports) =>
      (assets ?? []).reduce((total, asset) => total + Math.max(1, Number((asset.raw as { level?: number }).level ?? 1)), 0);
    expect(usaSnapshot.facts.ports.value).toContain('Porto di New York');
    expect(portCapacity(usaSnapshot.infrastructure.ports)).toBe(Number(usaAccount?.ports ?? 0));
    expect(usaSnapshot.infrastructure.ports?.length).toBeGreaterThanOrEqual(1);
  });

  it('il mondo apre breve e il paese parla subito: KHM e USA sono diversi', () => {
    const khmBrief = briefingFor(khm).briefing;
    const usaBrief = briefingFor(usa).briefing;
    // Mondo: una frase breve, non il briefing intero.
    expect(khmBrief.world.narrative.worldOrder.split(/\s+/).length).toBeLessThanOrEqual(45);
    expect(khmBrief.world.narrative.worldOrder).toContain('nuovo millennio');
    // Paese: quadro + 1-3 questioni reali.
    expect(khmBrief.nation.framing).toBeTruthy();
    expect(khmBrief.nation.framing).not.toBe(khmBrief.world.narrative.worldOrder);
    expect(khmBrief.nation.questions.length).toBeGreaterThanOrEqual(1);
    expect(khmBrief.nation.questions.length).toBeLessThanOrEqual(3);
    // §3 — la PRIMA pagina contiene già la frase del paese (stakesForNation,
    // dal quadro verificato) e differisce tra KHM e USA.
    expect(khmBrief.world.narrative.stakesForNation).toBeTruthy();
    expect(khmBrief.world.narrative.stakesForNation).not.toBe(usaBrief.world.narrative.stakesForNation);
    // Aperture visibilmente diverse tra i due paesi.
    const khmOpening = [khmBrief.world.narrative.worldOrder, khmBrief.nation.framing, ...khmBrief.nation.questions].join(' | ');
    const usaOpening = [usaBrief.world.narrative.worldOrder, usaBrief.nation.framing, ...usaBrief.nation.questions].join(' | ');
    expect(khmOpening).not.toBe(usaOpening);
    // Le questioni derivano dallo STATO: due paesi possono condividerne alcune,
    // ma il quadro del paese (misure) è specifico e diverso.
    expect(khmBrief.nation.framing).not.toBe(usaBrief.nation.framing);
  });

  it('il Consulente non parla mai come un debugger del database', () => {
    const { snapshot, briefing } = briefingFor(khm);
    const visible = [briefing.nation.framing, ...briefing.nation.questions, ...nationalSituationLines(snapshot)].join('\n');
    expect(visible.length).toBeGreaterThan(0);
    expect(hasTechnicalVocabulary(visible)).toBe(false);
    for (const word of ['FACT', 'inventory', 'account', 'sourceRef', 'canonical', 'fallback', 'JSON']) {
      expect(visible).not.toContain(word);
    }
  });
});
