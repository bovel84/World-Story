/**
 * World Story — disponibilità di WebGL
 * =====================================
 * MapLibre richiede un contesto WebGL e **non ha ripiego**: se la creazione
 * fallisce solleva un errore che, non intercettato, abbatte l'intera partita.
 * Succede davvero — hardware acceleration disattivata, GPU in blocklist,
 * browser sandboxato — e il messaggio del browser è eloquente:
 *
 *   `Could not create a WebGL context, GL_VENDOR = Disabled, Sandboxed = yes`
 *
 * Qui la disponibilità si **accerta prima** di montare la mappa, così il gioco
 * può degradare a una mappa statica invece di morire. Il modulo è puro e
 * testabile: l'ambiente è iniettabile.
 */

/** Esito della verifica, con la ragione leggibile (per UI e diagnostica). */
export interface WebGLSupport {
  available: boolean;
  /** Perché non è disponibile: mostrabile al giocatore. */
  reason: 'ok' | 'no_document' | 'context_failed';
}

/**
 * Vero se il documento può creare un contesto WebGL.
 *
 * Il test crea un canvas **usa e getta** e prova i due nomi di contesto
 * (`webgl2` prima, poi `webgl`): è la stessa prova che farà MapLibre, fatta
 * prima e senza conseguenze. Il canvas non viene mai inserito nel DOM.
 *
 * `doc` è iniettabile per i test; in assenza di documento (SSR, test in Node) la
 * risposta è «non disponibile» — mai un lancio.
 */
export function detectWebGL(doc?: Pick<Document, 'createElement'> | null): WebGLSupport {
  const target = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!target) return { available: false, reason: 'no_document' };
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = target.createElement('canvas') as HTMLCanvasElement;
    if (!canvas || typeof canvas.getContext !== 'function') {
      return { available: false, reason: 'context_failed' };
    }
    const attributes: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: false,
      // Un contesto di prova non deve lasciare stato: niente antialias, niente
      // buffer da conservare.
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    };
    const context = canvas.getContext('webgl2', attributes)
      ?? canvas.getContext('webgl', attributes);
    if (!context) return { available: false, reason: 'context_failed' };
    // Rilascia subito il contesto di prova: alcuni browser limitano quanti se ne
    // possono creare, e MapLibre ne vuole uno suo.
    const lose = (context as WebGLRenderingContext).getExtension?.('WEBGL_lose_context');
    lose?.loseContext?.();
    return { available: true, reason: 'ok' };
  } catch {
    // Un lancio è una risposta, non un errore da propagare.
    return { available: false, reason: 'context_failed' };
  } finally {
    // Il canvas non è mai finito nel DOM: basta lasciarlo al garbage collector,
    // ma azzerarne il riferimento evita di trattenerlo per errore.
    canvas = null;
  }
}

/** Messaggio per il giocatore: cosa è successo e cosa può fare. */
export function webglUnavailableNotice(reason: WebGLSupport['reason']): string {
  if (reason === 'ok') return '';
  return 'La mappa interattiva richiede WebGL, non disponibile in questo browser. '
    + 'La partita continua con la mappa statica: puoi giocare normalmente. '
    + 'Per la mappa interattiva, abilita l\'accelerazione hardware nelle impostazioni del browser.';
}
