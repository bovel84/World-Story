import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');
// Fase 2: il wiring del desk (incluso il passaggio delle proposte) vive in `GameScreen`.
const gameScreenSource = fs.readFileSync(path.resolve(__dirname, 'GameScreen.tsx'), 'utf8');
const deskSource = fs.readFileSync(path.resolve(__dirname, '..', 'Shell', 'DeskContent.tsx'), 'utf8');

describe('pannello Ordini — proposte generate', () => {
  it('passa le proposte dallo store al desk', () => {
    expect(gameScreenSource).toContain('suggestions={suggestions}');
    expect(deskSource).toContain('suggestions: Suggestion[]');
  });

  it('renderizza temi e azioni invece di lasciare invisibile il risultato', () => {
    expect(deskSource).toContain('suggestions.map((suggestion, topicIndex)');
    expect(deskSource).toContain('suggestion.actions.map((action, actionIndex)');
    expect(deskSource).toContain('className="suggestions-list"');
  });

  it('permette di aggiungere una proposta al piano e riconosce i duplicati', () => {
    expect(deskSource).toContain('queuePlayerAction(content)');
    expect(deskSource).toContain('resolveSuggestionToggle(pendingActions, content)');
    expect(deskSource).toContain("queued ? 'Rimuovi' : 'Usa'");
  });

  it('annuncia ai lettori di schermo l’arrivo dei risultati', () => {
    expect(deskSource).toContain('aria-live="polite"');
    expect(deskSource).toContain('temi strategici generati');
  });
});
