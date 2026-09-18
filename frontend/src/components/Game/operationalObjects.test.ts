/**
 * OP-OBJECTS — read model della sala di governo.
 * Verifica le sole responsabilità di presentazione: formattazione delle unità,
 * ordine della grammatica, aggregazione di settore (assente ≠ zero), vista
 * PRIMA → DOPO dell'azione. Nessun numero viene ricalcolato qui.
 */
import { describe, expect, it } from 'vitest';
import type { ArsenalResponse, FormationImpactPayload, OperatingPicturePayload } from '../../services/api';
import {
  childrenOf, factRows, factsByLabel, formatFactValue, formationActionView, formationOutcomeLine,
  kindCount, objectsOfKind, primaryProblem, sectorCards, sectionsOf, statusTone,
} from './operationalObjects';

const fact = (section: any, label: string, value: number | null, unit: any, tone?: any, text?: string) =>
  ({ section, label, value, unit, tone: tone ?? 'neutral', ...(text ? { text } : {}) });

const picture: OperatingPicturePayload = {
  counts: { force: 1, army: 2, facility: 2, construction: 1, mine: 1 },
  conventions: ['Le armate derivano dagli oggetti `army` della mappa.'],
  chains: [
    {
      id: 'steel',
      label: 'Minerali → acciaio → armamenti',
      steps: [
        { label: 'Minerali ferrosi', value: 12, unit: 'per_mese', tone: 'positive' },
        { label: 'Armamenti', value: 0, unit: 'per_mese', tone: 'critical' },
      ],
      broken: true,
      summary: 'La filiera si rompe a valle: manca acciaio.',
    },
  ],
  objects: [
    {
      id: 'force', kind: 'force', label: 'Forze armate', subtitle: '8 reparti · 96.000 uomini in armi',
      status: 'degraded', statusLabel: 'Ridotta', parentId: null,
      facts: [
        fact('personale', 'Uomini in armi', 96_000, 'numero'),
        fact('personale', 'Riserva addestrata', 86_400, 'numero'),
        fact('capacita', 'Prontezza', 64, 'pct', 'warning'),
        fact('costi', 'Spesa militare', 1.2345, 'mld'),
        fact('autonomia', 'Carburante (scorte)', 2.4, 'mesi', 'warning'),
      ],
      problems: [{ severity: 'critical', label: 'Copertura armi individuali 77,8%' }],
      actions: [{ id: 'raise_formation', label: 'Crea 1 reparto', enabled: true, blockedReason: null }],
      why: 'Il piano è quello del motore.',
    },
    {
      id: 'army-A', kind: 'army', label: '1ª Armata', subtitle: 'Dislocata in Italia',
      status: 'degraded', statusLabel: 'Ridotta', parentId: 'force', regionId: 'ita', regionName: 'Italia',
      facts: [fact('stato', 'Reparti', 5, 'numero'), fact('personale', 'Uomini', 60_000, 'numero')],
      problems: [],
      actions: [{ id: 'raise_formation', label: 'Aggiungi 1 reparto a questa armata', enabled: false, blockedReason: 'Servono 3.200 fucili in più.' }],
      why: 'Armata reale del mondo.',
    },
    {
      id: 'army-B', kind: 'army', label: '2ª Armata', subtitle: 'Dislocata in Italia',
      status: 'operational', statusLabel: 'Operativa', parentId: 'force', regionId: 'ita', regionName: 'Italia',
      facts: [fact('stato', 'Reparti', 3, 'numero')],
      problems: [],
      actions: [{ id: 'raise_formation', label: 'Aggiungi 1 reparto a questa armata', enabled: true, blockedReason: null }],
      why: 'Armata reale del mondo.',
    },
    {
      id: 'factory-1', kind: 'facility', label: 'Acciaierie Italia', subtitle: 'Impianto industriale',
      status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'ita', regionName: 'Italia',
      facts: [
        fact('stato', 'Linee di lavorazione', 4, 'numero'),
        fact('output', 'Armamenti', 0.055, 'per_mese'),
        fact('input', 'Minerali ferrosi', 0.02, 'per_mese'),
        fact('costi', 'Costo operativo', 0.004, 'mld'),
      ],
      problems: [{ severity: 'warning', label: 'Capacità satura (96%)' }],
      actions: [{ id: 'procure', label: 'Avvia una produzione militare', enabled: true, blockedReason: null }],
      why: 'Impianto derivato dal profilo industriale.',
    },
    {
      id: 'shipyard-1', kind: 'facility', label: 'Cantieri Napoli', subtitle: 'Cantiere navale e porto',
      status: 'idle', statusLabel: 'Fermo', parentId: null,
      facts: [fact('stato', 'Linee di lavorazione', 2, 'numero')],
      problems: [{ severity: 'critical', label: 'Impianto fermo: nessuna lavorazione' }],
      actions: [],
      why: 'I cantieri sono i porti del paese.',
    },
    {
      id: 'construction-1', kind: 'construction', label: 'Ferrovia del Sud', subtitle: 'Cantiere in Italia',
      status: 'under_construction', statusLabel: 'In costruzione', parentId: null,
      facts: [
        fact('stato', 'Avanzamento', 42.5, 'pct'),
        fact('autonomia', 'Mesi al completamento', 7, 'mesi'),
        fact('output', 'Beneficio', 0, 'numero'),
      ],
      problems: [],
      actions: [],
      why: 'Un\'opera in costruzione non produce nulla.',
    },
    {
      id: 'mine-iron', kind: 'mine', label: 'Miniera di ferro', subtitle: 'Giacimento 4/5 dal registro del paese',
      status: 'operational', statusLabel: 'Operativo', parentId: null,
      facts: [fact('stato', 'Giacimento', 4, 'numero'), fact('output', 'Minerali ferrosi', 12, 'per_mese')],
      problems: [],
      actions: [{ id: 'trade', label: 'Compra o vendi sul mercato', enabled: true, blockedReason: null }],
      why: 'Contributo del motore.',
    },
  ],
};

