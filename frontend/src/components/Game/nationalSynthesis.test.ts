/**
 * La sintesi della nazione (D03/D04) — read model puro.
 *
 * Il criterio è quello del piano, e non è un'impressione: la sintesi deve dare
 * **un giudizio**, una **sola** lista ordinata, e un'**azione minima** per ogni
 * voce. E deve saper stare zitta: a lista vuota non mostra riempitivi.
 *
 * L'ordinamento non è «per gravità» in astratto — è una regola dichiarata:
 * prima ciò che chiude la partita, poi ciò che scade, poi il resto.
 */
import { describe, it, expect } from 'vitest';
import { nationalSynthesis } from './nationalSynthesis';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import type { Commitment, CrisisSnapshot, PeacetimePressure } from '../../services/api';
import type { NationalProcess } from './nationDossier';

/** Un quadro d'insieme minimo ma con la forma reale. */
function picture(overrides: {
  status?: NationalOperatingPicture['status'];
  headline?: string;
  attention?: NationalOperatingPicture['attention'];
  facts?: Array<{ label: string; value: string; tone?: 'positive' | 'warning' | 'critical' | 'neutral' }>;
} = {}): NationalOperatingPicture {
  return {
    status: overrides.status ?? 'stable',
    headline: overrides.headline ?? 'Situazione sotto controllo, con margini da difendere.',
    summary: 'Sotto controllo',
    domains: [
      {
        id: 'economia', label: 'Economia e cassa', status: 'stable', headline: '', drivers: [],
        facts: overrides.facts ?? [
          { label: 'Saldo mensile', value: '+1,2', tone: 'positive' },
          { label: 'Debito / PIL', value: '62%', tone: 'warning' },
        ],
      },
      {
        id: 'governo', label: 'Governo', status: 'stable', headline: '', drivers: [],
        facts: [{ label: 'Fazioni insoddisfatte', value: '1', tone: 'warning' }],
      },
    ],
    attention: overrides.attention ?? [],
    answers: [],
  } as unknown as NationalOperatingPicture;
}

function pressure(overrides: Partial<PeacetimePressure> & { window?: Record<string, unknown> } = {}): PeacetimePressure {
  return {
    id: 'p1', kind: 'internal', template: 'strike', title: 'Sciopero generale',
    detail: '', severity: 40, source: 'lavoro', status: 'active',
    createdDate: '2026-01-01', createdTurn: 1,
    options: [
      { id: 'o1', label: 'Apri il tavolo', detail: '' },
      { id: 'o2', label: 'Requisisci i servizi', detail: '' },
    ],
    ...overrides,
  } as PeacetimePressure;
}

function crisis(overrides: Partial<CrisisSnapshot> = {}): Partial<CrisisSnapshot> {
  return {
    collapseDays: 90,
    state: {
      level: 'critical',
      risks: [
        { dimension: 'insolvency', level: 'critical', score: 88, title: 'Rischio di default', detail: '', drivers: [] },
        { dimension: 'revolt', level: 'calm', score: 12, title: 'Rischio di rivolta', detail: '', drivers: [] },
        { dimension: 'invasion', level: 'calm', score: 3, title: 'Rischio di invasione', detail: '', drivers: [] },
      ],
      headline: 'Il tesoro non regge', summary: '',
      criticalDays: { revolt: 0, insolvency: 85, invasion: 0 },
      ending: null,
    },
  } as unknown as Partial<CrisisSnapshot>;
}

describe('la sintesi risponde a tre domande', () => {
  it('1. dà un giudizio: la frase del motore, non una ricalcolata', () => {
    const synthesis = nationalSynthesis({ picture: picture({ headline: 'Il punto debole è economia e cassa.' }) });
    expect(synthesis.verdict).toBe('Il punto debole è economia e cassa.');
  });

  it('dichiara quando il quadro non è ancora pubblicato, senza inventare', () => {
    const synthesis = nationalSynthesis({});
    expect(synthesis.verdict).toMatch(/non ancora pubblicato/i);
    expect(synthesis.items).toEqual([]);
  });

  it('2. dà una sola lista, ordinata: prima ciò che chiude la partita', () => {
    const synthesis = nationalSynthesis({
      picture: picture(),
      crisis: crisis(),
      pressures: [pressure()],
    });
    expect(synthesis.items.length).toBeGreaterThan(1);
    // La crisi critica precede la sfida.
    expect(synthesis.items[0].source).toBe('crisi');
    expect(synthesis.items[0].rank).toBe(0);
    const firstPressure = synthesis.items.findIndex(item => item.source === 'sfida');
    expect(firstPressure).toBeGreaterThan(0);
  });

  it('3. dà un\'azione minima per ogni voce', () => {
    const synthesis = nationalSynthesis({
      picture: picture(), crisis: crisis(), pressures: [pressure()],
    });
    for (const item of synthesis.items) {
      expect(item.action, `«${item.title}» senza azione`).toBeTruthy();
      expect(item.action.length, `«${item.title}»: azione troppo vaga`).toBeGreaterThan(3);
    }
  });

  it('l\'azione di una sfida è una delle opzioni del motore, non una suggerita dal client', () => {
    const synthesis = nationalSynthesis({ picture: picture(), pressures: [pressure()] });
    const item = synthesis.items.find(entry => entry.source === 'sfida')!;
    expect(item.action).toContain('Apri il tavolo');
    // Le alternative restano visibili: la scelta è del giocatore.
    expect(item.action).toContain('Requisisci i servizi');
  });

  it('ogni voce dichiara da dove viene e dove si approfondisce', () => {
    const synthesis = nationalSynthesis({
      picture: picture({ attention: [{ label: 'Scorte basse', tone: 'warning', domain: 'Risorse', detail: 'Cibo per 1 mese' }] }),
      crisis: crisis(),
      pressures: [pressure()],
      commitments: { attention: [{ id: 'c1', description: 'Trattato con la Francia', type: 'treaty', actor: 'ITA', counterparty: 'FRA', deadline: '2026-02-01', status: 'active', createdDate: '2026-01-01', createdTurn: 1, importance: 3, note: '', sourceEventId: null, updatedDate: '', updatedTurn: 1 } as Commitment] },
      processes: [{ id: 'pr1', title: 'Ferrovia alpina', summary: '', started_date: '2025-06-01', expected_date: '2026-03-01', progress: 60 } as NationalProcess],
      today: '2026-01-15',
    });
    const sources = new Set(synthesis.items.map(item => item.source));
    // Tutte le fonti sono rappresentate: è il senso della lista unica.
    expect(sources).toEqual(new Set(['crisi', 'sfida', 'impegno', 'progetto', 'sintesi']));
    for (const item of synthesis.items) {
      expect(item.domain, `«${item.title}» senza ambito`).toBeTruthy();
      expect(item.urgency, `«${item.title}» senza scadenza`).toBeTruthy();
    }
  });
});

