import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiplomacyPanel } from './DiplomacyPanel';

describe('Diplomacy panel entrypoint', () => {
  it('shows a usable way to open diplomatic chats before relationships load', () => {
    const html = renderToStaticMarkup(
      <DiplomacyPanel gameId="game-1" playerPolityId="UGA" regions={[]} />
    );
    expect(html).toContain('Caricamento diplomazia');
    expect(html).toContain('Apri comunque le trattative diplomatiche');
    expect(html).not.toContain('disabled=""');
  });
});
