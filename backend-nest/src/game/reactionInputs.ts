/**
 * World Story — ReactionInputs
 * ============================
 * Alimentazione PURA del contesto di reazione (`core/simulation/ReactionContext`,
 * congelato): qui si decide solo quali dati entrano, mai chi reagisce o con
 * quali opzioni — quello resta al motore.
 */

/**
 * Rapporti rilevanti per il contesto di reazione: quelli che riguardano il
 * giocatore. La matrice è simmetrica, quindi lo stance della controparte verso
 * il giocatore resta leggibile anche se registrato nel verso opposto; una
 * relazione fra due terze politie non rende nessuna delle due una controparte
 * del giocatore e non deve entrare nell'elenco degli attori.
 */
export function playerCentricRelationships(
  relationships: Record<string, Record<string, string>> | undefined,
  playerPolityId: string,
): Record<string, Record<string, string>> | undefined {
  if (!relationships) return undefined;
  const out: Record<string, Record<string, string>> = {};
  const rowsInvolvingPlayer: Array<[string, string, string]> = [];
  for (const [from, targets] of Object.entries(relationships)) {
    for (const [to, type] of Object.entries(targets || {})) {
      if (!type || (from !== playerPolityId && to !== playerPolityId)) continue;
      rowsInvolvingPlayer.push([from, to, type]);
    }
  }
  // Prima i rapporti registrati nel verso originale, poi i rispecchiamenti
  // mancanti: un valore reale non viene mai sovrascritto da una simmetria.
  for (const [from, to, type] of rowsInvolvingPlayer) {
    (out[from] ||= {})[to] = type;
  }
  for (const [from, to, type] of rowsInvolvingPlayer) {
    const mirror = (out[to] ||= {});
    if (!(from in mirror)) mirror[from] = type;
  }
  return out;
}
