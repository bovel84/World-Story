# WS-COUNCIL-SIGNALKEYS — Report

**Obiettivo:** quando il Consulente individua una questione che richiede una decisione politica, deve comparire una scheda `Porta al Consiglio`, collegata in modo canonico alle realtà esistenti (`signalKeys`), anche quando la RealitySignal non ha `factKeys`.

**Branch:** `feat/ws-council-signalkeys` · **PR:** nuova, verso `main`, **NON mergiata**.

---

## 1. Problemi trovati (causa reale)

Verifica sul codice reale (Fase 1, non assunta):

1. **`signalKeys` non esisteva.** `backend-nest/src/core/government/CouncilIssue.ts` accettava solo `factKeys`/`verifiedFacts` e `councilIssueInputSchema` aveva `.refine(value => Boolean(value.factKeys?.length || value.verifiedFacts?.length))`. Il modello doveva copiare a mano chiavi di `VerifiedWorldSnapshot.facts`, che non può ricavare in modo affidabile → schede assenti o scartate.
2. **Signal valide senza `factKeys` sparivano.** In `RealitySignals.buildRealitySignals` alcune signal canoniche nascono con `factKeys: []` e `sourceRefs != []` (es. `hostile-relations`, `late-projects`, `recent-decisions`, `inaction`). Non essendoci modo di risolverle, la scheda non poteva esistere.
3. **Scarto silenzioso.** `parseCouncilIssues` scartava le issue invalide con `catch { /* ... */ }` senza registrare il motivo.
4. **Segnali limitati a 5.** `RealityAdvisor.ts` passava `buildRealitySignals(snapshot).slice(0, 5)` al modello, sotto il cap tecnico delle issue.
5. **Prompt "facoltativo".** `COUNCIL_ISSUE_PROTOCOL` usava `factKeys` nell'esempio e la riga `FORMA LIBERA` diceva «Le questioni al Consiglio sono facoltative, non obbligatorie»: il Consulente poteva proporre una decisione senza emettere la scheda.
6. **`CouncilIssueInline` rendeva sempre `<ul>`.** Anche con `verifiedFacts: []` restava una lista vuota.

Classificazione: **A** (estensione minima di input/validazione), **C** (prompt/testo), **D** (frontend). Nessuna **E**, nessuna migrazione.

## 2. Correzioni applicate

- **`signalKeys` come collegamento canonico (§1).** `councilIssueInputSchema` accetta `signalKeys` (retrocompatibile con `factKeys`/`verifiedFacts`). `resolveSignalLinks()` risolve le chiavi contro `buildRealitySignals(snapshot)` reali e prende dalla RealitySignal `factKeys` e `sourceRefs`; chiave inesistente → `Unknown reality signal key`.
- **Signal senza `factKeys` valide (§2).** Una signal con soli `sourceRefs` produce una issue valida con `verifiedFacts: []` e `sourceRefs` canonici. I `sourceRefs` forniti dal modello vengono ignorati (lo schema non li accetta e i riferimenti sono costruiti solo lato server). Fail-closed: senza fatto né riferimento canonico la issue è respinta.
- **Cap a 8 segnali (§4).** `RealityAdvisor` usa `.slice(0, MAX_COUNCIL_ISSUES)` (8), non più 5.
- **Schede non facoltative quando propone (§3).** Il prompt impone: zero schede solo se non c'è nulla da decidere; se identifica una decisione concreta, **DEVE** emettere la relativa `council_issue`; una per questione; più di tre ammesse; nessuna quota.
- **Frontend (§5).** `CouncilIssueInline` renderizza `<ul>` solo se `verifiedFacts.length > 0`; titolo, domanda e `Porta al Consiglio` restano.
- **Motivo dello scarto non silenzioso.** `parseCouncilIssues` logga `[CouncilIssue] proposta scartata: <motivo>` (o lo passa a `onDiscard`).

## 3. File modificati

