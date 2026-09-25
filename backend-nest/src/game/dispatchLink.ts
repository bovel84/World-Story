/**
 * World Story — collegamento dispaccio ↔ ordine
 * ============================================
 * Un dispaccio deve poter dire **da quale ordine nasce** (§3.2 punto 8 del
 * piano maestro: «il dispaccio espone ciò che è realmente avvenuto e "Perché":
 * ordine, fase, quantità impegnate/consumate ed effetti»).
 *
 * **Cosa non funzionava, misurato.** Il motore costruiva la mappa
 * ordine → dispaccio usando il **titolo come chiave** e poi la interrogava con
 * una uguaglianza di stringa esatta:
 *
 *     headlineToActionIds[headline]   // chiave: testo del modello
 *     state.headlineToActionIds[event.headline]   // ricerca: stesso testo
 *
 * Il modello scrive il titolo due volte — una nell'esito dell'ordine
 * (`eventHeadlines`) e una nell'evento (`headline`) — e le due copie possono
 * differire di uno spazio, di una maiuscola o di un segno di punteggiatura. In
 * quei casi la ricerca non trova nulla e il dispaccio resta **orfano**: nella
 * partita reale, 0 dispacci su 21 portavano il riferimento all'ordine.
 *
 * La SPEC §6.2 è esplicita: il collegamento va fatto **per ID**, non
 * confrontando il testo. Il modello però non fornisce un ID per gli esiti, solo
 * un titolo. Quindi la chiave si **normalizza** in modo identico da entrambi i
 * lati: è la parte di testo che il modello non può cambiare per sbaglio senza
 * cambiare il senso (maiuscole, spazi, punteggiatura, prefissi numerici).
 *
 * Questo modulo è **puro** e non tocca il database: si può provare senza il
 * motore, che nella VM sandbox non gira (modulo nativo non compilabile).
 */

/**
 * Rende confrontabile il titolo di un dispaccio.
 *
 * - pareggia maiuscole e minuscole;
 * - accorpa gli spazi interni e toglie quelli ai bordi;
 * - rimuove i segni di punteggiatura ai bordi e le virgolette (il modello ne
 *   aggiunge spesso uno);
 * - toglie il prefisso numerico di cortesia («Evento 3: …»), che il motore usa
 *   in alcune superfici e non in altre;
 * - normalizza la forma unicode, così «é» scritta in due modi non separa.
 *
 * Non tocca invece le parole: due titoli diversi restano diversi. Non è una
 * ricerca approssimata, è la **stessa** stringa scritta due volte.
 */
export function headlineKey(headline: string | undefined | null): string {
  if (!headline) return '';
  return headline
    .normalize('NFC')
    .replace(/^\s*evento\s+\d+\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[\s"'«»“”(\[]+/, '')
    .replace(/[\s"'«»“”)\].!?,;:]+$/, '');
}

/**
 * Costruisce l'indice ordine → dispacci, **normalizzato**.
 *
 * @param entries coppie (titolo del modello, ID dell'ordine). Un titolo può
 *                appartenere a più ordini: due ordini diversi possono
 *                confluire nello stesso dispaccio.
 */
export function buildActionLinkIndex(
  entries: Array<{ headline: string | undefined | null; actionId: string }>,
): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const { headline, actionId } of entries) {
    const key = headlineKey(headline);
    if (!key || !actionId) continue;
    const ids = index[key] || [];
    if (!ids.includes(actionId)) ids.push(actionId);
    index[key] = ids;
  }
  return index;
}

/**
 * Cerca gli ordini di un dispaccio.
 *
 * Prova prima la chiave normalizzata e, se non trova, la chiave esatta: così
 * un indice costruito altrove (o un salvataggio vecchio, prima di questa
 * correzione) continua a funzionare invece di perdere il collegamento.
 */
export function lookupActionIds(
  index: Record<string, string[]> | undefined,
  headline: string | undefined | null,
): string[] {
  if (!index || !headline) return [];
  const normalizzata = index[headlineKey(headline)];
  if (normalizzata && normalizzata.length > 0) return normalizzata;
  const esatta = index[headline];
  return Array.isArray(esatta) ? esatta : [];
}
