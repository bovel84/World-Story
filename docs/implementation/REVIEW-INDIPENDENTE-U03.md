# Revisione indipendente — U03 (Dossier Nazione, chat/accordi, lettore causale)

- **Revisore**: ≠ implementatore.
- **Oggetto**: `stores/nationDock.ts`, `utils/format.ts`, `components/Game/NationDock.tsx`
  (µ1); `components/Game/SimulationEventReader.tsx`, `EventFeed.tsx`, `ChatsPanel.tsx`.
- **Metodo**: lettura dei call path + prove riproducibili (incluse le suite E2E/a11y Q01).
- **Esito**: **ACCETTABILE**; U03 chiuso per le parti realizzabili, con i passi dati/manuali
  dipendenti dichiarati.

## Claim verificati

| Requisito U03 | Evidenza |
|---|---|
| Passo 1 — dossier a sezioni (§10.3), default «decisioni richieste», selezione provincia non rinomina la nazione, formattazione deterministica | `nationDock.ts` (`NATION_SECTIONS`, default `situazione`) + `nationDock.test.ts` (**7 casi**); `utils/format.ts` (raggruppamento `.` deterministico, non-ICU) + `format.test.ts` (**11 casi**); `NationDock.tsx` a 6 sezioni |
| Passo 1 — nazione mai rinominata dalla provincia | App usa `nationalReference?.polityName` (polity), non il nome della provincia; `nationDock.test.ts`/`nationDossier.test.ts` |
| Passo 4 — lettore checkpoint con data e ancora; archivio separato read-only | `SimulationEventReader.tsx`: `disclosedEvents` sigillati (dedup), ancora `revision`/`checkpointId`, azioni «Evento successivo»/«Intervieni», nota «archivio non modifica il checkpoint»; `EventFeed.tsx` separato (cronaca) |
| Passo 4 — cause/effetti e «Mostra sulla mappa» | `EventFeed.tsx`: «Perché è accaduto:» + «Mostra sulla mappa» (source-contract `causalEvents.test.ts`); `Mostra sulla mappa` seleziona la regione senza mutare il mondo |
| Passo 3 — nessuna sottoscrizione silenziosa nelle chat | `ChatsPanel.tsx`: «Prosegui dialogo» (`auto`) e «Invia» sono conversazione, non sottoscrizione; gli `outcome` sono **descrittivi** e non mutano contratti; il guard F04 (409 senza run attivo) è attivo su `Lascia che parlino` |
| Passo 2 — disponibile/impegnato/previsto, fasi progetto | `NationDock`: scorte minime («Disponibile … su minimo … mancano …»), processi con «Avviato … esito previsto …», sezioni Progetti/Risorse |
| Test UI04/UI12/UI14 via E2E | `modules.spec.mjs` (U03 Dossier a sezioni, mobile) — 17/17 E2E verdi |

## Residui dichiarati (non bloccanti)

- **Passo 2 completo** (disponibile/impegnato/previsto su *pool runtime* e ledger filtrato
  per causal refs) dipende dal contratto di pool materiali/ledger: stesso blocco di U02
  passo 3 (non inventare dati). Le sezioni oltre «Situazione» mostrano dati reali dove
  disponibili e «Da cosa dipende?» altrove.
- **Passo 3 card accordo strutturata**: le chat non sottoscrivono condizioni (nessun
  bottone bindante); una *card* dedicata è un miglioramento di presentazione, non un
  requisito di correttezza, e richiede un contratto di accordi strutturati.
- **Passo 5** (tastiera virtuale/landscape su dispositivi reali): manuale (vedi Q01 µ5).

## Esito

Nessun difetto bloccante. **U03 CHIUSO** per le parti realizzabili; residui motivati.
