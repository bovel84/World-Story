/**
 * T06 — La strada scelta entra nella stanza, e la bozza non nasce mai vuota.
 *
 * Il difetto, misurato il 2026-10-08 sulla partita dell'autore (millennium,
 * Palestina 2000): portata una mossa in Consiglio, la bozza veniva compilata col
 * testo della mossa — ma la **Tavola** della stanza restava vuota. I ministri
 * leggono la Tavola (`projectCurrentDecision(room.sharedBoard)`), non il testo
 * della bozza: discutevano di nulla e rispondevano «non ho nulla da portare».
 *
 * Due invarianti:
 *  - **T-B1** la strada scelta dal Presidente è una misura della Tavola, con la
 *    provenienza vera (`source: 'president'`) — i ministri la vedono;
 *  - **T-I1 / T-I3** seminarla **non firma e non accoda**, e la bozza che nasce
 *    da una questione senza mosse non è mai vuota.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { councilDraft, createCouncilRoom, seedChosenRoad, councilContext } from './councilRoom';
import { activeProposal } from './decisionWorkspace';
import { projectCurrentDecision } from './ministerDialogueContext';
import type { CouncilIssue } from '../../services/api';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const office = read('GovernmentOffice.tsx');

const issue: CouncilIssue = {
  id: 'issue-gerusalemme', title: 'Gerusalemme: mandato per lo statuto finale',
  question: 'Che mandato diamo al negoziato sullo statuto finale?',
  verifiedFacts: [], suggestedMinisters: ['esteri'], origin: 'advisor', sourceRefs: [], createdDate: '2000-01-01',
};
const gerusalemme = { title: 'Capitale senza gesti', content: 'Mandiamo la delegazione a negoziare con l’obiettivo della sovranità su Gerusalemme Est.' };
const room = () => createCouncilRoom({ id: 'room-g', scopeKey: 'g|b|3', initiatorMinister: 'esteri', sourceIssue: issue });

describe('T-B1 — la strada scelta è una misura della Tavola, visibile ai ministri', () => {
  it('senza seminarla, la Decisione trasmessa ai ministri è vuota: è il difetto', () => {
    // Il controllo che descrive il difetto: la stanza appena creata non ha misure.
    const decision = projectCurrentDecision(room().sharedBoard);
    expect(decision?.measures ?? []).toEqual([]);
  });

  it('dopo la semina, la strada scelta arriva ai ministri con la provenienza vera', () => {
    const seeded = seedChosenRoad(room(), gerusalemme, 'seed-1');
    const decision = projectCurrentDecision(seeded.sharedBoard)!;
    expect(decision.measures).toHaveLength(1);
    expect(decision.measures[0].label).toBe('Capitale senza gesti');
    expect(decision.measures[0].source).toBe('president');
    expect(decision.measures[0].value).toContain('sovranità su Gerusalemme Est');
    expect(decision.objective).toBe('Gerusalemme: mandato per lo statuto finale');
  });

  it('l’obiettivo della Tavola è la QUESTIONE, non la mossa', () => {
    // Se l'obiettivo diventasse la mossa, i ministri discuterebbero la mossa
    // invece della questione: la Tavola dice di cosa si parla.
    expect(seedChosenRoad(room(), gerusalemme, 'seed-1').sharedBoard.objective).toBe(issue.title);
  });

  it('la scelta entra nella cronologia come EVENTO, non come battuta di un ministro', () => {
    const seeded = seedChosenRoad(room(), gerusalemme, 'seed-1');
    const event = seeded.messages.at(-1)!;
    expect(event.kind).toBe('event');
    expect(event.seat).toBeUndefined();
    expect(event.content).toContain('Strada scelta dal Presidente');
    // e i ministri la leggono anche via councilHistory
    expect(councilContext(seeded).sourceIssue).toEqual(issue);
  });

  it('una seconda scelta sostituisce la prima: una sola direzione del Presidente', () => {
    const first = seedChosenRoad(room(), gerusalemme, 's1');
    const second = seedChosenRoad(first, { title: 'Leva sugli alleati', content: 'Portiamo la questione davanti agli alleati arabi.' }, 's2');
    const measures = activeProposal(second.sharedBoard)!.measures.filter(measure => measure.status !== 'rejected');
    expect(measures).toHaveLength(1);
    expect(measures[0].label).toBe('Leva sugli alleati');
  });

  it('seminare NON firma e NON accoda (T-I1)', () => {
    const seeded = seedChosenRoad(room(), gerusalemme, 'seed-1');
    // Nessun evento d'atto firmato, nessuna chiave di firma nel testo.
    expect(seeded.messages.some(message => message.content.includes('[Atto firmato]'))).toBe(false);
    const start = office.indexOf('const openIssue =');
    const body = office.slice(start, office.indexOf('\n  };', start));
    expect(body).not.toContain('onQueueOrder');
    expect(body).not.toContain('signDraft');
  });

  it('una mossa vuota non semina nulla: la stanza resta quella di prima', () => {
    const base = room();
    expect(seedChosenRoad(base, { title: '  ', content: '   ' }, 's')).toBe(base);
  });
});

describe('T06 — la bozza non nasce mai vuota (T-I3)', () => {
  it('senza mossa scelta, la bozza contiene titolo, domanda e un punto di partenza', () => {
    const draft = councilDraft(room(), 3);
    expect(draft.text).toContain('Gerusalemme: mandato per lo statuto finale');
    // Il punto interrogativo cade: un testo d'atto non finisce con una domanda,
    // ma la questione resta leggibile come punto di partenza.
    expect(draft.text).toContain('Che mandato diamo al negoziato sullo statuto finale.');
    // Il segnaposto è esplicito: la seduta sa che il testo si definirà discutendo.
    expect(draft.text).toContain('si definirà in seduta');
  });

  it('aperta la seduta senza mossa, la bozza è deposta e non vuota', () => {
    // Guardia sul percorso vero: `openIssue` depone la bozza in ogni caso, e il
    // ramo dipende da `chosenOption`. Senza mossa prende `councilDraft` (che
    // porta il testo della questione), con la mossa prende il contenuto scelto.
    expect(office).toContain('setDrafts(previous => ({ ...previous, [room.id]: prepared }))');
    const start = office.indexOf('const prepared: RoomDraft');
    const body = office.slice(start, office.indexOf('setDrafts', start));
    expect(body).toContain('chosenOption?.content.trim()');
    expect(body).toContain('councilDraft(seeded, currentTurn ?? 0)');
  });

  it('la bozza conserva il testo quando la Tavola ha misure: nessuna regressione di P07', () => {
    const seeded = seedChosenRoad(room(), gerusalemme, 's');
    expect(councilDraft(seeded, 3).text).toContain('Capitale senza gesti');
  });
});
