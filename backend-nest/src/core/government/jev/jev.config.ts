export interface JevContextBudget {
  identity: number;
  worldState: number;
  strategicMemory: number;
  retrievedMemory: number;
  recentConversation: number;
}

export interface JevConfig {
  enabled: boolean;
  maxActiveMemories: number;
  consolidationIntervalTurns: number;
  maxMinisterContextTokens: number;
  maxDiplomaticContextTokens: number;
  maxFactionContextTokens: number;
  semanticRetrievalEnabled: boolean;
  llmFallbackEnabled: boolean;
  debug: boolean;
  contextBudget: JevContextBudget;
}

/** Read at call time, never cache process.env: flag-off preserves the caller's legacy path. */
export function getJevConfig(env: Record<string, string | undefined> = process.env): JevConfig {
  const flag = env.JEV_MEMORY_ENABLED;
  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    throw new TypeError('JEV_MEMORY_ENABLED must be true or false');
  }
  return {
    enabled: flag !== 'false',
    maxActiveMemories: 5000,
    consolidationIntervalTurns: 10,
    maxMinisterContextTokens: 4500,
    maxDiplomaticContextTokens: 3500,
    maxFactionContextTokens: 1200,
    semanticRetrievalEnabled: false,
    llmFallbackEnabled: false,
    debug: false,
    contextBudget: {
      identity: 400, worldState: 1200, strategicMemory: 800,
      retrievedMemory: 1200, recentConversation: 800,
    },
  };
}
