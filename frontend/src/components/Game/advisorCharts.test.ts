/**
 * World Story — C01: i grafici del Consulente
 * ==========================================
 * La regola che questi test difendono è una sola, ed è la più importante di
 * tutte: **il modello sceglie cosa mostrare, mai le cifre.** Un grafico disegnato
 * con numeri del modello sarebbe una figura verosimile e falsa — il difetto
 * peggiore possibile, perché *sembra* un dato.
 *
 * Il blocco del modello porta solo un tipo (`[[chart: bilancio]]`); ogni numero
 * viene dai read model del motore e della mappa.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHART_KINDS, availableKinds, budgetChart, chartFor, chartScale, resourceChart, territoryChart, trendChart,
} from './advisorCharts';
import { parseBlocks } from './richTextModel';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const REGIONS = [
  { id: 'r1', name: 'Lombardia', owner: 'ITA', gdp: 210, population: 10 },
  { id: 'r2', name: 'Sicilia', owner: 'ITA', gdp: 42, population: 5 },
  { id: 'r3', name: 'Alsazia', owner: 'FRA', gdp: 999, population: 2 },
] as any[];

const BUDGET = {
  expense: [
    { id: 'administration', label: 'Amministrazione pubblica', amount: 26 },
    { id: 'health', label: 'Sanità e assistenza', amount: 18 },
    { id: 'defence', label: 'Difesa', amount: 12 },
    { id: 'education', label: 'Istruzione e ricerca', amount: 9 },
  ],
} as any;

const HISTORY = [
  { date: '1951-01-01', account: { money: 10 } },
  { date: '1951-02-01', account: { money: 13 } },
  { date: '1951-03-01', account: { money: 11 } },
] as any[];

describe('C01 — il blocco grafico nel testo del Consulente', () => {
  it('riconosce il blocco e ne legge il tipo', () => {
    const blocks = parseBlocks('Prima.\n\n[[chart: bilancio]]\n\nDopo.');
    expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'chart', 'paragraph']);
    const chart = blocks[1];
    expect(chart.kind === 'chart' && chart.chartKind).toBe('bilancio');
  });

  it('il blocco non porta cifre: solo il tipo', () => {
    // La sintassi è `[[chart: tipo]]`. Se il modello scrivesse dei numeri dentro,
    // il blocco non sarebbe riconosciuto — ed è voluto: le cifre non si chiedono.
    const blocks = parseBlocks('[[chart: bilancio 12 mld]]');
    expect(blocks.some(block => block.kind === 'chart')).toBe(false);
  });

  it('un tipo ignoto resta testo, non diventa un grafico', () => {
    expect(chartFor('inventato', {})).toBeNull();
    expect(chartFor('', {})).toBeNull();
    expect(chartFor('BILANCIO', { budget: BUDGET })).not.toBeNull();
  });
});

describe('C01 — i dati vengono dal motore, mai dal modello', () => {
  it('il territorio mostra solo le province del giocatore, per prodotto', () => {
    const figure = territoryChart({ regions: REGIONS, playerPolityId: 'ITA' });
    expect(figure.bars.map(bar => bar.label)).toEqual(['Lombardia', 'Sicilia']);
    // La provincia straniera non entra: il grafico è del paese del giocatore.
    expect(figure.bars.some(bar => bar.label === 'Alsazia')).toBe(false);
    // La barra più alta è la prima.
    expect(figure.bars[0].value).toBeGreaterThanOrEqual(figure.bars[1].value);
    expect(figure.unit).toBeTruthy();
  });

  it('il bilancio ordina le uscite e segna civili e difesa', () => {
    const figure = budgetChart({ budget: BUDGET });
    expect(figure.bars.map(bar => bar.label)).toEqual([
      'Amministrazione pubblica', 'Sanità e assistenza', 'Difesa', 'Istruzione e ricerca',
    ]);
    const tone = (label: string) => figure.bars.find(bar => bar.label === label)?.tone;
    expect(tone('Sanità e assistenza')).toBe('positive');
    expect(tone('Istruzione e ricerca')).toBe('positive');
    expect(tone('Difesa')).toBe('warning');
    expect(figure.unit).toBe('uscita mensile (mld)');
  });

  it('le risorse sommano le quantità note, e senza quelle contano i siti', () => {
    const figure = resourceChart({
      resourceSites: [
        { resourceName: 'Carbone', regionId: 'r1', knownQuantity: { baseUnits: '120' } },
        { resourceName: 'Carbone', regionId: 'r2', knownQuantity: { baseUnits: '80' } },
        { resourceName: 'Ferro', regionId: 'r1', knownQuantity: { baseUnits: '30' } },
      ] as any[],
    });
    expect(figure.bars.map(bar => bar.label)).toEqual(['Carbone', 'Ferro']);
    expect(figure.bars[0].value).toBe(200);

    // Senza quantità note, il grafico dichiara di contare i siti produttivi.
    const fallback = resourceChart({
      facilities: [
        { typeName: 'Acciaieria', regionId: 'r1', operational: true, polityId: 'ITA' },
        { typeName: 'Acciaieria', regionId: 'r2', operational: true, polityId: 'ITA' },
        { typeName: 'Porto', regionId: 'r1', operational: true, polityId: 'ITA' },
      ] as any[],
    });
    expect(fallback.bars[0].label).toBe('Acciaieria');
    expect(fallback.note).toMatch(/siti produttivi/i);
    expect(fallback.unit).toBe('siti produttivi');
  });

  it('il trend sceglie la prima cifra disponibile e dichiara la variazione', () => {
    const figure = trendChart({ history: HISTORY });
    expect(figure.series?.label).toBe('Tesoreria');
    expect(figure.series?.points).toEqual([10, 13, 11]);
    // Da 10 a 11: +1,00, e la cassa che sale è un bene → positivo.
    expect(figure.series?.deltaText).toContain('+');
    expect(figure.series?.tone).toBe('positive');
  });

  it('senza due punti storici il trend non si disegna: meglio il testo', () => {
    expect(chartFor('trend', { history: [{ date: 'x', account: { money: 5 } }] as any[] })).toBeNull();
    expect(chartFor('trend', {})).toBeNull();
  });

  it('un grafico senza nulla da mostrare non si rende', () => {
    // Il contratto: meglio il testo del Consulente che una figura vuota.
    expect(chartFor('bilancio', { budget: null })).toBeNull();
    expect(chartFor('territorio', { regions: [] })).toBeNull();
    expect(chartFor('risorse', {})).toBeNull();
  });

  it('la scala non è mai zero (nessuna divisione per zero nel disegno)', () => {
    const figure = territoryChart({ regions: REGIONS, playerPolityId: 'ITA' });
    expect(chartScale(figure)).toBeGreaterThan(0);
    expect(chartScale({ kind: 'bilancio', title: '', note: '', bars: [] })).toBe(1);
  });

  it('dichiara quali grafici sono disponibili con i dati che ha', () => {
    const kinds = availableKinds({ regions: REGIONS, budget: BUDGET, history: HISTORY, playerPolityId: 'ITA' });
    expect(kinds).toContain('territorio');
    expect(kinds).toContain('bilancio');
    expect(kinds).toContain('trend');
    // Con dati vuoti non ne è disponibile nessuno.
    expect(availableKinds({})).toEqual([]);
    // E i tipi sono quelli dichiarati, chiusi.
    expect(CHART_KINDS).toEqual(['territorio', 'bilancio', 'risorse', 'trend']);
  });
});

describe('C01 — la resa è sicura e non inventa', () => {
  const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('la figura non usa HTML grezzo', () => {
    const view = code('./AdvisorChart.tsx');
    expect(view).not.toMatch(/dangerouslySetInnerHTML/);
    expect(view).not.toMatch(/innerHTML/);
  });

  it('senza dati il blocco sparisce: non si disegna una figura vuota', () => {
    const view = code('./RichText.tsx');
    expect(view).toMatch(/chartFor\(block\.chartKind, chartData\)/);
    // Il ramo che rende: `figure ? <AdvisorChart …/> : null`.
    expect(view).toMatch(/figure \? <AdvisorChart[^>]*\/> : null/);
  });

  it('il modulo dei grafici non contiene cifre scritte a mano', () => {
    // Le soglie di tono sono ammesse; i valori no. Nessun importo, nessuna
    // quantità: tutto arriva dagli ingressi.
    const model = code('./advisorCharts.ts');
    expect(model).not.toMatch(/\b\d{3,}\b\s*(mld|mln)/i);
    expect(model).toMatch(/input\.budget|input\.regions|input\.resources|input\.history|input\.resourceSites/);
  });

  it('il disegno è SVG nativo: nessuna libreria di grafici introdotta', () => {
    const view = read('./AdvisorChart.tsx');
    expect(view).toMatch(/<svg/);
    expect(view).toMatch(/viewBox="0 0 100 28"/);
    // Guardia: nessuna dipendenza di charting nel componente.
    expect(view).not.toMatch(/from 'recharts'|from 'chart\.js'/);
  });
});
