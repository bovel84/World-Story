/**
 * World Story — M01 µ1: caricamento e validazione del catalogo di scenario.
 * =====================================================================
 * Regole (piano M01 passi 1–3, maestro §4.4):
 *  - import strict: un errore produce un rapporto con percorsi JSON precisi,
 *    MAI fallback silenzioso (MAT01);
 *  - integrità dei riferimenti, DAG conoscenze, ricette amplificatrici e
 *    cicli a tempo zero rifiutati; chiusura transitiva delle filiere:
 *    un input senza stock iniziale giustificato, giacimento o filiera è
 *    un errore bloccante;
 *  - segnalare insufficiente conoscenza delle fonti e `unknown`, non
 *    fabbricare dati (MAT02).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isIntString,
  type SimulationCatalog,
  type ScenarioManifest,
} from './types';

export type ScenarioSeverity = 'blocking' | 'warning';

export interface ScenarioIssue {
  /** Percorso JSON preciso, es. `recipes[2].inputs[0].baseUnits`. */
  path: string;
  code: string;
  message: string;
  severity: ScenarioSeverity;
}

export interface ScenarioReport {
  presetId: string;
  ok: boolean;
  errors: ScenarioIssue[];
  warnings: ScenarioIssue[];
  catalogHashes: Record<string, string>;
  /** M01 µ4: anteprima di copertura per l'editor (chiusura delle filiere §4.4). */
  coverage: ScenarioCoverage;
}

export interface ScenarioCoverage {
  /** Risorse con fonte giustificata: stock iniziale, giacimento estraibile o filiera chiusa. */
  justified: string[];
  /** Risorse richieste da ricette senza fonte giustificata (bloccanti). */
  missing: string[];
  /** Giacimenti in stato `unknown` dichiarato (warning, non bloccante). */
  unknownDeposits: number;
}

export type CatalogFiles = Partial<Record<
  'manifest' | 'polities' | 'resources' | 'technologies' | 'recipes' | 'facilities' | 'actors' | 'authorities' | 'initial-state',
  unknown
>>;

const SCENARIO_FILES = [
  'manifest.json', 'polities.json', 'resources.json', 'technologies.json',
  'recipes.json', 'facilities.json', 'actors.json', 'authorities.json', 'initial-state.json',
] as const;

function issue(path: string, code: string, message: string, severity: ScenarioSeverity = 'blocking'): ScenarioIssue {
  return { path, code, message, severity };
}

function asArray(value: unknown, path: string, errors: ScenarioIssue[]): any[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(issue(path, 'not_array', 'atteso un array'));
    return [];
  }
  return value;
}

function asObject(value: unknown, path: string, errors: ScenarioIssue[]): Record<string, any> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(issue(path, 'not_object', 'atteso un oggetto'));
    return {};
  }
  return value as Record<string, any>;
}

/** Hash di contenuto del catalogo: base della cache per versione (MAT18). */
export function catalogHash(files: CatalogFiles): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    if (content === undefined) continue;
    // Nota: JSON.stringify mantiene l'ordine di inserimento; per la cache
    // conta la versione del CONTENUTO del file pubblicato.
    hashes[name] = crypto.createHash('sha256').update(name + '\n' + JSON.stringify(content)).digest('hex');
  }
  return hashes;
}

/**
 * Impronta di contenuto del catalogo (M01 passo 4, MAT18): derivata dagli
 * hash di CONTENUTO dei file, non da data/paesi. Due preset con lo stesso
 * anno ma regole diverse hanno impronte diverse: nessun riuso di baseline.
 */
