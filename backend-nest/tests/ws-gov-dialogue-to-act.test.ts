/**
 * WS-GOV-DIALOGUE-TO-ACT — Il ministro parla come un ministro (difetto 1)
 * ======================================================================
 * Il difetto osservato: il briefing imponeva la struttura FATTI / LETTURA /
 * PROPOSTA e il modello la riversavano nella risposta, producendo un bollettino a
 * tre sezioni invece di una conversazione. Le regole nuove dicono che quella
 * struttura resta **interna**: la risposta è naturale, sviluppa idee e
 * compromessi, e la voce della sedia **prevale** sullo stile del consigliere
 * generale.
 *
 * Difende anche il canale strutturato: il modello aggiorna la proposta con un
 * blocco `decision`, e ogni valore numerico porta la sua provenienza — mai un
 * numero inventato.
 */
import { describe, expect, it } from 'vitest';
import { briefingFor } from '../src/core/government/MinisterChat';
import { MINISTER_PERSONAS, personaSection } from '../src/core/government/MinisterPersona';
import { CABINET_SEATS, SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem } from '../src/core/government/Cabinet';
import type { GovernmentAgenda } from '../src/core/government/GovernmentAgenda';

const emptyAgenda: GovernmentAgenda = { voices: [], headline: '', canonicalMutation: false };

function item(voiceId: string): CabinetItem {
  return {
    voiceId,
    need: `Bisogno ${voiceId}`,
    because: `Perché ${voiceId}`,
    urgency: 'ordinaria',
    figures: [{ label: 'Misura', value: '1', unit: 'unità', basis: { kind: 'measured', source: 'motore' } }],
    paths: [
      { id: 'a', title: 'Via A', detail: 'Dettaglio A', prerequisites: [], expected: 'Esito A', recommended: true },
    ],
  };
}

function address(seat: CabinetAddress['seat'], items: CabinetItem[]): CabinetAddress {
  return { seat, label: SEAT_LABEL[seat], reads: SEAT_READS[seat], items, opening: 'Apertura.' };
}

const briefing = () => briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);

describe('WS-GOV-DIALOGUE-TO-ACT — il ministro parla come un ministro', () => {
  it('la struttura FATTI/LETTURA/PROPOSTA resta interna e NON va mostrata', () => {
    const ctx = briefing().context;
    expect(ctx).toContain('[DIALOGUE STYLE]');
    expect(ctx).toMatch(/NON mostrare.*FATTI \/ LETTURA \/ PROPOSTA/);
    expect(ctx).toContain('Non stai leggendo un rapporto');
    expect(ctx).toContain('la tua risposta è una conversazione naturale');
  });

  it('può sviluppare idee e compromessi, non solo commentare le alternative', () => {
    const ctx = briefing().context;
    expect(ctx).toContain('Se hai una preferenza, dilla e argomentala come tua');
    expect(ctx).toContain('mostrando il compromesso');
    expect(ctx).toContain('Una tua raccomandazione è source = minister, status = proposed');
    expect(ctx).toContain('NON inventare mai un numero del mondo');
    expect(ctx).toContain('Non aggiungere aneddoti, nomi propri, date o promesse assenti');
  });

  it('la voce della sedia prevale sullo stile generico del consigliere', () => {
    for (const seat of CABINET_SEATS) {
      const section = personaSection(MINISTER_PERSONAS[seat]);
      expect(section).toContain('LA TUA VOCE PREVALE SULLO STILE GENERICO');
      expect(section).toContain('non un consigliere generico');
      // La sezione resta senza cifre: è ruolo, non stato.
      expect(section).not.toMatch(/\d/);
    }
    expect(briefing().context).toContain('Tu non sei il Primo Consigliere');
    expect(briefing().context).toMatch(/Lo stile ministeriale PREVALE/);
  });

  it('dichiara il canale `decision`: provenienza obbligatoria, mai numeri inventati', () => {
    const ctx = briefing().context;
    expect(ctx).toContain('PROPOSTA IN LAVORAZIONE');
    expect(ctx).toContain('```decision');
    expect(ctx).toContain('`engine`');
    expect(ctx).toContain('`president`');
    expect(ctx).toContain('`minister`');
    expect(ctx).toContain('NON inventare mai un numero');
    expect(ctx).toContain('unresolvedQuestions');
  });
});
