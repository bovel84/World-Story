#!/usr/bin/env node
/* Convert one country-level game/world to Pax provinces. Usage: node ... <gameId> */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
process.chdir(path.join(root, 'backend-nest'));
const db = require('../backend-nest/dist/database').default;
const { geometryAreaDeg2, pointInGeometry } = require('../backend-nest/dist/utils/geo');
const { paxSettlementObjectsForGeometry } = require('../backend-nest/dist/utils/pax-geography');

const gameId = process.argv[2];
if (!gameId) throw new Error('Usage: node scripts/migrate-game-to-pax-provinces.js <gameId>');
const game = db.prepare('SELECT world_id FROM games WHERE id = ?').get(gameId);
if (!game) throw new Error(`Game ${gameId} not found`);
const worldId = game.world_id;
const sourceRows = db.prepare('SELECT * FROM world_regions WHERE world_id = ?').all(worldId);
if (sourceRows.some(row => String(row.id).includes('_pax-'))) throw new Error('World already uses Pax provinces');
const sourceByCountry = new Map(sourceRows.map(row => [String(row.flag || row.owner || '').toUpperCase(), row]));
const featureCollection = JSON.parse(fs.readFileSync(path.join(root, 'backend-nest/data/presets/pax_modern_provinces/map.geojson'), 'utf8'));
const features = featureCollection.features.filter(feature => sourceByCountry.has(feature.properties.country));
if (!features.length) throw new Error('No Pax provinces match this world');
const capitals = JSON.parse(fs.readFileSync(path.join(root, 'backend-nest/data/geojson/capitals.json'), 'utf8'));

const byCountry = new Map();
for (const feature of features) {
  const code = feature.properties.country;
  if (!byCountry.has(code)) byCountry.set(code, []);
  byCountry.get(code).push(feature);
}
const newId = feature => `${worldId}_${feature.properties.code}`;
const validProvinceIds = new Set(features.map(newId));
const provinceByCountry = new Map();
for (const [code, provinces] of byCountry) {
  const weights = provinces.map(feature => Math.max(geometryAreaDeg2(feature.geometry), 0.00001));
  const total = weights.reduce((sum, value) => sum + value, 0);
  provinceByCountry.set(code, { provinces, weights, total });
}
function provinceForPoint(code, lng, lat) {
  const data = provinceByCountry.get(code);
  if (!data || typeof lng !== 'number' || typeof lat !== 'number') return null;
  return data.provinces.find(feature => pointInGeometry([lng, lat], feature.geometry)) || null;
}
function homeProvince(code) {
  const cap = capitals[code];
  const containing = cap && provinceForPoint(code, cap.lng, cap.lat);
  const data = provinceByCountry.get(code);
  return containing || data?.provinces.find(feature => feature.properties.is_capital) || data?.provinces[0] || null;
}
function nonGeographicObjects(source, code, feature) {
  const sourceObjects = Array.isArray(source.objects) ? source.objects : JSON.parse(source.objects || '[]');
  return sourceObjects.filter(object => {
    if (object.type === 'city' || object.type === 'capital') return false;
    const home = homeProvince(code);
    if (typeof object.lat === 'number' && typeof object.lng === 'number') {
      return pointInGeometry([object.lng, object.lat], feature.geometry);
    }
    return home?.properties.code === feature.properties.code;
  });
}
function makeRows(sourceStates) {
  const out = [];
  for (const [code, data] of provinceByCountry) {
    const source = sourceStates.get(code) || sourceByCountry.get(code);
    if (!source) continue;
    data.provinces.forEach((feature, index) => {
      const share = data.weights[index] / data.total;
      const settlements = paxSettlementObjectsForGeometry(feature.geometry, Infinity);
      const objects = [...settlements, ...nonGeographicObjects(source, code, feature)];
      const props = feature.properties;
      out.push({
        id: newId(feature), name: props.name, svgPath: '', geojson: JSON.stringify(feature),
        color: source.color, owner: source.owner, flag: code,
        population: Math.max(1, Math.round(Number(source.population || 0) * share)),
        gdp: Math.max(0, Number(source.gdp || 0) * share),
        militaryPower: Math.max(0, Number(source.militaryPower ?? source.military_power ?? 0) * share),
        borders: (props.adjacencies || []).map(id => `${worldId}_pax-${id}`).filter(id => validProvinceIds.has(id)),
        objects, status: source.status || 'active',
        metadata: JSON.stringify({ pax_region_id: props.pax_region_id, tags: props.tags, centroid: props.centroid, surface_type: props.surface_type }),
      });
    });
  }
  return out;
}

// Backup is created by the caller while the backend is stopped.
const backup = process.env.PAX_BACKUP || '(external backup)';

const currentStates = new Map(sourceRows.map(row => [String(row.flag || row.owner || '').toUpperCase(), {
  ...row, militaryPower: row.military_power,
}]));
const rows = makeRows(currentStates);
const saves = db.prepare('SELECT id, data FROM saves WHERE game_id = ?').all(gameId);
const insert = db.prepare(`INSERT INTO world_regions (id, world_id, name, svg_path, geojson, color, owner, population, gdp, military_power, borders, objects, status, metadata, flag)
  VALUES (@id, @worldId, @name, @svgPath, @geojson, @color, @owner, @population, @gdp, @militaryPower, @borders, @objects, @status, @metadata, @flag)`);
const updatePlayer = db.prepare('UPDATE players SET region_id = ? WHERE id = ?');
const updateSave = db.prepare('UPDATE saves SET data = ? WHERE id = ?');

db.transaction(() => {
  db.prepare('DELETE FROM world_regions WHERE world_id = ?').run(worldId);
  for (const row of rows) insert.run({ ...row, worldId, borders: JSON.stringify(row.borders), objects: JSON.stringify(row.objects) });

  const players = db.prepare('SELECT id, region_id, polity_id FROM players WHERE game_id = ?').all(gameId);
  for (const player of players) {
    const code = String(player.polity_id || String(player.region_id).split('_').pop()).toUpperCase();
    const home = homeProvince(code);
    if (home) updatePlayer.run(newId(home), player.id);
  }

  for (const save of saves) {
    const data = JSON.parse(save.data);
    const states = new Map((data.regions || []).map(([id, state]) => [String(state.id || id).split('_').pop().toUpperCase(), state]));
    data.regions = makeRows(states).map(row => [row.id, {
      id: row.id, name: row.name, color: row.color, owner: row.owner,
      population: row.population, gdp: row.gdp, militaryPower: row.militaryPower,
      objects: row.objects, svgPath: '', status: row.status,
    }]);
    data.players = (data.players || []).map(player => {
      const code = String(player.polityId || player.regionId || '').split('_').pop().toUpperCase();
      const home = homeProvince(code);
      return home ? { ...player, regionId: newId(home), polityId: code } : player;
    });
    updateSave.run(JSON.stringify(data), save.id);
  }
})();
console.log(JSON.stringify({ gameId, worldId, previousCountryRegions: sourceRows.length, paxProvinceRegions: rows.length, savesMigrated: saves.length, backup }, null, 2));
