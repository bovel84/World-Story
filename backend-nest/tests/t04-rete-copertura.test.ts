/**
 * T04 — La copertura diventa una RETE, non una speranza.
 *
 * La misura di T01 (§7) ha mostrato che senza proposte OGNI situazione resta
 * scoperta. Questa prova difende la rete e i suoi confini:
 *  - una situazione CON mosse viene coperta da una proposta derivata;
 *  - una situazione SENZA mosse resta scoperta, e la copertura lo **dichiara**:
 *    il sistema non inventa una mossa per riempire il tavolo (`T-I2`);
 *  - le mosse sono SPOSTATE, non fabbricate: titolo e contenuto sono quelli
 *    scritti dal modello, identici;
 *  - una chiave ignota scarta la proposta derivata (fail closed, `T-I5`);
 *  - la copertura è RICALCOLATA dopo la rete, mai dichiarata prima.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildAdvisorSituations, situationAsCouncilIssue, uncoveredAdvisorSituations, withAdvisorBriefingCoverage, withSituationDerivedProposals, type AdvisorResponse, type AdvisorSituation } from '../src/core/government/AdvisorSituations';
import { proposalMatchesSituation } from '../src/core/government/AdvisorSituations';
import { buildRealityAdvisorContext } from '../src/core/government/RealityAdvisor';
import { repairAdvisorBriefing } from '../src/core/government/AdvisorBriefingRepair';

function world() {
  return buildVerifiedWorldSnapshot({ gameData: {
    id: 's', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: '2000-06-01',
    world: { regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', coastal: false, objects: [] } } },
    worldState: { accounts: { UGA: { population: 10_000_000, socialTension: 65, stability: 20, monthlyBalance: -2, nominalGdpUsdBillions: 100, debtRatioPct: 40, debtServicePct: 5 } }, resources: { stock: { money: 1, food: 0.5, weapons: 1 }, needs: { food: 1 } }, arsenal: { units: {} } },
    relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } }, polityNames: { SDN: 'Sudan', COD: 'Congo' },
  }, commitments: [], operationalRows: [], foodCoverageMonths: 0.5 });
}

const mosse = [
  { title: 'Soffocare la rivolta nell’uovo', content: 'Dispieghiamo le unità disponibili lungo il confine e fortifichiamo i nodi logistici.' },
  { title: 'Comprare la tregua', content: 'Apriamo un canale con i capi locali e finanziamo la ricostruzione dei mercati di confine.' },
];
const conMosse = (): AdvisorSituation => ({ id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.', options: mosse, signalKeys: ['hostile-relations:SDN'], importance: 3 });
const senzaMosse = (): AdvisorSituation => ({ id: 'scorte', title: 'Scorte alimentari sotto soglia', summary: 'Il margine è sottile.', signalKeys: ['food-coverage'], importance: 3 });

const empty = (situations: AdvisorSituation[]): AdvisorResponse => ({ reply: '', situations, issues: [] });

describe('T04 — la rete di copertura', () => {
  it('una situazione CON mosse viene coperta, e la copertura è RICALCOLATA', () => {
    const snapshot = world();
    const prima = withAdvisorBriefingCoverage(snapshot, empty([conMosse()]));
    expect(prima.briefingCoverage?.complete).toBe(false);
    const dopo = withSituationDerivedProposals(snapshot, prima);
    expect(dopo.issues).toHaveLength(1);
    // La copertura non è dichiarata: è ricalcolata. Una proposta derivata per
    // l'unica situazione ⇒ completa.
    expect(dopo.briefingCoverage?.complete).toBe(true);
    expect(uncoveredAdvisorSituations(dopo)).toEqual([]);
  });

  it('T-I2 — le mosse sono SPOSTATE, non fabbricate: identiche a quelle scritte', () => {
    const derived = situationAsCouncilIssue(world(), conMosse())!;
    expect(derived.options).toEqual(mosse);
    // E passano anche la validazione del server, byte per byte.
    const dopo = withSituationDerivedProposals(world(), withAdvisorBriefingCoverage(world(), empty([conMosse()])));
    expect(dopo.issues[0].options).toEqual(mosse);
    expect(dopo.issues[0].title).toBe('Tensioni con il Sudan');
    expect(dopo.issues[0].signalKeys).toEqual(['hostile-relations:SDN']);
  });

  it('T-I2 — una situazione SENZA mosse resta scoperta, e la copertura lo DICHIARA', () => {
    const snapshot = world();
    const dopo = withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, empty([senzaMosse()])));
    // Nessuna proposta fabbricata per riempire il tavolo.
    expect(dopo.issues).toEqual([]);
    expect(situationAsCouncilIssue(world(), senzaMosse())).toBeUndefined();
    // Ma il sistema SA di non averla coperta: è il punto di T04.
    expect(dopo.briefingCoverage?.complete).toBe(false);
    expect(uncoveredAdvisorSituations(dopo).map(s => s.id)).toEqual(['scorte']);
  });

  it('una copertura già esistente non viene duplicata', () => {
    const snapshot = world();
    const base = withAdvisorBriefingCoverage(snapshot, empty([conMosse()]));
    const derived = situationAsCouncilIssue(world(), conMosse())!;
    const coperta = withAdvisorBriefingCoverage(snapshot, { ...base, issues: [{ ...derived, id: 'issue-sudan', verifiedFacts: [], suggestedMinisters: ['esteri'], sourceRefs: [], createdDate: '2000-06-01' }] });
    expect(uncoveredAdvisorSituations(coperta)).toEqual([]);
    const dopo = withSituationDerivedProposals(snapshot, coperta);
    expect(dopo.issues).toHaveLength(1); // nessun doppione
  });

  it('T-I5 — una chiave ignota scarta la proposta derivata, e la situazione resta scoperta', () => {
    const snapshot = world();
    const rotta: AdvisorSituation = { ...conMosse(), signalKeys: ['chiave-inesistente'] };
    // La copertura va calcolata PRIMA della rete: è la sua premessa, non un
    // effetto collaterale. (La mia prima versione la saltava e leggeva
    // `undefined`: era la prova a essere monca, non il codice.)
    const dopo = withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, empty([rotta])));
    // `resolveCouncilIssue` fallisce chiuso sulla chiave ignota: nessuna proposta.
    expect(dopo.issues).toEqual([]);
    expect(dopo.briefingCoverage?.complete).toBe(false);
  });

  it('la proposta derivata è collegata alla SUA situazione (identità di copertura)', () => {
    const derived = situationAsCouncilIssue(world(), conMosse())!;
    expect(proposalMatchesSituation(derived, conMosse())).toBe(true);
  });

  it('più situazioni con mosse: tutte coperte, una proposta ciascuna', () => {
    const snapshot = world();
    const seconda: AdvisorSituation = { id: 'congo', title: 'Tensioni con il Congo', summary: 'Fronte orientale.', options: mosse, signalKeys: ['hostile-relations:COD'], importance: 3 };
    const dopo = withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, empty([conMosse(), seconda])));
    expect(dopo.issues).toHaveLength(2);
    expect(dopo.briefingCoverage?.complete).toBe(true);
    expect(dopo.issues.map(i => i.title).sort()).toEqual(['Tensioni con il Congo', 'Tensioni con il Sudan']);
  });
});

/**
 * T04-bis — La rete sul briefing DETERMINISTICO, e il suo limite misurato.
 *
 * L'errore trovato dalla verifica indipendente (T08) ha due parti, e la seconda
 * è la più importante:
 *
 * 1. `buildRealityAdvisorContext` — il briefing deterministico, il primo che il
 *    Tavolo percorre quando il provider è giù — applicava SOLO la misura e mai la
 *    rete. Era incoerente con `parseAdvisorResponse`. Corretto: ora la chiama.
 * 2. **Ma la chiamata non cambia nulla su quel percorso, e va detto.** Le
 *    situazioni che `buildAdvisorSituations` costruisce dai segnali non hanno MAI
 *    mosse — è una proiezione, non una scelta politica. La rete copre solo le
 *    situazioni con mosse, quindi lì non aggiunge niente: sei situazioni restano
 *    scoperte, `complete: false`, la forma del 16:43.
 *
 * La correzione dell'incoerenza è giusta; credere che chiudesse il difetto era
 * l'errore. Questa prova misura il limite invece di nasconderlo.
 */
