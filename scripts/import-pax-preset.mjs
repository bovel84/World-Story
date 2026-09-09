/**
 * World Story — Importatore preset Pax Historia
 * ==========================================
 * Scarica un preset pubblico da paxhistoria.co (Firestore REST + map-geometry
 * R2), assegna ogni provincia alla nazione che contiene il suo centroide
 * (Natural Earth, point-in-polygon — assegnazione conservativa: i tag originali
 * come «California» restano info di regione, non creano nazioni separate) e
 * genera un pacchetto preset World Story in backend-nest/data/presets/<id>/.
 *
 * Uso:
 *   node scripts/import-pax-preset.mjs [presetUID] [versionID]
 *
 * Default: DSXlVtl943Mg3idMqy2k (Blank Map — WW2 provinces, Isorrowproductions)
 *
 * Nessuna dipendenza esterna: fetch globale (Node 18+).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Config
// ============================================================================

const PRESET_UID = process.argv[2] || 'DSXlVtl943Mg3idMqy2k';
const VERSION_ID = process.argv[3] || '1';

/** Chiave API web pubblica di Pax Historia (client Firebase, è pubblica per design) */
const FIREBASE_API_KEY = 'AIzaSyCTpjwdW5M9H--btVimb9uqmnTQSQ8hr7Q';
const FIREBASE_PROJECT = 'pax-historia-dev';

const FIRESTORE_URL =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}` +
  `/databases/(default)/documents/simplePresets/${PRESET_UID}/versions/${VERSION_ID}` +
  `?key=${FIREBASE_API_KEY}`;

/** ID documento geometria: noto per il preset di default; per altri preset lo
 *  prendiamo dal campo mapGeometryDocumentID (prefix «r2:» → percorso R2). */
const DEFAULT_GEOMETRY_ID =
  'ZStvYODXIYbsWJBYSWQnjiCwHaV2/SmxXCwBltpCIvHuphQNL_3af7di_1771723133518';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NE_COUNTRIES_PATH = path.join(REPO_ROOT, 'backend-nest', 'data', 'geojson', 'countries.geojson');
const REGISTRY_PATH = path.join(REPO_ROOT, 'backend-nest', 'data', 'countries.json');

const OUTPUT_ID = 'paxh_ww2_provinces';
const OUTPUT_DIR = path.join(REPO_ROOT, 'backend-nest', 'data', 'presets', OUTPUT_ID);

/** Precisione coordinate: 4 decimali ≈ 11 m — più che sufficiente */
const COORD_PRECISION = 4;

// ============================================================================
// Helpers geografici (point-in-polygon, ray casting — senza librerie)
// ============================================================================

function featureBBox(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < bbox[0]) bbox[0] = x;
      if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x;
      if (y > bbox[3]) bbox[3] = y;
    }
  }
  return bbox;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Punto dentro il poligono (anello esterno; i buchi sono ignorati — NE non
 *  li usa per i confini di terra che ci interessano). */
function pointInGeometry(lng, lat, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    if (pointInRing(lng, lat, poly[0])) return true;
  }
  return false;
}

function roundRing(ring) {
  return ring.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
}

/** Colori: HSL con golden-angle per varietà, toni smorzati leggibili sulla
 *  mappa scura di World Story (evita nero e grigio neutro). */
function colorForCode(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = (h * 137.508) % 360;
  const sat = 38 + (h % 18);      // 38–55%
  const light = 40 + (h % 16);    // 40–55%
  const s = sat / 100, l = light / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${to255(f(0))}${to255(f(8))}${to255(f(4))}`;
}


// ============================================================================
// Download
// ============================================================================

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return res.json();
}

/** Converte un valore tipizzato Firestore in JS (solo i tipi che ci servono). */
function fv(v) {
  if (v === null || v === undefined) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue?.values) return v.arrayValue.values.map(fv);
  if (v.mapValue?.fields) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields)) out[k] = fv(val);
    return out;
  }
  return undefined;
}

async function downloadPresetDoc() {
  console.log(`⬇️  Scarico il documento preset (Firestore): ${PRESET_UID} v${VERSION_ID} ...`);
  const doc = await fetchJson(FIRESTORE_URL);
  const fields = doc.fields || {};
  const regionDataRaw = fv(fields.regionData) || {};
  const regionData = {};
  for (const [id, val] of Object.entries(regionDataRaw)) {
    regionData[id] = {
      name: typeof val?.name === 'string' ? val.name : `Regione ${id}`,
      tags: Array.isArray(val?.tags) ? val.tags.filter(t => typeof t === 'string') : [],
    };
  }
  const geometryDocId = (typeof fields.mapGeometryDocumentID === 'string'
    ? fields.mapGeometryDocumentID
    : `r2:map-geometry/${DEFAULT_GEOMETRY_ID}`).replace(/^r2:/, '');
  const title = typeof fields.title === 'string' ? fields.title : 'Preset Pax Historia';
  console.log(`   ✅ «${title}» — ${Object.keys(regionData).length} province nel documento`);
  return { title, regionData, geometryDocId };
}

