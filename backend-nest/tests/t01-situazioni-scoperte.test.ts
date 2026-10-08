/**
 * T01 — LA MISURA: quante situazioni nascono, e quante restano scoperte.
 *
 * Non è una correzione: è lo strumento che decide se T04 (la rete di copertura)
 * serve, e che cosa deve coprire. Le cifre qui sotto sono quelle misurate il
 * 2026-10-08 e riportate in `docs/PIANO_SEDUTA_E_FORMA_PROPOSTE.md` §7.
 *
 * Il DB dell'autore **non conserva** le conversazioni del Consulente (`chats` e
 * `chat_messages` sono vuote): una misura sulle sue partite non è disponibile,
 * quindi lo snapshot è costruito con la stessa forma del fixture standard
 * (Uganda 2000) e variato per stato del paese.
 *
 * Ciò che la misura dice, e che queste prove difendono:
 *  - le situazioni sono **esattamente i segnali** (fuori dal dominio decisione):
 *    `buildAdvisorSituations` è una proiezione 1:1, non una scelta politica;
 *  - **senza proposte, ogni situazione è scoperta** — non è la copertura a
 *    mancare, è che nessuno genera le proposte;
 *  - il numero dipende dallo stato: uno Stato stabile ne ha una, un collasso otto.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildAdvisorSituations, withAdvisorBriefingCoverage, uncoveredAdvisorSituations } from '../src/core/government/AdvisorSituations';
import { buildRealitySignals } from '../src/core/government/RealitySignals';

type Options = {
  relationships?: Record<string, Record<string, string>>;
  polityNames?: Record<string, string>;
  ongoingProcesses?: Array<Record<string, unknown>>;
  account?: Record<string, unknown>;
  stock?: Record<string, number>;
  date?: string;
  turn?: number;
};

function world(options: Options = {}): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'situations', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: options.date ?? '2000-06-01',
      ...(options.turn !== undefined ? { currentTurn: options.turn } : {}),
      world: { regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', coastal: false, objects: [] } } },
      worldState: {
        accounts: { UGA: options.account ?? { population: 10_000_000, socialTension: 65, stability: 20, monthlyBalance: -2, nominalGdpUsdBillions: 100, debtRatioPct: 40, debtServicePct: 5 } },
        resources: { stock: options.stock ?? { money: 1, food: 0.5, weapons: 1 }, needs: { food: 1 } },
        arsenal: { units: {} },
      },
      relationships: options.relationships ?? {},
      polityNames: options.polityNames,
      ongoingProcesses: options.ongoingProcesses ?? [],
    },
    commitments: [], operationalRows: [], foodCoverageMonths: 0.5,
  });
}

/** I quattro stati misurati. Le cifre sono quelle della misura, non stime. */
const scenari = {
  /** Una crisi sola: carestia, deficit, instabilità, tensione. */
  crisi: () => ({ snapshot: world(), situazioni: 4 }),
  /** Due vicini ostili + due opere in ritardo. */
  vicini: () => ({ snapshot: world({
    relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } }, polityNames: { SDN: 'Sudan', COD: 'Congo' },
    ongoingProcesses: [
      { id: 'p1', title: 'Ferrovia Kampala–Jinja', expectedDate: '2000-01-01' },
      { id: 'p2', title: 'Acquedotto del Nord', expectedDate: '2000-02-01' },
    ],
  }), situazioni: 8 }),
  /** Stato stabile e ricco: resta solo l'approvvigionamento sotto soglia. */
  stabile: () => ({ snapshot: world({
    account: { population: 50_000_000, socialTension: 5, stability: 90, monthlyBalance: 5, nominalGdpUsdBillions: 900, debtRatioPct: 20, debtServicePct: 2 },
    relationships: { UGA: { SDN: 'friendly', COD: 'neutral' } }, stock: { money: 100, food: 20, weapons: 10 },
  }), situazioni: 1 }),
  /** Collasso: quattro vicini ostili, cassa e scorte a zero. */
  collasso: () => ({ snapshot: world({
    account: { population: 10_000_000, socialTension: 95, stability: 3, monthlyBalance: -20, nominalGdpUsdBillions: 20, debtRatioPct: 120, debtServicePct: 40 },
    stock: { money: 0, food: 0, weapons: 0 },
    relationships: { UGA: { SDN: 'hostile', COD: 'hostile', KEN: 'hostile', TZA: 'hostile' } },
  }), situazioni: 8 }),
};

describe('T01 — la misura delle situazioni scoperte', () => {
  it('le situazioni sono esattamente i segnali fuori dal dominio decisione', () => {
    for (const [nome, costruisci] of Object.entries(scenari)) {
      const { snapshot } = costruisci();
      const segnali = buildRealitySignals(snapshot).filter(signal => signal.domain !== 'decision');
      const situazioni = buildAdvisorSituations(snapshot);
      expect(situazioni.length, `scenario ${nome}: una situazione per segnale`).toBe(segnali.length);
      expect(situazioni.map(s => s.signalKeys[0])).toEqual(segnali.map(s => s.key));
      // La proiezione non è una scelta: nessuna situazione nasce da un segnale
      // di decisione, e nessuna sparisce.
    }
  });

  it('senza proposte, OGNI situazione resta scoperta — in ogni stato del paese', () => {
    for (const [nome, costruisci] of Object.entries(scenari)) {
      const { snapshot, situazioni } = costruisci();
      const built = buildAdvisorSituations(snapshot);
      expect(built.length, `scenario ${nome}`).toBe(situazioni);
      const scoperte = uncoveredAdvisorSituations({ situations: built, issues: [] });
      expect(scoperte.length, `scenario ${nome}: nessuna proposta ⇒ nessuna copertura`).toBe(built.length);
      expect(withAdvisorBriefingCoverage(snapshot, { reply: '', situations: built, issues: [] }).briefingCoverage?.complete)
        .toBe(false);
    }
  });

  it('il numero dipende dallo STATO, non da una quota: da 1 a 8', () => {
    const conteggi = Object.fromEntries(Object.entries(scenari).map(([nome, costruisci]) => [nome, buildAdvisorSituations(costruisci().snapshot).length]));
    expect(conteggi).toEqual({ crisi: 4, vicini: 8, stabile: 1, collasso: 8 });
    // La misura che conta per T04: **quante** situazioni T04 dovrà coprire.
    // Nello stato stabile è una sola; nel collasso sono otto, tutte gravi.
    expect(Math.max(...Object.values(conteggi))).toBeLessThanOrEqual(24); // MAX_ADVISOR_SITUATIONS
  });

  it('il collasso produce solo situazioni gravi (g3): niente opportunità da cogliere', () => {
    const built = buildAdvisorSituations(scenari.collasso().snapshot);
    expect(built.every(s => s.importance === 3)).toBe(true);
    // Nello stato stabile l'unica situazione è ancora un problema, non una chance:
    // `buildAdvisorSituations` non distingue problema da opportunità (`kind` resta
    // al modello). È il motivo per cui T04 non può inventare le mosse da sé.
    expect(buildAdvisorSituations(scenari.stabile().snapshot).every(s => s.kind === undefined)).toBe(true);
  });
});
