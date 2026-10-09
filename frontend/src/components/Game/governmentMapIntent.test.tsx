/**
 * M-INTENT — I tre intenti della richiesta di mappa.
 *
 * La causa reale del difetto: `resolveGovernmentVisuals` non distingueva tra
 * «mostrami il NOSTRO paese» (che deve mostrare il territorio posseduto anche
 * quando la questione contiene un segnale diplomatico non verificato) e
 * «mostrami il CONFINE/l crisi» (che invece NON deve ripiegare in silenzio sulla
 * mappa nazionale). Il terzo caso, la richiesta generica, ripiega sul quadro
 * politico nazionale **dichiarandolo**.
 *
 * La fixture del paese è composta da 61 regioni con geometria SVG reale (zero
 * fronti), così la verifica non dipende da snapshot militari artificiali. Non si
 * crea nessun mondo e non si chiama l'LLM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import type { CouncilIssue } from '../../services/api';
import { buildMapContextIndex } from '../Map/mapContext';
import { CouncilRoomView, type CouncilRoomViewProps } from './CouncilRoomView';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import { appendCouncilMessage, createCouncilRoom, receiveCouncilReply } from './councilRoom';
import { CABINET_SEATS } from './seatDecisionBoards';
import { buildGovernmentVisualSnapshot, governmentVisualModel, mapFocusFromVisual, resolveGovernmentVisuals, explainGovernmentVisualDenial, type GovernmentVisualSnapshot } from './governmentVisual';
import { captureGovernmentMapRequest, classifyGovernmentMapIntent, isGovernmentMapRequest } from './governmentVisualRequest';

const SCOPE = 'game:KOR:branch:1';
const PLAYER = 'KOR';

/** 61 province con geometria SVG assoluta: la mini-mappa è realmente disegnabile. */
const country = (owner = PLAYER, prefix = 'prov'): Region[] =>
  Array.from({ length: 61 }, (_, i) => ({
    id: `${prefix}${i}`, name: `Provincia ${i}`, polityName: owner === PLAYER ? 'Corea del Sud' : 'Vicino',
    owner, color: owner === PLAYER ? '#315f87' : '#ad7749',
    svgPath: `M${(i % 10) * 30} ${Math.floor(i / 10) * 30} L${(i % 10) * 30 + 28} ${Math.floor(i / 10) * 30} L${(i % 10) * 30 + 28} ${Math.floor(i / 10) * 30 + 28} Z`,
    objects: [], borders: [], metadata: {},
  } as unknown as Region));

const snapshot = (regions: Region[], relationships: Record<string, Record<string, string>> | null = null): GovernmentVisualSnapshot => buildGovernmentVisualSnapshot({
  scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
  index: buildMapContextIndex({ regions, units: [], fronts: [] }), unavailable: false,
  playerPolityId: PLAYER, relationships,
})!;

const issue = (signalKeys: string[]): CouncilIssue =>
  ({ id: 'issue', title: 'La questione', question: 'Come procediamo?', signalKeys, suggestedMinisters: ['esteri'], verifiedFacts: [], sourceRefs: [], createdDate: '2000-06-01' }) as unknown as CouncilIssue;

/** Il percorso reale del Consiglio: messaggio del Presidente → risposta del ministro. */
function reply(presidentText: string, signalKeys: string[], visualSnapshot: GovernmentVisualSnapshot, relationships: Record<string, Record<string, string>> | null = null) {
  const seat = CABINET_SEATS[0];
  const room = appendCouncilMessage(createCouncilRoom({ id: 'room', scopeKey: 'session', initiatorMinister: seat, sourceIssue: issue(signalKeys) }),
    { id: 'president', role: 'user', kind: 'speech', content: presidentText });
  return { snapshot: relationships ? { ...visualSnapshot, relationships } : visualSnapshot, room: receiveCouncilReply(room, seat, 'Prendo atto, Presidente.', 'reply', SCOPE) };
}

function renderRoom(room: ReturnType<typeof receiveCouncilReply>, visualSnapshot: GovernmentVisualSnapshot): string {
  return renderToStaticMarkup(<CouncilRoomView room={room} visualSnapshot={visualSnapshot} onFocusMap={() => {}} evidenceIndex={{}} onFocusEvidence={() => {}} nationalName="Corea del Sud" isMobile={false} busy={false} speaking={null} streamText="" input="" target="council" onInput={() => {}} onTarget={() => {}} onSend={() => {}} onInterrupt={() => {}} onConvene={() => {}} onBack={() => {}} onClose={() => {}} onConclude={() => {}} onSheetChange={() => {}} board={<p>Tavola esistente</p>} draftPrepared={false} />);
}

