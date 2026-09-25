/**
 * World Story — M01/M02: il popolo e le occasioni
 * ===============================================
 * La diagnosi: il dossier leggeva il paese come una macchina da guerra. La scheda
 * «Armamenti» ha 8 blocchi — il massimo di ogni scheda — la dimensione civile una
 * metrica, e il quadro d'insieme cinque aree senza una per la qualità della vita.
 * Le due correzioni misurate qui:
 *
 *  - **M01**: un'area «Popolo» che legge le voci civili che il motore *già*
 *    pubblica (`socialBurdenPct`, `educationBurdenPct`, atenei, ricerca, PIL pro
 *    capite, tensione, stabilità);
 *  - **M02**: la sintesi mostra anche le **occasioni**, senza che queste scalzino
 *    mai un'urgenza.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CIVIL_SPENDING_THRESHOLDS, peopleOperatingPicture } from './peopleOperatingPicture';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationalSynthesis } from './nationalSynthesis';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

/** Un paese con un bilancio civile ricco: istruzione e sanità pesano. */
const CIVIL_WEALTHY = {
  account: { stability: 62, socialTension: 18, universities: 12, population: 40_000_000, gdpPerCapitaUsd: 21_000 },
  resources: { research: 45, technologies: ['industria_tessile', 'elettronica'] },
  budget: { socialBurdenPct: 7.2, educationBurdenPct: 3.4, defenceBurdenPct: 3.1 },
};

/** Un paese che spende per le armi e non per il popolo. */
const GARRISON = {
  account: { stability: 44, socialTension: 61, universities: 0, population: 12_000_000, gdpPerCapitaUsd: 4_000 },
  resources: { research: 0, technologies: [] },
  budget: { socialBurdenPct: 1.1, educationBurdenPct: 0.6, defenceBurdenPct: 12.4 },
};

describe('M01 — l\'area «Popolo» legge la dimensione civile', () => {
  it('somma le voci civili e calcola la quota che va al popolo, non alle armi', () => {
    const people = peopleOperatingPicture(CIVIL_WEALTHY);
    expect(people.socialBurdenPct).toBe(7.2);
    expect(people.educationBurdenPct).toBe(3.4);
    // 10,6 civile su (10,6 + 3,1) = 77,4% → il civile domina la spesa dichiarata.
    expect(people.civilianShareOfSpendingPct).toBeCloseTo(77.4, 1);
    expect(people.status).toBe('healthy');
  });

  it('un paese che arma e non cura ha lo stato del punto debole', () => {
    const people = peopleOperatingPicture(GARRISON);
    expect(people.socialBurdenPct).toBe(1.1);
    // 1,7 civile su (1,7 + 12,4) = 12,1%.
    expect(people.civilianShareOfSpendingPct).toBeCloseTo(12.1, 1);
    // Tensione 61 → fragile, e la spesa civile sotto la soglia «sottile».
    expect(people.status).toBe('fragile');
    const labels = people.drivers.map(driver => driver.label).join(' | ');
    // Guardia sul **contenuto**: la spesa civile è dichiarata e la quota che va
    // al popolo è resa esplicita, con la difesa accanto.
    expect(labels).toMatch(/spesa civile/i);
    expect(labels).toMatch(/va al civile/i);  });

  it('dichiara l\'assenza quando il motore non pubblica le voci civili', () => {
    const people = peopleOperatingPicture({ account: { stability: 50 }, resources: {}, budget: null });
    expect(people.socialBurdenPct).toBeNull();
    expect(people.educationBurdenPct).toBeNull();
    // Il rapporto non è calcolabile: `null`, mai un numero inventato.
    expect(people.civilianShareOfSpendingPct).toBeNull();
    // Con una sola cifra nota, l'area mostra quella e **non** inventa le altre:
    // nessun driver afferma una spesa civile che il motore non ha pubblicato.
    const labels = people.drivers.map(driver => driver.label).join(' | ');
    expect(labels).not.toMatch(/spesa civile/i);
    expect(labels).toMatch(/stabilità/i);
  });

  it('senza alcun dato sociale dichiara l\'assenza invece di inventare', () => {
    const people = peopleOperatingPicture({ account: {}, resources: {}, budget: null });
    expect(people.drivers.some(driver => /non pubblicat|non pubblicalt/i.test(driver.label))).toBe(true);
  });

  it('senza atenei lo dice, e senza ricerca pure', () => {
    const people = peopleOperatingPicture(GARRISON);
    const labels = people.drivers.map(driver => driver.label).join(' | ');
    expect(labels).toContain('Nessun ateneo');
    expect(people.universities).toBe(0);
  });

  it('le soglie della spesa civile sono dichiarate e ordinate', () => {
    expect(CIVIL_SPENDING_THRESHOLDS.thin).toBeLessThan(CIVIL_SPENDING_THRESHOLDS.substantial);
    expect(CIVIL_SPENDING_THRESHOLDS.substantial).toBeLessThan(CIVIL_SPENDING_THRESHOLDS.leading);
  });

  it('«Popolo» è un\'area del quadro d\'insieme, non una scheda a parte', () => {
    const picture = nationalOperatingPicture({ ...CIVIL_WEALTHY, today: '1951-01-01' });
    const ids = picture.domains.map(domain => domain.id);
    expect(ids).toContain('popolo');
    // Guardia contro il falso verde: le aree restano sei, nessuna persa.
    expect(ids).toEqual(['economia', 'risorse', 'industria', 'militare', 'popolo', 'governo']);
    // E porta cifre proprie, non vuote.
    const popolo = picture.domains.find(domain => domain.id === 'popolo');
    expect(popolo?.facts.length).toBe(4);
    expect(popolo?.facts.every(fact => fact.value !== '—')).toBe(true);
  });
});

