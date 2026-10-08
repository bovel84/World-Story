/**
 * T02 — Le MOSSE entrano nella SITUAZIONE, con la stessa forma delle proposte.
 *
 * Difende tre invarianti:
 *  - **T-I5** una situazione SENZA mosse resta valida e rende come oggi;
 *  - **T-I5** una situazione CON mosse le conserva identiche al round-trip;
 *  - **T-I2 / P09** una mossa con una CHIAVE dentro (`signalKey`, una cifra) e'
 *    prosa travestita da fatto: la scheda si scarta INTERA, mai accettata in
 *    parte. E' la trappola di P09 applicata alla situazione.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { advisorSituationInputSchema, parseAdvisorSituations, resolveAdvisorSituation, serializeAdvisorResponse } from '../src/core/government/AdvisorSituations';

const block = (kind: string, value: unknown) => `\`\`\`${kind}\n${JSON.stringify(value)}\n\`\`\``;

function world(options: any = {}) {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'situations', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: options.date ?? '2000-06-01',
      world: { regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', coastal: false, objects: [] } } },
      worldState: {
        accounts: { UGA: options.account ?? { population: 10_000_000, socialTension: 65, stability: 20, monthlyBalance: -2, nominalGdpUsdBillions: 100, debtRatioPct: 40, debtServicePct: 5 } },
        resources: { stock: options.stock ?? { money: 1, food: 0.5, weapons: 1 }, needs: { food: 1 } },
        arsenal: { units: {} },
      },
      // DUE vicini ostili, non uno: con un solo rapporto ostile la chiave resta
      // la generica `hostile-relations` (retrocompatibilità, RealitySignals:340).
      // La forma per entità `hostile-relations:<polityId>` nasce solo da due.
      // È stato il primo rosso di questa prova — colpa del fixture, non del codice.
      relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } },
      polityNames: { SDN: 'Sudan', COD: 'Congo' },
    },
    commitments: [], operationalRows: [], foodCoverageMonths: 0.5,
  });
}

const mosse = [
  { title: 'Soffocare la rivolta nell’uovo', content: 'Dispieghiamo le unità disponibili lungo il confine, fortifichiamo i nodi logistici e chiediamo osservatori neutrali.' },
  { title: 'Comprare la tregua', content: 'Apriamo un canale con i capi locali e finanziamo la ricostruzione dei mercati di confine in cambio della smobilitazione.' },
];

describe('T02 — la mossa nella situazione', () => {
  it('una situazione SENZA mosse resta valida e rende come oggi (T-I5)', () => {
    const parsed = advisorSituationInputSchema.safeParse({ title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.', signalKeys: ['hostile-relations:SDN'] });
    expect(parsed.success).toBe(true);
    const resolved = resolveAdvisorSituation(world(), { id: 's1', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations:SDN'] });
    expect(resolved.options).toBeUndefined();
    // La proiezione deterministica non inventa mosse: non ne ha mai.
    expect(resolved).not.toHaveProperty('options');
  });

  it('una situazione CON mosse le conserva identiche al round-trip (T-I5)', () => {
    const resolved = resolveAdvisorSituation(world(), { id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', options: mosse, signalKeys: ['hostile-relations:SDN'] });
    expect(resolved.options).toEqual(mosse);
    // Round-trip sul trasporto vero: serialize → parseAdvisorSituations.
    const again = parseAdvisorSituations(world(), serializeAdvisorResponse({ reply: '', situations: [resolved], issues: [] }));
    expect(again.situations[0].options).toEqual(mosse);
  });

  it('le mosse sono 2-5: una sola non è una scelta', () => {
    const uno = [mosse[0]];
    const sei = [...mosse, ...mosse, ...mosse];
    expect(advisorSituationInputSchema.safeParse({ title: 't', summary: 's', options: uno, signalKeys: ['stability'] }).success).toBe(false);
    expect(advisorSituationInputSchema.safeParse({ title: 't', summary: 's', options: sei, signalKeys: ['stability'] }).success).toBe(false);
  });

  it('T-I2 / P09 — una mossa con una CHIAVE dentro DEGRADA: la chiave sparisce, la scheda vive', () => {
    // Correzione trovata dalla verifica indipendente (T08). La prima versione di
    // questa prova pretendeva la scheda MORTA, con uno schema `.strict()`. Era
    // sbagliato: contraddiceva P09 («degrada, non uccide») e non era più sicuro,
    // perché una chiave dentro una MOSSA non raggiunge il motore — le mosse sono
    // prosa, e i fatti li porta `signalKeys`, che il server rivalida sempre.
    // Ora lo schema è come quello delle proposte: la chiave si perde, la scheda resta.
    const parsed = parseAdvisorSituations(world(), block('advisor_situation', {
      title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.',
      options: [
        { title: 'Mossa', content: 'Facciamo qualcosa di concreto al confine settentrionale.', signalKey: 'hostile-relations:SDN' },
        { title: 'Altra via', content: 'Apriamo un canale diplomatico e rinunciamo per ora a ogni movimento di truppe.' },
      ],
      signalKeys: ['hostile-relations:SDN'],
    }));
    expect(parsed.situations).toHaveLength(1);
    // La scheda vive, e la chiave NON c'è: solo titolo e contenuto.
    for (const option of parsed.situations[0].options!) {
      expect(Object.keys(option).sort()).toEqual(['content', 'title']);
    }
    // È il comportamento delle proposte: stessa disciplina, stesso esito.
    expect(JSON.stringify(parsed.situations[0].options)).not.toContain('signalKey');
  });

  it('T-I2 — una mossa con una CIFRA dentro passa lo schema: la prosa la controlla il prompt', () => {
    // Confine dichiarato: lo schema misura lunghezze, non semantica. Una cifra in
    // un content non è una chiave: non introduce un fatto nel motore, perché le
    // mosse non entrano in nessun calcolo. È il prompt a vietarla (vedi [OPZIONI]).
    const resolved = resolveAdvisorSituation(world(), {
      title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.',
      options: [
        { title: 'Muovere 3 brigate', content: 'Dispieghiamo 3 brigate al confine settentrionale e chiediamo osservatori neutrali.' },
        { title: 'Trattare per gradi', content: 'Apriamo un canale diplomatico con il vicino e rinunciamo a ogni movimento di truppe per ora.' },
      ],
      signalKeys: ['hostile-relations:SDN'],
    });
    expect(resolved.options?.[0].content).toContain('3 brigate');
  });

  it('una mossa SOLA scarta la scheda intera: 2-5 è la definizione di «una scelta»', () => {
    // Confine che ho scelto, non un accidente. Lo schema della situazione è lo
    // STESSO della proposta (`councilIssueInputSchema`), che esige 2-5. La
    // conseguenza è severa e va detta: con una sola mossa la scheda si scarta
    // INTERA, non solo le mosse — perché è `advisorSituationInputSchema` a
    // fallire, e `resolveAdvisorSituation` non accetta una scheda in parte.
    //
    // Ho preferito la severità alla tolleranza: «porta al Consiglio» con una
    // sola strada non è una scelta, e ammettere 1 aprirebbe la porta a una
    // situazione che si presenta come decisione senza esserlo. Se un giorno
    // questa severità costerà una scheda buona, il posto per cambiarla è qui.
    const reasons: string[] = [];
    const parsed = parseAdvisorSituations(world(), block('advisor_situation', {
      title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.',
      options: [mosse[0]], signalKeys: ['hostile-relations:SDN'],
    }), { onDiscard: reason => reasons.push(reason) });
    expect(parsed.situations).toEqual([]);
    expect(reasons).toHaveLength(1);
    // E senza `options` la stessa scheda passa: la severità riguarda le mosse,
    // non la situazione. È l'invariante T-I5 a proteggerla.
    const senzaMosse = parseAdvisorSituations(world(), block('advisor_situation', {
      title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations:SDN'],
    }));
    expect(senzaMosse.situations).toHaveLength(1);
  });

  it('il trasporto non perde le mosse di una situazione (parseAdvisorResponse)', () => {
    const text = block('advisor_situation', {
      id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.', options: mosse, signalKeys: ['hostile-relations:SDN'],
    });
    const parsed = parseAdvisorSituations(world(), text);
    expect(parsed.situations).toHaveLength(1);
    expect(parsed.situations[0].options).toEqual(mosse);
  });
});
