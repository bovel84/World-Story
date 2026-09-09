import { describe, expect, it } from 'vitest';
import {
  EffectValidationError,
  rejectDirectMaterialCommand,
  validateStrictEffect,
  validateStrictEffects,
  validateStrictMapChanges,
  validateStrictOutcome,
  validateStrictResult,
  validateStrictResultSafe,
  validateStrictWorldChanges,
} from '../src/core/simulation/EffectValidator';

describe('M06 µ2 — EffectValidator strict', () => {
  it('rifiuta worldChanges assoluti che creano PIL/militare/territorio (MAT26)', () => {
    expect(() => validateStrictWorldChanges({ regionGDP: { r: 999999 } })).toThrow(EffectValidationError);
    expect(() => validateStrictWorldChanges({ regionOwners: { r: 'X' } })).toThrow(/vietato/);
    expect(() => validateStrictWorldChanges({ regionMilitary: { r: 1 } })).toThrow(EffectValidationError);
    expect(() => validateStrictWorldChanges({ regionPopulation: { r: 1e9 } })).toThrow(EffectValidationError);
    expect(() => validateStrictWorldChanges({ newFeatures: [{ type: 'factory' }] })).toThrow(EffectValidationError);
    expect(() => validateStrictWorldChanges({ deletedFeatures: ['x'] })).toThrow(EffectValidationError);
    // Oggetto vuoto o assente è ammesso: nessuna mutazione.
    expect(() => validateStrictWorldChanges({})).not.toThrow();
    expect(() => validateStrictWorldChanges(undefined)).not.toThrow();
  });

  it('rifiuta build/spawn/grant diretti della LLM (MAT25)', () => {
    for (const c of ['build_facility foundry', 'spawn_battalion now', 'grant_funds 999', 'set_gdp 999', 'spawn_unit tank']) {
      expect(() => rejectDirectMaterialCommand(c)).toThrow(/vietato/);
    }
    // Comandi non materiali non vengono bloccati dal validatore di comandi.
    expect(() => rejectDirectMaterialCommand('invest in research')).not.toThrow();
  });

  it('rifiuta mapChanges LLM diretti senza resolver/autorizzazione (MAT25/MAT27)', () => {
    expect(() => validateStrictMapChanges([{ type: 'build_facility', regionName: 'r' }])).toThrow(EffectValidationError);
    expect(() => validateStrictMapChanges([{ type: 'spawn_battalion', regionName: 'r' }])).toThrow(EffectValidationError);
    expect(() => validateStrictMapChanges([{ type: 'transfer', regionName: 'r', newOwner: 'X' }])).toThrow(EffectValidationError);
    expect(() => validateStrictMapChanges([])).not.toThrow();
    expect(() => validateStrictMapChanges(undefined)).not.toThrow();
  });

  it('protocollo structured invalido non diventa fallback; qualitative senza mutazioni è ammesso (MAT37)', () => {
    expect(() => validateStrictEffects([{ kind: 'ledger', effectId: 'e' }])).toThrow(/causale/);
    expect(() => validateStrictEffects([{ kind: 'qualitative', effectId: 'q' }])).not.toThrow();
    expect(() => validateStrictWorldChanges({ regionGDP: {} })).not.toThrow();
  });

  it('effetto materiale richiede causale e bersaglio per tipo (MAT38)', () => {
    // ledger senza conto → rifiuto anche con causale.
    expect(() => validateStrictEffect({ kind: 'ledger', effectId: 'e', cause: 'c' })).toThrow(/conto/);
    // shipment senza risorsa → rifiuto.
    expect(() => validateStrictEffect({ kind: 'shipment', effectId: 'e', cause: 'c' })).toThrow(/risorsa/);
    // project_tick senza progetto → rifiuto.
    expect(() => validateStrictEffect({ kind: 'project_tick', effectId: 'e', cause: 'c' })).toThrow(/progetto/);
    // Effetti materiali ben formati passano.
    expect(() =>
      validateStrictEffect({ kind: 'ledger', effectId: 'e', cause: 'c', account: 'a', amount: '10' }),
    ).not.toThrow();
    expect(() =>
      validateStrictEffect({ kind: 'shipment', effectId: 'e', cause: 'c', resource: 'steel', quantity: '10' }),
    ).not.toThrow();
    expect(() =>
      validateStrictEffect({ kind: 'project_tick', effectId: 'e', cause: 'c', projectId: 'p' }),
    ).not.toThrow();
  });

  it('outcome senza actionId canonico è rifiutato (nessun fallback posizionale)', () => {
    expect(() => validateStrictOutcome({ action: 'testo', status: 'accepted', summary: 's' })).toThrow(/actionId/);
    expect(() => validateStrictOutcome({ actionId: 'a', status: 'weird', summary: 's' })).toThrow(/status/);
    expect(() => validateStrictOutcome({ actionId: 'a', status: 'accepted', summary: '' })).toThrow(/summary/);
    expect(() => validateStrictOutcome({ actionId: 'a', status: 'partial', summary: 's' })).not.toThrow();
  });

  it('validateStrictResult valida l\'intero risultato (worldChanges, mapChanges, outcomes, effects)', () => {
    // Risultato pulito: nessuna mutazione materiale, esiti validi.
    expect(() =>
      validateStrictResult({
        events: [{ headline: 'h', description: 'd', date: '1951-01-01', mapChanges: [] }],
        worldChanges: {},
        actionOutcomes: [{ actionId: 'a1', status: 'accepted', summary: 'ok' }],
        voided: [],
      }),
    ).not.toThrow();

    // worldChanges materiale → rifiuto.
    expect(() =>
      validateStrictResult({ worldChanges: { regionGDP: { r: 1 } }, events: [], actionOutcomes: [] }),
    ).toThrow(EffectValidationError);

    // mapChanges da un evento → rifiuto.
    expect(() =>
      validateStrictResult({
        events: [{ headline: 'h', description: 'd', date: '1951-01-01', mapChanges: [{ type: 'build_facility' }] }],
        worldChanges: {},
        actionOutcomes: [],
      }),
    ).toThrow(EffectValidationError);

    // outcome senza actionId → rifiuto.
    expect(() =>
      validateStrictResult({ worldChanges: {}, events: [], actionOutcomes: [{ action: 'x', status: 'accepted', summary: 's' }] }),
    ).toThrow(EffectValidationError);

    // effects invalidi → rifiuto.
    expect(() =>
      validateStrictResult({ worldChanges: {}, events: [], actionOutcomes: [], effects: [{ kind: 'ledger', effectId: 'e' }] }),
    ).toThrow(EffectValidationError);
  });

  it('fuzz: schema/ID malformati → mai crash non gestito, mai fallback di successo (fuzz schema/ID)', () => {
    const malformed = [
      null,
      undefined,
      42,
      'string',
      { worldChanges: 'nope' },
      { events: 'nope' },
      { actionOutcomes: 'nope' },
      { effects: 'nope' },
      { effects: [null] },
      { effects: [42] },
      { effects: [{ kind: 'nope', effectId: 'e' }] },
      { effects: [{ kind: 'ledger', effectId: '' }] },
      { effects: [{ kind: 'ledger', effectId: 7 }] },
      { events: [null] },
      { events: [{ mapChanges: 'nope' }] },
      { actionOutcomes: [null] },
      { actionOutcomes: [{ actionId: 7, status: 'accepted', summary: 's' }] },
      { worldChanges: { regionGDP: { r: 1 } } },
      { events: [{ mapChanges: [{ type: 'build_facility' }] }] },
    ];
    for (const m of malformed) {
      // Invariante: mai un errore non gestito; se rifiuta, è sempre EffectValidationError.
      try {
        validateStrictResultSafe(m);
      } catch (err) {
        expect(err).toBeInstanceOf(EffectValidationError);
      }
    }
    // Le mutazioni materiali sono SEMPRE rifiutate, mai accettate per fallback.
    expect(() => validateStrictResultSafe({ worldChanges: { regionGDP: { r: 1 } } })).toThrow(EffectValidationError);
    expect(() =>
      validateStrictResultSafe({ events: [{ mapChanges: [{ type: 'build_facility' }] }] }),
    ).toThrow(EffectValidationError);
  });

  it('stesso rifiuto materiale per player e NPC: il validatore non distingue l\'attore (MAT27)', () => {
    // La stessa mutazione materiale è vietata indipendentemente da chi la emette.
    const npcResult = { worldChanges: { regionMilitary: { r: 5 } }, events: [], actionOutcomes: [] };
    const playerResult = { worldChanges: { regionMilitary: { r: 5 } }, events: [], actionOutcomes: [] };
    expect(() => validateStrictResult(npcResult)).toThrow(EffectValidationError);
    expect(() => validateStrictResult(playerResult)).toThrow(EffectValidationError);
  });
});