const impact: FormationImpactPayload = {
  plan: {
    men: 12_000,
    items: [
      { equipmentId: 'fucili', name: 'Fucili', required: 9_000, available: 8_000, consumed: 8_000, missing: 1_000, unitCostMln: 0.02 },
      { equipmentId: 'apc', name: 'APC', required: 2, available: 10, consumed: 2, missing: 0, unitCostMln: 4_000 },
    ],
    riflesRequired: 9_000, riflesAvailable: 8_000, riflesMissing: 1_000,
    initialCostMln: 8_160, blocked: false, blockedReason: null,
    basis: 'Il piano consuma la dotazione di riferimento dell\'epoca.',
  },
  armyId: null,
  armyName: '3ª Armata',
  targetRegionId: 'ita',
  target: { regionId: 'ita', regionName: 'Italia', armyName: '3ª Armata', armyId: null },
  before: { formations: 8, activePersonnel: 96_000 },
  after: { formations: 9, activePersonnel: 108_000 },
  deltas: [
    { label: 'Reparti', unit: 'numero', before: 8, after: 9, tone: 'positive' },
    { label: 'Prontezza', unit: 'pct', before: 64, after: 66.5, tone: 'positive' },
    { label: 'Consumo carburante', unit: 'per_mese', before: 0.83, after: 1.04, tone: 'warning' },
    { label: 'Uomini in armi', unit: 'numero', before: 96_000, after: 108_000, tone: 'positive' },
    { label: 'Spesa militare', unit: 'mld', before: 1.2345, after: 1.2412, tone: 'neutral' },
  ],
  why: 'L\'impatto è calcolato dal motore sui conti della nazione.',
};

