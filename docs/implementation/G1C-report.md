# G1-C — Unificazione dei dialog residui

**Pacchetto:** completamento della primitive di dialog introdotta in G1-B.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

Sono stati migrati gli ultimi dialog e overlay interattivi rimasti fuori da `AccessibleDialog`:

- dettaglio del dispaccio in `EventFeed`;
- pannello Timeline in `HudBar`;
- lettore del checkpoint attivo in `SimulationEventReader`.

Non restano più `role="dialog"` o `createPortal()` specifici nei componenti `Game`: il portal, l'isolamento dell'app, Escape, backdrop e ciclo focus risiedono in un punto solo.

## Decisioni

### Archivio e Timeline

- entrambi chiudono con Escape o backdrop;
- il primo controllo focusabile (in pratica la chiusura) riceve il focus quando non viene dichiarato un target esplicito;
- l'apertura della Timeline continua a notificare il padre e la scelta di un salto continua a chiudere il pannello prima di avviare il comando.

### Lettore del checkpoint

Il lettore rappresenta un punto decisionale obbligatorio, non una finestra consultativa. Rimane quindi modale e non chiudibile da Escape/backdrop; il focus raggiunge `Evento successivo` e torna lì quando arriva una pagina successiva. Il lettore conserva `aria-live="polite"` e l'id canonico `simulation-event-reader`.

### Primitive

`AccessibleDialog` ora supporta `id` e `ariaLive`; quando il focus esplicito è disabilitato, sceglie il primo controllo disponibile e poi il contenitore dialog. Ciò evita di tentare di focalizzare un'azione temporaneamente disabilitata durante un avanzamento.

## Invarianti

- Nessun contratto API, simulazione, salvataggio, timeline o checkpoint è cambiato.
- Nessun contenuto futuro viene rivelato dal reader.
- Le classi CSS legacy (`article-overlay`, `hud-timeline-overlay`, `simulation-reader-scrim`) sono mantenute; il cambiamento è strutturale/accessibile, non di palette o layout intenzionale.

## Test

```text
cd frontend && ../node_modules/.bin/vitest run src/components/ui/accessibleDialogContract.test.ts
→ 1 file, 5 test verdi

cd frontend && npm run build
→ tsc + vite OK

git diff --check
→ pulito
```

La build è particolarmente lenta nell'ambiente corrente (3m23s) ma termina correttamente. Playwright resta incompatibile con macOS 11.6 e la sessione Chrome DevTools ha un tab bloccato da una creazione mondo; la verifica manuale dei flussi in partita rimane da svolgere.

## Prossimo passo

La base dialog è ora unificata. Il prossimo blocco G1 dovrebbe sostituire `alert()` con toast accessibili e poi iniziare la shell operativa (rail, mappa dominante e moduli) senza aggiungere CSS stratificato.
