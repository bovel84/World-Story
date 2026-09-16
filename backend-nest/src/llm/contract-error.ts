/**
 * World Story — LLM Contract Error
 * ==============================
 * Errore tipizzato per violazioni del **contratto di output** di un modello:
 * la risposta non contiene JSON estraibile oppure non rispetta la forma attesa.
 *
 * Distinto da `LLMError` (trasporto/provider: rete, 429/5xx, timeout): quello
 * dice «il modello non ha risposto», questo dice «il modello ha risposto male».
 * I chiamanti possono quindi scegliere politiche diverse (fallback morbido per
 * il contratto, retry per il trasporto).
 *
 * Il messaggio e l'estratto sono sicuri da mostrare: non contengono chiavi API
 * né il corpo della richiesta; l'estratto è troncato.
 */
export class LLMContractError extends Error {
  /** Meccanica che ha prodotto la risposta non conforme (es. 'jump'). */
  readonly mechanic?: string;
  /** Estratto troncato della risposta, per diagnosi senza esporre tutto. */
  readonly excerpt?: string;

  constructor(message: string, opts: { mechanic?: string; excerpt?: string } = {}) {
    super(`llm_contract_error: ${message}`);
    this.name = 'LLMContractError';
    this.mechanic = opts.mechanic;
    this.excerpt = opts.excerpt ? opts.excerpt.slice(0, 200) : undefined;
  }
}
