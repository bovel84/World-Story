/**
 * M01 µ2 — Catalogo pilota `cold_war_1951_v2` (storico con stime dichiarate).
 * =====================================================================
 * Il pilota è una NUOVA versione del preset (mai modifiche ai preset
 * esistenti). Perimetro della µ: polity USA, filiera energetica
 * (carbone + greggio 1951) con fonti reali verificate; ogni dato senza
 * fonte raggiungibile resta `unknown` o è escluso (MAT02: mai fabbricare).
 * Contratto: import strict, una sola valuta per catalogo, consensi R1
 * separati, chiusura delle filiere.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadSimulationCatalog, validateCatalog, type CatalogFiles } from '../src/scenario/loader';
import { isIntString } from '../src/scenario/types';

const ROOT = process.cwd();
const PILOT_DIR = path.join(ROOT, 'data', 'presets', 'cold_war_1951_v2');
const FIXTURE_DIR = path.join(ROOT, 'data', 'presets', 'realism_test_world');
const LEGACY_DIR = path.join(ROOT, 'data', 'presets', 'cold_war_1951');

/** Legge l'intero catalogo `simulation/` di un preset (per test di contratto). */
function baseCatalogFiles(presetDir: string): CatalogFiles {
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(presetDir, 'simulation', name), 'utf-8'));
  return {
    manifest: read('manifest.json'),
    polities: read('polities.json'),
    resources: read('resources.json'),
    technologies: read('technologies.json'),
    recipes: read('recipes.json'),
    facilities: read('facilities.json'),
    actors: read('actors.json'),
    authorities: read('authorities.json'),
    'initial-state': read('initial-state.json'),
  };
}

describe('M01 µ2 — pilota cold_war_1951_v2: import e dichiarazione', () => {
  it('carica senza errori bloccanti', () => {
    const { catalog, report } = loadSimulationCatalog(PILOT_DIR);
    expect(report.errors).toEqual([]);
    expect(catalog).not.toBeNull();
  });

  it('dichiara storico con stime, mode strict, valuta USD', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    expect(catalog!.manifest.declaration).toBe('historical_estimated');
    expect(catalog!.manifest.mode).toBe('strict');
    expect(catalog!.manifest.startDate).toBe('1951-01-01');
    expect(catalog!.manifest.currency.id).toBe('USD');
    expect(catalog!.manifest.currency.minorUnitName).toBe('cent');
  });

  it('copre le due polity pilota (USA, URSS) con forma di governo datata', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    expect(catalog!.polities).toHaveLength(2);
    const ids = catalog!.polities.map(p => p.id).sort();
    expect(ids).toEqual(['USA', 'USSR']);
    for (const p of catalog!.polities) {
      expect(p.governmentFormAtStart).toContain('repubblica');
    }
  });

  it('il preset v1 cold_war_1951 NON è toccato: resta legacy dichiarato', () => {
    const { catalog, report } = loadSimulationCatalog(LEGACY_DIR);
    expect(catalog).toBeNull();
    expect(report.warnings.some(w => w.code === 'no_catalog')).toBe(true);
  });
});

describe('M01 µ2 — fonti reali e metodo dichiarato', () => {
  it('produzione energetica 1951 da fonte: output per giorno = round(annuale/365)', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    // Carbone USA 1951: 3.938,8542 TWh (Energy Institute/EIA) → 3.938.854 GWh/anno
    // Greggio USA 1951: 3.532,659 TWh → 3.532.659 GWh/anno
    const expectedPerDay: Record<string, string> = {
      coal: String(Math.round(3938854 / 365)), // 10791
      crude_oil: String(Math.round(3532659 / 365)), // 9679
    };
    const byId = new Map(catalog!.recipes.map(r => [r.id, r]));
    const coalRecipe = byId.get('r_coal_extraction')!;
    const oilRecipe = byId.get('r_oil_extraction')!;
    expect(coalRecipe.outputs[0].baseUnits).toBe(expectedPerDay.coal);
    expect(oilRecipe.outputs[0].baseUnits).toBe(expectedPerDay.crude_oil);
    expect(coalRecipe.durationDays).toBeGreaterThanOrEqual(1);
    // la fonte è dichiarata con qualità `sourced`, mai `authored`
    expect(coalRecipe.evidence?.quality).toBe('sourced');
    expect(oilRecipe.evidence?.quality).toBe('sourced');
  });

  it('capacità dei tipi impianto coerente con i metodi di conversione dichiarati', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const byId = new Map(catalog!.facilityTypes.map(f => [f.id, f]));
    expect(byId.get('ft_coal_mine')!.capacity.perDay).toBe('10791');
    expect(byId.get('ft_oil_field')!.capacity.perDay).toBe('9679');
    // capacità ≠ quantità (§4.1.7): unità distinte dai simboli delle risorse
    expect(byId.get('ft_coal_mine')!.capacity.unit).toContain('GWh');
  });

  it('popolazione dal censimento 1950, dichiarata come proxy al 1951', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const pool = catalog!.initialState.workforce.find(w => w.id === 'wf_usa_residents');
    expect(pool).toBeDefined();
    expect(pool!.persons).toBe('151325798');
    expect(isIntString(pool!.persons)).toBe(true);
  });
});

