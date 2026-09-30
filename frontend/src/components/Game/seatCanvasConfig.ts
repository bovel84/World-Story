/**
 * World Story — WS-GOVOFFICE-07: la tela è di TUTTE le sedie (aggancio per sedia)
 * ==============================================================================
 * `SeatCanvas` è generico: riceve una lista di blocchi già derivati e non
 * conosce il Tesoro. Questo modulo è il **punto di aggancio per sedia**: una
 * mappa `sedia → configurazione della tela` che decide quale **contenuto
 * curato** (piano strategico, idee, obiettivo della mappa) una sedia porta in
 * più rispetto ai blocchi derivati dal motore (`metrics`/`chart`/`map`).
 *
 * Il principio è quello del task:
 *  - i blocchi `metrics`, `chart` e `map` li deriva **sempre** il read model
 *    (`deriveSeatCanvasBlocks`), per ogni sedia, dalla mappa `SEAT_DOMAINS`;
 *  - i blocchi `strategy` e `ideas` sono **contenuto autore**, e qui si dichiara
 *    chi ne ha: il **Tesoro** (primo inquilino, il caso di riferimento) e lo
 *    **Stato maggiore** (sedia `guerra`, secondo esempio minimo). Le altre sedie
 *    ricevono la sola tela derivata, senza cablature: aggiungere una sedia vuol
 *    dire aggiungere una voce a questa mappa, non rifattorizzare.
 *
 * Aggiungere una sedia = aggiungere una chiave a `SEAT_CANVAS_AUTHORING`.
 * Nessun numero di gioco vive qui: date, titoli e idee sono contenuto curato.
 */
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import type { NationOperatingPictureSources } from './nationOperatingPictureInput';
import type { CanvasIdea, SeatCanvasAuthored } from './seatCanvasModel';
import type { TreasuryAct } from './treasuryAct';
import { parseStrategicPlan, stabilizationPlan, type StrategicPlan } from './strategicPlan';

/** Tutto ciò che una sedia può guardare per comporre il suo contenuto curato. */
export interface SeatCanvasContext {
  seat: CabinetAddressView['seat'];
  picture: NationalOperatingPicture;
  sources: NationOperatingPictureSources;
  /** L'atto del Tesoro, quando la sedia è il Tesoro; altrimenti `null`. */
  act: TreasuryAct | null;
}

/** Compone il contenuto curato di una sedia dal suo contesto. */
export type SeatCanvasAuthoring = (context: SeatCanvasContext) => SeatCanvasAuthored | undefined;

/**
 * Secondo esempio minimo (sedia `guerra`, lo Stato maggiore): un piano
 * militare a cascata. È **autore**, come il piano del Tesoro: la tela lo
 * ospita, il motore non lo genera. Serve a dimostrare che il `kind: strategy`
 * non è cablato al Tesoro.
 */
export const MILITARY_PLAN_TEXT = [
  'PIANO: Difesa e Deterrenza Regionale',
  'ESITO: I confini sono tenuti e la regione rispetta la nazione.',
  'GEN 2026 | Riarmo ordinato | Ricostituire riserve e mezzi senza sproporzione | -',
  'FEB 2026 | Fortificazioni di confine | Mettere in sicurezza i valichi | riarmo-ordinato',
  'FEB 2026 | Esercitazioni congiunte | Addestrare i comandi a muoversi insieme | riarmo-ordinato',
  'APR 2026 | Deterrenza credibile | Mostrare la forza senza doverla impiegare | fortificazioni-di-confine, esercitazioni-congiunte',
].join('\n');

/** Il piano d'esempio dello Stato maggiore, già analizzato. */
export function militaryPlan(): StrategicPlan {
  return parseStrategicPlan(MILITARY_PLAN_TEXT, 'difesa-e-deterrenza-regionale');
}

/** Le idee dello Stato maggiore: contenuto curato, nessun numero. */
export const MILITARY_IDEAS: CanvasIdea[] = [
  {
    title: 'Riserve addestrate',
    detail: 'Tenere in armi un nucleo addestrato, richiamabile senza smobilitare l’economia.',
    tone: 'neutral',
  },
  {
    title: 'Confini presidiati',
    detail: 'Presidiare i valichi con le opere del catalogo, non con guarnigioni improvvisate.',
    tone: 'neutral',
  },
];

/**
 * La mappa sedia → contenuto curato. Il Tesoro (primo inquilino) e lo Stato
 * maggiore (secondo esempio) hanno voce; le altre sedie no — e non serve
 * toccarle: la tela derivata dal motore le copre comunque.
 */
export const SEAT_CANVAS_AUTHORING: Partial<Record<CabinetAddressView['seat'], SeatCanvasAuthoring>> = {
  /**
   * Il Tesoro: il piano di stabilizzazione e, come idee, le due strade firmabili
   * (le stesse che il ministro mette sul tavolo), con l'opera in attesa come
   * obiettivo della mappa. Il contenuto vive nell'atto: qui non si duplica.
   */
  tesoro: ({ act }) => {
    if (!act) return undefined;
    return {
      plan: stabilizationPlan(),
      ideas: act.roads.map(road => ({
        title: road.title,
        detail: road.voice,
        tone: road.recommended ? 'positive' as const : 'neutral' as const,
      })),
      target: act.worksRequest
        ? {
            label: act.worksRequest.workName,
            detail: act.worksRequest.missing.length > 0
              ? `mancano ${act.worksRequest.missing.join(', ')}`
              : 'distinta coperta',
          }
        : null,
    };
  },
  /**
   * Lo Stato maggiore: un piano militare a cascata e due idee di deterrenza.
   * Non ha un «atto»: le cifre le porta la tela derivata (`militare`).
   */
  guerra: () => ({ plan: militaryPlan(), ideas: MILITARY_IDEAS }),
};

/** Il contenuto curato di una sedia, se ne ha uno. */
export function seatCanvasAuthoring(
  seat: CabinetAddressView['seat'],
  context: SeatCanvasContext,
): SeatCanvasAuthored | undefined {
  return SEAT_CANVAS_AUTHORING[seat]?.(context);
}
