/**
 * World Story — riconoscimento della fascia di un modello
 * ======================================================
 * Il gioco ha due protocolli di prompt: uno **pieno** (tutte le guardie, tutti
 * gli esempi) e uno **compatto** (`buildConstrainedSimulationPrompt`), scritto
 * per i modelli che perdono il filo su istruzioni lunghe. Quale dei due si usi
 * dipende da `isConstrainedModel`.
 *
 * **Cosa non funzionava, misurato.** Il rilevatore riconosceva **solo** i
 * modelli con `:free`:
 *
 *     return /:free(?:$|[/?#])/.test(model)
 *       || /(?:^|[-_/])(?:[0-4](?:\.\d+)?)b(?:$|[-_/:])/.test(model);
 *
 * La seconda alternativa pretende un separatore (`-`, `_`, `/`) **prima** della
 * cifra, quindi `llama3.2:3b` non corrisponde: dopo il `:` c'è `3`, ma il
 * carattere prima della cifra è `2`, non un separatore. Nella pratica il
 * protocollo compatto non si attivava quasi mai — nemmeno per il modello
 * **predefinito del progetto** (`glm-5.3-flash`, in `llm/models.ts`) né per i
 * modelli locali da 2 e 3 miliardi. Il percorso esisteva ed era morto.
 *
 * Qui il riconoscimento è **esplicito e verificabile**, in una funzione pura:
 * si prova senza avviare il router, e una tabella di modelli reali lo difende.
 *
 * Non si indovina la qualità di un modello dal nome: si riconoscono i **segnali
 * dichiarati** — la variante gratuita, la dimensione in miliardi scritta nel
 * nome, l'ordine di grandezza `mini`/`small`/`nano` — e **prima di tutto** una
 * allowlist esplicita di **famiglie forti** (`glm-5*`, `deepseek-v4*`), perché
 * il suffisso `flash` non è una misura di capacità (i modelli che Andrea usa
 * davvero lo portano e finivano erroneamente nella fascia vincolata).
 */

/** Sotto questa soglia (in miliardi di parametri) il modello è di fascia bassa. */
export const CONSTRAINED_PARAM_LIMIT_B = 7;

export interface ModelTier {
  /** Il modello riceve il protocollo compatto. */
  constrained: boolean;
  /** Perché: utile nei log e nei test, e per non doverlo dedurre. */
  reason: 'free' | 'flash' | 'small-params' | 'small-label' | 'strong-family' | 'full-tier';
}

/**
 * Famiglie di modelli con **capacità piena** riconosciuta, non inferita dalla
 * parola `flash`. L'allowlist è esplicita e deterministica: sono i modelli che
 * Andrea usa davvero (`glm-5*`, `deepseek-v4*`), che il suffisso `flash`
 * classificava erroneamente come piccoli.
 */
const STRONG_FAMILIES = /(?:^|[-_/])(?:glm-5(?:\.\d+)?|deepseek-v4(?:\.\d+)?)(?=$|[-_/:.])/;

/**
 * Dimensioni in miliardi scritte nel nome del modello.
 *
 * Il punto critico è che la cifra sia riconosciuta **anche attaccata** a una
 * lettera o a un separatore qualsiasi, non solo dopo `-`/`_`/`/`: `llama3.2:3b`,
 * `qwen3:1.7b`, `phi4:3.8b`, `gemma2:2b`, `mistral-7b`.
 *
 * Non si guarda un numero qualsiasi: serve una `b` **subito dopo** la cifra, ed
 * eventualmente la fine del nome o un separatore. Così `gpt-oss:20b` (20) e
 * `deepseek-v4` (versione 4, non 4 miliardi) non vengono confusi con modelli
 * piccoli. Il caso `4.1` di `deepseek-v4.1-flash` è coperto dalla allowlist
 * `STRONG_FAMILIES`, non da questa regola.
 */
function smallParams(model: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*b(?=$|[-_/:.])/g;
  for (const match of model.matchAll(re)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= CONSTRAINED_PARAM_LIMIT_B) return value;
  }
  return null;
}

/** Etichette che dichiarano un modello leggero, senza contare i parametri. */
const SMALL_LABELS = /(?:^|[-_/])(mini|small|nano|tiny|lite)(?=$|[-_/:.])/;