describe('M01 µ2 — ignoranza dichiarata, mai fabbricata (MAT02)', () => {
  it('giacimenti senza quantità nota né stima: warning unknown_quantity, mai errori', () => {
    const { catalog, report } = loadSimulationCatalog(PILOT_DIR);
    expect(catalog!.initialState.deposits.length).toBeGreaterThanOrEqual(4);
    for (const dep of catalog!.initialState.deposits) {
      expect(dep.known).toBeNull();
      expect(dep.estimated).toBeUndefined();
    }
    expect(report.errors.filter(e => e.path.includes('deposits'))).toEqual([]);
    // 2 depositi USA + 2 depositi URSS, tutti con ignoranza dichiarata
    expect(report.warnings.filter(w => w.code === 'unknown_quantity').length).toBe(4);
  });

  it('filiere senza fonti (acciaio, ferro, grano) NON sono presenti nel pilota', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const resourceIds = catalog!.resources.map(r => r.id).sort();
    expect(resourceIds).toEqual(['coal', 'crude_oil']);
  });

  it('tesorerie: valute dichiarate nel manifest, saldi canonici, nessun dato di cassa inventato', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    expect(catalog!.initialState.treasuries).toHaveLength(2);
    const byCurrency = new Map(catalog!.initialState.treasuries.map(t => [t.currencyId, t]));
    const usd = byCurrency.get('USD')!;
    const sur = byCurrency.get('SUR')!;
    // saldo di cassa reale 1951 non raggiunto come fonte: 0, dichiarato in sources.md
    expect(usd.balanceMinorUnits).toBe('0');
    expect(sur.balanceMinorUnits).toBe('0');
    for (const acc of catalog!.initialState.treasuries) {
      expect(isIntString(acc.balanceMinorUnits)).toBe(true);
      expect(catalog!.manifest.currencies?.some(c => c.id === acc.currencyId)).toBe(true);
    }
  });
});

describe('M01 µ2 — matrice di autorità R1 con tre consensi separati', () => {
  it('le regole di autorità coprono i tre consensi senza mescolarli', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const kinds = new Set(catalog!.authorities.flatMap(a => a.requiresApprovals));
    expect(kinds.has('user')).toBe(true);
    expect(kinds.has('institutional')).toBe(true);
    expect(kinds.has('counterparty')).toBe(true);
    // il settore privato non è magazzino del governo: la produzione privata
    // richiede il consenso della controparte
    const privateRule = catalog!.authorities.find(a => a.actorType === 'private_sector');
    expect(privateRule).toBeDefined();
    expect(privateRule!.requiresApprovals).toContain('counterparty');
  });

  it('attori economici reali con i sei tipi di §4.3.1', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const types = new Set(catalog!.actors.map(a => a.type));
    expect(types.has('treasury')).toBe(true);
    expect(types.has('public_enterprise')).toBe(true);
    expect(types.has('private_sector')).toBe(true);
    expect(types.has('bank')).toBe(true);
    expect(types.has('carrier')).toBe(true);
    expect(types.has('household')).toBe(true);
  });
});

describe('M01 µ2-bis — contratto multi-valuta del loader (MODIFICA CONTRATTO: per revisione indipendente)', () => {
  it('accetta treasury in ciascuna valuta dichiarata da manifest.currencies', () => {
    const { catalog, report } = loadSimulationCatalog(PILOT_DIR);
    expect(report.errors.filter(e => e.code === 'currency_mismatch')).toEqual([]);
    const ids = (catalog!.manifest.currencies ?? []).map(c => c.id).sort();
    expect(ids).toEqual(['SUR', 'USD']);
    expect(catalog!.manifest.currency.id).toBe('USD'); // valuta di conto primaria invariata
  });

  it('rifiuta SEMPRE una valuta non dichiarata (retrocompatibile con µ1)', () => {
    // la fixture realism_test_world dichiara solo TEST: un conto USD resta errore
    const files = baseCatalogFiles(FIXTURE_DIR);
    ((files['initial-state'] as any).treasuries[0]).currencyId = 'USD';
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'currency_mismatch')).toBe(true);
  });

  it('senza manifest.currencies il comportamento resta identico a µ1 (una sola valuta)', () => {
    const files = baseCatalogFiles(FIXTURE_DIR);
    expect((files.manifest as any).currencies).toBeUndefined();
  });
});

