import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { normalizeAiPreset, presetsRouter } from '../src/routes/presets.routes';
import { getLLMRouter } from '../src/llm';

const servers: Array<ReturnType<ReturnType<typeof express>['listen']>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('assistente IA dei preset', () => {
  it('normalizza una bozza italiana e conserva soltanto codici ISO-A3', () => {
    const result = normalizeAiPreset({
      nome: 'Europa 1914',
      data_iniziale: '1914-07-23',
      paesi_giocabili: ['ita', 'FRA', 'Francia', 'DEU'],
      premessa: 'La crisi di luglio entra nella sua fase decisiva.',
      presentazione: 'Le cancellerie europee affrontano una scelta irreversibile.',
      dossier_storico: 'Alleanze e piani di mobilitazione dominano i calcoli delle potenze.',
      regole: 'Le mobilitazioni richiedono tempo. Nessuna alleanza implica automatismi assoluti.',
    }, {});

    expect(result.id).toBe('europa_1914');
    expect(result.country_codes).toEqual(['ITA', 'FRA', 'DEU']);
    expect(result.start_date).toBe('1914-07-23');
    expect(result.base_prompt).toContain('crisi di luglio');
  });

  it('rifiuta risposte prive dei campi essenziali', () => {
    expect(() => normalizeAiPreset({ description: 'Solo una frase.' }, {}))
      .toThrow(/incompleta/);
  });

  it('espone una bozza rivedibile senza salvarla', async () => {
    const generate = vi.spyOn(getLLMRouter(), 'generate').mockResolvedValue({
      content: JSON.stringify({
        id: 'mediterraneo_1967', name: 'Mediterraneo 1967',
        description: 'Una crisi regionale mette alla prova le cancellerie.',
        start_date: '1967-05-15', country_codes: ['ISR', 'EGY'],
        base_prompt: 'Le tensioni regionali precedono l’apertura delle ostilità.',
        historical_accuracy: 0.9,
        lore: 'Gli schieramenti militari e le alleanze regionali sono già definiti.',
        simulation_rules: 'Le mobilitazioni richiedono tempo e ogni governo decide autonomamente.',
      }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/templates', presetsRouter);
    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server test non disponibile');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/templates/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: 'Crisi in Medio Oriente nel 1967', draft: {} }),
    });
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.preset.country_codes).toEqual(['ISR', 'EGY']);
    expect(generate).toHaveBeenCalledWith('advisor', expect.any(String), expect.stringContaining("IDEA DELL'AUTORE"), expect.any(Object));
  });
});
