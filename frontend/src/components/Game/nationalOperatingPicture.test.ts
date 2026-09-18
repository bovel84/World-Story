/**
 * COUNTRY-CLARITY — sala operativa: composizione dei cinque domini, risposte
 * brevi, priorità delle attenzioni, compatibilità fra scenari.
 */
import { describe, it, expect } from 'vitest';
import { nationalOperatingPicture, type OperatingPictureInput } from './nationalOperatingPicture';
import { worstStatus, DOMAIN_STATUS_LABEL } from './domainStatus';
import type { ArsenalLine, Commitment, GovernmentFaction } from '../../services/api';
function line(name: string, category: string, domain: string, quantity: number): ArsenalLine {
  return { id: name.toLowerCase().replace(/\W+/g, '_'), name, category, domain, quantity, quality: 60, tier: 'moderno', combatFactor: 1 } as unknown as ArsenalLine;
}

const FACTIONS: GovernmentFaction[] = [
  { id: 'ind', name: 'Industriali', interest: 'profitto', powerPct: 40, satisfaction: 78, stance: 'alleato', pressure: 12, demand: null as any, footprint: '' },
  { id: 'naz', name: 'Nazionalisti', interest: 'onore', powerPct: 30, satisfaction: 34, stance: 'critico', pressure: 55, demand: null as any, footprint: '' },
] as GovernmentFaction[];

function modernInput(overrides: Partial<OperatingPictureInput> = {}): OperatingPictureInput {
  return {
    account: {
      forces: 12, mobilized: 4, population: 60_000_000, stability: 58, socialTension: 38, factories: 14, ports: 6, universities: 5,
      monthlyRevenue: 42, monthlyExpenses: 44, monthlyBalance: -2, nominalGdpUsdBillions: 900,
    },
    resources: {
      money: 30, debt: 620, debtRatioPct: 69, annualInterest: 22, weapons: 900, fuel: 180, food: 400,
      needs: { weapons: 12, fuel: 60, food: 90 } as any,
      balance: [
        { kind: 'food', stock: 400, capacity: 900, productionPerMonth: 95, consumptionPerMonth: 90, balancePerMonth: 5, spoiledPerMonth: 0 },
        { kind: 'weapons', stock: 900, capacity: 2000, productionPerMonth: 10, consumptionPerMonth: 12, balancePerMonth: -2, spoiledPerMonth: 0 },
        { kind: 'fuel', stock: 180, capacity: 600, productionPerMonth: 40, consumptionPerMonth: 60, balancePerMonth: -20, spoiledPerMonth: 0 },
      ],
      natural: [{ kind: 'oil', label: 'Petrolio', renewable: false, endowment: 4, reserve: 90, maxReserve: 120, stockpile: 20, extractionPerMonth: 5, depletionPct: 12, depleted: false }] as any,
    },
    arsenal: {
      lines: [line('Fucili d’ordinanza', 'Fanteria', 'terra', 480), line('Artiglieria da campagna', 'Artiglieria', 'terra', 6)],
      qualityIndex: 58, combatFactor: 1.05, effectiveMilitaryPower: 8000, baseMilitaryPower: 7600,
      catalog: [
        { id: 'fucili', name: 'Fucili d’ordinanza', domain: 'terra', category: 'Fanteria', quality: 55, tier: 'moderno', costMln: 40, weaponsCost: 1, role: '', description: '', specs: [], canBuild: true, canBuy: false, buildCostMln: 30, buyCostMln: null, reasons: [] },
        { id: 'caccia_5', name: 'Caccia di 5ª generazione', domain: 'aria', category: 'Aerei', quality: 82, tier: 'avanzato', costMln: 12000, weaponsCost: 30, role: '', description: '', specs: [], canBuild: false, canBuy: true, buildCostMln: null, buyCostMln: 24000, reasons: ['Tecnologia non disponibile'] },
      ] as any,
      units: { fucili: 200, caccia_5: 4 }, production: { orders: [], inProgress: 0 } as any,
    },
    assets: { capacityBase: { forces: 20 } },
    government: { factions: FACTIONS, dominantId: 'ind', angriestId: 'naz', cohesion: 55, pressureIndex: 44, trustIndex: 51, headline: 'Governo in equilibrio', resentful: [], budget: {} as any, debt: { ratioPct: 69, servicePct: 8 } } as any,
    commitments: { commitments: [{ id: 'c1', status: 'fulfilled' }, { id: 'c2', status: 'active', deadline: '2026-04-20' }] as unknown as Commitment[], attention: [] },
    processes: [{ id: 'p1', title: 'Metropolitana', summary: '', started_date: '2026-01-01', expected_date: '2027-01-01', progress: 30, progress_note: '' }] as any,
    maintenance: [{ facilityId: 'f1', typeName: 'Acciaieria', operational: true, sufficient: false, resourceId: 'coal', shortfall: '8' }],
    today: '2026-04-01',
    ...overrides,
  };
}

