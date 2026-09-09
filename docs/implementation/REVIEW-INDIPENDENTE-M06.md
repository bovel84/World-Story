# Revisione indipendente — M06 / integrazione verticale

**Revisore:** agente `reviewer` separato dall’implementatore.  
**Esito:** **NON ACCETTABILE**.  
**Metodo:** ispezione read-only dei call path e test mirati esistenti; nessuna modifica del revisore. La suite verde non è stata usata come unico criterio.

## Blocker

1. **Bypass del verticale economico** — `backend-nest/src/game-session.ts:564-567, 2190, 2484, 3550`.
   Le partite strict fanno ancora avanzare PIL, popolazione e potenza militare con `WorldStateEngine.advance` legacy e persistono direttamente le regioni. Non c’è collegamento a ledger/riserve/progetti/produzione M02–M05 né applicazione degli `effects` strict verificati. Il validatore impedisce la mutazione LLM diretta, ma non implementa il commit deterministico promesso da M06.
2. **I/O di rete dentro transazione canonica** — `backend-nest/src/game-session.ts:2468, 3529`; `backend-nest/src/sse.ts:51-66`.
   `broadcast('chat_message')` è eseguito dentro `withCanonicalTransaction`; con SSE collegato raggiunge `Response.write()`. Può pubblicare un messaggio poi rollbackato e viola F02/M06.

## Major

- `docs/implementation/M06-report.md`: stato non coerente. Il report descrive integrazione M06, ma `TurnOrchestrator` deterministico resta dichiarato come µ5; M01/M05 indicano che il collegamento gameplay è responsabilità M06.

## Minor

- `backend-nest/tests/m06-strict-integration.test.ts:184-267`: i rifiuti E2E non verificano esplicitamente l’assenza di nuove righe `simulation_outbox`.
- Manca un E2E per un effect strict materiale valido applicato esclusivamente dal motore canonico.

## Aspetti verificati positivi

- Strict mode derivata dal catalogo server-side e persistita (`session-registry.ts:42-60`), non scelta dal client.
- `worldChanges`, `mapChanges`, comandi legacy e completion malformati vengono rifiutati prima del commit nel percorso strict esaminato.
- Negli errori coperti dai test, rollback e `simulation_runs.status='failed'` funzionano.

## Condizioni per nuova revisione

1. Implementare M06 µ5: orchestratore deterministico che collega i verticali M02–M05 ed elimina la mutazione economica legacy in strict.
2. Spostare ogni broadcast/SSE post-commit tramite outbox o buffer post-transazione.
3. Aggiungere prove no-outbox su failure e effect strict materiale valido, con causalità e commit canonico.
4. Correggere il report M06 e rieseguire revisione con revisore distinto.

## Remediation successiva (implementatore; richiede nuova verifica indipendente)

- SSE chat bufferizzato post-commit; regressione rollback senza `chat_message` aggiunta.
- Strict non usa più `WorldStateEngine.advance`; il tick esegue soltanto cashflow datati canonici via FinanceService/ledger.
- Effect materiale senza adapter canonico è fail-closed (`UNAPPLIED_STRICT_EFFECT`), non ignorato.
- I failure strict E2E attestano `simulation_outbox = 0`.

Queste correzioni rimuovono i blocker osservati, ma **non equivalgono a un nuovo verdetto**: rimane richiesta una revisione indipendente dopo gli adapter materiali M02–M05.
