/**
 * Disponibilità di WebGL — la guardia che evita il crash.
 *
 * Il difetto: MapLibre non ha ripiego e, senza contesto WebGL, solleva un
 * errore che risale fino alla radice React. Questi test verificano che la
 * disponibilità si accerti **prima**, che un contesto mancante o un lancio non
 * si propaghino mai, e che il messaggio al giocatore dica la verità: il gioco
 * continua.
 */
import { describe, it, expect } from 'vitest';
import { detectWebGL, webglUnavailableNotice } from './webglSupport';

/** Un documento finto: `createElement` restituisce un canvas che risponde come serve. */
function fakeDocument(contexts: Record<string, unknown>, throwOn?: string) {
  return {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {} as unknown as HTMLElement;
      return {
        getContext: (id: string) => {
          if (throwOn && id === throwOn) throw new Error('BindToCurrentSequence failed');
          return contexts[id] ?? null;
        },
      } as unknown as HTMLCanvasElement;
    },
  } as unknown as Document;
}

const GL_CONTEXT = {
  getExtension: () => ({ loseContext: () => { /* rilascia il contesto di prova */ } }),
};

describe('rilevamento WebGL', () => {
  it('disponibile quando il browser sa creare un contesto', () => {
    expect(detectWebGL(fakeDocument({ webgl2: GL_CONTEXT })).available).toBe(true);
    // I browser più vecchi offrono solo `webgl`: va bene lo stesso.
    expect(detectWebGL(fakeDocument({ webgl: GL_CONTEXT })).available).toBe(true);
  });

  // Il caso del crash riportato: `Could not create a WebGL context, GL_VENDOR = Disabled`.
  it('non disponibile quando nessun contesto viene creato', () => {
    const result = detectWebGL(fakeDocument({}));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('context_failed');
  });

  it('un lancio del browser è una risposta, non un errore da propagare', () => {
    // `getContext` che solleva è esattamente ciò che fa un browser sandboxato.
    expect(() => detectWebGL(fakeDocument({}, 'webgl2'))).not.toThrow();
    expect(detectWebGL(fakeDocument({}, 'webgl2')).available).toBe(false);
  });

  it('senza documento (ambienti non browser) dichiara l\'indisponibilità', () => {
    expect(detectWebGL(null)).toEqual({ available: false, reason: 'no_document' });
  });

  it('prova prima il contesto che serve a MapLibre, senza conservarlo', () => {
    const asked: string[] = [];
    const doc = {
      createElement: () => ({
        getContext: (id: string) => { asked.push(id); return GL_CONTEXT; },
      }),
    } as unknown as Document;
    detectWebGL(doc);
    expect(asked[0]).toBe('webgl2');
  });
});

describe('messaggio al giocatore', () => {
  it('dice che il gioco continua, non solo che la mappa manca', () => {
    const notice = webglUnavailableNotice('context_failed');
    expect(notice).toMatch(/partita continua/i);
    expect(notice).toMatch(/mappa statica/i);
    // Il rimedio pratico è indicato.
    expect(notice).toMatch(/accelerazione hardware/i);
  });

  it('non produce messaggi quando WebGL c\'è', () => {
    expect(webglUnavailableNotice('ok')).toBe('');
  });
});
