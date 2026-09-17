/**
 * MATERIEL-CLARITY — sintesi del bilancio materiale (frontend).
 *
 * La riga di sintesi deve rispondere in due secondi a «quanto ho, quanto
 * produco, quanto consumo, avanzo o deficit?» usando **solo** i numeri del
 * motore; se il motore non pubblica il bilancio, la riga lo dichiara invece di
 * inventare un valore.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveMaterialRows, materialRowsOf, materialSummaryLine, type MaterialBalanceRow,
} from './materialBalance';

const row = (over: Partial<MaterialBalanceRow> = {}): MaterialBalanceRow => ({
  kind: 'weapons', label: 'Armamenti', stock: 160, capacity: 200,
  productionPerMonth: 1.1, consumptionPerMonth: 0.8, balancePerMonth: 0.3, spoiledPerMonth: 0,
  ...over,
});

describe('deriveMaterialRows — sintesi del bilancio materiale', () => {
  it('mostra disponibilità, produzione, consumo e saldo dalla riga del motore', () => {
    const [view] = deriveMaterialRows([row()]);
    expect(view.label).toBe('Armamenti');
    expect(view.availabilityText).toBe('160,0 / 200,0');
    expect(view.productionText).toBe('1,10/mese');
    expect(view.consumptionText).toBe('0,80/mese');
    expect(view.balanceText).toBe('+0,30/mese');
    expect(view.balanceTone).toBe('positive');
    expect(view.state).toBe('sufficiente');
    expect(materialSummaryLine(view)).toBe('Armamenti 160,0 / 200,0 · saldo +0,30/mese · sufficiente');
  });

  it('saldo negativo: tono negativo e segno meno esplicito (deficit)', () => {
    const [view] = deriveMaterialRows([row({ balancePerMonth: -1.4, stock: 20, productionPerMonth: 0.6, consumptionPerMonth: 2 })]);
    expect(view.balanceText).toBe('−1,40/mese');
    expect(view.balanceTone).toBe('negative');
    expect(view.state).toBe('teso');
    expect(view.stateHint).toContain('tre mesi');
  });

  it('scorta sotto un mese di fabbisogno: stato critico', () => {
    const [view] = deriveMaterialRows([row({ stock: 0.4, consumptionPerMonth: 1, balancePerMonth: -0.6 })]);
    expect(view.state).toBe('critico');
    expect(view.stateLabel).toBe('critico');
    expect(view.stateHint).toContain('meno di un mese');
  });

  it('magazzino al tetto con avanzo: stato «in accumulo» e surplus dichiarato perso', () => {
    const [view] = deriveMaterialRows([row({ stock: 200, capacity: 200, balancePerMonth: 3.1, spoiledPerMonth: 3.1 })]);
    expect(view.state).toBe('al_tetto');
    expect(view.stateLabel).toBe('in accumulo');
    expect(view.stateHint).toContain('va perso');
  });

  it('senza bilancio pubblicato non inventa numeri: valori «—» e stato ignoto', () => {
    const [view] = deriveMaterialRows([{ kind: 'fuel' }]);
    expect(view.label).toBe('Carburante');
    expect(view.availabilityText).toBe('—');
    expect(view.productionText).toBe('—');
    expect(view.balanceText).toBe('—');
    expect(view.balanceTone).toBe('neutral');
    expect(view.state).toBe('ignoto');
  });

  it('bilancio assente o malformato → nessuna riga (meglio nulla che finto)', () => {
    expect(deriveMaterialRows(undefined)).toEqual([]);
    expect(deriveMaterialRows(null)).toEqual([]);
    expect(deriveMaterialRows([{ kind: '' }])).toEqual([]);
    expect(deriveMaterialRows('x' as unknown as MaterialBalanceRow[])).toEqual([]);
  });

  it('ignora le righe duplicate dello stesso materiale', () => {
    const views = deriveMaterialRows([row(), row({ stock: 1 })]);
    expect(views).toHaveLength(1);
    expect(views[0].availabilityText).toBe('160,0 / 200,0');
  });

  it('etichetta di riserva quando il motore non la manda', () => {
    const [view] = deriveMaterialRows([{ kind: 'food', stock: 4, capacity: 4 }]);
    expect(view.label).toBe('Cibo');
  });

  it('filtro per materiale: il tab Armamenti mostra solo le scorte di armi', () => {
    const views = deriveMaterialRows([
      row({ kind: 'food', label: 'Cibo' }),
      row({ kind: 'clothing', label: 'Vestiario' }),
      row(),
      row({ kind: 'fuel', label: 'Carburante' }),
    ]);
    expect(views).toHaveLength(4);
    expect(materialRowsOf(views, ['weapons']).map(v => v.kind)).toEqual(['weapons']);
    expect(materialRowsOf(views, [])).toHaveLength(4);
  });

  it('capacità assente: mostra la sola disponibilità, senza tetto inventato', () => {
    const [view] = deriveMaterialRows([row({ capacity: undefined, stock: 12 })]);
    expect(view.availabilityText).toBe('12,0');
  });
});
