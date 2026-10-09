/**
 * P07 — Le proposte arrivano alle superfici.
 *
 * Test-contratto sul sorgente (convenzione del progetto). Difende il percorso
 * completo della questione, dal Consulente all'atto:
 *
 *   AdvisorChat → CouncilIssueInline (questione senza soluzioni) → openIssue(issue) →
 *   orderDraftStore/`drafts` → ActDraftPanel (la bozza, modificabile) → firma.
 *
 * La misura dice che **non c'è una seconda superficie da costruire**: il
 * percorso esiste e va solo difeso contro le regressioni.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const office = read('GovernmentOffice.tsx');
const chat = read('AdvisorChat.tsx');
const panel = read('ActDraftPanel.tsx');

describe('P07 — il percorso della mossa, dal Consulente all’atto', () => {
  it('il Consulente rende le proposte con il loro callback', () => {
    expect(chat).toContain('<CouncilIssueInline');
    expect(chat).toContain('onOpenIssue={onOpenIssue}');
  });

  it('la stanza del Governo collega il clic alla bozza', () => {
    expect(office).toContain('const openIssue = (issue: CouncilIssue): void =>');
    expect(office).toContain('const room = startRoom(rapporteur, discussionIssue)');
    expect(office).toContain('councilDraft(room, currentTurn ?? 0)');
    expect(office).not.toContain('seedChosenRoad');
  });

  it('la bozza è resa da ActDraftPanel, modificabile prima della firma', () => {
    expect(office).toContain('<ActDraftPanel');
    expect(office).toContain('onEdit={text =>');
    // L'editabilità è una condizione esplicita: dopo un tentativo di firma la
    // bozza si congela (non si firma un testo diverso da quello verificato).
    expect(office).toMatch(/editable=\{!draft\.signatureAttempted && !stale\}/);
    expect(panel).toContain('ActDraftPanel');
  });

  it('la firma passa da onSign → onQueueOrder (il motore, non la UI)', () => {
    expect(office).toContain('onSign={signDraft}');
    expect(office).toContain('onQueueOrder');
  });

  it('guardia contro il falso verde: i tre pezzi del percorso esistono davvero', () => {
    for (const fragment of ['CouncilIssueInline', 'startRoom', 'ActDraftPanel', 'signDraft']) {
      expect(office + chat, `manca ${fragment}`).toContain(fragment);
    }
  });
});
