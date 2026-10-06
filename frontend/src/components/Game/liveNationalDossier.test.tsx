/**
 * World Story — Dossier Nazionale vivo: consolidamento
 * ====================================================
 * Dopo il consolidamento c'è **una sola rappresentazione primaria per ogni
 * fatto**: le schede `NationalDossierLive` portano le cifre attuali vs Turno 0,
 * i vecchi blocchi del dock non le ricopiano più.
 *
 * Le verifiche qui sono di due tipi:
 *  - **render** (`renderToStaticMarkup`) della scheda viva, per le etichette e
 *    per l'assenza di metriche senza fonte corrente;
 *  - **sorgente** (`fs` + regex) del dock, per provare che le vecchie card
 *    duplicate non esistono più e che ogni scheda viva sta nel tab giusto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NationalDossierLive, type DossierLivePart } from './LiveNationalDossier';
import { buildNationalDossierLive } from './nationalDossierLive';
import type { CountryInitialProfilePayload, ArsenalResponse } from '../../services/api';
import type { NationAccount, NationResources } from './NationDock/types';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const DOCK = read('./NationDock.tsx');

function profile(over: Partial<CountryInitialProfilePayload> = {}): CountryInitialProfilePayload {
  return {
    polityId: 'AAA', startDate: '1951-01-01', population: 48_000_000,
    economy: { nominalGdpUsdBillions: 12.7, debtRatioPct: 40, treasuryUsdBillions: 1.2, taxRatePct: 22, monthlyRevenue: 0.4, monthlyExpenses: 0.35 },
    military: {
      activePersonnel: 200_000, reservePersonnel: 100_000, formations: 10, averageFormationSize: 20_000,
      readinessPct: 60, defenceBurdenPct: 3.5, equipmentProfile: { tank: 300 }, trainingPct: 55, qualityPct: 50, logisticsPct: 45,
    },
    society: { stability: 62, socialTension: 28 },
    infrastructure: { factories: 6, ports: 3, universities: 4 },
    resources: { food: 5_000, clothing: 800, weapons: 1_200, fuel: 900, research: 400, technologies: ['industria_tessile'] },
    ...over,
  };
}
const account = (over: Partial<NationAccount> = {}): NationAccount => ({
  population: 48_000_000, nominalGdpUsdBillions: 12.7, gdpPerCapitaUsd: 264_583,
  factories: 8, ports: 3, universities: 5, monthlyRevenue: 0.4, monthlyExpenses: 0.35, monthlyBalance: 0.05,
  stability: 62, socialTension: 28, money: 1.2, debt: 5.08, debtRatioPct: 40, ...over,
});
const resources = (over: Partial<NationResources> = {}): NationResources => ({
  money: 1.2, debt: 5.08, food: 5_000, clothing: 800, weapons: 1_200, fuel: 900, research: 400,
  technologies: ['industria_tessile'], capacity: { food: 8_000, clothing: 2_000, weapons: 3_000, fuel: 2_000 }, ...over,
});
const arms = (over: Partial<ArsenalResponse> = {}): ArsenalResponse => ({
  units: { tank: 250 }, qualityIndex: 50,
  manpower: { activePersonnel: 200_000, reservePersonnel: 100_000, mobilizedPersonnel: 0, formations: 10, mobilizedFormations: 0 },
  readiness: { readinessPct: 60 },
  catalog: [{ id: 'tank', name: 'Carro armato', domain: 'terra' }],
  domains: [{ domain: 'terra', label: 'Terra' }],
  ...over,
} as unknown as ArsenalResponse);

const live = (withBaseline = true) => buildNationalDossierLive({
  account: account(), resources: resources(), arms: arms(), initialProfile: withBaseline ? profile() : null,
});
const render = (part: DossierLivePart, withBaseline = true) =>
  renderToStaticMarkup(<NationalDossierLive live={live(withBaseline)} part={part} />);

describe('NationalDossierLive — schede vive', () => {
  it('3. la scheda «stato» rende popolazione, PIL, PIL pro capite, stabilità e tensione', () => {
    const markup = render('stato');
    for (const label of ['Popolazione', 'PIL nominale', 'PIL pro capite', 'Stabilità', 'Tensione sociale']) {
      expect(markup, `manca «${label}»`).toContain(label);
    }
    // L'unità del PIL pro capite si dichiara (N4): niente dollaro nudo.
    expect(markup).toContain('dollari di oggi');
    expect(markup).toContain('Inizio partita');
  });

  it('3b. la scheda «finanze» rende le voci di cassa e debito', () => {
    const markup = render('finanze');
    for (const label of ['Tesoreria', 'Entrate mensili', 'Spese mensili', 'Saldo mensile', 'Debito totale', 'Debito / PIL']) {
      expect(markup, `manca «${label}»`).toContain(label);
    }
    // Saldo corrente non pubblicato: il valore resta «—», mai 0,00 inventato.
    expect(render('finanze')).not.toContain('0,00 mld · Inizio');
  });

  it('4. nessuna metrica del dock ricopia più le etichette delle schede vive', () => {
    // Le cifre che la scheda viva porta sono state tolte dai vecchi blocchi:
    // se una compare ancora nel dock come `label="…"`, la duplicazione è tornata.
    const duplicates = ['Tesoreria', 'Saldo mensile', 'Stabilità', 'Tensione sociale', 'Popolazione', 'PIL pro capite', 'Università', 'Debito pubblico', 'Riserve mobilitate', 'Qualità media armi'];
    for (const label of duplicates) {
      expect(DOCK, `«${label}» è ancora una card del dock: duplicazione col Dossier vivo`)
        .not.toContain(`label="${label}"`);
    }
  });

  it('4c. il riepilogo delle quantità correnti non è più nel vecchio blocco militare', () => {
    // `armsSummary` ridiceva «×N in servizio» per ogni mezzo: ora è solo nella
    // scheda viva «Forze armate». Resta `armsSplit` (deposito/assegnazione), che
    // è un fatto diverso.
    expect(DOCK).not.toContain('Armamenti in servizio');
    expect(DOCK).not.toContain('{armsSummary}');
    expect(DOCK).toContain('{armsSplit}');
  });

  it('7. la ricerca compare in una sola scheda: Risorse = materiali, Tecnologia = ricerca', () => {
    // `live.research` era reso sia in «Risorse strategiche» sia in «Tecnologia».
    const risorse = render('risorse');
    expect(risorse, 'la ricerca non deve stare in Risorse').not.toContain('Punti ricerca');
    const tecnologia = render('tecnologia');
    expect(tecnologia.match(/Punti ricerca/g)?.length, 'la ricerca sta solo in Tecnologia').toBe(1);
  });

  it('4b. ogni scheda viva ha ancora una metrica per volta (nessun doppione interno)', () => {
    const markup = render('militare');
    expect(markup.match(/Personale attivo/g)?.length).toBe(1);
    expect(markup.match(/Prontezza operativa/g)?.length).toBe(1);
    expect(markup.match(/Carro armato/g)?.length).toBe(1);
  });

  it('5. la scheda «tecnologia» usa l\'etichetta leggibile, non l\'ID grezzo', () => {
    const markup = render('tecnologia');
    expect(markup).toContain('Industria tessile');
    expect(markup).not.toContain('industria_tessile');
  });

  it('6. senza baseline (salvataggio legacy) mostra solo lo stato corrente', () => {
    const markup = render('stato', false);
    expect(markup).toContain('Popolazione');
    expect(markup).toContain('Baseline iniziale non disponibile');
    expect(markup).not.toContain('Inizio partita');
  });

  it('nessun addestramento/logistica «attuale» senza fonte corrente', () => {
    const markup = render('militare');
    expect(markup).not.toContain('Addestramento');
    expect(markup).not.toContain('Logistica');
    expect(markup).toContain('Prontezza operativa');
    expect(markup).toContain('Qualità');
  });
});

describe('NationDock — le schede vive stanno nei tab giusti', () => {
  const section = (name: string): string => {
    const start = DOCK.indexOf(`{active === '${name}' && (`);
    expect(start, `sezione ${name} non trovata`).toBeGreaterThan(-1);
    const next = DOCK.indexOf('{active === ', start + 1);
    return DOCK.slice(start, next === -1 ? DOCK.length : next);
  };

  it('«stato» in Situazione, «finanze»/«risorse»/«capacita» in Tesoro', () => {
    expect(section('situazione')).toContain('part="stato"');
    for (const part of ['finanze', 'risorse', 'capacita']) {
      expect(section('tesoro'), `manca ${part} in Tesoro`).toContain(`part="${part}"`);
    }
  });

  it('«tecnologia» in Regno e «militare» in Stato maggiore', () => {
    expect(section('regno')).toContain('part="tecnologia"');
    expect(section('statoMaggiore')).toContain('part="militare"');
    // «tecnologia» non sta più anche in Tesoro: una sola sede.
    expect(section('tesoro')).not.toContain('part="tecnologia"');
  });
});
