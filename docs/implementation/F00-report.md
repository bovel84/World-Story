# F00 — Baseline affidabile e regressioni dei rilievi

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F00 (micro-consegna 1: isolamento fixture e riproduzioni audit).
- **Revisore/esecutore:** pi coding agent; revisione indipendente ancora necessaria.
- **HEAD iniziale:** `384dac7909dbd8ac6aaf79d75fae43e6ae7ed947`.
- **Fotografia locale:** modifiche preesistenti in backend prompt/test, frontend e documentazione; nessuna è stata modificata da questa consegna. Sono stati aggiunti soltanto questo report e `backend-nest/tests/integrity-regressions.test.ts`.
- **Runtime:** Node `v22.23.1`, npm `10.9.8`, SQLite `better-sqlite3` tramite fixture temporanea.

## Requisiti audit / invarianti / test

| Audit | Invarianti | Test introdotto | Stato della fotografia |
|---|---|---|---|
| A01 | I15 | C01 | Riprodotto dinamicamente con due testi identici e outcome invertiti per `actionId`; il percorso associa ancora per testo/indice. |
| A03 | I11 | C03 | Riprodotto via route: `GET /simulations/:runId` serializza la riga `run` con `pending_state`. |
| A05 | I13 | C05 | Riprodotto via repository: `replacePendingActions` scarta gli ordini `processing`. |
| A07 | I15 | C07 | Riprodotto staticamente: la chiusura processo confronta `title`, non `source_action_id`. |
| A10 | I01, I11 | C10 | Riprodotto staticamente: il percorso senza eventi ritorna `results.at(-1)`. |

Le riproduzioni A03/A10 restano `it.fails`: sono **test attesi rossi** della baseline, quindi la suite resta eseguibile ma falliranno se il difetto sparisce senza che F03/F04 aggiornino esplicitamente il test e il contratto. A01/C01, A05/C05 locale e A07/C07 sono state convertite in test verdi dalle micro-consegne F01. Non sono presentati come E2E R1.

Il test di guardia usa `PRAGMA database_list` e confronta il percorso reale (`realpath`) per evitare l'alias macOS `/var` → `/private/var`; fallisce se la fixture non usa il file temporaneo impostato in `OPEN_PAX_DB_PATH`.

## File letti e modificati

**Letti:**

- `docs/AUDIT_CONFORMITA_PARITA_2026-09-08.md`
- `docs/PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md` (integrale)
- `docs/PIANO_ESECUTIVO_LLM_REALISMO_UX.md` (integrale)
- `docs/SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md` (integrale)
- `backend-nest/package.json`, `database.ts`, `game-session.ts`, `routes/games.routes.ts`, `repositories/game.repository.ts`, `index.ts`
- Test esistenti: `smoke.test.ts`, `stage2.test.ts`, `routes-playback.test.ts`, `incremental-events.test.ts`.

**Modificati/creati:**

- `backend-nest/tests/integrity-regressions.test.ts` — fixture DB temporanea, guardia e cinque riproduzioni attese rosse.
- `backend-nest/tests/id-contract-regression.test.ts` — C01 dinamico con testi duplicati e outcome invertiti per ID.
- `docs/implementation/F00-report.md` — questo report.

## Comportamento prima / prova

Prima di questa micro-consegna non esisteva una suite F00 che verificasse insieme il path DB e i cinque rilievi selezionati. La prova aggiunta conferma i comportamenti sopra sul sorgente/route/repository correnti. C01 ora è anche dinamico: due ordini dal testo uguale ricevono outcome invertiti muniti di `actionId`; il parser/percorso legacy ignora l'ID e attribuisce l'esito per testo/indice. Il primo run ha rilevato solo un errore della nuova guardia dovuto all'alias di path macOS; corretto il confronto con `realpath`, senza mutare alcun comportamento applicativo.

## Contratto API/schema e compatibilità

Nessun contratto di produzione, schema o migrazione è stato cambiato. Il test A03 osserva deliberatamente l'API legacy corrente; F03 dovrà sostituire `run` con un DTO pubblico allowlist e trasformare la riproduzione in test verde.

## Algoritmo e invarianti mantenute

- I test impostano `OPEN_PAX_DB_PATH` **prima** dell'import dinamico di `database.ts`.
- La fixture viene rimossa con sidecar WAL/SHM; nessun DB o salvataggio reale viene letto, migrato o cancellato.
- Nessun provider LLM, rete esterna, server, deploy o mutazione del mondo viene avviato.
- Nessun ordine viene registrato o emesso; I01, I02, I11–I13 e I15 non vengono aggirati.

## Migrazioni eseguite solo su copie

`initDatabase()` è stato chiamato esclusivamente sul DB temporaneo in `os.tmpdir()`. Nessuna migrazione è stata eseguita su `backend-nest/data/world-story.db` o su altri salvataggi.

## Comandi test e risultato completo

```text
npm --prefix backend-nest test -- integrity-regressions.test.ts
PASS: 1 file, 1 test verde, 5 expected fail.

npm --prefix backend-nest test
PASS dopo F01 micro-consegne: 24 file, 243 test verdi, 2 expected fail (245 totali).
PASS dopo F03 (A03/A10 corretti e convertiti a verde): 28 file, 255/255 verdi, nessun expected-fail residuo.

npm --prefix backend-nest test -- id-contract-regression.test.ts
PASS: 1 file, 1 expected fail.

npm --prefix backend-nest run build
PASS: tsc.

npm --prefix frontend run build
PASS: tsc + vite build.
WARN: chunk JS 1,368.76 kB (385.15 kB gzip), oltre il warning Vite 500 kB;
      è una misura baseline, non è stata modificata in F00.
```

## Screenshot/trace UI

Non applicabile: nessun componente UI né flusso browser è stato modificato.

## Cosa NON è implementato / dipendenze mancanti

- Nessun difetto A01/A03/A05/A07/A10 è corretto in F00.
- Mancano ancora le fixture dinamiche complete per A02/A04/A06/A08/A09/A11–A14; sono responsabilità dei rispettivi pacchetti F02–F06.
- Il mapping completo T01–T38 non è ancora concluso: questa micro-consegna mappa soltanto C01/C03/C05/C07/C10. F00 va esteso prima del gate con gli altri test/fixture e con una revisione dell'audit se una deduzione statica non si conferma.
- C07/C10 sono per ora prove statiche controllate; F01/F03 dovranno sostituirle o affiancarle con integrazioni ID/checkpoint reali. C01 ha ora una riproduzione dinamica, ma deve diventare verde nel percorso canonico F01.

## Crediti / DB reale / deploy

Nessun credito, provider reale, DB reale, partita pubblica, migrazione reale o deploy è stato usato o autorizzato.

## Decisione revisore

**Da correggere / proseguire.** Questa è una baseline F00, non una chiusura del gate. F01 è stato avviato con la micro-consegna `actionId`; restano le riproduzioni dinamiche residue e la revisione indipendente.
