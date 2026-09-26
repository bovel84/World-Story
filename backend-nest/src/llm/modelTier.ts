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
 * dichiarati** — il suffisso `flash`, la variante gratuita, la dimensione in
 * miliardi scritta nel nome, l'ordine di grandezza `mini`/`small`/`nano`.
 */

/** Sotto questa soglia (in miliardi di parametri) il modello è di fascia bassa. */
export const CONSTRAINED_PARAM_LIMIT_B = 7;

export interface ModelTier {
  /** Il modello riceve il protocollo compatto. */
  constrained: boolean;
  /** Perché: utile nei log e nei test, e per non doverlo dedurre. */
  reason: 'free' | 'flash' | 'small-params' | 'small-label' | 'full-tier';
}

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
 * piccoli. Il caso `4.1` di `deepseek-v4.1-flash` è coperto dal suffisso
 * `flash`, non da questa regola.
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

  // `flash` è il suffisso dei modelli veloci ed economici (glm-5.3-flash,
  // deepseek-v4.1-flash, gemini-flash): è il caso che l'autore ha chiesto.
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