/**
 * Decide la fascia di un modello dal suo nome.
 *
 * @param model il nome come lo riporta il provider (es. `glm-5.3-flash`,
 *              `openai/gpt-oss:20b`, `llama3.2:3b:free`).
 */
export function classifyModel(model: string | undefined | null): ModelTier {
  const m = String(model || '').toLowerCase();
  if (!m) return { constrained: false, reason: 'full-tier' };

  // Variante gratuita: storicamente il caso che il codice riconosceva.
  if (/:free(?:$|[/?#])/.test(m)) return { constrained: true, reason: 'free' };

  // Capacità piena riconosciuta per famiglia: batte il suffisso `flash`, che da
  // solo non è una misura di capacità (glm-5.3-flash, deepseek-v4.1-flash).
  if (STRONG_FAMILIES.test(m)) return { constrained: false, reason: 'strong-family' };

  // `flash` resta un segnale debole per i modelli **non** in allowlist: il
  // suffisso da solo non basta a declassare una famiglia forte, ma per gli
  // sconosciuti mantiene il comportamento storico.
  if (/(?:^|[-_/])flash(?=$|[-_/:.])/.test(m)) return { constrained: true, reason: 'flash' };

  const params = smallParams(m);
  if (params !== null) return { constrained: true, reason: 'small-params' };

  if (SMALL_LABELS.test(m)) return { constrained: true, reason: 'small-label' };

  return { constrained: false, reason: 'full-tier' };
}

/** Scorciatoia: il modello riceve il protocollo compatto? */
export function isSmallModel(model: string | undefined | null): boolean {
  return classifyModel(model).constrained;
}

/**
 * Budget di caratteri della memoria narrativa e del prompt compatto.
 *
 * Erano costanti sparse nei due moduli; qui vivono in **una tabella sola**,
 * scelta da `classifyModel`. Così i modelli forti ricevono più cronaca e più
 * memoria canonica, mentre i modelli piccoli mantengono i tetti attuali.
 */
export interface NarrativeBudgets {
  /** Caratteri riservati alla cronaca recente in `buildNarrativeMemory`. */
  recentMemoryChars: number;
  /** Caratteri riservati alla memoria canonica consolidata. */
  canonicalMemoryChars: number;
  /** Limite di ogni turno recente (il più nuovo ha un tetto separato più alto). */
  recentTurnChars: number;
  /** Tetto del turno più recente. */
  newestTurnChars: number;
  /** Clip dei blocchi del prompt compatto. */
  compactStrategicChars: number;
  compactReactionChars: number;
  compactNpcChars: number;
  compactProcessesChars: number;
  compactHistoryChars: number;
  compactDiplomacyChars: number;
  compactMapChars: number;
  compactPremiseChars: number;
}

/** Valori storici: identici al comportamento precedente per i modelli piccoli. */
export const CONSTRAINED_NARRATIVE_BUDGETS: NarrativeBudgets = {
  recentMemoryChars: 4_200,
  canonicalMemoryChars: 1_200,
  recentTurnChars: 750,
  newestTurnChars: 1_700,
  compactStrategicChars: 5_000,
  compactReactionChars: 2_500,
  compactNpcChars: 6_500,
  compactProcessesChars: 2_000,
  compactHistoryChars: 4_500,
  compactDiplomacyChars: 2_500,
  compactMapChars: 5_000,
  compactPremiseChars: 2_000,
};

/** Fascia piena: più cronaca e più memoria canonica, senza cambiare il motore. */
export const FULL_NARRATIVE_BUDGETS: NarrativeBudgets = {
  recentMemoryChars: 7_000,
  canonicalMemoryChars: 2_400,
  recentTurnChars: 1_200,
  newestTurnChars: 2_800,
  compactStrategicChars: 7_500,
  compactReactionChars: 3_500,
  compactNpcChars: 9_500,
  compactProcessesChars: 3_000,
  compactHistoryChars: 7_000,
  compactDiplomacyChars: 3_500,
  compactMapChars: 7_000,
  compactPremiseChars: 3_000,
};

/** Budget di memoria corrispondenti alla fascia del modello. */
export function narrativeBudgetsFor(model: string | undefined | null): NarrativeBudgets {
  return classifyModel(model).constrained
    ? CONSTRAINED_NARRATIVE_BUDGETS
    : FULL_NARRATIVE_BUDGETS;
}