async function downloadGeometry(geometryDocId) {
  const url = `https://map-geometry.paxhistoria.co/${geometryDocId}.json`;
  console.log(`⬇️  Scarico la geometria della mappa ...`);
  const geo = await fetchJson(url);
  const regions = geo.geometry || {};
  console.log(`   ✅ ${Object.keys(regions).length} geometrie (fonte: «${geo.name}»)`);
  return regions;
}

// ============================================================================
// Assegnazione province → nazioni (centroide → Natural Earth)
// ============================================================================

function assignProvincesToCountries(regionData, geometryRegions) {
  console.log('🔎 Carico Natural Earth per l\'assegnazione centroide → nazione ...');
  const ne = JSON.parse(fs.readFileSync(NE_COUNTRIES_PATH, 'utf-8'));

  const countries = ne.features
    .filter(f => f.properties?.code && f.geometry)
    .map(f => {
      const geometry = f.geometry;
      const bbox = featureBBox(geometry);
      return { code: f.properties.code, nameEn: f.properties.nameEn || f.properties.code, geometry, bbox };
    });

  console.log(`   ${countries.length} nazioni Natural Earth caricate`);

  const byCode = new Map();
  const unmatched = [];

  for (const [id, region] of Object.entries(geometryRegions)) {
    // Nel documento sia `geometry` che `centroid` sono stringhe JSON
    let centroidObj, geomParsed;
    try {
      centroidObj = typeof region.centroid === 'string' ? JSON.parse(region.centroid) : region.centroid;
      geomParsed = typeof region.geometry === 'string' ? JSON.parse(region.geometry) : region.geometry;
    } catch {
      unmatched.push({ id, name: regionData[id]?.name || id, reason: 'geometria non parsabile' });
      continue;
    }

    let centroid;
    try {
      centroid = centroidObj?.coordinates;
      if (!Array.isArray(centroid) || centroid.length < 2) throw new Error('centroid assente');
      if (typeof centroid[0] === 'string') centroid = centroid.map(Number);
    } catch {
      unmatched.push({ id, name: regionData[id]?.name || id, reason: 'centroid invalido' });
      continue;
    }
    const [lng, lat] = centroid;

    // Prefiltro bbox poi test puntuale; in caso di overlap scegliamo la
    // nazione con bbox più piccolo (poligono più specifico).
    let best = null;
    for (const c of countries) {
      if (lng < c.bbox[0] || lng > c.bbox[2] || lat < c.bbox[1] || lat > c.bbox[3]) continue;
      if (pointInGeometry(lng, lat, c.geometry)) {
        const area = (c.bbox[2] - c.bbox[0]) * (c.bbox[3] - c.bbox[1]);
        if (!best || area < best.area) best = { c, area };
      }
    }

    if (!best) {
      unmatched.push({ id, name: regionData[id]?.name || id, reason: `centroide fuori da ogni nazione (${lng.toFixed(2)}, ${lat.toFixed(2)})` });
      continue;
    }

    const code = best.c.code;
    if (!byCode.has(code)) {
      byCode.set(code, { code, nameEn: best.c.nameEn, provinces: [], tags: new Set() });
    }
    const entry = byCode.get(code);
    entry.provinces.push({ id, name: regionData[id]?.name || `Regione ${id}`, geometry: geomParsed });
    for (const t of regionData[id]?.tags || []) entry.tags.add(t);
  }

  const total = Object.keys(geometryRegions).length;
  console.log(`🗺️  Province assegnate: ${total - unmatched.length} / ${total} su ${byCode.size} nazioni`);
  if (unmatched.length > 0) {
    console.log(`   ⚠️  ${unmatched.length} province senza nazione (isole/centroidi fuori dai confini NE) — escluse:`);
    for (const u of unmatched.slice(0, 15)) console.log(`      · ${u.name} — ${u.reason}`);
    if (unmatched.length > 15) console.log(`      ... e altre ${unmatched.length - 15}`);
  }

  return { byCode, unmatched };
}

/** Unisce le province di una nazione in Polygon/MultiPolygon unico. */
function mergeProvinces(provinces) {
  const polygons = [];
  for (const p of provinces) {
    const g = p.geometry;
    if (g.type === 'Polygon') polygons.push(g.coordinates.map(roundRing));
    else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) polygons.push(poly.map(roundRing));
    }
    // Altri tipi (LineString ecc.) ignorati: non sono province valide
  }
  if (polygons.length === 0) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