- `backend-nest/src/core/government/CouncilIssue.ts`
- `backend-nest/src/core/government/RealityAdvisor.ts`
- `backend-nest/tests/council-signalkeys.test.ts` (nuovo)
- `frontend/src/components/Game/CouncilIssueInline.tsx`
- `frontend/src/components/Game/CouncilIssueInline.test.tsx`

File di consegna: `docs/implementation/WS-COUNCIL-SIGNALKEYS-report.md`.

## 4. Conferma CORE ENGINE FREEZE

**Confermato: nessuna modifica al core engine.** Non toccati `core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema/database, repositories, checkpoint/run/`useSimulationPlayback`, pipeline del tempo. Non toccati salience thresholds, motore economico/militare, Dossier, preflight, CouncilRoom, worldPulse/JEV. Nessuna nuova chiamata LLM: si estende l'input dello stesso giudizio.

## 5. Test eseguiti (esito reale)

Backend (`npx vitest run`):

- `tests/council-signalkeys.test.ts` (nuovo), `tests/council-issue-variety.test.ts`, `tests/advisor-strategist-voice.test.ts`, `tests/reality-advisor.test.ts`, `tests/polity-historical-baselines.test.ts` → **5 file / 69 test passed**.

Frontend (`npx vitest run`):

- `src/components/Game/CouncilIssueInline.test.tsx`, `src/components/Game/councilIssueFlow.test.tsx` → **2 file / 21 test passed**.

Type-check:

- backend `npx tsc --noEmit` → **OK**; frontend `npx tsc --noEmit -p tsconfig.json` → **OK**.

Test mirati richiesti (tutti coperti):

- signal con `factKeys` → issue valida (fatti e `sourceRef` canonici);
- signal con zero `factKeys` + `sourceRefs` → issue valida con `verifiedFacts: []`;
- `signalKey` inesistente → issue scartata, con motivo registrato;
- `sourceRefs` inventati dal modello → ignorati;
- 5 signal + 5 issue → 5 schede; più di 3 supportate;
- prompt: una proposta decisionale **DEVE** produrre `council_issue`; assente la vecchia formulazione «facoltative»; cap a 8 signal;
- zero problemi/proposte → zero issue;
- `CouncilIssueInline` con `verifiedFacts` vuoto → titolo, domanda, `Porta al Consiglio`, nessuna `<ul>`.

## 6. Risultati

- Una `council_issue` con `signalKeys` validi produce una scheda anche senza `factKeys`.
- Le signal canoniche senza `factKeys` (relazioni ostili, progetti, decisioni/inazioni) smettono di sparire.
- Il modello non fornisce mai fatti o `sourceRefs`: risolve il server.
- Il prompt impone la scheda quando propone una decisione, mantenendo zero schede come esito valido.
- Al modello passano al massimo 8 signal.
- Frontend robusto a `verifiedFacts: []`.
- Nessun nuovo motore, core engine congelato, test mirati verdi.

## 7. Limiti residui

- La risoluzione richiede che la `signalKey` sia una chiave reale di `buildRealitySignals(snapshot)`: se una signal è fuori dal cap a 8 non compare nel prompt, ma il server la risolverebbe comunque se citata correttamente.
- Il cap a 8 resta un limite tecnico (anti-abuso) e non una quota semantica.
- La qualità reale delle risposte del modello non è misurabile senza valutazione provider autorizzata (nessuna chiamata LLM in questo task).
- `OpeningNarrative`/`RealitySignals` continuano a usare i propri limiti a 3 per il briefing deterministico: fuori perimetro.

## 8. Proposte per la fase successiva

- Valutazione con provider reale (quando autorizzata) per misurare: schede prodotte quando il testo propone una decisione, duplicati, `signalKeys` inesistenti.
- Eventuale log/metrica strutturata dei motivi di scarto (`onDiscard`) per diagnosi in produzione.
- Allineare, se utile, il briefing deterministico (`OpeningNarrative`/`nationalQuestions`) al nuovo collegamento canonico.

---

**Stato: NON MERGIATO.** PR nuova verso `main`, in attesa di `test-build`.
