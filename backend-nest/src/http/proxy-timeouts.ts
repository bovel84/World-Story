/**
 * Timeout HTTP compatibili con il proxy (Cloudflare Worker → quick tunnel → backend).
 * =============================================================================
 * Difetto osservato in produzione: il gioco online rispondeva `502` a richieste
 * brevi e sporadiche (es. il polling di un job di simulazione), con questo log
 * lato `cloudflared`:
 *
 *   error="Unable to reach the origin service ... read tcp [::1]:57077->[::1]:8000:
 *          read: connection reset by peer"
 *
 * La causa non è il backend "giù": è una corsa sui socket keep-alive. `cloudflared`
 * tiene le connessioni verso l'origine in un pool e le riusa; il server Node, con
 * il default `keepAliveTimeout = 5s`, chiude un socket rimasto inattivo per 5
 * secondi. Se il proxy scrive la richiesta successiva su quel socket già chiuso,
 * il reset arriva dal lato origine e l'utente vede un 502 (il frontend lo tratta
 * come transitorio, quindi il turno prosegue, ma l'errore è reale e sporadico).
 *
 * Regola: il timeout keep-alive dell'**origine** deve essere più lungo
 * dell'inattività tollerata dal **proxy**, così la chiusura la decide sempre il
 * proxy e il backend non interrompe mai un socket che il proxy considera vivo.
 * `headersTimeout` deve restare strettamente maggiore di `keepAliveTimeout`
 * (vincolo di Node), altrimenti Node rifiuta la configurazione.
 *
 * Questo modulo è puro e senza stato: rende la scelta verificabile da un test
 * (riuso reale di un socket dopo un'inattività maggiore del default di Node).
 */

/** Inattività tollerata su una connessione keep-alive inattiva (default Node: 5s). */
export const KEEP_ALIVE_TIMEOUT_MS = 120_000;

/** Deve essere > `KEEP_ALIVE_TIMEOUT_MS` (vincolo Node). */
export const HEADERS_TIMEOUT_MS = 125_000;

export interface TimeoutTarget {
  keepAliveTimeout: number;
  headersTimeout: number;
}

/** Applica i timeout proxy-safe a un server HTTP (Express o `http.Server`). */
export function applyProxySafeTimeouts<T extends TimeoutTarget>(server: T): T {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}
