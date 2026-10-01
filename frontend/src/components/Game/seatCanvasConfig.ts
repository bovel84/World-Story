/**
 * World Story — WS-GOVOFFICE-07 / WS-MINISTER-UX-08: il contenuto di TUTTE le sedie
 * ==============================================================================
 * `SeatCanvas` è generico: riceve una lista di blocchi già derivati e non
 * conosce il Tesoro. Questo modulo è il **punto di aggancio per sedia**: decide
 * quale **contenuto** una sedia porta in più rispetto ai blocchi derivati dal
 * motore (`metrics`/`chart`/`map`).
 *
 * WS-MINISTER-UX-08 — Correzione dei difetti osservati sul codice reale:
 *  - **niente piani dimostrativi con date fisse**: il piano (`strategy`) deriva
 *    dalla **proposta concreta della sedia** e dall'**ancora di gioco corrente**
 *    (`planFromProposal`). Senza data di gioco o senza strade, il piano non si
 *    mostra: «dato mancante», non una data inventata;
 *  - **niente `act.roads` globale**: il piano e le idee di una sedia derivano dai
 *    **suoi** `items`/`paths` (per il Tesoro, dalle strade del suo atto);
 *  - **niente contenuto curato per sedia**: la sedia che non porta una proposta
 *    concreta non inventa un piano. Il Tesoro aggiunge solo l'obiettivo della
 *    mappa (l'opera in attesa), che è dato del motore, non autore.
 *
 * Il modulo resta **puro**: nessun I/O, nessuna chiamata al modello.
 */
import type { CabinetAddressView, CabinetItemView, CabinetPathView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import type { NationOperatingPictureSources } from './nationOperatingPictureInput';
import type { CanvasIdea, SeatCanvasAuthored } from './seatCanvasModel';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';
import { planFromProposal, type StrategicPlan } from './strategicPlan';

/** Tutto ciò che una sedia può guardare per comporre il suo contenuto. */
export interface SeatCanvasContext {
  seat: CabinetAddressView['seat'];
  picture: NationalOperatingPicture;
  sources: NationOperatingPictureSources;
  /** L'atto del Tesoro, quando la sedia è il Tesoro; altrimenti `null`. */
  act: TreasuryAct | null;
  /** La sedia aperta: la sua proposta concreta (`items[].paths`). */
  address: CabinetAddressView | null;
}

/** Compone il contenuto di una sedia dal suo contesto. */
export type SeatCanvasAuthoring = (context: SeatCanvasContext) => SeatCanvasAuthored | undefined;

/** La data di gioco corrente, dalla stessa sorgente del resto del quadro. */
function today(sources: NationOperatingPictureSources): string | null {
  return sources.today ? String(sources.today) : null;
}

/** Il piano delle strade del Tesoro: dalle strade reali dell'atto. */
function treasuryPlan(act: TreasuryAct, gameDate: string | null): StrategicPlan | null {
  const recommended = act.roads.find(road => road.recommended) ?? act.roads[0];
  return planFromProposal({
    id: `tesoro-${act.seatLabel}`,
    title: `Le strade del ${act.seatLabel}`,
    need: act.voice,
    ...(recommended ? { outcome: recommended.expectedGain } : {}),
    today: gameDate,
    steps: act.roads.map(road => ({
      id: `strada-${road.id}`,
      title: road.title,
      detail: road.voice,
    })),
  });
}

/** Il piano di una proposta di sedia: prerequisiti → strade → esito. */
function itemPlan(item: CabinetItemView, gameDate: string | null): StrategicPlan | null {
  if (item.paths.length === 0) return null;
  const recommended = item.paths.find(path => path.recommended) ?? item.paths[0];

  // I prerequisiti comuni alle strade diventano i nodi che le aprono: il piano
  // non inventa tappe che la proposta non dichiara.
  const prerequisites = [...new Set(item.paths.flatMap(path => path.prerequisites))];
  const prerequisiteSteps = prerequisites.map((text, index) => ({
    id: `prereq-${index}-${item.voiceId}`,
    title: text,
    detail: 'Prerequisito dichiarato dalla proposta.',
  }));

  return planFromProposal({
    id: item.voiceId,
    title: item.need,
    need: item.because || item.need,
    outcome: recommended.expected,
    today: gameDate,
    steps: [
      ...prerequisiteSteps,
      ...item.paths.map(path => ({
        id: `strada-${item.voiceId}-${path.id}`,
        title: path.title,
        detail: path.detail,
        ...(prerequisites.length > 0 ? { requires: prerequisiteSteps.map(step => step.id) } : {}),
      })),
    ],
  });
}

/** Le idee di una sedia: le sue strade concrete, non contenuto curato. */
function roadsAsIdeas(roads: readonly TreasuryRoad[]): CanvasIdea[] {
  return roads.map(road => ({
    title: road.title,
    detail: road.voice,
    tone: road.recommended ? 'positive' as const : 'neutral' as const,
  }));
}

/** Le idee di una proposta di sedia: i suoi percorsi concreti. */
function pathsAsIdeas(item: CabinetItemView): CanvasIdea[] {
  return item.paths.map((path: CabinetPathView) => ({
    title: path.title,
    detail: path.expected || path.detail,
    tone: path.recommended ? 'positive' as const : 'neutral' as const,
  }));
}

/**
 * Il contenuto di una sedia, se ne ha uno:
 *  - il **Tesoro** parte dalle strade del suo atto (con l'opera in attesa come
 *    obiettivo della mappa);
 *  - le **altre sedie** partono dalla loro prima proposta concreta con percorsi.
 */
export function seatCanvasAuthoring(context: SeatCanvasContext): SeatCanvasAuthored | undefined {
  const { seat, act, address, sources } = context;
  const gameDate = today(sources);

  if (seat === 'tesoro' && act) {
    const plan = treasuryPlan(act, gameDate);
    const ideas = roadsAsIdeas(act.roads);
    return {
      ...(plan ? { plan } : {}),
      ideas,
      target: act.worksRequest
        ? {
            label: act.worksRequest.workName,
            detail: act.worksRequest.missing.length > 0
              ? `mancano ${act.worksRequest.missing.join(', ')}`
              : 'distinta coperta',
          }
        : null,
    };
  }

  const item = address?.items.find(candidate => candidate.paths.length > 0);
  if (!item) return undefined;
  const plan = itemPlan(item, gameDate);
  return {
    ...(plan ? { plan } : {}),
    ideas: pathsAsIdeas(item),
  };
}
