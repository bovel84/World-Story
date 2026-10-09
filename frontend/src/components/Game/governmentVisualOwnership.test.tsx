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
