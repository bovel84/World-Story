/**
 * World Story — Flag narrativi (WS-NARR-DISPATCH-PAX-QUALITY)
 * ==========================================================
 * Le migliorie di qualità narrativa dei dispacci sono modifiche di **prompt**
 * e di **budget di memoria**: cambiano ciò che il modello legge, non ciò che il
 * motore calcola. Per questo vivono dietro flag di configurazione **spenti di
 * default**: accenderli non tocca `EffectValidator`, `ReactionDecisions` né il
 * contratto delle reazioni, e un turno con i flag spenti deve restare identico
 * a prima.
 *
 * I flag si leggono da:
 *  1. la sezione `narrative` di `llm.config.json`;
 *  2. le variabili d'ambiente `WS_NARRATIVE_*` (comodo per l'harness offline e
 *     per le prove locali, senza riscrivere il file).
 *
 * La risoluzione è una **funzione pura**: si prova senza avviare il router.
 */

export interface NarrativeFlags {
  /**
   * Step 3 — texture narrativa: nei preset storici consente figure ed eventi
   * documentati dell'epoca e del canone, aggiunge due esempi originali di buon
   * dispaccio e una regola di varietà delle aperture.
   */
  texture: boolean;
  /**
   * Step 4 — «world pulse»: passaggio separato che propone 3-6 eventi di nazioni
   * lontane partendo da `NpcAgenda`, relazioni e stato del motore, con causa
   * verificabile e le stesse validazioni esistenti.
   */
  worldPulse: boolean;
  /**
   * Step 5 — memoria per fascia di modello: i limiti di caratteri di
   * `buildNarrativeMemory` e del prompt compatto dipendono da `classifyModel`,
   * così i modelli forti ricevono più cronaca e più memoria canonica.
   */
  tieredMemory: boolean;
}

/** Tutti spenti: il comportamento di default resta quello precedente. */
export const DEFAULT_NARRATIVE_FLAGS: NarrativeFlags = {
  texture: false,
  worldPulse: false,
  tieredMemory: false,
};

const ENV_KEYS: Record<keyof NarrativeFlags, string> = {
  texture: 'WS_NARRATIVE_TEXTURE',
  worldPulse: 'WS_NARRATIVE_WORLD_PULSE',
  tieredMemory: 'WS_NARRATIVE_TIERED_MEMORY',
};

function truthy(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '') return undefined;
  if (['1', 'true', 'on', 'yes', 'si', 'sì'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return undefined;
}

/**
 * Fonde le tre fonti nell'ordine di priorità: default (tutto spento) →
 * sezione `narrative` del file → variabili d'ambiente. Solo un valore booleano
 * esplicito accende un flag: un refuso non abilita nulla per sbaglio.
 */
export function resolveNarrativeFlags(
  raw?: Partial<NarrativeFlags> | null,
  env: NodeJS.ProcessEnv = process.env,
): NarrativeFlags {
  const out: NarrativeFlags = { ...DEFAULT_NARRATIVE_FLAGS };
  for (const key of Object.keys(out) as Array<keyof NarrativeFlags>) {
    if (typeof raw?.[key] === 'boolean') out[key] = raw[key] as boolean;
    const fromEnv = truthy(env[ENV_KEYS[key]]);
    if (fromEnv !== undefined) out[key] = fromEnv;
  }
  return out;
}