describe('T04-bis — il briefing deterministico: la rete, e il suo limite', () => {
  it('il percorso deterministico chiama la rete, come il punto unico dei briefing', () => {
    const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/core/government/RealityAdvisor.ts'), 'utf8');
    expect(src).toContain('withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, result))');
  });

  it('LIMITE DICHIARATO — le situazioni deterministiche non hanno mai mosse', () => {
    const snapshot = world();
    const situazioni = buildAdvisorSituations(snapshot);
    expect(situazioni.length).toBeGreaterThan(0);
    expect(situazioni.every(s => s.options === undefined)).toBe(true);
    // E la rete, di conseguenza, non può coprirle: nessuna proposta da derivare.
    const dopo = withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, { reply: '', situations: situazioni, issues: [] }));
    expect(dopo.issues).toEqual([]);
    expect(uncoveredAdvisorSituations(dopo).length).toBe(situazioni.length);
    expect(dopo.briefingCoverage?.complete).toBe(false);
  });

  it('il briefing deterministico non mente: dichiara di non aver coperto', () => {
    const snapshot = world();
    const result = buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing');
    expect(result.situations.length).toBeGreaterThan(0);
    // Ciò che la correzione garantisce davvero: il percorso SA e DICHIARA di non
    // aver coperto, invece di presentare un tavolo che sembra pronto. Se un
    // giorno le mosse arriveranno anche qui, questa prova cadrà — ed è il posto
    // giusto per accorgersene.
    expect(result.briefingCoverage?.complete).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it('ma quando le situazioni HANNO mosse, la rete le copre anche qui', () => {
    const snapshot = world();
    const conMosse: AdvisorSituation = { id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', options: mosse, signalKeys: ['hostile-relations:SDN'], importance: 3 };
    const coperto = withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, { reply: '', situations: [conMosse], issues: [] }));
    expect(coperto.issues).toHaveLength(1);
    expect(coperto.briefingCoverage?.complete).toBe(true);
  });
});

