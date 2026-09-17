/**
 * World Story — MovementNotices
 * =============================
 * I movimenti impossibili devono essere **spiegati**, non silenziosi.
 *
 * Il motore applica i movimenti in due modi: il `move_unit` emesso dal modello
 * e il recupero deterministico sugli ordini accettati (`reconcileAcceptedMoves`).
 * Quando nessuno dei due produce uno spostamento, oggi l'unità resta ferma e il
 * giocatore legge soltanto la narrativa. Questo modulo puro deriva, dai dati che
 * il motore ha già (intenti, analisi dell'ordine, regioni dopo il turno), una
 * motivazione leggibile per ogni ordine accettato che non ha spostato nulla.
 *
 * Nessun numero inventato: la verità è la posizione reale dell'unità rispetto
 * all'origine dell'intento.
 */
import type { MovementBlock, MovementIntent } from '../utils/movement-orders';

export interface MovementNoticeRegion {
  id: string;
  name: string;
  objects?: any[];
}

export interface MovementNoteInput {
  /** Ordini con esito accettato/parziale: il motore non smentisce un rifiuto. */
  accepted: Array<{ actionId: string; text: string }>;
  /** Analisi dell'ordine: presente quando l'ordine È di movimento ma non eseguibile. */
  analyses: Array<{ actionId: string; block?: MovementBlock }>;
  intents: MovementIntent[];
  /** Regioni DOPO il turno: serve solo a sapere se l'unità si è mossa davvero. */
  regions: MovementNoticeRegion[];
}

function unitRegionId(regions: MovementNoticeRegion[], unitId: string): string | undefined {
  for (const region of regions) {
    if ((region.objects || []).some(object => object && object.id === unitId)) return region.id;
  }
  return undefined;
}

function regionName(regions: MovementNoticeRegion[], regionId: string): string {
  return regions.find(region => region.id === regionId)?.name || regionId;
}

/**
 * Una riga per ogni ordine di movimento accettato che non ha prodotto uno
 * spostamento reale, più un avviso quando il movimento è avvenuto ma con
 * scorte insufficienti (fatto registrato dal motore, non un giudizio).
 */
export function buildMovementNotices(input: MovementNoteInput): string[] {
  const notes: string[] = [];
  const byAction = new Map<string, MovementIntent[]>();
  for (const intent of input.intents) {
    const list = byAction.get(intent.actionId) || [];
    list.push(intent);
    byAction.set(intent.actionId, list);
  }
  const blockByAction = new Map(input.analyses.map(analysis => [analysis.actionId, analysis.block]));

  for (const action of input.accepted) {
    const block = blockByAction.get(action.actionId);
    if (block) {
      notes.push(`🚫 Movimento non eseguito — ${block.message}`);
      continue;
    }
    for (const intent of byAction.get(action.actionId) || []) {
      const currentRegionId = unitRegionId(input.regions, intent.unitId);
      // Unità rimossa o fusa: l'assenza è un esito legittimo, non un blocco.
      if (!currentRegionId) continue;
      if (currentRegionId !== intent.originId) {
        const unit = input.regions
          .flatMap(region => region.objects || [])
          .find(object => object && object.id === intent.unitId);
        if (unit?.metadata?.logistics && unit.metadata.logistics.covered === false) {
          notes.push(`⚠️ Movimento eseguito con scorte insufficienti — «${intent.unitName}» ha raggiunto ${regionName(input.regions, currentRegionId)} consumando più cibo, carburante o denaro di quanto fosse disponibile.`);
        }
        continue;
      }
      // Stessa origine e stessa destinazione: nessuno spostamento possibile.
      if (intent.targetId === intent.originId) {
        notes.push(`🚫 Movimento non eseguito — «${intent.unitName}» è già in ${regionName(input.regions, intent.originId)}: la destinazione indicata coincide con la regione di partenza.`);
      } else {
        notes.push(`🚫 Movimento non eseguito — «${intent.unitName}» resta in ${regionName(input.regions, intent.originId)}: la destinazione ${regionName(input.regions, intent.targetId)} non è stata raggiunta nel periodo.`);
      }
    }
  }
  return notes;
}
