#!/usr/bin/env node
/** Assemble the 4,588 Pax province files into a game-ready FeatureCollection. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const input = '/Users/bovel/Downloads/pax_province_poligoni_individuali (1)';
const regionData = JSON.parse(fs.readFileSync('/Users/bovel/Downloads/pax_region_data.json', 'utf8'));
const elements = Object.values(JSON.parse(fs.readFileSync('/Users/bovel/Downloads/pax_elements.json', 'utf8')));
const countries = JSON.parse(fs.readFileSync(path.join(root, 'backend-nest/data/geojson/countries.geojson'), 'utf8')).features;
const output = path.join(root, 'backend-nest/data/presets/pax_modern_provinces/map.geojson');

function bbox(geometry) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      minLng = Math.min(minLng, value[0]); maxLng = Math.max(maxLng, value[0]);
      minLat = Math.min(minLat, value[1]); maxLat = Math.max(maxLat, value[1]);
    } else value.forEach(visit);
  };
  visit(geometry.coordinates);
  return { minLng, maxLng, minLat, maxLat };
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function contains(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(poly => inRing(point, poly[0]) && !poly.slice(1).some(hole => inRing(point, hole)));
}
const countryIndex = countries.map(feature => ({
  code: feature.properties.code,
  geometry: feature.geometry,
  box: bbox(feature.geometry),
}));
const capitalRegionIds = new Set(elements
  .filter(element => element.classification === 'capital' && element.location?.regionID !== undefined)
  .map(element => String(element.location.regionID)));

const features = [];
const unmatched = [];
for (const filename of fs.readdirSync(input).filter(name => name.endsWith('.geojson')).sort()) {
  const collection = JSON.parse(fs.readFileSync(path.join(input, filename), 'utf8'));
  const feature = collection.features?.[0];
  if (!feature?.geometry || !feature.properties?.region_id) continue;
  const props = feature.properties;
  const id = String(props.region_id);
  const [lng, lat] = props.centroid || [NaN, NaN];
  const candidates = countryIndex.filter(country => lng >= country.box.minLng && lng <= country.box.maxLng
    && lat >= country.box.minLat && lat <= country.box.maxLat);
  // Some country bboxes cross the antimeridian; try the exact point against all as fallback.
  const country = candidates.find(candidate => contains([lng, lat], candidate.geometry))
    || countryIndex.find(candidate => contains([lng, lat], candidate.geometry));
  if (!country) { unmatched.push({ id, name: props.name, centroid: props.centroid }); continue; }
  const catalog = regionData[id] || {};
  features.push({
    type: 'Feature',
    id: `pax-${id}`,
    properties: {
      code: `pax-${id}`,
      country: country.code,
      pax_region_id: id,
      name: catalog.name || props.name || id,
      tags: catalog.tags || props.tags || [],
      surface_type: props.surface_type || null,
      adjacencies: props.adjacencies || [],
      centroid: props.centroid,
      is_capital: capitalRegionIds.has(id),
    },
    geometry: feature.geometry,
  });
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(JSON.stringify({ output, provinces: features.length, countries: new Set(features.map(f => f.properties.country)).size, unmatched: unmatched.length, unmatched: unmatched.slice(0, 20) }, null, 2));