export function catalogFingerprint(hashes: Record<string, string>): string {
  const canonical = Object.keys(hashes).sort().map(key => `${key}:${hashes[key]}`).join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

/** DFS di rilevamento cicli. */
function findCycle(nodes: Array<{ id: string; requires: string[] }>): string[] | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return start >= 0 ? stack.slice(start).concat(id) : [id, id];
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const dep of node.requires || []) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Valida un catalogo già parse-izzato (usato dal loader e dai test). */
export function validateCatalog(files: CatalogFiles): ScenarioReport {
  const errors: ScenarioIssue[] = [];
  const warnings: ScenarioIssue[] = [];
  const manifest = asObject(files.manifest, 'manifest', errors);

  // ── Manifest ────────────────────────────────────────────────────────────
  const manifestId = typeof manifest.id === 'string' ? manifest.id : '';
  if (!manifestId) errors.push(issue('manifest.id', 'missing_field', 'id del manifest obbligatorio'));
  if (manifest.schemaVersion !== 1) errors.push(issue('manifest.schemaVersion', 'schema_version', 'schemaVersion deve essere 1'));
  const startDate = typeof manifest.startDate === 'string' ? manifest.startDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.push(issue('manifest.startDate', 'bad_date', 'data ISO-8601 YYYY-MM-DD richiesta'));
  const currencyId = typeof manifest.currency?.id === 'string' ? manifest.currency.id : '';
  if (!currencyId) errors.push(issue('manifest.currency.id', 'missing_field', 'valuta del catalogo obbligatoria (§4.1)'));
  // µ2-bis: valute aggiuntive dichiarate per i treasury delle polities.
  // Contratto retrocompatibile: senza `currencies` vale solo `currency`.
  const declaredCurrencies = new Set<string>(currencyId ? [currencyId] : []);
  const extraCurrencies = asArray(manifest.currencies, 'manifest.currencies', errors);
  extraCurrencies.forEach((c, i) => {
    const cur = asObject(c, `manifest.currencies[${i}]`, errors);
    if (!cur.id) errors.push(issue(`manifest.currencies[${i}].id`, 'missing_field', 'id valuta dichiarata obbligatorio'));
    else declaredCurrencies.add(String(cur.id));
    if (!cur.minorUnitName) errors.push(issue(`manifest.currencies[${i}].minorUnitName`, 'missing_field', 'sottomultiplo della valuta obbligatorio (§4.1)'));
  });
  if (!['strict', 'authored'].includes(manifest.mode)) errors.push(issue('manifest.mode', 'bad_mode', "mode deve essere 'strict' o 'authored'"));
  if (!['synthetic', 'historical_rigorous', 'historical_estimated', 'ucronia'].includes(manifest.declaration)) {
    errors.push(issue('manifest.declaration', 'bad_declaration', 'dichiarazione del catalogo obbligatoria (fixture sintetica, storico rigoroso/stimato, ucronia)'));
  }

  // ── Collezioni base ─────────────────────────────────────────────────────
  const resources = asArray(files.resources, 'resources', errors);
  const resourceIds = new Set<string>();
  const unitKinds = new Set(['mass', 'volume', 'energy', 'power', 'work', 'count']);
  resources.forEach((r, i) => {
    const p = `resources[${i}]`;
    const res = asObject(r, p, errors);
    if (!res.id) errors.push(issue(`${p}.id`, 'missing_field', 'id risorsa obbligatorio'));
    else if (resourceIds.has(res.id)) errors.push(issue(`${p}.id`, 'duplicate_id', `risorsa duplicata ${res.id}`));
    else resourceIds.add(res.id);
    if (!res.unit || !unitKinds.has(res.unit.kind)) errors.push(issue(`${p}.unit.kind`, 'bad_unit', 'kind unità non valido'));
    if (!res.unit?.symbol) errors.push(issue(`${p}.unit.symbol`, 'missing_field', 'simbolo unità obbligatorio'));
  });

  const polities = asArray(files.polities, 'polities', errors);
  const polityIds = new Set<string>();
  polities.forEach((p, i) => {
    const pp = `polities[${i}]`;
    const pol = asObject(p, pp, errors);
    if (!pol.id) errors.push(issue(`${pp}.id`, 'missing_field', 'id polity obbligatorio'));
    else polityIds.add(pol.id);
    if (!pol.governmentFormAtStart) errors.push(issue(`${pp}.governmentFormAtStart`, 'missing_field', 'forma di governo datata obbligatoria (§4.3)'));
  });

  // ── Conoscenze: DAG ─────────────────────────────────────────────────────
  const technologies = asArray(files.technologies, 'technologies', errors);
  const techIds = new Set<string>();
  const techNodes: Array<{ id: string; requires: string[] }> = [];
  technologies.forEach((t, i) => {
    const tp = `technologies[${i}]`;
    const tech = asObject(t, tp, errors);
    if (!tech.id) errors.push(issue(`${tp}.id`, 'missing_field', 'id tecnologia obbligatorio'));
    else techIds.add(tech.id);
    const requires = asArray(tech.requires, `${tp}.requires`, errors);
    techNodes.push({ id: tech.id, requires });
  });
  for (const node of techNodes) {
    node.requires.forEach((dep, j) => {
      if (!techIds.has(dep)) errors.push(issue(`technologies[${node.id}].requires[${j}]`, 'unknown_ref', `tecnologia ${dep} non definita`));
    });
  }
  const techCycle = findCycle(techNodes.filter(n => n.id));
  if (techCycle) errors.push(issue('technologies', 'dag_cycle', `ciclo nel grafo delle conoscenze: ${techCycle.join(' → ')}`));

  // ── Tipi impianto ───────────────────────────────────────────────────────
  const facilityTypes = asArray(files.facilities, 'facilities', errors);
  const facilityTypeIds = new Set<string>();
  facilityTypes.forEach((f, i) => {
    const fp = `facilities[${i}]`;
    const ft = asObject(f, fp, errors);
    if (!ft.id) errors.push(issue(`${fp}.id`, 'missing_field', 'id tipo impianto obbligatorio'));
    else facilityTypeIds.add(ft.id);
    if (!ft.capacity?.unit || !isIntString(ft.capacity?.perDay)) {
      errors.push(issue(`${fp}.capacity`, 'bad_capacity', 'capacità con unità e perDay intero canonico obbligatorio (capacità ≠ quantità, §4.1.7)'));
    }
    if (ft.maintenance) {
      if (!resourceIds.has(ft.maintenance.resourceId)) errors.push(issue(`${fp}.maintenance.resourceId`, 'unknown_ref', `risorsa ${ft.maintenance.resourceId} non definita`));
      if (!isIntString(ft.maintenance.baseUnits)) errors.push(issue(`${fp}.maintenance.baseUnits`, 'bad_int', 'quantità non canonica'));
    }
  });

  // ── Ricette ─────────────────────────────────────────────────────────────
  const recipes = asArray(files.recipes, 'recipes', errors);
  const recipeIds = new Set<string>();
  recipes.forEach((r, i) => {
    const rp = `recipes[${i}]`;
    const rec = asObject(r, rp, errors);
    const rid = rec.id;
    if (!rid) errors.push(issue(`${rp}.id`, 'missing_field', 'id ricetta obbligatorio'));
    else recipeIds.add(rid);
    if (!facilityTypeIds.has(rec.facilityTypeId)) errors.push(issue(`${rp}.facilityTypeId`, 'unknown_ref', `tipo impianto ${rec.facilityTypeId} non definito`));
    if (!Number.isInteger(rec.durationDays) || rec.durationDays < 1) errors.push(issue(`${rp}.durationDays`, 'bad_duration', 'durata in giorni interi ≥ 1 (niente cicli a tempo zero)'));

    const inputs = asArray(rec.inputs, `${rp}.inputs`, errors);
    const outputs = asArray(rec.outputs, `${rp}.outputs`, errors);
    const inputByRes = new Map<string, bigint>();
    const outputByRes = new Map<string, bigint>();
    const checkQty = (q: unknown, qp: string, map: Map<string, bigint>, sign: 1n | -1n) => {
      const qty = asObject(q, qp, errors);
      if (!resourceIds.has(qty.resourceId)) errors.push(issue(`${qp}.resourceId`, 'unknown_ref', `risorsa ${qty.resourceId} non definita`));
      if (!isIntString(qty.baseUnits) || BigInt(qty.baseUnits) <= 0n) {
        errors.push(issue(`${qp}.baseUnits`, 'bad_int', 'quantità intera canonica > 0 richiesta'));
      } else {
        const id = String(qty.resourceId);
        const prev = map.get(id) ?? 0n;
        map.set(id, prev + BigInt(qty.baseUnits) * sign);
      }
    };
    // Le mappe raccolgono MAGNITUDINI positive per risorsa: servono solo
    // alla verifica di amplificazione qui sotto (nessun calcolo netto).
    inputs.forEach((q, j) => checkQty(q, `${rp}.inputs[${j}]`, inputByRes, 1n));
    outputs.forEach((q, j) => checkQty(q, `${rp}.outputs[${j}]`, outputByRes, 1n));

    // Amplificazione: SOLO se la risorsa è anche input della stessa ricetta
    // (loop che si autoalimenta; l'estrazione senza input non è un ciclo).
    // Un loop netto positivo richiede allowsRecycle esplicito (§4.4).
    for (const [resId, outQty] of outputByRes) {
      const inQty = inputByRes.get(resId) ?? 0n;
      if (inQty > 0n && outQty > inQty && rec.allowsRecycle !== true) {
        errors.push(issue(`${rp}.outputs`, 'amplifying_recipe', `la ricetta produce più ${resId} di quanto consumi senza allowsRecycle esplicito (nessun ciclo gratuito)`));
      }
    }
  });
  // I cicli produttivi fra ricette diverse sono ammessi solo a durata
  // positiva con perdite/consumi espliciti (già forzato da bad_duration:
  // ogni ricetta ha durata ≥ 1) — §4.4.

  // ── Attori e autorità ───────────────────────────────────────────────────
  const actors = asArray(files.actors, 'actors', errors);
  const actorIds = new Set<string>();
  actors.forEach((a, i) => {
    const ap = `actors[${i}]`;
    const act = asObject(a, ap, errors);
    if (!act.actorId) errors.push(issue(`${ap}.actorId`, 'missing_field', 'actorId obbligatorio'));
    else if (actorIds.has(act.actorId)) errors.push(issue(`${ap}.actorId`, 'duplicate_id', `attore duplicato ${act.actorId}`));
    else actorIds.add(act.actorId);
    if (!polityIds.has(act.polityId)) errors.push(issue(`${ap}.polityId`, 'unknown_ref', `polity ${act.polityId} non definita`));
    if (!['treasury', 'public_enterprise', 'private_sector', 'bank', 'carrier', 'household'].includes(act.type)) {
      errors.push(issue(`${ap}.type`, 'bad_actor_type', 'tipo attore non valido (§4.3.1)'));
    }
  });

  const authorities = asArray(files.authorities, 'authorities', errors);
  authorities.forEach((a, i) => {
    const ap = `authorities[${i}]`;
    const rule = asObject(a, ap, errors);
    if (!rule.id) errors.push(issue(`${ap}.id`, 'missing_field', 'id regola di autorità obbligatorio'));
    if (!rule.activity) errors.push(issue(`${ap}.activity`, 'missing_field', 'attività ammessa obbligatoria'));
    const approvals = asArray(rule.requiresApprovals, `${ap}.requiresApprovals`, errors);
    for (const kind of approvals) {
      if (!['user', 'institutional', 'counterparty'].includes(kind)) {
        errors.push(issue(`${ap}.requiresApprovals`, 'bad_approval', "consenso deve essere 'user' | 'institutional' | 'counterparty'"));
      }
    }
  });

  // ── Stato iniziale ──────────────────────────────────────────────────────
  const initial = asObject(files['initial-state'], 'initial-state', errors);
  const treasuries = asArray(initial.treasuries, 'initial-state.treasuries', errors);
  treasuries.forEach((t, i) => {
    const tp = `initial-state.treasuries[${i}]`;
    const acc = asObject(t, tp, errors);
    if (!actorIds.has(acc.actorId)) errors.push(issue(`${tp}.actorId`, 'unknown_ref', `attore ${acc.actorId} non definito`));
    if (!declaredCurrencies.has(String(acc.currencyId))) errors.push(issue(`${tp}.currencyId`, 'currency_mismatch', `conto in valuta ${acc.currencyId}, catalogo dichiara: ${[...declaredCurrencies].join(', ')}`));
    if (!isIntString(acc.balanceMinorUnits)) errors.push(issue(`${tp}.balanceMinorUnits`, 'bad_int', 'saldo non canonico (stringa decimale intera)'));
  });

  const inventory = asArray(initial.inventory, 'initial-state.inventory', errors);
  const stockByResource = new Set<string>();
  inventory.forEach((l, i) => {
    const lp = `initial-state.inventory[${i}]`;
    const lot = asObject(l, lp, errors);
    if (!actorIds.has(lot.ownerActorId)) errors.push(issue(`${lp}.ownerActorId`, 'unknown_ref', `attore proprietario ${lot.ownerActorId} non definito`));
    if (lot.custodianActorId && !actorIds.has(lot.custodianActorId)) errors.push(issue(`${lp}.custodianActorId`, 'unknown_ref', `depositario ${lot.custodianActorId} non definito`));
    const qty = asObject(lot.quantity, `${lp}.quantity`, errors);
    if (!resourceIds.has(qty.resourceId)) errors.push(issue(`${lp}.quantity.resourceId`, 'unknown_ref', `risorsa ${qty.resourceId} non definita`));
    if (!isIntString(qty.baseUnits)) errors.push(issue(`${lp}.quantity.baseUnits`, 'bad_int', 'quantità non canonica'));
    stockByResource.add(String(qty.resourceId));
  });

  const deposits = asArray(initial.deposits, 'initial-state.deposits', errors);
  const extractable = new Set<string>();
  deposits.forEach((d, i) => {
    const dp = `initial-state.deposits[${i}]`;
    const dep = asObject(d, dp, errors);
    if (dep.known !== null && dep.known !== undefined) {
      const qty = asObject(dep.known, `${dp}.known`, errors);
      if (!resourceIds.has(qty.resourceId)) errors.push(issue(`${dp}.known.resourceId`, 'unknown_ref', `risorsa ${qty.resourceId} non definita`));
      if (!isIntString(qty.baseUnits)) errors.push(issue(`${dp}.known.baseUnits`, 'bad_int', 'quantità non canonica'));
      if (dep.accessibility !== 'hidden') extractable.add(String(qty.resourceId));
    }
    if (dep.known === null && !dep.estimated) {
      warnings.push(issue(`${dp}.known`, 'unknown_quantity', 'giacimento senza quantità nota né stima: resta `unknown`, non fabbricare dati (MAT02)', 'warning'));
    }
    if (dep.yieldRate && (!isIntString(dep.yieldRate.numerator) || !isIntString(dep.yieldRate.denominator) || BigInt(dep.yieldRate.denominator) <= 0n)) {
      errors.push(issue(`${dp}.yieldRate`, 'bad_ratio', 'rateo come razionale numerator/denominator con denominatore > 0 (§4.1.3)'));
    }
  });

  const workforce = asArray(initial.workforce, 'initial-state.workforce', errors);
  workforce.forEach((w, i) => {
    const wp = `initial-state.workforce[${i}]`;
    const pool = asObject(w, wp, errors);
    if (!isIntString(pool.persons) || BigInt(pool.persons) < 0n) errors.push(issue(`${wp}.persons`, 'bad_int', 'persone intere ≥ 0'));
  });

  const facilities = asArray(initial.facilities, 'initial-state.facilities', errors);
  facilities.forEach((f, i) => {
    const fp = `initial-state.facilities[${i}]`;
    const fac = asObject(f, fp, errors);
    if (!facilityTypeIds.has(fac.typeId)) errors.push(issue(`${fp}.typeId`, 'unknown_ref', `tipo impianto ${fac.typeId} non definito`));
    if (!actorIds.has(fac.ownerActorId)) errors.push(issue(`${fp}.ownerActorId`, 'unknown_ref', `proprietario ${fac.ownerActorId} non definito`));
    if (!actorIds.has(fac.controllerActorId)) errors.push(issue(`${fp}.controllerActorId`, 'unknown_ref', `controllore ${fac.controllerActorId} non definito`));
  });

  // ── Chiusura transitiva delle filiere (§4.4) ────────────────────────────
  // Una risorsa è "giustificata" se: c'è stock iniziale, un giacimento
  // estraibile, o una ricetta che la produce (ricorsivamente a punto fisso).
  const producersOf = new Map<string, string[]>();
  for (const rec of recipes as any[]) {
    for (const out of rec.outputs || []) {
      const list = producersOf.get(out.resourceId) ?? [];
      list.push(rec.id);
      producersOf.set(out.resourceId, list);
    }
  }
  const justified = new Set<string>([...stockByResource, ...extractable]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const rec of recipes as any[]) {
      const outputs = (rec.outputs || []) as any[];
      const inputs = (rec.inputs || []) as any[];
      if (!outputs.every(o => justified.has(o.resourceId))) continue;
      // input senza fonte già giustificata bloccano la giustificazione
      // della ricetta: la chiusura richiede l'intera filiera.
      if (inputs.length > 0 && !inputs.every(inp => justified.has(inp.resourceId))) continue;
      for (const out of outputs) {
        if (!justified.has(out.resourceId)) { justified.add(out.resourceId); grew = true; }
      }
    }
  }
  const missingInputs = new Set<string>();
  for (const rec of recipes as any[]) {
    for (const inp of (rec.inputs || []) as any[]) {
      if (!justified.has(inp.resourceId)) {
        missingInputs.add(String(inp.resourceId));
        errors.push(issue(`recipes[${rec.id}].inputs`, 'unjustified_input', `la ricetta ${rec.id} richiede ${inp.resourceId} senza stock iniziale, giacimento estraibile o filiera definita (chiusura transitiva §4.4)`));
      }
    }
  }
  const unknownDeposits = warnings.filter(w => w.code === 'unknown_quantity').length;

  const catalogHashes = catalogHash(files);
  return {
    presetId: manifestId,
    ok: errors.length === 0,
    errors,
    warnings,
    catalogHashes,
    // M01 µ4: anteprima di copertura per l'editor.
    coverage: {
      justified: [...justified].sort(),
      missing: [...missingInputs].sort(),
      unknownDeposits,
    },
  };
}

