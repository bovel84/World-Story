/**
 * WS-GOVOFFICE-07 — test dell'atto del Tesoro (Parte B)
 * ====================================================
 * Le regole provate su funzioni **pure**:
 *  - ogni cifra dell'atto deriva dal read model e dichiara la sua provenienza;
 *  - la scadenza scelta è la più vicina davvero (dai titoli del motore);
 *  - la richiesta dei Lavori viene dalla seduta, non inventata;
 *  - le due strade hanno costo immediato + effetto futuro, e un ordine
 *    firmabile (opera o testo) che il chiamante accoderà;
 *  - senza dati, l'atto lo **dichiara** invece di inventare un numero.
 */
import { describe, expect, it } from 'vitest';
import type { CabinetSessionView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import { nextMaturityFrom, treasuryAct, worksRequestFrom } from './treasuryAct';

function sources(overrides: Record<string, unknown> = {}) {
  return {
    regions: [],
    account: { polityId: 'p1', monthlyBalance: -3, debtRatioPct: 90, debtServicePct: 15.1, money: 40 },
    resources: {
      money: 40,
      debt: 300,
      annualInterest: 4.2,
      debts: [
        { id: 'd2', label: 'Titolo 10 anni', principal: 50, annualRatePct: 4, issuedDate: '2026-01-01', maturityDate: '2026-11-01', termYears: 10 },
        { id: 'd1', label: 'Titolo 5 anni', principal: 20, annualRatePct: 3, issuedDate: '2026-01-01', maturityDate: '2026-05-01', termYears: 5 },
      ],
    },
    government: null,
    commitments: null,
    accountHistory: [],
    ongoingProcesses: [],
    maintenanceObligations: null,
    crisis: null,
    pressures: null,
    today: '2026-04-01',
    ...overrides,
  } as any;
}

const picture = {
  economy: { debtServicePct: 15.1, treasuryMonths: 2.5, metrics: [] },
  domains: [],
} as unknown as NationalOperatingPicture;

function session(): CabinetSessionView {
  return {
    addresses: [
      { seat: 'tesoro', label: 'Ministro del Tesoro', reads: 'conti', opening: 'Ho due cose.', items: [] },
      {
        seat: 'lavori',
        label: 'Ministro dei Lavori',
        reads: 'cantieri',
        opening: 'Ho una cosa.',
        items: [{
          voiceId: 'build_w_school',
          need: 'Costruire: Scuola elementare',
          because: 'La distinta è coperta.',
          urgency: 'ordinaria',
          figures: [{ label: 'Copertura', value: '1', unit: 'opera', basis: { kind: 'measured', source: 'distinta del catalogo' } }],
          paths: [{ id: 'build_now', title: 'Avviare il cantiere', detail: 'Impegnare cassa e materiali.', prerequisites: [], expected: 'Il cantiere avanza.', recommended: true }],
          work: { workId: 'w_school', name: 'Scuola elementare' },
          declaration: { workId: 'w_school', payerActorId: 'alpha', materialActorId: 'alpha', funded: true },
        }],
      },
    ],
    president: { opening: 'Riunito.', closing: 'Chiusa.' },
    summary: { total: 2, critical: 0 },
    canonicalMutation: false,
  };
}

describe('nextMaturityFrom', () => {
  it('sceglie la scadenza più vicina non ancora passata', () => {
    const maturity = nextMaturityFrom(sources());
    expect(maturity?.maturityDate).toBe('2026-05-01');
    expect(maturity?.principal).toBe(20);
    expect(maturity?.daysToMaturity).toBe(30);
  });

  it('senza titoli non inventa una scadenza', () => {
    expect(nextMaturityFrom(sources({ resources: { money: 10 } }))).toBeNull();
  });
});

describe('worksRequestFrom', () => {
  it('legge la richiesta dalla sedia dei Lavori, con la strada da accodare', () => {
    const request = worksRequestFrom(session());
    expect(request?.workId).toBe('w_school');
    expect(request?.path.id).toBe('build_now');
    expect(request?.item.work?.name).toBe('Scuola elementare');
  });

  it('una seduta senza opere non produce una richiesta', () => {
    expect(worksRequestFrom(null)).toBeNull();
  });
});

describe('treasuryAct', () => {
  it('porta le cifre del motore, ciascuna con la provenienza', () => {
    const act = treasuryAct({ session: session(), picture, sources: sources() });
    const labels = act.figures.map(figure => figure.label);
    expect(labels).toContain('Cassa disponibile');
    expect(labels).toContain('Debito / PIL');
    expect(labels).toContain('Interessi / entrate');
    const debt = act.figures.find(figure => figure.label === 'Debito / PIL');
    expect(debt?.display).toBe('90%');
    expect(debt?.basis).toContain('conti nazionali');
    const service = act.figures.find(figure => figure.label === 'Interessi / entrate');
    expect(service?.display).toBe('15,1%');
  });

  it('la voce contiene le cifre, non le nasconde in una scatola KPI', () => {
    const act = treasuryAct({ session: session(), picture, sources: sources() });
    expect(act.voice).toContain('15,1%');
    expect(act.voice).toContain('Scuola elementare');
    expect(act.voice).toContain('2026-05-01');
  });

  it('le due strade hanno costo immediato + effetto futuro e un ordine firmabile', () => {
    const act = treasuryAct({ session: session(), picture, sources: sources() });
    const repay = act.roads.find(road => road.id === 'repay');
    const invest = act.roads.find(road => road.id === 'invest');
    expect(repay?.declaredCost).toContain('20');
    expect(repay?.expectedGain).toContain('0,60');
    expect(repay?.order.kind).toBe('text');
    expect(invest?.order.kind).toBe('work');
    if (invest?.order.kind === 'work') {
      expect(invest.order.item.work?.workId).toBe('w_school');
    }
    // La strada dell'investimento è consigliata quando il debito non pesa.
    const healthy = treasuryAct({ session: session(), picture, sources: sources({ account: { monthlyBalance: 2, debtRatioPct: 40, debtServicePct: 4, money: 60 } }) });
    expect(healthy.roads.find(road => road.id === 'invest')?.recommended).toBe(true);
    expect(healthy.roads.find(road => road.id === 'repay')?.recommended).toBe(false);
  });

  it('senza conti pubblicati l’atto lo dichiara: nessun numero inventato', () => {
    const empty = treasuryAct({ session: null, picture: null, sources: sources({ account: null, resources: null }) });
    expect(empty.figures.every(figure => figure.display === '—')).toBe(true);
    expect(empty.roads).toHaveLength(0);
    expect(empty.voice).toContain('non sono ancora pubblicati');
  });
});