describe('M-INTENT — i tre intenti, dal solo testo del Presidente', () => {
  it('nazionale: chiede esplicitamente il proprio paese', () => {
    for (const text of ['Mostrami la mappa del nostro paese.', 'Mostrami il nostro paese', 'Fammi vedere la mappa nazionale', 'Voglio vedere i nostri territori']) {
      expect(isGovernmentMapRequest(text), text).toBe(true);
      expect(classifyGovernmentMapIntent(text), text).toBe('national');
    }
  });

  it('questione: chiede il contesto geografico della crisi', () => {
    for (const text of ['Fammi vedere il confine con il vicino.', 'Dove si trova il fronte?', 'Mostrami la crisi al confine']) {
      expect(isGovernmentMapRequest(text), text).toBe(true);
      expect(classifyGovernmentMapIntent(text), text).toBe('situation');
    }
  });

  it('generica: chiede «la mappa», senza qualificarla', () => {
    expect(classifyGovernmentMapIntent('Fammi vedere la mappa.')).toBe('generic');
    expect(classifyGovernmentMapIntent('Mostrami la mappa')).toBe('generic');
    // Una direttiva del modello, senza testo del Presidente, è generica.
    expect(classifyGovernmentMapIntent('')).toBe('generic');
  });

  it('la prosa non è una richiesta di mappa', () => {
    expect(isGovernmentMapRequest('Il nostro paese sta crescendo.')).toBe(false);
    expect(isGovernmentMapRequest('Parliamo della riforma agraria.')).toBe(false);
  });
});

describe('A — mappa nazionale esplicita, anche con segnali non verificati', () => {
  it('Consiglio senza fronti, con una relazione ostile non verificata: card nazionale a 61 province', () => {
    const { snapshot: snap, room } = reply('Mostrami la mappa del nostro paese.', ['hostile-relations:PRK'], snapshot(country()));
    const message = room.messages.at(-1)!;
    expect(message.visualRequest?.intent).toBe('national');
    const cards = resolveGovernmentVisuals(message, snap);
    expect(cards).toHaveLength(1);
    expect(cards[0].regionIds).toHaveLength(61);
    const model = governmentVisualModel(cards[0], snap)!;
    // La geometria è realmente disegnata: 61 path SVG, non un riepilogo testuale.
    expect(model.preview?.paths).toHaveLength(61);
    expect(model.legend.map(entry => entry.label)).toEqual(['Corea del Sud']);
    // Il pulsante «Mostra sulla mappa principale» inquadra gli stessi territori.
    expect(mapFocusFromVisual(cards[0], snap, 1)?.regionIds).toHaveLength(61);
    const html = renderRoom(room, snap);
    expect(html).toContain('government-visual-card');
    expect(html).toContain('<svg');
    expect(html).toContain('Mostra sulla mappa principale');
  });

  it('due ostili ambigui non cancellano la richiesta nazionale', () => {
    const regions = [...country(), ...country('PRK', 'prk'), ...country('CHN', 'chn')];
    const { snapshot: snap, room } = reply('Mostrami la mappa del nostro paese.', ['hostile-relations'],
      snapshot(regions), { [PLAYER]: { PRK: 'hostile', CHN: 'hostile' } });
    const cards = resolveGovernmentVisuals(room.messages.at(-1)!, snap);
    expect(cards).toHaveLength(1);
    expect(cards[0].regionIds.sort()).toEqual(country().map(region => region.id).sort());
  });

  it('il percorso del Consulente produce la stessa card nazionale', () => {
    const snap = snapshot(country());
    const request = captureGovernmentMapRequest({ presidentText: 'Mostrami la mappa del nostro paese.', directives: [], signalKeys: ['hostile-relations:PRK'], scopeKey: SCOPE })!;
    const message = { role: 'assistant' as const, content: 'Ecco il paese.', visualRequest: request };
    const cards = resolveGovernmentVisuals(message, snap);
    expect(cards).toHaveLength(1);
    expect(renderToStaticMarkup(<GovernmentMessageVisuals message={message} snapshot={snap} />)).toContain('government-visual-card');
  });
});

describe('B — mappa della questione: solo riferimenti verificati', () => {
  it('nessun riferimento verificato → nessuna mappa, mai un fallback nazionale silenzioso', () => {
    const regions = [...country(), ...country('PRK', 'prk'), ...country('CHN', 'chn')];
    const { snapshot: snap, room } = reply('Fammi vedere il confine con il vicino.', ['hostile-relations'],
      snapshot(regions), { [PLAYER]: { PRK: 'hostile', CHN: 'hostile' } });
    const message = room.messages.at(-1)!;
    expect(message.visualRequest?.intent).toBe('situation');
    expect(resolveGovernmentVisuals(message, snap)).toEqual([]);
    const html = renderRoom(room, snap);
    expect(html).not.toContain('government-visual-card');
  });

  it('la relazione ostile verificata vince: card diplomatica', () => {
    const regions = [...country(), ...country('PRK', 'prk')];
    const { snapshot: snap, room } = reply('Fammi vedere il confine con il vicino.', ['hostile-relations'],
      snapshot(regions), { [PLAYER]: { PRK: 'hostile' } });
    const cards = resolveGovernmentVisuals(room.messages.at(-1)!, snap);
    expect(cards[0].title).toBe('Contesto diplomatico');
    expect(cards[0].source?.type).toBe('diplomacy');
  });
});

