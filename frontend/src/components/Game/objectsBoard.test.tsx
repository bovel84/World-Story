/**
 * OP-OBJECTS — sala di governo: superficie di presentazione.
 * Verifica che la vista mostri le schede di settore, che la navigazione porti
 * agli oggetti concreti, che i paragrafi lunghi restino sotto «Perché?» e che
 * il componente non parli mai con il motore (nessuna chiamata, nessuna regola).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObjectsBoard } from './ObjectsBoard';
import type { ArsenalResponse, OperatingPicturePayload } from '../../services/api';

const source = fs.readFileSync(path.resolve(__dirname, 'ObjectsBoard.tsx'), 'utf8');

const fact = (section: any, label: string, value: number | null, unit: any, tone?: any, text?: string) =>
  ({ section, label, value, unit, tone: tone ?? 'neutral', ...(text ? { text } : {}) });

const picture: OperatingPicturePayload = {
  counts: { force: 1, army: 2, facility: 2, construction: 1 },
  conventions: ['Le armate derivano dagli oggetti `army` della mappa.'],
  chains: [
    {
      id: 'steel', label: 'Minerali → acciaio → armamenti',
      steps: [{ label: 'Minerali ferrosi', value: 12, unit: 'per_mese', tone: 'positive' }, { label: 'Armamenti', value: 0, unit: 'per_mese', tone: 'critical' }],
      broken: true, summary: 'La filiera si rompe a valle.',
    },
  ],
  objects: [
    {
      id: 'force', kind: 'force', label: 'Forze armate', subtitle: '8 reparti · 96.000 uomini in armi',
      status: 'degraded', statusLabel: 'Ridotta', parentId: null,
      facts: [fact('personale', 'Uomini in armi', 96_000, 'numero'), fact('capacita', 'Prontezza', 64, 'pct', 'warning')],
      problems: [{ severity: 'critical', label: 'Copertura armi individuali 77,8%' }],
      actions: [{ id: 'raise_formation', label: 'Crea 1 reparto', enabled: true, blockedReason: null }],
      why: 'Il piano dei reparti è quello del motore: nessuna stima.',
    },
    {
      id: 'army-A', kind: 'army', label: '1ª Armata', subtitle: 'Dislocata in Italia',
      status: 'degraded', statusLabel: 'Ridotta', parentId: 'force', regionId: 'ita', regionName: 'Italia',
      facts: [fact('stato', 'Reparti', 5, 'numero')], problems: [],
      actions: [{ id: 'raise_formation', label: 'Aggiungi 1 reparto a questa armata', enabled: false, blockedReason: 'Servono 3.200 fucili in più.' }],
      why: 'Armata reale del mondo.',
    },
    {
      id: 'factory-1', kind: 'facility', label: 'Acciaierie Italia', subtitle: 'Impianto industriale',
      status: 'operational', statusLabel: 'Operativo', parentId: null,
      facts: [fact('stato', 'Linee di lavorazione', 4, 'numero'), fact('output', 'Armamenti', 0.055, 'per_mese')],
      problems: [], actions: [{ id: 'procure', label: 'Avvia una produzione militare', enabled: true, blockedReason: null }],
      why: 'Impianto derivato dal profilo industriale.',
    },
    {
      id: 'construction-1', kind: 'construction', label: 'Ferrovia del Sud', subtitle: 'Cantiere in Italia',
      status: 'under_construction', statusLabel: 'In costruzione', parentId: null,
      facts: [fact('stato', 'Avanzamento', 42.5, 'pct')], problems: [], actions: [],
      why: 'Un\'opera in costruzione non produce nulla.',
    },
  ],
};

const arsenal = {
  objects: picture,
  industrialCapacity: { total: 38, used: 26, free: 12, utilizationPct: 68.4, demand: 26, satisfactionPct: 100, overflowFactor: 1, saturated: false, blocked: false, allocations: [], byKind: {}, defenceSharePct: 60, totalBasis: '' },
  capacity: { factories: 9, ports: 2, universities: 2, money: 120, weapons: 400, credit: 900, technologies: [] },
  epochLabel: 'Era moderna',
} as unknown as ArsenalResponse;

const html = renderToStaticMarkup(
  <ObjectsBoard
    arsenal={arsenal}
    onPreviewFormation={async () => { throw new Error('non deve essere chiamato in SSR'); }}
    onRaiseFormation={async () => undefined}
  />,
);

describe('OP-OBJECTS — sala di governo (SSR)', () => {
  it('apre sul livello A: le schede di settore con i numeri che contano', () => {
    expect(html).toContain('Forze armate');
    expect(html).toContain('Industria');
    expect(html).toContain('8 reparti · 96.000 uomini in armi');
    expect(html).toContain('96.000');
    expect(html).toContain('64%');
    expect(html).toContain('Linee totali');
    expect(html).toContain('1 impianto · 1 cantiere');
    // La marina non esiste in questo quadro: nessuna scheda inventata.
    expect(html).not.toContain('>Marina<');
  });

  it('mostra i problemi aperti sulle schede di settore', () => {
    expect(html).toContain('Copertura armi individuali 77,8%');
    expect(html).toContain('Apri');
  });

  it('riduce il testo: nessun paragrafo lungo nella vista principale', () => {
    // Le spiegazioni degli oggetti vivono solo dentro «Perché?»: da chiusi non
    // compaiono affatto, quindi la prima schermata è fatta di numeri.
    expect(html).not.toContain('Il piano dei reparti è quello del motore');
    expect(html).not.toContain('Impianto derivato dal profilo industriale');
    // Il meccanismo esiste nel componente e si apre sul singolo oggetto.
    expect(source).toContain('Perché?');
    const visibleFacts = (html.match(/<dd>/g) || []).length;
    expect(visibleFacts).toBeGreaterThan(4);
  });

  it('porta le catene e le convenzioni dichiarate dal motore', () => {
    expect(html).toContain('Catene e convenzioni');
    expect(html).toContain('Minerali → acciaio → armamenti');
    expect(html).toContain('Le armate derivano dagli oggetti `army` della mappa.');
  });

  it('è una superficie di sola presentazione: nessuna chiamata al motore', () => {
    expect(source).not.toContain('gameApi.');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('useEffect');
    // Le azioni arrivano dal payload del motore, non da soglie della UI.
    expect(source).toContain('actionsOf');
  });
});
