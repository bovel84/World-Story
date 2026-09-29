/**
 * WS-GOVOFFICE-02 — Dalla seduta all'ordine: la regola pura
 * =========================================================
 * Verifica il contratto della promessa dell'autore: «alla fine della
 * discussione ci deve essere un ordine o un nulla di fatto. Ordine che deve
 * essere messo in automatico nella lista degli ordini».
 *
 * Qui si prova la parte che si può provare senza schermo: il testo dell'ordine
 * composto dai dati del motore e la dichiarazione d'opera. `environment: 'node'`,
 * nessun render, nessuno store.
 */
import { describe, expect, it } from 'vitest';
import type { CabinetItemView, CabinetPathView } from '../../services/api';
import { cabinetDeclarationFor, composeCabinetOrderText } from './cabinetOrder';

const path: CabinetPathView = {
  id: 'tesoro-path-1',
  title: 'Emettere titoli a 10 anni',
  detail: 'Un prestito lungo per coprire il disavanzo corrente.',
  prerequisites: ['Fiducia sul debito'],
  expected: 'Cassa immediata, oneri più alti per un decennio.',
  recommended: true,
};

function item(overrides: Partial<CabinetItemView> = {}): CabinetItemView {
  return {
    voiceId: 'tesoro-1',
    need: 'La cassa del Tesoro non copre la spesa corrente.',
    because: 'le entrate correnti non bastano',
    urgency: 'urgente',
    figures: [
      { label: 'Fabbisogno mensile', value: '1,2', unit: 'mld', basis: { kind: 'measured', source: 'bilancio' } },
      { label: 'Copertura disponibile', value: '0,4', unit: 'mld', basis: { kind: 'measured', source: 'bilancio' } },
    ],
    paths: [path],
    ...overrides,
  };
}

describe('WS-GOVOFFICE-02 — composeCabinetOrderText', () => {
  it('mette in fila i termini della strada senza inventare cifre', () => {
    const text = composeCabinetOrderText(item(), path);
    expect(text).toContain('Emettere titoli a 10 anni');
    expect(text).toContain('La cassa del Tesoro non copre la spesa corrente.');
    expect(text).toContain('Strada scelta: Un prestito lungo per coprire il disavanzo corrente.');
    expect(text).toContain('Prerequisiti: Fiducia sul debito');
    expect(text).toContain('Esito atteso: Cassa immediata, oneri più alti per un decennio.');
    // Le cifre del motore restano nel loro campo: non si promettono numeri.
    expect(text).not.toContain('1,2 mld');
  });

  it('dichiara «nessuno» quando non ci sono prerequisiti', () => {
    const text = composeCabinetOrderText(item(), { ...path, prerequisites: [] });
    expect(text).toContain('Prerequisiti: nessuno');
  });

  it('elenca i vincoli delle cifre non misurate o mancanti', () => {
    const withMissing = item({
      figures: [
        { label: 'Fabbisogno mensile', value: '1,2', unit: 'mld', basis: { kind: 'measured', source: 'bilancio' } },
        { label: 'Copertura disponibile', value: '', unit: '', basis: { kind: 'unknown', missing: 'il bilancio non la dichiara' } },
      ],
    });
    const text = composeCabinetOrderText(withMissing, path);
    expect(text).toContain('Vincoli da sciogliere: Copertura disponibile');
  });

  it('avverte quando l’opera non ha una distinta coperta', () => {
    const withWork = item({
      work: { workId: 'acquedotto', name: 'Acquedotto' },
      declaration: {
        workId: 'acquedotto',
        payerActorId: 'tesoro',
        materialActorId: null,
        funded: false,
        missingMaterials: [{ resourceId: 'ghisa', missing: '800 t' }],
      },
    });
    const text = composeCabinetOrderText(withWork, path);
    expect(text).toContain('mancano ghisa (800 t)');
  });
});

describe('WS-GOVOFFICE-02 — cabinetDeclarationFor', () => {
  it('non dichiara un’opera per un ordine in prosa', () => {
    expect(cabinetDeclarationFor(item())).toBeNull();
  });

  it('dichiara l’opera quando i detentori sono risolti', () => {
    const declaration = {
      workId: 'acquedotto',
      payerActorId: 'tesoro',
      materialActorId: 'miniere',
      funded: true,
    };
    expect(cabinetDeclarationFor(item({ work: { workId: 'acquedotto', name: 'Acquedotto' }, declaration })))
      .toEqual(declaration);
  });

  it('tace la dichiarazione quando nessun attore copre la distinta', () => {
    const declaration = {
      workId: 'acquedotto',
      payerActorId: 'tesoro',
      materialActorId: null,
      funded: false,
    };
    expect(cabinetDeclarationFor(item({ work: { workId: 'acquedotto', name: 'Acquedotto' }, declaration })))
      .toBeNull();
  });
});
