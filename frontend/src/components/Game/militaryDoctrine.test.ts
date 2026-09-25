/**
 * World Story — N05/N06: la dottrina d'epoca nel dossier militare
 * ==============================================================
 * Invarianti **N3** («nessuna schermata dichiara una pertinenza che non può
 * provare») e **N4** («nessun'etichetta d'epoca scritta a mano nel client»).
 *
 * Il difetto misurato: in una partita del 1815 il dossier elencava le 31 voci del
 * catalogo del motore — carri di 4ª generazione, caccia di 5ª generazione,
 * portaerei, missili ipersonici — sotto cinque intestazioni di dominio scritte a
 * mano nel componente. La dottrina pre-industriale dichiara una sola categoria
 * pertinente.
 *
 * Il client **non può filtrare**: il predicato `match` categoria↔epoca non è
 * pubblicato. Può però smettere di far passare il catalogo per la dottrina
 * d'epoca, ed è quello che questi test difendono.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctrineView, hasDoctrine } from './militaryDoctrine';
import type { EstablishmentCategoryPayload } from '../../services/api';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

/** Le categorie che il motore pubblica per `pre_industriale` (misurate). */
const PRE_INDUSTRIALE: EstablishmentCategoryPayload[] = [
  {
    category: 'individualWeapons',
    label: 'Armi individuali',
    perFormation: null,
    perMobilized: null,
    personnelSharePct: 90,
    demand: 'personnel_share',
    weight: 1,
    source: 'doctrine',
    basis: 'Un esercito pre-industriale si misura sulle armi individuali: il catalogo dell’epoca non ha mezzi corazzati, aerei o missili.',
  },
];

const GUERRA_FREDDA: EstablishmentCategoryPayload[] = [
  { category: 'individualWeapons', label: 'Armi individuali', perFormation: null, perMobilized: null, personnelSharePct: 35, demand: 'personnel_share', weight: 0.3, source: 'doctrine', basis: 'x' },
  { category: 'armoredMobility', label: 'Mobilità corazzata', perFormation: 2, perMobilized: 1, personnelSharePct: null, demand: 'per_formation', weight: 0.2, source: 'doctrine', basis: 'y' },
  { category: 'navalSupport', label: 'Supporto navale', perFormation: 0.5, perMobilized: null, personnelSharePct: null, demand: 'per_formation', weight: 0.15, source: 'doctrine', basis: 'z' },
];

describe('N05 — la dottrina si legge dal motore, non si scrive nel client', () => {
  it('espone epoca, categorie previste e motivazione del motore', () => {
    const view = doctrineView(PRE_INDUSTRIALE, 'Eserciti pre-industriali');
    expect(view.epochLabel).toBe('Eserciti pre-industriali');
    expect(view.categories).toHaveLength(1);
    expect(view.categories[0].label).toBe('Armi individuali');
    expect(view.categories[0].basis).toContain('non ha mezzi corazzati');
    expect(hasDoctrine(view)).toBe(true);
  });

  it('la sintesi distingue le categorie a quota di personale', () => {
    expect(doctrineView(PRE_INDUSTRIALE, 'x').summary).toBe('Armi individuali (quota degli uomini in armi)');
    expect(doctrineView(GUERRA_FREDDA, 'x').summary).toContain('Mobilità corazzata');
    expect(doctrineView(GUERRA_FREDDA, 'x').summary).not.toContain('Mobilità corazzata (quota');
  });

  it('senza dottrina pubblicata non afferma nulla (N7)', () => {
    const vuota = doctrineView([], null);
    expect(hasDoctrine(vuota)).toBe(false);
    expect(vuota.summary).toBe('');
    expect(vuota.epochLabel).toBeNull();
    expect(doctrineView(undefined, undefined).categories).toEqual([]);
  });

  it('il dossier non elenca più i domini con una lista scritta a mano', () => {
    const dock = read('./NationDock.tsx');
    // Il difetto rimosso: i cinque domini hardcoded nel componente.
    expect(dock).not.toMatch(/\['terra', 'aria', 'mare', 'missili', 'droni'\]/);
    // Ora vengono dal motore.
    expect(dock).toMatch(/catalogDomains/);
    expect(dock).toMatch(/arms\.domains/);
  });

  it('il catalogo si dichiara per quello che è', () => {
    const dock = read('./NationDock.tsx');
    // La description della card non presenta più il catalogo come la dottrina
    // della nazione: dice che è il catalogo del motore e cosa l'epoca prevede.
    expect(dock).toMatch(/Catalogo completo del motore/);
    expect(dock).toMatch(/L'epoca prevede:/);
  });

  it('il client non ricopia il predicato categoria-epoca del motore', () => {
    // Guardia contro il falso verde **e** contro la tentazione di filtrare nel
    // client: nessuna tabella di categorie per epoca nel frontend.
    const doctrine = read('./militaryDoctrine.ts');
    expect(doctrine).not.toMatch(/Fanteria|Corazzati|Artiglieria|Aerei da combattimento/);
    expect(doctrine).toMatch(/non è pubblicato|non è serializzato|non filtra/);
  });
});

describe('N06 — le conoscenze dichiarano la fonte vera', () => {
  it('la card non attribuisce al motore un catalogo che non pubblica', () => {
    const dock = read('./NationDock.tsx');
    // Il difetto rimosso: «Catalogo tecnologie del motore» sopra un elenco che
    // era invece quello degli sblocchi.
    expect(dock).not.toMatch(/Catalogo tecnologie del motore/);
    expect(dock).toMatch(/tecnologie che il motore pubblica come sbloccate/);
  });

  it('l\'epoca è dichiarata accanto alle conoscenze', () => {
    const dock = read('./NationDock.tsx');
    const block = dock.match(/title="Tecnologie sbloccate"[\s\S]*?<\/DossierBlock>/)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).toMatch(/non dichiara un.*epoca delle tecnologie/);
    expect(block).toMatch(/epochView\.year/);
    // E la lista mostra davvero le tecnologie pubblicate dal motore.
    expect(block).toMatch(/resources\.technologies\.map/);
  });
});
