/**
 * COUNTRY-CLARITY — Quadro d'insieme, superficie di presentazione.
 * Verifica che lo schermo unico mostri stato, attenzioni, cinque domini e la
 * sala operativa, e che non introduca nuove chiamate al motore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswersGrid, DomainCard, DomainOperatingBlock, OperatingPictureBoard } from './OperatingPictureBoard';
import { nationalOperatingPicture, type OperatingPictureInput } from './nationalOperatingPicture';

const dock = fs.readFileSync(path.resolve(__dirname, 'NationDock.tsx'), 'utf8');
const board = fs.readFileSync(path.resolve(__dirname, 'OperatingPictureBoard.tsx'), 'utf8');
const model = fs.readFileSync(path.resolve(__dirname, 'NationDock/useNationDockModel.ts'), 'utf8');

const input: OperatingPictureInput = {
  account: { forces: 8, mobilized: 2, stability: 52, socialTension: 44, factories: 9, ports: 3, universities: 2, monthlyRevenue: 30, monthlyExpenses: 33, monthlyBalance: -3, nominalGdpUsdBillions: 400 },
  resources: {
    money: 12, debt: 300, debtRatioPct: 75, annualInterest: 14, weapons: 320, fuel: 40, food: 200,
    needs: { weapons: 10, fuel: 40, food: 60 } as any,
    balance: [
      { kind: 'food', stock: 200, capacity: 400, productionPerMonth: 58, consumptionPerMonth: 60, balancePerMonth: -2, spoiledPerMonth: 0 },
      { kind: 'fuel', stock: 40, capacity: 200, productionPerMonth: 18, consumptionPerMonth: 40, balancePerMonth: -22, spoiledPerMonth: 0 },
    ],
  },
  // Dottrina e capacità industriale sono del motore: qui sono il contratto.
  arsenal: {
    epoch: 'moderno', epochLabel: 'Era moderna',
    establishment: [
      { category: 'individualWeapons', label: 'Armi individuali', perFormation: 40, perMobilized: 50, weight: 0.3, source: 'engine_seed', basis: 'Il singolo soldato è la base.' },
      { category: 'armoredMobility', label: 'Mobilità corazzata', perFormation: 1.5, perMobilized: 1.5, weight: 0.2, source: 'doctrine', basis: 'Manovra protetta.' },
    ],
    manpower: { population: 40_000_000, eligiblePopulation: 5_600_000, totalMilitaryPool: 5_600_000, activePersonnel: 96_000, reservePersonnel: 86_400, mobilizedPersonnel: 24_000, availableReserve: 62_400, formations: 8, mobilizedFormations: 2, menPerFormation: 12_000 },
    coverage: [
      { category: 'individualWeapons', label: 'Armi individuali', required: 420, available: 400, coveragePct: 95.2, missing: 20, items: ['Fucili ×400'], weight: 0.3 },
      { category: 'armoredMobility', label: 'Mobilità corazzata', required: 15, available: 0, coveragePct: 0, missing: 15, items: [], weight: 0.2 },
    ],
    readiness: { readinessPct: 64, status: 'pressure', drivers: [{ tone: 'critical', label: 'Copertura mobilità corazzata 0%', detail: '0 in servizio su 15.' }] },
    industrialCapacity: {
      total: 90, used: 12, free: 78, utilizationPct: 13.3, demand: 12, satisfactionPct: 100, overflowFactor: 1, saturated: false,
      allocations: [{ id: 'p1', kind: 'project', label: 'Metropolitana', capacityDemand: 12, sector: 'Infrastrutture e progetti', basis: 'Progetto di 9 mesi.' }],
      byKind: { military_production: 0, project: 12, maintenance: 0 }, defenceSharePct: 0, totalBasis: '9 fabbriche × 10 linee',
    },
    lines: [{ id: 'fucili', name: 'Fucili', category: 'Fanteria', domain: 'terra', quantity: 400, quality: 50, tier: 'moderno', combatFactor: 1 } as any],
    qualityIndex: 48, catalog: [{ id: 'caccia', name: 'Caccia', domain: 'aria', category: 'Aerei', canBuild: false, canBuy: true, buildCostMln: null, buyCostMln: 9000, reasons: ['Tecnologia non disponibile'], quality: 70, tier: 'moderno', costMln: 5000, weaponsCost: 10, role: '', description: '', specs: [] } as any],
    units: {}, production: { orders: [], inProgress: 0 } as any,
  },
  government: { factions: [{ id: 'a', name: 'Industriali', powerPct: 50, satisfaction: 40, stance: 'neutrale' } as any], dominantId: 'a', angriestId: 'a', cohesion: 40, pressureIndex: 60, trustIndex: 42, headline: 'Consiglio diviso', resentful: [], budget: {} as any, debt: { ratioPct: 75, servicePct: 9 } } as any,
  commitments: { commitments: [{ id: 'c1', status: 'active', deadline: '2026-04-15' } as any], attention: [] },
  today: '2026-04-01',
};

describe('COUNTRY-CLARITY · quadro d’insieme (presentazione)', () => {
  it('mostra stato complessivo, sintesi e attenzioni con il tono giusto', () => {
    const picture = nationalOperatingPicture(input);
    const html = renderToStaticMarkup(OperatingPictureBoard({ picture }));
    expect(html).toContain('Quadro d’insieme');
    expect(html).toContain(picture.headline);
    expect(html).toContain(picture.summary);
    expect(html).toContain('Da decidere per primo');
    expect(html).toContain(`op-verdict tone-${picture.status === 'critical' ? 'negative' : picture.status === 'fragile' || picture.status === 'pressure' ? 'warning' : picture.status === 'healthy' ? 'positive' : 'neutral'}`);
    expect(html).toContain(picture.attention[0].label);
    // Nessun dominio manca all'appello e ogni dominio porta le sue cifre.
    for (const domain of picture.domains) {
      expect(html).toContain(domain.label);
      expect(html).toContain(domain.facts[0].value);
    }
  });

  it('mostra la sala operativa: venti risposte, tutte visibili', () => {
    const picture = nationalOperatingPicture(input);
    const html = renderToStaticMarkup(AnswersGrid({ answers: picture.answers }));
    expect(picture.answers).toHaveLength(20);
    for (const answer of picture.answers) {
      expect(html).toContain(answer.question);
      expect(html).toContain(answer.answer);
    }
  });

  it('il pulsante di sezione porta al dettaglio giusto', () => {
    const picture = nationalOperatingPicture(input);
    const clicked: string[] = [];
    const html = renderToStaticMarkup(DomainCard({ domain: picture.domains[3], onOpenSection: (section) => clicked.push(section) }));
    expect(html).toContain(picture.domains[3].label);
    expect(html).toContain('Apri Armamenti');
    // Il blocco di sezione riusa la stessa card: un solo posto per i numeri.
    const section = renderToStaticMarkup(DomainOperatingBlock({ picture, id: 'economia' }));
    expect(section).toContain('Economia e cassa');
    expect(section).toContain(picture.economy.headline);
    expect(renderToStaticMarkup(DomainOperatingBlock({ picture, id: 'governo' }))).toContain('Governo e società');
  });

  it('le forze armate mostrano personale, copertura e prontezza del motore', () => {
    const picture = nationalOperatingPicture(input);
    const html = renderToStaticMarkup(DomainOperatingBlock({ picture, id: 'militare' }));
    expect(html).toContain('Dottrina d’epoca: Era moderna');
    expect(html).toContain('Personale');
    expect(html).toContain('Uomini in armi');
    expect(html).toContain('120.000'); // 96.000 attivi + 24.000 richiamati
    expect(html).toContain('Riserva addestrata');
    expect(html).toContain('Equipaggiamento — copertura per categoria');
    expect(html).toContain('Armi individuali');
    expect(html).toContain('mancano 20 pezzi');
    expect(html).toContain('Copertura mobilità corazzata 0%');
  });

  it('l’industria mostra stabilimenti, assegnazioni e capacità del motore', () => {
    const picture = nationalOperatingPicture(input);
    const html = renderToStaticMarkup(DomainOperatingBlock({ picture, id: 'industria' }));
    expect(html).toContain('Stabilimenti');
    expect(html).toContain('Linee di lavorazione');
    expect(html).toContain('Assegnazioni');
    expect(html).toContain('Metropolitana');
    expect(html).toContain('Infrastrutture e progetti');
    expect(html).toContain('9 fabbriche × 10 linee');
    // Fuori dalle lavorazioni attive non si parla di consegne.
    expect(html).not.toContain('Produzioni militari');
  });

  it('il Dossier apre con il quadro d’insieme e lo ripete in ogni sezione tematica', () => {
    expect(dock).toContain("active === 'situazione' && (");
    const situazione = dock.slice(dock.indexOf("active === 'situazione'"), dock.indexOf("active === 'governo'"));
    expect(situazione).toContain('<OperatingPictureBoard picture={operatingPicture} onOpenSection={openSection} />');
    for (const [id, section] of [['governo', 'governo'], ['economia', 'bilancio'], ['risorse', 'risorse'], ['industria', 'risorse'], ['militare', 'armamenti']] as const) {
      const start = dock.indexOf(`active === '${section}'`);
      const block = dock.slice(start, dock.indexOf("active === '", start + 10));
      expect(block).toContain(`picture={operatingPicture} id="${id}"`);
    }
    expect(dock).toContain('const openSection = (section: NationSection) => setState((prev) => setSection(prev, section));');
  });

  it('il quadro d’insieme non chiama il motore e non inventa serie', () => {
    // La derivazione vive nel modello del Dossier, sui dati già caricati.
    expect(model).toContain('nationalOperatingPicture({');
    expect(model).toContain('arsenal: arms');
    expect(board).not.toMatch(/fetch\(|api\.|http/);
    expect(board).not.toMatch(/useEffect|useState/);
    // Nessun numero casuale o stimato nella presentazione.
    expect(board).not.toMatch(/Math\.random|Date\.now/);
  });
});
