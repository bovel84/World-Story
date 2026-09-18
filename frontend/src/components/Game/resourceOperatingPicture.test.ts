/**
 * COUNTRY-CLARITY — scheda Risorse: stock, flussi, autonomia, dati mancanti.
 */
import { describe, it, expect } from 'vitest';
import { flowLine, resourceOperatingPicture, stockLabel, type ResourceFlowRow } from './resourceOperatingPicture';
import type { MaterialBalanceRow } from './materialBalance';

function row(kind: string, stock: number, production: number, consumption: number, capacity = 0): MaterialBalanceRow {
  return { kind, stock, capacity, productionPerMonth: production, consumptionPerMonth: consumption, balancePerMonth: production - consumption, spoiledPerMonth: 0 };
}

const LABELS: Record<string, string> = { food: 'Cibo', clothing: 'Vestiario', weapons: 'Armamenti', fuel: 'Carburante' };

describe('COUNTRY-CLARITY · risorse', () => {
  it('stock positivo con saldo negativo: autonomia calcolata sul saldo', () => {
    const picture = resourceOperatingPicture({ balance: [row('fuel', 10, 14, 19)], natural: [] });
    const fuel = picture.rows[0];
    expect(fuel.id).toBe('fuel');
    expect(fuel.stock).toBe(10);
    expect(fuel.netPerMonth).toBe(-5);
    expect(fuel.autonomy.text).toBe('2,0 mesi');
    expect(fuel.importsPerMonth).toBeNull();
    expect(fuel.exportsPerMonth).toBeNull();
    expect(flowLine(fuel)).toContain('autonomia 2,0 mesi');
    expect(stockLabel(fuel)).toBe('10');
  });

  it('saldo positivo: la riserva cresce, autonomia «non critica»', () => {
    const picture = resourceOperatingPicture({ balance: [row('food', 50, 30, 10)] });
    expect(picture.rows[0].autonomy.text).toBe('non critica');
    expect(picture.rows[0].autonomy.selfSustaining).toBe(true);
    expect(picture.status).toBe('stable');
  });

  it('saldo molto negativo: il materiale diventa un’attenzione critica', () => {
    const picture = resourceOperatingPicture({ balance: [row('weapons', 0.4, 0.2, 1.4), row('food', 100, 30, 28)] });
    const weapons = picture.rows.find(entry => entry.id === 'weapons') as ResourceFlowRow;
    expect(weapons.state).toBe('critico');
    expect(weapons.tone).toBe('critical');
    expect(picture.critical.map(entry => entry.id)).toEqual(['weapons']);
    expect(picture.status).toBe('fragile');
    expect(picture.headline).toContain('armamenti');
    expect(picture.drivers[0].tone).toBe('critical');
  });

  it('consumo zero e dati assenti non producono numeri ingannevoli', () => {
    const noConsumption = resourceOperatingPicture({ balance: [row('clothing', 5, 2, 0)] });
    expect(noConsumption.rows[0].autonomy.text).toBe('non critica');

    const empty = resourceOperatingPicture({ balance: [row('clothing', 0, 0, 0)] });
    expect(empty.rows[0].autonomy.text).toBe('dato non disponibile');

    const missing = resourceOperatingPicture(null);
    expect(missing.rows).toEqual([]);
    expect(missing.status).toBe('pressure');
    expect(missing.headline).toContain('non pubblica');
    expect(missing.drivers[0].label).toContain('non pubblicato');
  });

  it('il carburante è la voce che decide la prontezza: sempre in evidenza', () => {
    const picture = resourceOperatingPicture({ balance: [row('fuel', 90, 20, 25)], needs: { fuel: 25 } as any });
    expect(picture.fuel?.id).toBe('fuel');
    expect(picture.drivers.some(driver => driver.label.startsWith('Carburante'))).toBe(true);
  });

  it('risorse naturali: riserva, estrazione ed esaurimento', () => {
    const picture = resourceOperatingPicture({
      balance: [row('fuel', 50, 10, 10)],
      natural: [
        { kind: 'oil', label: 'Petrolio', renewable: false, endowment: 4, reserve: 100, maxReserve: 120, stockpile: 30, extractionPerMonth: 6, depletionPct: 22, depleted: false },
        { kind: 'timber', label: 'Legname', renewable: true, endowment: 3, reserve: 2, maxReserve: 40, stockpile: 4, extractionPerMonth: 1, depletionPct: 96, depleted: true },
      ] as any,
    });
    expect(picture.natural).toHaveLength(2);
    expect(picture.depletedNatural.map(node => node.id)).toEqual(['timber']);
    expect(picture.drivers.some(driver => driver.label.includes('giacimenti in esaurimento'))).toBe(true);
  });

  it('etichette: il motore fornisce il nome, il modulo non lo inventa', () => {
    const picture = resourceOperatingPicture({ balance: [row('food', 10, 5, 5)] });
    expect(picture.rows[0].label).toBe(LABELS.food);
  });
});