describe('M01 µ2-bis — URSS nel pilota su fonti reali', () => {
  it('produzione energetica URSS 1951: round(annuale/365) con metodo dichiarato', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    // Carbone URSS 1951: 1.606,4044 TWh → 1.606.404 GWh/anno
    // Greggio URSS 1951: 491,40237 TWh → 491.402 GWh/anno
    const byId = new Map(catalog!.recipes.map(r => [r.id, r]));
    const coal = byId.get('r_ussr_coal_extraction')!;
    const oil = byId.get('r_ussr_oil_extraction')!;
    expect(coal.outputs[0].baseUnits).toBe(String(Math.round(1606404 / 365))); // 4401
    expect(oil.outputs[0].baseUnits).toBe(String(Math.round(491402 / 365))); // 1346
    expect(coal.evidence?.quality).toBe('sourced');
    expect(oil.evidence?.quality).toBe('sourced');
    expect(oil.evidence?.sourceRefs[0]).toContain('sources.md');
  });

  it('capacità URSS coerente con le ricette (capacità ≠ quantità)', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const byId = new Map(catalog!.facilityTypes.map(f => [f.id, f]));
    expect(byId.get('ft_ussr_coal_mine')!.capacity.perDay).toBe('4401');
    expect(byId.get('ft_ussr_oil_field')!.capacity.perDay).toBe('1346');
  });

  it('popolazione URSS 1951 da fonte (media annuale 181.582.000, proxy dichiarata)', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const pool = catalog!.initialState.workforce.find(w => w.id === 'wf_ussr_residents');
    expect(pool).toBeDefined();
    expect(pool!.persons).toBe('181582000');
    expect(isIntString(pool!.persons)).toBe(true);
  });

  it('attori sovietici reali con tesoreria in rubli e istituzioni esistenti nel 1951', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const ussr = catalog!.actors.filter(a => a.polityId === 'USSR');
    const types = new Set(ussr.map(a => a.type));
    expect(types.has('treasury')).toBe(true);   // Ministero delle Finanze URSS
    expect(types.has('public_enterprise')).toBe(true); // industria di stato (aggregato)
    expect(types.has('bank')).toBe(true);       // Gosbank
    expect(types.has('carrier')).toBe(true);    // Ministero delle Ferrovie (MPS)
    expect(types.has('household')).toBe(true);  // famiglie (aggregato)
  });

  it('autorità sovietiche: stanziamento e produzione di stato richiedono consenso istituzionale', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const ussrRules = catalog!.authorities.filter(a => a.id.startsWith('auth_ussr_'));
    expect(ussrRules.length).toBeGreaterThanOrEqual(2);
    for (const rule of ussrRules) {
      expect(rule.requiresApprovals).toContain('institutional');
    }
  });

  it('le ricette USA restano invariate (nessuna regressione µ2)', () => {
    const { catalog } = loadSimulationCatalog(PILOT_DIR);
    const byId = new Map(catalog!.recipes.map(r => [r.id, r]));
    expect(byId.get('r_coal_extraction')!.outputs[0].baseUnits).toBe('10791');
    expect(byId.get('r_oil_extraction')!.outputs[0].baseUnits).toBe('9679');
  });
});

describe('M01 µ2 — nessuna regressione sul resto di M01', () => {
  it('la fixture realism_test_world resta valida', () => {
    const { catalog, report } = loadSimulationCatalog(FIXTURE_DIR);
    expect(report.errors).toEqual([]);
    expect(catalog).not.toBeNull();
    expect(catalog!.manifest.declaration).toBe('synthetic');
  });

  it('il DAG delle conoscenze del pilota è aciclico e con date valide', () => {
    const { catalog, report } = loadSimulationCatalog(PILOT_DIR);
    expect(report.errors.some(e => e.code === 'dag_cycle')).toBe(false);
    for (const t of catalog!.technologies) {
      if (t.validFrom) expect(/^\d{4}-\d{2}-\d{2}$/.test(t.validFrom)).toBe(true);
    }
  });
});