/**
 * T04-ter — Il seguito: il REPAIR chiede le mosse, e le sue mosse arrivano al tavolo.
 *
 * Misurato il 2026-10-08, dopo T08. Il vero motivo per cui il 16:43 non aveva
 * mosse: la copertura delle situazioni deterministiche la fa il **repair mirato**
 * (`AdvisorBriefingRepair`), ed era l'**unico** punto del sistema che chiedeva
 * proposte **senza** `options`. Il prompt del briefing le chiedeva, quello delle
 * situazioni le chiedeva, quello del repair no. Per questo l'autore vedeva
 * «titolo, sintesi e Approfondisci» senza mosse.
 *
 * Correzione: il repair chiede anche le mosse, come il resto del sistema.
 */
describe('T04-ter — il repair chiede le mosse', () => {
  it('il prompt di sistema del repair chiede le mosse', async () => {
    const { ADVISOR_BRIEFING_REPAIR_SYSTEM } = await import('../src/core/government/AdvisorBriefingRepair');
    expect(ADVISOR_BRIEFING_REPAIR_SYSTEM).toContain('options');
    expect(ADVISOR_BRIEFING_REPAIR_SYSTEM).toMatch(/2-5/);
    // La guida del briefing è già scritta e di qualità: si riusa, non si riscrive.
    expect(ADVISOR_BRIEFING_REPAIR_SYSTEM).toContain('[OPZIONI]');
  });

  it('una risposta del repair CON mosse produce una proposta con mosse', async () => {
    const snapshot = world();
    const base = withAdvisorBriefingCoverage(snapshot, { reply: '', situations: buildAdvisorSituations(snapshot), issues: [] });
    const stub = async () => '```council_issue\n' + JSON.stringify({
      title: 'Scorte alimentari sotto soglia', question: 'Come garantiamo le scorte?',
      options: mosse, signalKeys: ['food-coverage'], suggestedMinisters: ['interno'],
    }) + '\n```';
    const esito = await repairAdvisorBriefing(snapshot, base, { complete: stub });
    expect(esito.response.issues).toHaveLength(1);
    expect(esito.response.issues[0].options).toEqual(mosse);
    // E la situazione è coperta: la copertura è ricalcolata dal repair.
    expect(esito.response.briefingCoverage?.missingSignalKeys).not.toContain('food-coverage');
  });

  /**
   * RISCHIO RESIDUO, dichiarato e misurato — non nascosto.
   *
   * Il repair emette UNA proposta principale per situazione, e lo schema esige
   * 2-5 mosse (l'invariante di P01). Se il modello ne scrive **una sola**, la
   * proposta si scarta. Non è una regressione: prima se ne scrivevano zero per
   * costruzione, quindi il repair perdeva **tutte** le proposte sulla forma. Ora
   * ne perde una solo se il conteggio è sbagliato. Ma il rischio c'è, ed è qui.
   *
   * Chi volesse toglierlo ha due strade, e sono una scelta dell'autore: allentare
   * lo schema a 1-5 (P09: degrada, non uccide — la scheda vive e il Presidente
   * sceglie fra una strada sola), oppure lasciare 2-5 e accettare che una
   * risposta pigra perda la proposta. Oggi vale la seconda.
   */
  it('RISCHIO RESIDUO — una sola mossa nel repair scarta la proposta (limite 2-5 di P01)', async () => {
    const snapshot = world();
    const base = withAdvisorBriefingCoverage(snapshot, { reply: '', situations: buildAdvisorSituations(snapshot), issues: [] });
    const stub = async () => '```council_issue\n' + JSON.stringify({
      title: 'Scorte alimentari sotto soglia', question: 'Come garantiamo le scorte?',
      options: [mosse[0]], signalKeys: ['food-coverage'], suggestedMinisters: ['interno'],
    }) + '\n```';
    const esito = await repairAdvisorBriefing(snapshot, base, { complete: stub });
    expect(esito.response.issues).toHaveLength(0);
    expect(esito.discarded.some(d => d.situationId === 'situation-food-coverage')).toBe(true);
  });
});