describe('COUNTRY-CLARITY · sala operativa nazionale', () => {
  it('compone i cinque domini nello stesso ordine del modello mentale', () => {
    const picture = nationalOperatingPicture(modernInput());
    expect(picture.domains.map(domain => domain.id)).toEqual(['economia', 'risorse', 'industria', 'militare', 'governo']);
    expect(picture.status).toBe(worstStatus(picture.domains.map(domain => domain.status)));
    expect(picture.summary).toContain(DOMAIN_STATUS_LABEL[picture.status]);
    expect(picture.domains.every(domain => domain.facts.length === 4)).toBe(true);
    expect(picture.domains.every(domain => domain.headline.length > 0)).toBe(true);
    expect(picture.attention.length).toBeGreaterThan(0);
    expect(picture.attention.length).toBeLessThanOrEqual(5);
    expect(new Set(picture.attention.map(item => item.label)).size).toBe(picture.attention.length);
  });

  it('ogni dominio espone le 10 risposte del modello mentale, tutte piene', () => {
    const picture = nationalOperatingPicture(modernInput());
    expect(picture.answers.map(answer => answer.id)).toEqual([
      'situazione', 'problema', 'manpower', 'mobilitati', 'equipaggiamenti', 'sufficienza',
      'carburante', 'operazioni', 'fabbriche', 'capacita', 'produzione-interna', 'importazioni',
      'economia', 'debito', 'sostegno', 'opposizione', 'progetti', 'promesse',
    ]);
    for (const answer of picture.answers) {
      expect(answer.question.endsWith('?') || answer.id === 'problema').toBe(true);
      expect(answer.answer.length).toBeGreaterThan(0);
      expect(['positive', 'neutral', 'warning', 'critical']).toContain(answer.tone);
    }
  });

  it('le risposte chiave citano i numeri del motore', () => {
    const picture = nationalOperatingPicture(modernInput());
    const answer = (id: string) => picture.answers.find(item => item.id === id)!.answer;
    const detail = (id: string) => picture.answers.find(item => item.id === id)!.detail ?? '';
    expect(answer('situazione')).toBe(DOMAIN_STATUS_LABEL[picture.status]);
    expect(answer('problema')).toBe(picture.attention[0].label);
    expect(answer('manpower')).toContain('16 reparti sotto le armi');
    expect(detail('manpower')).toContain('12 in servizio permanente');
    expect(detail('manpower')).toContain('Il motore conta reparti, non teste');
    expect(answer('mobilitati')).toContain('4 reparti');
    expect(answer('equipaggiamenti')).toContain('2 categorie in servizio');
    expect(answer('sufficienza')).toMatch(/Copertura più debole: \d+/);
    expect(answer('carburante')).toBe(picture.resources.fuel?.autonomy.text);
    expect(answer('operazioni')).toMatch(/Prontezza \d+%/);
    expect(answer('fabbriche')).toContain('su 14 stabilimenti');
    expect(answer('capacita')).toBe(`${Math.round(picture.industry.usedPct)}%`);
    expect(answer('produzione-interna')).toContain('1 sistemi producibili');
    expect(answer('importazioni')).toContain('1 sistemi solo dall’estero');
    expect(answer('economia')).toContain('DISAVANZO');
    expect(answer('debito')).toContain('620');
    expect(answer('sostegno')).toContain('Industriali');
    expect(answer('opposizione')).toContain('Nazionalisti');
    expect(answer('progetti')).toContain('1 progetti attivi');
    expect(answer('promesse')).toContain('1 mantenute');
  });

  it('gli ordini di produzione e i blocchi industriali arrivano fino alle risposte', () => {
    const picture = nationalOperatingPicture(modernInput({
      arsenal: {
        ...modernInput().arsenal,
        production: {
          orders: [{ id: 'o1', equipmentId: 'fucili', name: 'Fucili d’ordinanza', domain: 'terra', quantity: 100, progress: 0, spentMln: 0, startedTurn: 1, startedDate: '2026-01-01', expectedDate: '2026-05-01', status: 'in_progress', note: '', qualityLoss: 0, updatedDate: '2026-01-10' }] as any,
          inProgress: 1,
        } as any,
      },
    }));
    expect(picture.industry.capacityUsed).toBe(3); // ordine + progetto + manutenzione
    expect(picture.answers.find(item => item.id === 'produzione-interna')?.detail).toContain('In costruzione adesso');
    expect(picture.answers.find(item => item.id === 'progetti')?.detail).toContain('Acciaieria');
    expect(picture.industry.assignments.map(item => item.kind)).toContain('produzione');
    expect(picture.industry.assignments.map(item => item.kind)).toContain('manutenzione');
    expect(picture.industry.assignments.map(item => item.kind)).toContain('progetto');
  });

  it('dati mancanti: la sala operativa lo dichiara, non riempie i vuoti', () => {
    const picture = nationalOperatingPicture({});
    expect(picture.status).toBe('critical');
    expect(picture.answers).toHaveLength(17); // senza manpower la risposta «mobilitati» non esiste
    expect(picture.answers.find(item => item.id === 'manpower')?.answer).toBe('Dato non pubblicato');
    expect(picture.answers.find(item => item.id === 'equipaggiamenti')?.answer).toBe('Nessun equipaggiamento in servizio');
    expect(picture.answers.find(item => item.id === 'carburante')?.answer).toBe('Dato non pubblicato');
    expect(picture.answers.find(item => item.id === 'fabbriche')?.answer).toBe('Nessuna lavorazione attiva');
    expect(picture.answers.find(item => item.id === 'debito')?.answer).toBe('Nessun debito pubblico');
    expect(picture.answers.find(item => item.id === 'sostegno')?.answer).toBe('Nessuna fazione pubblicata');
    expect(picture.headline.length).toBeGreaterThan(0);
  });

  it('scenario 1815: nessun numero moderno richiesto, nessuna risposta inventata', () => {
    const picture = nationalOperatingPicture({
      account: { forces: 40, mobilized: 0, population: 20_000_000, stability: 62, socialTension: 20, factories: 3, ports: 1, universities: 0, monthlyRevenue: 1.2, monthlyExpenses: 1.4, monthlyBalance: -0.2, nominalGdpUsdBillions: 24 },
      resources: { money: 2, debt: 0, weapons: 500, food: 100, needs: { weapons: 4, food: 30 } as any, balance: [{ kind: 'food', stock: 100, capacity: 200, productionPerMonth: 28, consumptionPerMonth: 30, balancePerMonth: -2, spoiledPerMonth: 0 }] },
      arsenal: { lines: [line('Fucili a miccia', 'Fanteria', 'terra', 1600)], qualityIndex: 24, catalog: [] },
      today: '1815-06-01',
    });
    expect(picture.domains.find(domain => domain.id === 'economia')?.facts[0].value).toBe('24 mld');
    expect(picture.answers.find(item => item.id === 'manpower')?.answer).toBe('40 reparti sotto le armi');
    expect(picture.answers.find(item => item.id === 'importazioni')?.answer).toBe('Nessuna dipendenza obbligata');
    expect(picture.answers.find(item => item.id === 'sostegno')?.answer).toBe('Nessuna fazione pubblicata');
    expect(picture.answers.find(item => item.id === 'progetti')?.answer).toBe('Nessun progetto in corso');
    expect(picture.military.coverage.find(row => row.id === 'individualWeapons')?.pct).toBe(100);
    expect(picture.industry.capacityTotal).toBe(3);
  });

  it('scenario 1936/1989 senza catalogo moderno: il catalogo vuoto non genera dipendenze', () => {
    const picture = nationalOperatingPicture(modernInput({
      government: null,
      commitments: null,
      processes: null,
      arsenal: { ...modernInput().arsenal, catalog: [] },
      resources: { ...modernInput().resources, natural: undefined as any, balance: [] },
    }));
    expect(picture.answers.find(item => item.id === 'importazioni')?.answer).toBe('Nessuna dipendenza obbligata');
    expect(picture.answers.find(item => item.id === 'produzione-interna')?.answer).toBe('Nessun sistema producibile');
    expect(picture.answers.find(item => item.id === 'sostegno')?.answer).toBe('Nessuna fazione pubblicata');
    expect(picture.resources.rows).toEqual([]);
    expect(picture.resources.status).toBe('pressure');
  });

  it('valori a zero non diventano «dato mancante»', () => {
    const picture = nationalOperatingPicture({
      account: { forces: 0, mobilized: 0, population: 0, factories: 0, monthlyBalance: 0 },
      resources: { money: 0, debt: 0, weapons: 0, fuel: 0, needs: { weapons: 0, fuel: 0 } as any, balance: [{ kind: 'fuel', stock: 0, capacity: 0, productionPerMonth: 0, consumptionPerMonth: 0, balancePerMonth: 0, spoiledPerMonth: 0 }] },
    });
    expect(picture.answers.find(item => item.id === 'debito')?.answer).toBe('Nessun debito pubblico');
    expect(picture.answers.find(item => item.id === 'carburante')?.answer).toBe('dato non disponibile');
    expect(picture.industry.usedPct).toBe(0);
    expect(picture.military.manpower?.standing).toBe(0);
    expect(picture.answers.find(item => item.id === 'manpower')?.answer).toBe('0 reparti sotto le armi');
  });
});