// ============================================================================
// Generazione pacchetto preset
// ============================================================================

function buildPresetPackage(byCode) {
  const registry = fs.existsSync(REGISTRY_PATH)
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    : [];
  const registryByCode = new Map(registry.map(c => [c.code, c]));

  const features = [];
  const countries = [];

  for (const { code, nameEn, provinces, tags } of byCode.values()) {
    const geometry = mergeProvinces(provinces);
    if (!geometry) continue;

    // Nome: registro esistente, altrimenti Natural Earth EN
    const reg = registryByCode.get(code);
    const name = reg?.name || nameEn || code;
    const color = reg?.color || colorForCode(code);

    features.push({
      type: 'Feature',
      properties: { code, name, provinces: provinces.length, tags: [...tags].sort() },
      geometry,
    });

    countries.push({ code, name, color });
  }

  countries.sort((a, b) => a.name.localeCompare(b.name, 'it'));

  // Palette curata per le grandi potenze (stile dei preset esistenti)
  const MAJOR_COLORS = {
    DEU: '#6B6B5A', ITA: '#4F8560', GBR: '#C46A7E', FRA: '#4A6FA5',
    RUS: '#8B3A2E', USA: '#7B9EC7', JPN: '#D9C77A', POL: '#B87A8C',
    CHN: '#C49A5A',
  };
  const countryColors = {};
  for (const c of countries) {
    if (MAJOR_COLORS[c.code]) countryColors[c.code] = MAJOR_COLORS[c.code];
  }

  const preset = {
    id: OUTPUT_ID,
    name: 'Mondo Provinciale WW2 (Pax Historia)',
    description:
      'Import della mappa comunitaria di Pax Historia («Blank Map» di Isorrowproductions): ' +
      'province mondiali d\'epoca raggruppate nelle nazioni reali. Sandbox storicamente aperta ' +
      'al 1939: ogni divergenza è possibile.',
    start_date: '1939-09-01',
    historical_accuracy: 0.85,
    country_codes: countries.map(c => c.code),
    countries,
    country_colors: countryColors,
    base_prompt:
      "Settembre 1939. Il mondo disegnato provincia per provincia è sull'orlo della guerra totale. " +
      "Le potenze europee manovrano tra alleanze fragili e ambizioni imperiali; gli Stati Uniti restano " +
      "isolazionisti dietro l'oceano; il Giappone dilania la Cina; l'Urss osserva e aspetta. " +
      "Ogni nazione ha eserciti, economie e debolezze reali dell'epoca, ma la storia non è scritta: " +
      "ogni decisione può ridisegnare i confini di questo mondo in guerra.",
    author: 'importato da paxhistoria.co (mappa: Isorrowproductions)',
    version: '1.0',
  };

  const lore = [
    '# Mondo Provinciale WW2 (import Pax Historia)',
    '',
    'Mappa comunitaria «WW2 But with more Provinces V90» di Pax Historia',
    '(autore della mappa: Isorrowproductions), importata in World Story.',
    '',
    `Nazioni: ${byCode.size} — Province totali: ${features.reduce((s, f) => s + f.properties.provinces, 0)}.`,
    '',
    'Ogni regione di gioco è una nazione; i confini sono la somma delle sue province d\'epoca.',
    'I tag originali delle province (California, Texas, Nigeria…) sono conservati nelle',
    'proprietà GeoJSON delle nazioni come semplice informazione storico-geografica.',
    '',
    'Situazione di partenza: 1 settembre 1939. Nessun schieramento è bloccato:',
    'alleanze, tradimenti e confini nuovi sono materia di gioco.',
    '',
  ].join('\n');

  return { preset, features, lore };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('─── World Story · import preset Pax Historia ───');
  const { regionData, geometryDocId } = await downloadPresetDoc();
  const geometryRegions = await downloadGeometry(geometryDocId);
  const { byCode } = assignProvincesToCountries(regionData, geometryRegions);
  const { preset, features, lore } = buildPresetPackage(byCode);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'preset.json'), JSON.stringify(preset, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'map.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'lore.md'), lore);

  const mapSize = fs.statSync(path.join(OUTPUT_DIR, 'map.geojson')).size;
  console.log('');
  console.log('🎉 Pacchetto preset generato in', OUTPUT_DIR);
  console.log(`   · preset.json  — ${preset.country_codes.length} nazioni`);
  console.log(`   · map.geojson  — ${features.length} features (${(mapSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log('   · lore.md');
}

main().catch((e) => {
  console.error('❌ Import fallito:', e.message);
  process.exit(1);
});

