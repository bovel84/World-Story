import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import { buildMapContextIndex } from '../Map/mapContext';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import {
  buildGovernmentVisualSnapshot, governmentVisualModel, playerOwnedRegionIds, resolveGovernmentVisuals,
  type GovernmentVisualSnapshot, type MapFocusVisual,
} from './governmentVisual';
import { captureGovernmentMapRequest, readGovernmentVisualMetadata, isGovernmentMapRequest } from './governmentVisualRequest';
import { parsePresentation } from './presentation';
import { appendCouncilMessage, createCouncilRoom, receiveCouncilReply } from './councilRoom';
import { CABINET_SEATS } from './seatDecisionBoards';
import { MAX_MAP_PREVIEW_REGIONS } from './presentation';

const SCOPE = 'game:A:branch:1';

/** N owned regions with an absolute svgPath, so a preview can actually be drawn. */
const ownedRegions = (n: number, owner = 'A'): Region[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `own${i}`, name: `Territorio ${i}`, polityName: `Paese ${owner}`, owner, color: '#315f87',
    svgPath: `M${i * 100} 0 L${i * 100 + 60} 0 L${i * 100 + 60} 60 Z`,
    objects: [], borders: [], metadata: {},
  } as unknown as Region));

/** NAKED world: no fronts at all, no diplomatic relations. The author's real case. */
const naked = (regions: Region[], playerPolityId: string | undefined = 'A'): GovernmentVisualSnapshot => buildGovernmentVisualSnapshot({
  scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
  index: buildMapContextIndex({ regions, units: [], fronts: [] }), unavailable: false, playerPolityId,
})!;

const explicitRequest = () => ({ requested: true as const, scopeKey: SCOPE, signalKeys: [] as string[] });

describe('M-I3 — una richiesta esplicita mostra il territorio posseduto, senza fronti', () => {
  it('richiesta esplicita, nessun segnale, nessun fronte → una card col territorio posseduto', () => {
    const snapshot = naked(ownedRegions(4));
    const request = captureGovernmentMapRequest({ presidentText: 'Mostrami la mappa del nostro paese.', directives: [], signalKeys: [], scopeKey: SCOPE })!;
    expect(request.regionIds).toBeUndefined(); // il contratto non cambia: la geografia la risolve il motore
    const message = { role: 'assistant' as const, content: 'Ecco il paese.', visualRequest: request };
    const cards = resolveGovernmentVisuals(message, snapshot);
    expect(cards).toHaveLength(1);
    expect(cards[0].regionIds).toEqual(['own0', 'own1', 'own2', 'own3']);
    expect(cards[0].description).toContain('non indica operazioni');
  });

  it('il percorso completo del Consiglio: la frase del Presidente diventa una card', () => {
    const snapshot = naked(ownedRegions(3));
    const seat = CABINET_SEATS[0];
    const room = appendCouncilMessage(createCouncilRoom({ id: 'room', scopeKey: 'session', initiatorMinister: seat }),
      { id: 'president', role: 'user', kind: 'speech', content: 'Mostrami la mappa del nostro paese.' });
    const next = receiveCouncilReply(room, seat, 'Presidente, ecco il contesto.', 'reply', SCOPE);
    const message = next.messages.at(-1)!;
    expect(message.visualRequest).toBeDefined();
    expect(resolveGovernmentVisuals(message, snapshot)).toHaveLength(1);
  });

  it('una menzione non esplicita NON forza la mappa', () => {
    const snapshot = naked(ownedRegions(4));
    expect(captureGovernmentMapRequest({ presidentText: 'Parliamo della riforma agraria.', directives: [], signalKeys: [], scopeKey: SCOPE })).toBeUndefined();
    expect(resolveGovernmentVisuals({ role: 'assistant', content: 'Certo.' }, snapshot)).toEqual([]);
  });

  it('una chiave NON geografica (economia) non blocca la richiesta esplicita', () => {
    // In produzione l'Advisor eredita le chiavi del messaggio precedente: una
    // richiesta esplicita «mostrami la mappa» non deve andare persa solo perché
    // il turno parlava di bilancio.
    const snapshot = naked(ownedRegions(3));
    const request = { requested: true as const, scopeKey: SCOPE, signalKeys: ['monthly-balance'] };
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: '', visualRequest: request }, snapshot);
    expect(cards).toHaveLength(1);
    expect(cards[0].regionIds).toEqual(['own0', 'own1', 'own2']);
  });
});