describe('la sintesi sa stare zitta', () => {
  it('con nulla da fare la lista è vuota: nessun riempitivo', () => {
    const synthesis = nationalSynthesis({ picture: picture() });
    expect(synthesis.items).toEqual([]);
  });

  it('una crisi calma non entra nella lista', () => {
    const calm = crisis();
    for (const risk of calm.state!.risks) risk.level = 'calm';
    expect(nationalSynthesis({ picture: picture(), crisis: calm }).items).toEqual([]);
  });

  it('una sfida risolta non entra nella lista', () => {
    const resolved = pressure({ status: 'resolved' });
    expect(nationalSynthesis({ picture: picture(), pressures: [resolved] }).items).toEqual([]);
  });

  it('un processo senza data attesa non entra: non è una scadenza', () => {
    const process = { id: 'p', title: 'Ricerca', summary: '', started_date: '2026-01-01', expected_date: null } as NationalProcess;
    expect(nationalSynthesis({ picture: picture(), processes: [process] }).items).toEqual([]);
  });
});

describe('l\'ordinamento è una regola, non una preferenza', () => {
  it('un impegno scaduto precede un progetto in ritardo', () => {
    const synthesis = nationalSynthesis({
      picture: picture(),
      today: '2026-03-01',
      commitments: { attention: [{ id: 'c1', description: 'Pagamento promesso', type: 'debt', actor: 'ITA', counterparty: null, deadline: '2026-02-01', status: 'active', createdDate: '2026-01-01', createdTurn: 1, importance: 3, note: '', sourceEventId: null, updatedDate: '', updatedTurn: 1 } as Commitment] },
      processes: [{ id: 'p1', title: 'Ferrovia', summary: '', started_date: '2025-01-01', expected_date: '2026-02-15', progress: 50 } as NationalProcess],
    });
    const overdue = synthesis.items.findIndex(item => item.key.startsWith('impegno'));
    const project = synthesis.items.findIndex(item => item.key.startsWith('progetto'));
    expect(overdue).toBeGreaterThanOrEqual(0);
    expect(project).toBeGreaterThanOrEqual(0);
    expect(overdue).toBeLessThan(project);
  });

  it('un impegno scaduto è più urgente di uno senza scadenza', () => {
    const base = { actor: 'ITA', counterparty: null, type: 'treaty', status: 'active', createdDate: '2026-01-01', createdTurn: 1, importance: 3, note: '', sourceEventId: null, updatedDate: '', updatedTurn: 1 };
    const synthesis = nationalSynthesis({
      picture: picture(),
      today: '2026-03-01',
      commitments: { attention: [
        { ...base, id: 'late', description: 'Scaduto', deadline: '2026-02-01' } as Commitment,
        { ...base, id: 'open', description: 'Aperto', deadline: null } as Commitment,
      ] },
    });
    const lateIndex = synthesis.items.findIndex(item => item.key === 'impegno:late');
    const openIndex = synthesis.items.findIndex(item => item.key === 'impegno:open');
    expect(lateIndex).toBeLessThan(openIndex);
    expect(synthesis.items[lateIndex].tone).toBe('critical');
  });

  it('è deterministico: stesso stato, stessa lista', () => {
    const input = { picture: picture(), crisis: crisis(), pressures: [pressure()] };
    expect(nationalSynthesis(input)).toEqual(nationalSynthesis(input));
  });
});

describe('le prove del giudizio', () => {
  it('porta le cifre del motore con il loro tono', () => {
    const synthesis = nationalSynthesis({ picture: picture() });
    expect(synthesis.evidence.length).toBeGreaterThan(0);
    // Le cifre vengono dal quadro: qui non si ricalcola nulla.
    expect(synthesis.evidence.find(fact => fact.label === 'Saldo mensile')?.value).toBe('+1,2');
    expect(synthesis.evidence.find(fact => fact.label === 'Debito / PIL')?.tone).toBe('warning');
  });

  it('il tono complessivo traduce la scala dei domini', () => {
    expect(nationalSynthesis({ picture: picture({ status: 'critical' }) }).tone).toBe('critical');
    expect(nationalSynthesis({ picture: picture({ status: 'fragile' }) }).tone).toBe('warning');
    expect(nationalSynthesis({ picture: picture({ status: 'healthy' }) }).tone).toBe('positive');
  });
});
