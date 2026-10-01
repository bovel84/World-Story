/**
 * WS-MINISTER-UX-08 — Le proposte della sedia aperta (difetto 2)
 * =============================================================
 * Il difetto osservato: `act.roads` del **Tesoro** era usato come sorgente per
 * **tutte** le sedie. Un confronto chiesto alla Sanità mostrava le strade del
 * Tesoro. Qui le proposte derivano dalla **sedia aperta** e dalla
 * **conversazione corrente**:
 *
 *  - per il Tesoro, dalle strade del suo atto (dato del motore);
 *  - per ogni altra sedia, dai **percorsi** delle sue voci (`items[].paths`),
 *    con lo stesso ordine firmabile del motore (opera o prosa) già usato dalla
 *    bozza d'atto di UX-06.
 *
 * `focusedProposals` ordina le proposte mettendo in testa quella **discussa**
 * (il confronto appartiene alla proposta di cui si parla), usando lo stesso
 * aggancio locale e deterministico di `spendingFocus`. Se nulla combacia,
 * l'ordine resta quello del motore: non si inventa una priorità.
 *
 * Modulo **puro**: nessun I/O, nessuna chiamata al modello, nessun numero nuovo.
 */
import type { CabinetAddressView, CabinetItemView } from '../../services/api';
import { basisLabel } from './CabinetSession';
import { cabinetDeclarationFor, composeCabinetOrderText } from './cabinetOrder';
import { formatFigureValue } from '../../utils/format';
import type { TreasuryAct, TreasuryRoad, TreasuryRoadOrder } from './treasuryAct';

/** Il costo dichiarato dalla voce, se il motore lo pubblica. Nessuna invenzione. */
function declaredCost(item: CabinetItemView): string {
  if (item.declaration?.missingMaterials?.length) {
    return `distinta scoperta: ${item.declaration.missingMaterials.map(material => `${material.resourceId} (${material.missing})`).join(', ')}`;
  }
  const cost = item.figures.find(figure => /cost|spesa|fabbisogn|copertur/i.test(figure.label)) ?? item.figures[0];
  if (!cost) return 'costo non dichiarato dal motore';
  return `${cost.label}: ${formatFigureValue(cost.value, cost.unit)} (${basisLabel(cost.basis)})`;
}

/** L'ordine firmabile di un percorso: opera (se la distinta è coperta) o prosa. */
function orderFor(item: CabinetItemView, path: CabinetItemView['paths'][number]): TreasuryRoadOrder {
  return cabinetDeclarationFor(item)
    ? { kind: 'work', item, path }
    : { kind: 'text', text: composeCabinetOrderText(item, path) };
}

/**
 * Le proposte concrete della sedia aperta. Per il Tesoro sono le strade del suo
 * atto (scadenze/opere reali) **più** i percorsi delle sue voci, deduplicati per
 * id; per le altre sedie i percorsi delle sue voci. Niente `act.roads` globale.
 */
export function seatRoads(
  address: CabinetAddressView | null,
  act: TreasuryAct | null,
): TreasuryRoad[] {
  if (!address) return [];
  const roads: TreasuryRoad[] = [];
  const seen = new Set<string>();
  const add = (road: TreasuryRoad): void => {
    if (road.id && !seen.has(road.id)) {
      seen.add(road.id);
      roads.push(road);
    }
  };

  // Le strade dell'atto del Tesoro vengono per prime: portano scadenze e opere
  // reali. Gli id coincidono con i percorsi gemelli dell'agenda (`repay`/
  // `invest`), così non si duplica la stessa scelta.
  if (address.seat === 'tesoro' && act) {
    for (const road of act.roads) add(road);
  }

  for (const item of address.items) {
    for (const path of item.paths) {
      // Per il Tesoro l'id resta `repay`/`invest` (dedup con l'atto); per le
      // altre sedie è qualificato dalla voce, perché due voci possono avere un
      // percorso con lo stesso id.
      const id = address.seat === 'tesoro' ? path.id : `${item.voiceId}:${path.id}`;
      add({
        id,
        title: path.title,
        voice: path.detail || item.need,
        declaredCost: declaredCost(item),
        expectedGain: path.expected || 'effetto dichiarato dalla proposta',
        recommended: path.recommended,
        order: orderFor(item, path),
      });
    }
  }

  return roads.slice(0, 4);
}

/** Normalizza per il confronto: minuscole, senza accenti, spazi compattati. */
function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quanto una proposta è nominata nel discorso. Punteggio deterministico: il
 * titolo intero vale 3, una parola lunga del titolo vale 1. `0` = non nominata.
 */
export function proposalMentionScore(road: Pick<TreasuryRoad, 'title' | 'voice'>, discussion: string): number {
  const hay = normalize(discussion);
  if (!hay) return 0;
  const title = normalize(road.title);
  let score = 0;
  if (title && hay.includes(title)) score += 3;
  for (const word of title.split(' ')) {
    if (word.length >= 5 && hay.includes(word)) score += 1;
  }
  return score;
}

/**
 * Le proposte ordinate per pertinenza al discorso: quella nominata sale in
 * testa, le altre restano nell'ordine del motore. Usata dal confronto.
 */
export function focusedProposals(
  roads: readonly TreasuryRoad[],
  discussion: string,
): TreasuryRoad[] {
  const scored = roads.map((road, index) => ({ road, index, score: proposalMentionScore(road, discussion) }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map(entry => entry.road);
}
