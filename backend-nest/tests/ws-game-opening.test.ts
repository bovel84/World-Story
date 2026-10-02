/**
 * WS-GAME-OPENING — la narrativa dell'apertura è deterministica e read-only.
 */
import { describe, expect, it } from 'vitest';
import { buildOpeningNarrative, extractOpeningParagraphs } from '../src/core/government/OpeningNarrative';
import { personaFor } from '../src/core/government/MinisterPersona';
import type { CabinetAddress } from '../src/core/government/Cabinet';

function address(seat: CabinetAddress['seat'], urgency: 'critica' | 'urgente' | 'ordinaria', need: string): CabinetAddress {
  return {
    seat,
    label: `Ministro ${seat}`,
    reads: 'una competenza',
    items: [{ voiceId: `v-${seat}`, need, because: 'perché', urgency, figures: [], paths: [] }],
    opening: 'apertura',
  } as CabinetAddress;
}

describe('WS-GAME-OPENING — OpeningNarrative (backend)', () => {
  it('il prologo viene dal preset, non da conoscenza generica', () => {
    const narrative = buildOpeningNarrative({
      worldName: 'Millennium Dawn',
      date: '2000-01-01',
      premise: '# Il mondo\n\nPRESET_MARKER_WORLD: la Guerra Fredda è finita e l’ordine è instabile.\n\nL’Europa prepara l’allargamento verso est.',
    });
    expect(narrative.deterministic).toBe(true);
    expect(narrative.generated).toBe(false);
    expect(narrative.world.name).toBe('Millennium Dawn');
    expect(narrative.world.date).toBe('2000-01-01');
    expect(narrative.world.paragraphs.join(' ')).toContain('PRESET_MARKER_WORLD');
    expect(narrative.world.paragraphs.join(' ')).not.toContain('GENERIC_HISTORY_FACT');
    expect(narrative.world.paragraphs.length).toBeLessThanOrEqual(4);
  });

  it('il consiglio usa la persona + la questione del motore, al massimo tre sedie, senza cifre', () => {
    const narrative = buildOpeningNarrative({
      worldName: 'W', date: '2000-01-01', premise: 'Testo.',
      addresses: [
        address('lavori', 'ordinaria', 'Ricostruire le infrastrutture'),
        address('tesoro', 'critica', 'Coprire la cassa'),
        address('esteri', 'ordinaria', 'Coltivare le relazioni'),
        address('guerra', 'ordinaria', 'Difendere i confini'),
      ],
    });
    expect(narrative.council).toHaveLength(3);
    // Urgenza critica in testa.
    expect(narrative.council[0].seat).toBe('tesoro');
    for (const voice of narrative.council) {
      // Persona (firma di stile, senza virgolette) + questione del motore.
      const signature = personaFor(voice.seat).signature.replace(/^[«"]\s*/, '').replace(/\s*[»"]$/, '').replace(/[.]$/, '');
      expect(voice.line).toContain(signature);
      expect(/\d/.test(voice.line)).toBe(false);
      expect(voice.line).not.toContain('«');
      expect(voice.line).not.toContain('»');
    }
    expect(narrative.council[0].line).toContain('coprire la cassa');
  });

  it('una questione con cifre non entra nella voce: resta la sola persona', () => {
    const narrative = buildOpeningNarrative({
      worldName: 'W', date: '', premise: '',
      addresses: [address('guerra', 'ordinaria', 'Portare la spesa al 4% del PIL')],
    });
    const line = narrative.council[0].line;
    expect(/\d/.test(line)).toBe(false);
    expect(line).toContain('La forza che rassicura');
  });

  it('una sedia senza voci tace', () => {
    const narrative = buildOpeningNarrative({
      worldName: 'W', date: '', premise: '',
      addresses: [
        address('tesoro', 'ordinaria', 'Coprire la cassa'),
        { ...address('lavori', 'ordinaria', 'x'), items: [] } as CabinetAddress,
      ],
    });
    expect(narrative.council.map(v => v.seat)).toEqual(['tesoro']);
  });

  it('estrae pochi paragrafi e ignora il markdown', () => {
    const paragraphs = extractOpeningParagraphs('# Titolo\n\n- Punto uno con abbastanza testo per restare.\n\n**Blocco due** con enfasi.', 4, 100);
    expect(paragraphs.length).toBeGreaterThan(0);
    const joined = paragraphs.join(' ');
    expect(joined).not.toContain('#');
    expect(joined).not.toContain('**');
    expect(joined).not.toContain('- Punto');
  });

  it('è deterministica', () => {
    const input = { worldName: 'W', date: '2000-01-01', premise: 'Uno. Due.\n\nTre. Quattro.' };
    expect(buildOpeningNarrative(input)).toEqual(buildOpeningNarrative(input));
  });
});