/** Carica e valida il catalogo `simulation/` di un preset su disco. */
export function loadSimulationCatalog(presetDir: string): { catalog: SimulationCatalog | null; report: ScenarioReport } {
  const presetId = path.basename(presetDir);
  const simDir = path.join(presetDir, 'simulation');
  if (!fs.existsSync(simDir)) {
    return {
      catalog: null,
      report: {
        presetId, ok: true,
        errors: [],
        warnings: [issue('simulation/', 'no_catalog', 'preset legacy: nessun catalogo simulation/ (dichiaratamente non migrato)', 'warning')],
        catalogHashes: {},
        coverage: { justified: [], missing: [], unknownDeposits: 0 },
      },
    };
  }
  const errors: ScenarioIssue[] = [];
  const files: CatalogFiles = {};
  for (const fileName of SCENARIO_FILES) {
    const full = path.join(simDir, fileName);
    const key = fileName.replace(/\.json$/, '').replace('initial-state', 'initial-state') as keyof CatalogFiles;
    if (!fs.existsSync(full)) {
      errors.push(issue(key, 'missing_file', `file di catalogo mancante: simulation/${fileName}`));
      continue;
    }
    try {
      (files as any)[key] = JSON.parse(fs.readFileSync(full, 'utf-8'));
    } catch (e: any) {
      errors.push(issue(key, 'bad_json', `JSON non valido: ${e.message}`));
    }
  }
  const report = validateCatalog(files);
  report.errors.unshift(...errors);
  report.ok = report.ok && errors.length === 0;

  let catalog: SimulationCatalog | null = null;
  if (report.ok) {
    const manifest = files.manifest as unknown as ScenarioManifest;
    catalog = {
      manifest: { ...manifest, catalogHashes: report.catalogHashes },
      polities: files.polities as any[] ?? [],
      resources: files.resources as any[] ?? [],
      technologies: files.technologies as any[] ?? [],
      recipes: files.recipes as any[] ?? [],
      facilityTypes: files.facilities as any[] ?? [],
      actors: files.actors as any[] ?? [],
      authorities: files.authorities as any[] ?? [],
      initialState: files['initial-state'] as any,
    };
  }
  return { catalog, report };
}