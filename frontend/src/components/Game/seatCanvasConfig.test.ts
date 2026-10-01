/**
 * WS-GOVOFFICE-07 / WS-MINISTER-UX-08 — test dell'aggancio per sedia
 * =================================================================
 * `SeatCanvas` è generico; `seatCanvasAuthoring` deriva il contenuto dalla
 * **proposta concreta** della sedia e dalla **data di gioco**. Questi test
 * difendono i difetti corretti in UX-08:
 *  - niente piani dimostrativi con date fisse: il piano deriva dalle strade e
 *    dall'ancora di gioco, o resta mancante;
 *  - niente contenuto curato: la sedia che non porta una proposta non inventa;
 *  - la derivazione dei blocchi resta indipendente dalla sedia.
 */
import { describe, expect, it } from 'vitest';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { seatCanvasAuthoring, type SeatCanvasContext } from './seatCanvasConfig';
import type { CabinetAddressView } from '../../services/api';
import type { TreasuryAct } from './treasuryAct';

const picture = {
  economy: {
    debtServicePct: 15.1,
    treasuryMonths: 2.5,
    metrics: [{ id: 'gdp', label: 'PIL', value: 1000, format: 'mld', tone: 'neutral' }],
  },
  domains: [
    { id: 'militare', label: 'Forze armate', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Reparti', value: '7' }] },
    { id: 'economia', label: 'Economia', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'PIL', value: '1.000 mld' }] },
  ],
} as unknown as NationalOperatingPicture;

const sources = {
  regions: [{ id: 'r1', name: 'Alfa', owner: 'p1', gdp: 100, population: 50 }],
  account: { polityId: 'p1', money: 40 },
  resources: { money: 40 },
  government: { budget: { expense: [{ label: 'Difesa', amount: 6 }] } },
  accountHistory: [{ date: '2026-01', turn: 1, account: { money: 30 } }, { date: '2026-02', turn: 2, account: { money: 40 } }],
  today: '2026-02-01',
} as any;

const tesoroAct = {
  seatLabel: 'Ministro del Tesoro',
  voice: 'Signor Presidente, in cassa ci sono 40,00 mld.',
  figures: [],
  worksRequest: { workId: 'w_school', workName: 'Scuola elementare', need: '', missing: [], figures: [], item: {}, path: {} },
  nextMaturity: null,
  roads: [
    { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', recommended: false, declaredCost: '', expectedGain: '0,60 mld in meno', order: { kind: 'text', text: '' } },
    { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', recommended: true, declaredCost: '', expectedGain: 'l’opera consegna il suo effetto', order: { kind: 'work', item: {}, path: {} } },
  ],
} as unknown as TreasuryAct;

/** Una sedia con una proposta concreta: due percorsi su una voce. */
function seatWithProposal(seat: CabinetAddressView['seat']): CabinetAddressView {
  return {
    seat,
    label: seat === 'guerra' ? 'Ministro della Guerra' : 'Ministro dei Lavori',
    reads: 'competenze',
    opening: 'Signor Presidente.',
    items: [{
      voiceId: 'v-1',
      need: 'Mettere in sicurezza i valichi.',
      because: 'I presidi sono scoperti.',
      urgency: 'urgente',
      figures: [{ label: 'Presidi', value: '3', unit: 'su 10', basis: { kind: 'measured', source: 'Stato maggiore' } }],
      paths: [
        { id: 'now', title: 'Fortificare subito', detail: 'Impegnare mezzi ora.', prerequisites: ['riserva di mezzi'], expected: 'I valichi sono tenuti.', recommended: true },
        { id: 'later', title: 'Rinviare', detail: 'Aspettare il prossimo bilancio.', prerequisites: [], expected: 'Nessun costo immediato.', recommended: false },
      ],
    }],
  };
}

const context = (seat: CabinetAddressView['seat'], address: CabinetAddressView | null, act: TreasuryAct | null = null): SeatCanvasContext => ({
  seat, picture, sources, act, address,
});

describe('seatCanvasAuthoring — dalla proposta concreta, non da fixture', () => {
  it('il Tesoro deriva il piano dalle strade del suo atto, ancorato alla data di gioco', () => {
    const authored = seatCanvasAuthoring(context('tesoro', null, tesoroAct));
    expect(authored?.plan?.title).toContain('Tesoro');
    expect(authored?.plan?.nodes.map(node => node.title)).toContain('Ammortamento del debito');
    expect(authored?.plan?.nodes[0].date).toBe('1 FEB 2026');
    expect(authored?.ideas?.map(idea => idea.title)).toEqual(['Ammortamento del debito', 'Investimento']);
    expect(authored?.target?.label).toBe('Scuola elementare');
  });

  it('una sedia non-Tesoro deriva piano e idee dai percorsi delle sue voci', () => {
    const authored = seatCanvasAuthoring(context('guerra', seatWithProposal('guerra')));
    expect(authored?.plan?.nodes.map(node => node.title)).toContain('Fortificare subito');
    // Un prerequisito dichiarato diventa un nodo del piano.
    expect(authored?.plan?.nodes.map(node => node.title)).toContain('riserva di mezzi');
    expect(authored?.ideas?.map(idea => idea.title)).toEqual(['Fortificare subito', 'Rinviare']);
    expect(authored?.target).toBeUndefined();
  });

  it('niente date fisse e niente date quando la data di gioco manca', () => {
    const noDate = { ...sources, today: undefined };
    const authored = seatCanvasAuthoring({ seat: 'guerra', picture, sources: noDate as any, act: null, address: seatWithProposal('guerra') });
    expect(authored?.plan).toBeUndefined();
    expect(authored?.ideas?.length).toBe(2);
  });

  it('una sedia senza proposta concreta non inventa contenuto', () => {
    const bare: CabinetAddressView = { seat: 'lavori', label: 'Ministro dei Lavori', reads: '', opening: '', items: [] };
    expect(seatCanvasAuthoring(context('lavori', bare))).toBeUndefined();
  });

  it('il piano derivato non contiene mai date fisse di un altro calendario', () => {
    const authored = seatCanvasAuthoring(context('guerra', seatWithProposal('guerra')));
    const dump = JSON.stringify(authored?.plan);
    expect(dump).not.toContain('1951');
    expect(dump).not.toContain('GEN 2026');
    expect(dump).toContain('1 FEB 2026');
  });
});

describe('deriveSeatCanvasBlocks con la configurazione per sedia', () => {
  it('la sedia guerra compone i blocchi derivati più il piano della proposta', () => {
    const address = seatWithProposal('guerra');
    const blocks = deriveSeatCanvasBlocks({
      seat: 'guerra',
      picture,
      sources,
      address,
      authored: seatCanvasAuthoring({ seat: 'guerra', picture, sources, act: null, address }),
    });
    const kinds = blocks.map(block => block.kind);
    expect(kinds).toContain('strategy');
    expect(kinds).toContain('ideas');
    expect(kinds).toContain('metrics');
    expect(kinds).toContain('map');
    expect(kinds).toContain('chart');
    // Le cifre dell'economia non entrano per una sedia non-Tesoro: resta il dominio.
    const quadro = blocks.find(block => block.id === 'quadro');
    if (quadro?.kind === 'metrics') {
      expect(quadro.metrics.map(metric => metric.label)).toEqual(['Reparti']);
    }
  });
});