describe('M02 — la sintesi mostra le occasioni, senza nascondere le urgenze', () => {
  it('un paese in pace con margini riceve occasioni di sviluppo', () => {
    const picture = nationalOperatingPicture({
      ...CIVIL_WEALTHY,
      account: { ...CIVIL_WEALTHY.account, monthlyBalance: 2.4 },
      today: '1951-01-01',
    });
    const synthesis = nationalSynthesis({ picture, today: '1951-01-01' });
    const opportunities = synthesis.items.filter(item => item.opportunity);
    expect(opportunities.length).toBeGreaterThan(0);
    // Ogni occasione ha un'azione concreta, non un invito generico.
    expect(opportunities.every(item => item.action.length > 10)).toBe(true);
    expect(opportunities.every(item => item.source === 'occasione')).toBe(true);
  });

  it('le occasioni vengono DOPO ogni urgenza, sempre', () => {
    const picture = nationalOperatingPicture({
      ...GARRISON,
      account: { ...GARRISON.account, monthlyBalance: 1.2 },
      today: '1951-01-01',
    });
    const synthesis = nationalSynthesis({
      picture,
      pressures: [{ id: 'p1', title: 'Sciopero generale', status: 'active', kind: 'internal', severity: 80, createdDate: '1951-01-01', options: [] } as any],
      today: '1951-01-01',
    });
    const ranks = synthesis.items.map(item => item.rank);
    const firstOpportunity = ranks.findIndex((_, index) => synthesis.items[index].opportunity);
    const lastUrgent = ranks.reduce((last, rank, index) => (synthesis.items[index].opportunity ? last : index), -1);
    expect(firstOpportunity).toBeGreaterThan(lastUrgent);
  });

  it('con una crisi attiva, la crisi resta in testa e l\'occasione scende', () => {
    const picture = nationalOperatingPicture({
      ...CIVIL_WEALTHY,
      account: { ...CIVIL_WEALTHY.account, monthlyBalance: 3 },
      today: '1951-01-01',
    });
    const synthesis = nationalSynthesis({
      picture,
      crisis: { state: { risks: [{ dimension: 'revolt', level: 'critical', title: 'Rivolta in corso' }], criticalDays: { revolt: 3 }, collapseDays: 1 } } as any,
      today: '1951-01-01',
    });
    expect(synthesis.items[0].source).toBe('crisi');
    expect(synthesis.items[synthesis.items.length - 1].opportunity).toBe(true);
  });

  it('senza occasione il blocco non compare: nessun riempitivo', () => {
    // Paese saturo, in disavanzo, senza ricerca, con atenei e spesa civile alta:
    // non c'è nulla da suggerire, e la sintesi non inventa un'occasione.
    const picture = nationalOperatingPicture({
      account: { stability: 60, socialTension: 15, universities: 14, population: 40_000_000, gdpPerCapitaUsd: 22_000, monthlyBalance: -1.5 },
      resources: { research: 0, technologies: [] },
      budget: { socialBurdenPct: 8, educationBurdenPct: 5, defenceBurdenPct: 3 },
      today: '1951-01-01',
    });
    const synthesis = nationalSynthesis({ picture, today: '1951-01-01' });
    const kinds = synthesis.items.filter(item => item.opportunity).map(item => item.key);
    expect(kinds).toEqual([]);
  });

  it('la vista separa le occasioni: blocco distinto, dopo la lista', () => {
    const panel = read('./NationalSynthesisPanel.tsx');
    expect(panel).toMatch(/nation-synthesis-opportunities/);
    expect(panel).toMatch(/item\.opportunity/);
    // Le occasioni non entrano nella lista numerata delle urgenze.
    expect(panel).toMatch(/items\.filter\(item => !item\.opportunity\)/);
    // E l'etichetta della fonte esiste.
    expect(panel).toMatch(/occasione: 'Occasione'/);
  });
});