describe('M-I6 — la mappa posseduta non preempta i riferimenti verificati', () => {
  const threeOwners = (): Region[] => [
    { id: 'r0', name: 'Casa', owner: 'A', polityName: 'Paese A', color: '#315f87', svgPath: 'M0 0L60 0L60 60Z', objects: [], borders: [], metadata: {} },
    { id: 'r1', name: 'Ostile', owner: 'B', polityName: 'Paese B', color: '#ad7749', svgPath: 'M60 0L120 0L120 60Z', objects: [], borders: [], metadata: {} },
    { id: 'r2', name: 'Terzo', owner: 'C', polityName: 'Paese C', color: '#777777', svgPath: 'M120 0L180 0L180 60Z', objects: [], borders: [], metadata: {} },
  ] as Region[];
  const withRelations = (relationships: Record<string, Record<string, string>>) => buildGovernmentVisualSnapshot({
    scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
    index: buildMapContextIndex({ regions: threeOwners(), units: [], fronts: [] }), unavailable: false,
    playerPolityId: 'A', relationships,
  })!;

  it('una relazione ostile verificata vince: card diplomatica, non territorio posseduto', () => {
    const snapshot = withRelations({ A: { B: 'hostile', C: 'neutral' } });
    const request = { requested: true as const, scopeKey: SCOPE, signalKeys: ['hostile-relations'] };
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: '', visualRequest: request }, snapshot);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Contesto diplomatico');
    expect(cards[0].regionIds.sort()).toEqual(['r0', 'r1']);
  });

  it('due relazioni ostili → nessuna card (non il territorio posseduto)', () => {
    const snapshot = withRelations({ A: { B: 'hostile', C: 'hostile' } });
    const request = { requested: true as const, scopeKey: SCOPE, signalKeys: ['hostile-relations'] };
    expect(resolveGovernmentVisuals({ role: 'assistant', content: '', visualRequest: request }, snapshot)).toEqual([]);
  });
});

describe('M-I1 — la geografia viene dal motore, mai dal modello', () => {
  it('playerOwnedRegionIds prende solo le regioni del proprietario, con ordine stabile', () => {
    const regions = [...ownedRegions(2, 'A'), ...ownedRegions(2, 'B')].map((r, i) => ({ ...r, id: `r${i}` }));
    const snapshot = naked(regions, 'A');
    expect(playerOwnedRegionIds(snapshot)).toEqual(['r0', 'r1']);
    expect(playerOwnedRegionIds(naked(regions, 'Z'))).toEqual([]);
    expect(playerOwnedRegionIds(naked(regions))).toEqual(playerOwnedRegionIds(naked(regions)));
  });

  it('id inventati non producono mai una card (fail-closed)', () => {
    const snapshot = naked(ownedRegions(3));
    const directive = { op: 'focus' as const, evidence: 'mappa' as const, regionIds: ['invented'] };
    expect(resolveGovernmentVisuals({ role: 'assistant', content: '', evidence: [directive] }, snapshot)).toEqual([]);
  });
});

describe('M-I4 — un tetto non distrugge', () => {
  it('oltre le 20 regioni la geometria si disegna ancora (non più solo testo)', () => {
    const snapshot = naked(ownedRegions(30));
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: '', visualRequest: explicitRequest() }, snapshot);
    expect(cards).toHaveLength(1);
    const model = governmentVisualModel(cards[0], snapshot)!;
    expect(model.regions).toHaveLength(30);
    expect(model.preview).not.toBeNull();
    expect(model.preview!.paths).toHaveLength(30);
  });

  it('una direttiva del modello con troppi id resta fail-closed (non è una mappa canonica)', () => {
    const snapshot = naked(ownedRegions(3));
    const directive = { op: 'focus' as const, evidence: 'mappa' as const, regionIds: ['own0', 'own1', 'own2'], invalidRegionIds: true };
    expect(resolveGovernmentVisuals({ role: 'assistant', content: '', evidence: [directive] }, snapshot)).toEqual([]);
  });

  it('oltre il tetto di resa degrada al riepilogo, mai al vuoto', () => {
    const snapshot = naked(ownedRegions(MAX_MAP_PREVIEW_REGIONS + 5));
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: '', visualRequest: explicitRequest() }, snapshot);
    expect(cards).toHaveLength(1);
    const model = governmentVisualModel(cards[0], snapshot)!;
    expect(model.regions).toHaveLength(MAX_MAP_PREVIEW_REGIONS + 5);
    expect(model.preview).toBeNull();
    const html = renderToStaticMarkup(<GovernmentVisualCard card={cards[0]} snapshot={snapshot} />);
    expect(html).toContain('Contesto territoriale esteso');
    expect(html).not.toContain('<svg');
  });

  it('la richiesta sopravvive al ricaricamento (non viene scartata per «troppi id»)', () => {
    const ids = ownedRegions(30).map(region => region.id);
    const reloaded = readGovernmentVisualMetadata({ visualRequest: { requested: true, scopeKey: SCOPE, signalKeys: [], regionIds: ids } });
    expect(reloaded.visualRequest?.regionIds).toEqual(ids);
    const tooWide = readGovernmentVisualMetadata({ visualRequest: { requested: true, scopeKey: SCOPE, signalKeys: [], regionIds: ownedRegions(MAX_MAP_PREVIEW_REGIONS + 5).map(r => r.id) } });
    expect(tooWide.visualRequest).toBeDefined();
    expect(tooWide.visualRequest!.regionIds).toBeUndefined();
  });
});