describe('OP-OBJECTS — formattazione dei fatti', () => {
  it('formatta ogni unità con il separatore italiano e i decimali giusti', () => {
    expect(formatFactValue(fact('stato', 'Reparti', 12_000, 'numero'))).toBe('12.000');
    expect(formatFactValue(fact('capacita', 'Prontezza', 64, 'pct'))).toBe('64%');
    expect(formatFactValue(fact('output', 'Armamenti', 0.055, 'per_mese'))).toBe('0,06 /mese');
    expect(formatFactValue(fact('costi', 'Costo operativo', 0.004, 'mld'))).toBe('0,004 mld');
    expect(formatFactValue(fact('costi', 'Costo nave', 812.5, 'mln'))).toBe('812,5 mln');
    expect(formatFactValue(fact('autonomia', 'Carburante', 2.4, 'mesi'))).toBe('2,4 mesi');
    expect(formatFactValue(fact('stato', 'Composizione', null, 'testo', 'neutral', 'Fregate 2'))).toBe('Fregate 2');
    // Una data si legge come data di gioco: mai l'ISO grezzo.
    expect(formatFactValue(fact('autonomia', 'Consegna prevista', null, 'data', 'neutral', '1951-06-20'))).toBe('20 giu 1951');
    expect(formatFactValue(fact('autonomia', 'Consegna prevista', null, 'data', 'neutral', undefined as never))).toBe('—');
    expect(formatFactValue(fact('stato', 'Mancante', null, 'numero'))).toBe('—');
  });

  it('ordina i fatti secondo la grammatica e salta le sezioni vuote', () => {
    const force = picture.objects[0];
    expect(factRows(force).map(row => row.section)).toEqual(['capacita', 'personale', 'personale', 'costi', 'autonomia']);
    const sections = sectionsOf(force);
    expect(sections.map(section => section.section)).toEqual(['capacita', 'personale', 'costi', 'autonomia']);
    expect(sections[0].label).toBe('Capacità');
    expect(sections[1].label).toBe('Personale');
    // `toFixed` tronca: 1,2345 mld → 1,234 (il motore pubblica già i suoi decimali).
    expect(factsByLabel(force)['Spesa militare'].value).toBe('1,234 mld');
  });

  it('porta la nota del motore accanto al fatto numerico, senza inventarla', () => {
    const construction = picture.objects.find(object => object.id === 'construction-1')!;
    const rows = factRows(construction);
    const benefit = rows.find(row => row.label === 'Beneficio')!;
    expect(benefit.note).toBeUndefined();
    const withNote = { ...construction, facts: [{ section: 'output' as const, label: 'Beneficio', value: 0, unit: 'numero' as const, tone: 'neutral' as const, text: 'Nessuno prima del completamento.' }] };
    expect(factRows(withNote)[0].note).toBe('Nessuno prima del completamento.');
    expect(factRows(withNote)[0].value).toBe('0');
  });

  it('riconosce il problema più grave e il tono dello stato', () => {
    const shipyard = picture.objects.find(object => object.id === 'shipyard-1')!;
    expect(primaryProblem(shipyard)?.severity).toBe('critical');
    expect(statusTone('idle')).toBe('neutral');
    expect(statusTone('under_construction')).toBe('warning');
    expect(statusTone('critical')).toBe('critical');
    expect(primaryProblem(picture.objects.find(object => object.id === 'factory-1')!)?.severity).toBe('warning');
  });

  it('seleziona oggetti e figli senza inventare gerarchie', () => {
    expect(objectsOfKind(picture, 'army').map(object => object.label)).toEqual(['1ª Armata', '2ª Armata']);
    expect(childrenOf(picture, 'force').map(object => object.id)).toEqual(['army-A', 'army-B']);
    expect(kindCount(picture, 'facility')).toBe(2);
    expect(kindCount(picture, 'navy')).toBe(0);
  });
});

describe('OP-OBJECTS — schede di settore', () => {
  it('aggrega i settori presenti senza inventare quelli assenti', () => {
    const cards = sectorCards(picture, {
      capacityTotal: 38, capacityUsed: 26, capacityFree: 12, blocked: false, saturated: false, factories: 9, ports: 2, universities: 2,
    });
    expect(cards.map(card => card.id)).toEqual(['forze', 'industria', 'risorse']);
    const forze = cards[0];
    expect(forze.headline).toContain('8 reparti');
    expect(forze.facts.find(item => item.label === 'Uomini in armi')?.value).toBe('96.000');
    expect(forze.problems[0].severity).toBe('critical');
    expect(forze.objectIds).toEqual(['force', 'army-A', 'army-B']);
    const industria = cards[1];
    expect(industria.headline).toContain('2 impianti');
    expect(industria.facts.find(item => item.label === 'Linee totali')?.value).toBe('38');
    expect(industria.facts.find(item => item.label === 'Cantieri')?.value).toBe('1');
  });

  it('senza industria la scheda denuncia il blocco (non un rallentamento)', () => {
    const cards = sectorCards(picture, { capacityTotal: 0, capacityUsed: 0, capacityFree: 0, blocked: true, saturated: false });
    const industria = cards.find(card => card.id === 'industria')!;
    expect(industria.status).toBe('critical');
    expect(industria.problems.some(problem => /bloccata/i.test(problem.label))).toBe(true);
    // La marina non esiste in questo quadro: la scheda non compare affatto.
    expect(cards.some(card => card.id === 'marina')).toBe(false);
  });
});

