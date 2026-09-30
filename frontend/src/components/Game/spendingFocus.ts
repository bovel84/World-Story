/**
 * WS-MINISTER-UX-07 — La voce di spesa discussa, scelta in locale
 * ==============================================================
 * Difetto A2 chiuso qui: quando la conversazione parla di **spesa** in una
 * voce precisa (sanità, istruzione, difesa, opere…), la tavola deve mettere in
 * evidenza **quella voce**, non il saldo del bilancio. La scelta è
 * **deterministica e locale**: nessuna chiamata al modello, nessun numero nuovo.
 *
 * Il modulo non conosce le etichette del bilancio — le riceve dal read model
 * (`.expense[].label`). Dal testo della discussione estrae, per sinonimi noti,
 * la voce che combacia; se nessuna combacia torna `null` e non si evidenzia
 * nulla (meglio la tavola intera che una voce sbagliata).
 *
 * Confine: qui si sceglie **cosa evidenziare**, non si legge né si calcola un
 * dato. Le cifre restano quelle del motore.
 */

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
 * I sinonimi per famiglie di spesa. Le chiavi sono **radici** dell'etichetta
 * (es. `sanita` combacia con «Sanità e assistenza»); i valori sono le parole che
 * nel discorso indicano quella famiglia. Elenco chiuso: una parola fuori elenco
 * non inventa una voce.
 */
const SYNONYMS: ReadonlyArray<{ readonly stem: string; readonly words: readonly string[] }> = [
  { stem: 'sanita', words: ['sanita', 'ospedal', 'salute', 'assistenza', 'medic', 'cure'] },
  { stem: 'istruzione', words: ['istruzione', 'scuol', 'atene', 'ricerca', 'universit', 'educaz', 'student'] },
  { stem: 'difesa', words: ['difesa', 'militar', 'guerra', 'esercito', 'armi', 'armat', 'repart', 'fanti'] },
  { stem: 'infrastruttur', words: ['infrastruttur', 'cantier', 'opere', 'opera', 'trasport', 'ferrov', 'strad', 'ponti'] },
  { stem: 'sostegno', words: ['sostegno', 'social', 'lavoro', 'welfare', 'disoccup', 'salari', 'pension'] },
  { stem: 'amministrazione', words: ['amministrazione', 'burocrazia', 'enti locali', 'comuni'] },
];

/**
 * La voce di spesa discussa, scelta fra le `labels` pubblicate dal motore.
 *
 * Priorità: combacia l'intera etichetta (3 punti), poi un sinonimo di famiglia
 * (2), poi una parola significativa dell'etichetta (1). Vince il punteggio
 * più alto; a parità, l'ordine delle `labels` (stabile). `null` se nulla
 * combacia: non si evidenzia una voce a caso.
 */
export function matchSpendingVoice(text: string, labels: readonly string[]): string | null {
  const hay = normalize(text);
  if (!hay) return null;

  let best: { label: string; score: number } | null = null;
  for (const label of labels) {
    const lab = normalize(label);
    if (!lab) continue;
    let score = 0;
    if (hay.includes(lab)) score += 3;
    for (const family of SYNONYMS) {
      if (!lab.includes(family.stem)) continue;
      for (const word of family.words) {
        if (hay.includes(word)) { score += 2; break; }
      }
    }
    // Le parole lunghe dell'etichetta stessa sono un segnale debole ma utile
    // per voci fuori elenco (es. «Royalties»).
    for (const word of lab.split(' ')) {
      if (word.length >= 6 && hay.includes(word)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { label, score };
  }
  return best?.label ?? null;
}