describe('M05 — la direttiva del modello (senza id) produce la mappa del paese', () => {
  it('il Consulente scrive il blocco mappa senza regionIds → card col territorio posseduto', () => {
    const snapshot = naked(ownedRegions(3));
    // Esattamente il comando che il prompt (M05) insegna al modello.
    const reply = 'Presidente, ecco dove ci troviamo.\n```tavola\n{"op":"focus","evidence":"mappa"}\n```';
    const parsed = parsePresentation(reply);
    expect(parsed.text).not.toContain('tavola');
    expect(parsed.directives).toHaveLength(1);
    const visualRequest = captureGovernmentMapRequest({ presidentText: 'Dove siamo?', directives: parsed.directives, signalKeys: [], scopeKey: SCOPE })!;
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: parsed.text, evidence: parsed.directives, visualRequest }, snapshot);
    expect(cards).toHaveLength(1);
    expect(cards[0].regionIds).toEqual(['own0', 'own1', 'own2']);
  });
});

describe('MAP02 — le zone di cui si parla salgono a primarie, con il loro vicinato', () => {
  // Un paese di 5 province, di cui una sola nominata: è il caso reale (la
  // conversazione parla di una provincia, la scheda disegnava tutte le altre).
  const country = (): Region[] => [
    { id: 'k1', name: 'Irbid', owner: 'A', polityName: 'Paese A', color: '#007A3D', svgPath: 'M0 0L60 0L60 60L0 60Z', objects: [], borders: ['k2', 'k3'], metadata: {} },
    { id: 'k2', name: 'Sakib', owner: 'A', polityName: 'Paese A', color: '#007A3D', svgPath: 'M60 0L120 0L120 60L60 60Z', objects: [], borders: ['k1'], metadata: {} },
    { id: 'k3', name: 'Al Salt', owner: 'A', polityName: 'Paese A', color: '#007A3D', svgPath: 'M0 60L60 60L60 120L0 120Z', objects: [], borders: ['k1'], metadata: {} },
    { id: 'k4', name: 'Maan', owner: 'A', polityName: 'Paese A', color: '#007A3D', svgPath: 'M60 60L120 60L120 120L60 120Z', objects: [], borders: [], metadata: {} },
    { id: 'k5', name: 'Aqaba', owner: 'A', polityName: 'Paese A', color: '#007A3D', svgPath: 'M120 60L180 60L180 120L120 120Z', objects: [], borders: [], metadata: {} },
  ] as Region[];

  const territoryCard = (content: string) => resolveGovernmentVisuals(
    { role: 'assistant', content, visualRequest: explicitRequest() },
    naked(country()),
  )[0];

  it('la provincia nominata è primaria, i suoi vicini adiacenti, il resto contesto', () => {
    const card = territoryCard('La crisi di Irbid richiede attenzione.');
    expect(card.zones?.primary).toEqual(['k1']);
    expect(card.zones?.adjacent).toEqual(['k2', 'k3']);
    expect(card.zones?.context).toEqual(['k4', 'k5']);
    // L'insieme canonico non cambia: le zone sono solo una lettura in più.
    expect(card.regionIds).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
  });

  it('l\'inquadratura segue le primarie, non l\'intero insieme', () => {
    const whole = governmentVisualModel({ type: 'map-focus', title: 'T', regionIds: ['k1', 'k2', 'k3', 'k4', 'k5'], scopeKey: SCOPE }, naked(country()))!;
    const focused = governmentVisualModel(territoryCard('La crisi di Irbid.'), naked(country()))!;
    // Il riquadro è più stretto: contiene il soggetto e il suo intorno, non tutto il paese.
    const width = (viewBox: string) => Number(viewBox.split(/\s+/)[2]);
    expect(width(focused.preview!.viewBox)).toBeLessThan(width(whole.preview!.viewBox));
    expect(focused.preview!.paths).toHaveLength(5); // il contesto resta disegnato intorno
  });

  it('la scheda dichiara il soggetto e marca i ruoli nel DOM', () => {
    const html = renderToStaticMarkup(<GovernmentVisualCard card={territoryCard('La crisi di Irbid.')} snapshot={naked(country())} />);
    expect(html).toContain('In evidenza: Irbid');
    expect(html).toContain('sulle 5 del contesto');
    expect(html).toContain('data-role="primary"');
    expect(html).toContain('data-role="adjacent"');
    expect(html).toContain('data-role="context"');
    // L'etichetta dentro la mappa segue la primaria (il soggetto si nomina).
    expect(html).toContain('>Irbid</text>');
  });

  it('senza una zona nominata la scheda è esattamente quella di prima', () => {
    const card = territoryCard('Nessun nome di provincia in questa risposta.');
    expect(card.zones).toBeUndefined();
    const html = renderToStaticMarkup(<GovernmentVisualCard card={card} snapshot={naked(country())} />);
    expect(html).not.toContain('data-role=');
    expect(html).not.toContain('In evidenza:');
  });

  it('un nome che non è una provincia non produce nessuna zona', () => {
    const card = territoryCard('Parlami di Sivas e della regione di confine.');
    expect(card.zones).toBeUndefined();
  });

  it('le zone non fanno mai crescere l\'insieme canonico, e un vicino fuori scheda non entra', () => {
    const regions = country();
    regions[0] = { ...regions[0], borders: ['k2', 'fuori-scheda'] } as Region;
    const card = resolveGovernmentVisuals({ role: 'assistant', content: 'La crisi di Irbid.', visualRequest: explicitRequest() }, naked(regions))[0];
    const all = [...card.zones!.primary, ...card.zones!.context, ...card.zones!.adjacent];
    expect(all.sort()).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
    expect(all).not.toContain('fuori-scheda');
  });

  it('una mappa di fronte o diplomatica è già il suo soggetto: nessuna graduazione', () => {
    const front = { id: 'f', name: 'Fronte', status: 'active', regionIds: ['k1', 'k2'] } as WarFrontPayload;
    const withFront = buildGovernmentVisualSnapshot({
      scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
      index: buildMapContextIndex({ regions: country(), units: [], fronts: [front] }), unavailable: false, playerPolityId: 'A',
    })!;
    expect(resolveGovernmentVisuals({ role: 'assistant', content: 'La crisi di Irbid.', issues: [{ signalKeys: ['conflict:f'] }] }, withFront)[0].zones).toBeUndefined();
  });

  it('una primaria che non esiste più non entra nelle zone (la scheda non cresce di nascosto)', () => {
    const card = resolveGovernmentVisuals({ role: 'assistant', content: 'La crisi di Irbid.', visualRequest: explicitRequest() }, naked(country()))[0];
    // Il mondo cambia: Irbid non è più fra le regioni della scheda.
    const shrunk = naked(country().filter(region => region.id !== 'k1'));
    const model = governmentVisualModel({ ...card, regionIds: ['k2', 'k3', 'k4', 'k5'] }, shrunk);
    expect(model).not.toBeNull();
    expect(model!.zones?.primary ?? []).toEqual([]);
  });
});

describe('M-I2 — il testo non promette una mappa che non c\'è', () => {
  it('un messaggio senza card e senza richiesta non mostra nulla', () => {
    const snapshot = naked(ownedRegions(3));
    expect(renderToStaticMarkup(<GovernmentMessageVisuals message={{ role: 'assistant', content: 'Nessun riferimento.' }} snapshot={snapshot} />)).toBe('');
  });

  it('«mostrami la mappa» è riconosciuto come intento', () => {
    expect(isGovernmentMapRequest('Mostrami la mappa del nostro paese')).toBe(true);
    expect(isGovernmentMapRequest('Parliamo della riforma agraria.')).toBe(false);
  });
});