describe('OP-OBJECTS — azione: creazione di reparti', () => {
  it('espone costo, materiale e righe PRIMA → DOPO già calcolate dal motore', () => {
    const view = formationActionView(impact)!;
    expect(view.blocked).toBe(false);
    expect(view.title).toBe('Crea 3ª Armata');
    expect(view.costLine).toContain('8 mld');
    expect(view.equipmentLine).toContain('12.000 uomini');
    expect(view.equipmentLine).toContain('mancano 1.000');
    const readiness = view.rows.find(row => row.label === 'Prontezza')!;
    expect(readiness.before).toBe('64%');
    expect(readiness.after).toBe('67%');
    const fuel = view.rows.find(row => row.label === 'Consumo carburante')!;
    expect(fuel.before).toBe('0,83 /mese');
    expect(fuel.after).toBe('1,04 /mese');
    expect(fuel.tone).toBe('warning');
    expect(view.why).toContain('motore');
  });

  it('nasconde le righe che non si muovono: una riga ferma non è una conseguenza', () => {
    const withFlat: FormationImpactPayload = {
      ...impact,
      deltas: [
        ...impact.deltas,
        { label: 'Consumo armamenti', unit: 'per_mese', before: 0.2, after: 0.2004, tone: 'neutral' },
        { label: 'Reparti di riserva', unit: 'numero', before: 3, after: 3, tone: 'neutral' },
      ],
    };
    const view = formationActionView(withFlat)!;
    expect(view.rows.some(row => row.label === 'Consumo armamenti')).toBe(false);
    expect(view.rows.some(row => row.label === 'Reparti di riserva')).toBe(false);
    // Le righe che cambiano restano tutte.
    expect(view.rows.map(row => row.label)).toEqual(['Reparti', 'Prontezza', 'Consumo carburante', 'Uomini in armi', 'Spesa militare']);
  });

  it('mantiene l\'azione bloccata con il motivo del motore', () => {
    const blocked: FormationImpactPayload = {
      ...impact,
      plan: { ...impact.plan, blocked: true, blockedReason: 'Servono 1.000 fucili in più: il deposito non basta.' },
    };
    const view = formationActionView(blocked)!;
    expect(view.blocked).toBe(true);
    expect(view.blockedReason).toContain('fucili');
    expect(formationActionView(null)).toBeNull();
  });

  it('riassume l\'esito con i soli numeri che contano', () => {
    const line = formationOutcomeLine(impact);
    expect(line).toContain('Uomini in armi');
    expect(line).toContain('Spesa militare');
    expect(line).not.toContain('Consumo carburante');
    expect(formationOutcomeLine(null)).toBeNull();
  });
});

/** Il read model non deve mai parlare con il motore: solo formattazione. */
describe('OP-OBJECTS — vincolo di presentazione', () => {
  it('non contiene chiamate di rete né formule di gioco', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync(new URL('./operationalObjects.ts', import.meta.url), 'utf8'));
    expect(source).not.toContain('gameApi.');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('useEffect');
  });
});

/** Il tipo ArsenalResponse deve portare il quadro: contratto della UI. */
describe('OP-OBJECTS — contratto con /arsenal', () => {
  it('il quadro è una proprietà dell\'arsenale pubblicato', () => {
    const arsenal = { objects: picture } as unknown as ArsenalResponse;
    expect(sectorCards(arsenal.objects).length).toBeGreaterThan(0);
  });
});
