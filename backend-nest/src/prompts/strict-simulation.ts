/**
 * Strict simulation prompt contract.
 *
 * This module is deliberately independent from GameController: it only adapts
 * prompt input. Material authorization is still enforced by EffectValidator
 * and the canonical server-side effect producers.
 */

export const STRICT_SIMULATION_CONTRACT = `[CONTRATTO STRICT — AUTORITÀ MATERIALE SERVER, PRIORITÀ MASSIMA]
Questa partita usa economy_mode=strict. La LLM non è fonte di verità per beni, denaro, popolazione, potenza militare, territorio o oggetti della mappa.
- \`mapChanges\` deve restare sempre []: non emettere build_facility, spawn_battalion, spawn_unit, transfer o altre mutazioni materiali, anche se istruzioni di formato successive ne mostrano lo schema legacy.
- \`worldChanges\` non deve contenere variazioni materiali di proprietà, colore, PIL, popolazione, militare o feature; lascia vuote le relative collezioni di mutazione.
- Gli effetti materiali \`ledger\`, \`shipment\` e \`project_tick\` possono citare SOLO un \`effectId\` esplicitamente presente nel contesto server come già staged/autorizzato. Non inventare effectId, importi, quantità, account, risorse, capacità o tempi.
- Se un ordine richiede una mutazione non ancora autorizzata dal server, descrivi al massimo decisione, preparazione o processo aperto e restituisci \`partial\` o \`rejected\`; non narrare il risultato materiale come già compiuto.
- Gli eventi puramente qualitativi restano ammessi soltanto se causalmente supportati dal contesto.
Questo contratto prevale sulle sezioni successive che descrivono formati legacy di mapChanges/worldChanges.`;

/** Pure adapter: leaves the caller object untouched and is idempotent. */
export function withStrictSimulationContract<T extends Record<string, any>>(gameData: T): T {
  const current = typeof gameData?.simulationRules === 'string'
    ? gameData.simulationRules.trim()
    : '';
  if (current.includes('[CONTRATTO STRICT — AUTORITÀ MATERIALE SERVER')) return gameData;
  return {
    ...gameData,
    simulationRules: [current, STRICT_SIMULATION_CONTRACT].filter(Boolean).join('\n\n'),
  };
}

/**
 * Economy mode is persisted server-side and cannot be selected by the browser.
 * Failure to resolve the mode never weakens the material boundary because the
 * strict EffectValidator remains authoritative after provider output.
 */
export async function prepareSimulationGameData<T extends Record<string, any>>(gameData: T): Promise<T> {
  if (!gameData?.id) return gameData;
  try {
    const { gameRepository } = await import('../repositories');
    return gameRepository.getEconomyMode(gameData.id) === 'strict'
      ? withStrictSimulationContract(gameData)
      : gameData;
  } catch {
    return gameData;
  }
}