describe('C — mappa generica: riferimenti verificati, altrimenti quadro politico neutro', () => {
  it('senza riferimenti verificati mostra la mappa nazionale neutra, dichiarata', () => {
    const snap = snapshot(country());
    const request = captureGovernmentMapRequest({ presidentText: 'Fammi vedere la mappa.', directives: [], signalKeys: [], scopeKey: SCOPE })!;
    const cards = resolveGovernmentVisuals({ role: 'assistant', content: 'Ecco.', visualRequest: request }, snap);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Contesto territoriale');
    expect(cards[0].description).toContain('non indica operazioni, crisi o aree di conflitto');
    expect(cards[0].regionIds).toHaveLength(61);
  });
});

describe('D — progetto/idea: la mappa spiega, anche senza richiesta del Presidente', () => {
  const seat = CABINET_SEATS[0];
  const projectRoom = (signalKeys: string[], presidentText: string) => appendCouncilMessage(
    createCouncilRoom({ id: 'room', scopeKey: 'session', initiatorMinister: seat, sourceIssue: issue(signalKeys) }),
    { id: 'president', role: 'user', kind: 'speech', content: presidentText });
  const directive = (ids?: string[]) => `\n\`\`\`tavola\n${JSON.stringify(ids
    ? { op: 'focus', evidence: 'mappa', regionIds: ids }
    : { op: 'focus', evidence: 'mappa' })}\n\`\`\``;

  it('(A) id canonici indicati dal ministro: la mappa mostra le zone del progetto', () => {
    const snap = snapshot(country());
    const room = receiveCouncilReply(projectRoom(['conflict:assente'], 'Spiegami il tuo progetto per la rete ferroviaria.'),
      seat, 'Il progetto tocca queste province.' + directive(['prov0', 'prov7']), 'reply', SCOPE);
    const cards = resolveGovernmentVisuals(room.messages.at(-1)!, snap);
    expect(cards).toHaveLength(1);
    expect([...cards[0].regionIds].sort()).toEqual(['prov0', 'prov7']);
    expect(cards[0].description).toContain('non indica operazioni');
    expect(renderRoom(room, snap)).toContain('government-visual-card');
  });

  it('(A) senza id il governo risolve da sé il contesto verificato della questione', () => {
    const regions = [...country(), ...country('PRK', 'prk')];
    const snap = snapshot(regions, { [PLAYER]: { PRK: 'hostile' } });
    const room = receiveCouncilReply(projectRoom(['hostile-relations'], 'Spiegami il tuo progetto per il porto.'),
      seat, 'Il progetto guarda al confine.' + directive(), 'reply', SCOPE);
    const cards = resolveGovernmentVisuals(room.messages.at(-1)!, snap);
    expect(cards[0].title).toBe('Contesto diplomatico');
    expect(cards[0].description).toContain('Relazione ostile verificata');
  });
});

describe('M-DIAG — il motivo di una mappa mancante è identificabile (solo in sviluppo)', () => {
  const base = { role: 'assistant' as const, content: 'Risposta.' };
  it('distingue le cause', () => {
    expect(explainGovernmentVisualDenial({ ...base, visualRequest: { requested: true, scopeKey: SCOPE, intent: 'national', signalKeys: [] } }, undefined)).toBe('snapshot-unavailable');
    expect(explainGovernmentVisualDenial({ ...base }, snapshot(country()))).toBe('no-request');
    expect(explainGovernmentVisualDenial({ ...base, visualRequest: { requested: true, scopeKey: 'altro', intent: 'national', signalKeys: [] } }, snapshot(country()))).toBe('snapshot-scope-mismatch');
    expect(explainGovernmentVisualDenial({ ...base, visualRequest: { requested: true, scopeKey: SCOPE, intent: 'situation', signalKeys: ['hostile-relations'] } }, snapshot(country(), { KOR: { PRK: 'neutral' } }))).toBe('no-verified-reference');
    expect(explainGovernmentVisualDenial({ ...base, visualRequest: { requested: true, scopeKey: SCOPE, intent: 'national', signalKeys: [] } }, snapshot([], null))).toBe('no-owned-territory');
    expect(explainGovernmentVisualDenial({ ...base, evidence: [{ op: 'show', evidence: 'mappa', regionIds: ['invented'] }], visualRequest: { requested: true, scopeKey: SCOPE, intent: 'national', signalKeys: [] } }, snapshot(country()))).toBe('invalid-region-id');
  });
  it('è null quando la mappa si risolve', () => {
    expect(explainGovernmentVisualDenial({ ...base, visualRequest: { requested: true, scopeKey: SCOPE, intent: 'national', signalKeys: [] } }, snapshot(country()))).toBeNull();
  });
});

describe('F — fail-closed: una direttiva con id inesistente resta rifiutata', () => {
  it('non viene trasformata in una mappa nazionale', () => {
    const snap = snapshot(country());
    const message = {
      role: 'assistant' as const, content: 'Risposta.',
      evidence: [{ op: 'show' as const, evidence: 'mappa' as const, regionIds: ['invented'] }],
      visualRequest: { requested: true as const, scopeKey: SCOPE, intent: 'national' as const, signalKeys: [] },
    };
    expect(resolveGovernmentVisuals(message, snap)).toEqual([]);
  });
});
