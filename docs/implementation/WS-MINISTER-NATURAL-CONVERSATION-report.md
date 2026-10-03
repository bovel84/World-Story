# WS-MINISTER-NATURAL-CONVERSATION

Baseline: `main=27a7c0f`, PR #182. Branch: `feat/ws-minister-natural-conversation`.

## Implementazione

- `backend-nest/src/core/government/MinisterDialogue.ts`: `MinisterDialogueBrief` è una proiezione per il renderer, non persistenza. Contiene la persona esistente, mondo, memoria, questioni, decisione corrente, domanda e storia recente.
- `MinisterChat.ts`: dossier JSON preservato integralmente, incluse cifre/provenance, paths e dichiarazioni d’opera; separazione IDENTITY / VERIFIED FACTS / MEMORY / DIALOGUE STYLE / PROTOCOL. WORLD resta del builder/JEV.
- `MinisterDialogueRules.ts`: regole dati separate da stile e protocolli. Stile/protocollo vengono collocati una volta dopo il contesto corrente; non sono parte del contenuto verificato. «Quanto?» durante una ripartizione chiede una quota, non una nuova lettura del saldo. Percentuali proposte non vengono autorizzate come nuovi importi misurati.
- `prompt-builder.ts`: un’unica generazione advisor per risposta ministeriale; guardrail stilistico ristretto e fallback deterministico, senza seconda riscrittura LLM. Il Consigliere ordinario e la riunione read-only mantengono il loro percorso. Gli override del preset rimangono, subordinati allo stile ministeriale.
- `advisor.routes.ts`: bridge HTTP request-local con `AsyncLocalStorage`, limitato a partita/sedia. Il DTO del workspace è normalizzato e marcato come discussione, mai come verità del motore. Un marker scritto nell’input del Consigliere non attiva il renderer ministeriale; il decoder controlla soltanto la forma del contratto interno.
- `frontend/.../ministerDialogueContext.ts`: snapshot distaccato della proposta attiva, senza mutare DecisionWorkspace o promuovere raccomandazioni. Entrambe le chat desktop/mobile lo trasmettono, incluso il fallback POST su route stream non implementata.

Nessuna modifica a GameSession, core/simulation, agenda, CabinetItem, Figures, Paths, MinisterMemory, MinisterWorldContext, JEV, DecisionWorkspace, database/schema, firma/queue/WorkCommit o dichiarazioni d’opera.

## Prima / dopo: tre turni

Il **prima è illustrativo**, non una registrazione della produzione:

1. «Confrontiamo le coperture.» → «Fatti: debito… Lettura: prudenza… Proposta: le alternative…»
2. «E il resto?» → rilettura del dossier e chiusura generica.
3. «Fammi vedere.» → altro rapporto invece della tavola.

Il **dopo seguente è la fixture effettivamente verificata nel browser**, non una previsione del provider:

1. «Confrontiamo le coperture.» → «Valutiamo insieme le coperture. Io partirei da metà per il debito e metà per gli investimenti.» + `decision`, source minister/status proposed.
2. «E il resto?» → «Il resto è la quota per gli investimenti che abbiamo appena discusso.» La richiesta contiene la stessa proposta e una sola copia del saluto.
3. «Fammi vedere.» → «Certo. Ti metto a confronto le due strade.» + `tavola {op: compare}`.

Il browser prosegue con «Va bene»: due misure 50/50 diventano source president/status accepted; nessun fence tecnico è mostrato come prosa.

## Continuità, persona, mondo

La storia conserva gli scambi e rimuove soltanto direttive tecniche dal prompt; la proiezione corrente porta valori, stato, source, vincoli e questioni aperte. La regola «NON RIPETERE ciò che hai appena detto» è esplicita. I follow-up sono continuazioni; obiezioni e cambio d’idea hanno istruzioni dedicate. Le preferenze restano quelle di MinisterPersona, senza un secondo profilo.

Il saluto è iniettato nella history solo se non è già un identico messaggio assistant. Testano anche la cache UI, il cambio sedia/seduta e l’annullamento. La cache vive nel GovernmentOffice montato: non promette conservazione dopo un completo unmount/reload, né scrive una nuova memoria.

Con JEV ON vengono conservati mondo immutabile, recall selettivo, conversazione recente e stato verificato. Il renderer non aggiunge un altro WORLD. Il percorso reale normal/stream verifica una sola occorrenza della premessa con JEV ON e OFF.

La signature non è un prefisso obbligatorio: tre risposte simulate che la ripetono vengono rifiutate; il saluto precedente è preso in considerazione. Le chiusure fallback chiedono, per esempio, «Quale investimento vuoi confrontare per primo?», non «Tocca a te».

I limiti superiori sono 140 parole per il testo ordinario e 80 per follow-up semplici/tavola; un approfondimento esplicito può superarli. Non si aggiungono parole artificialmente per raggiungere i minimi orientativi 60/30.

## Redirect

`ColleagueRedirectContext` vive in `MinisterChat.ts`: targetSeat/Label/Reads e currentSeat/Angle guidano il renderer. Il fallback Tesoro è:

> La scelta la valuterei con il ministro dei Lavori. Io guarderei se finanziariamente possiamo permettercelo e quanto margine lascia ai conti.

La spesa sanitaria interrogata dagli Esteri porta alla Sanità, non al Tesoro solo perché contiene «spesa».

## Decisione e una sola generazione

Una raccomandazione mantiene source minister/status proposed; un’ipotesi del Presidente mantiene source president/status proposed. La conferma aggiorna esplicitamente source president/status accepted: non basta `accept-proposal`.

Il parser congelato riceve un oggetto JSON per fence; un cambio direzione usa più fence separati. Il fallback di conferma aggiorna soltanto il draft già trasmesso, esclude misure engine/rejected/unresolved e divide più di dodici changes in blocchi compatibili. Test con tredici misure e reducer reale: nessuna resta raccomandazione ministeriale per troncamento.

Lo stream ministeriale ora trattiene la generazione fino al controllo stilistico: risposta e direttive vengono pubblicate insieme, non token per token. Questa è una scelta di latenza/UX, non una seconda chiamata. L’annullamento impedisce la pubblicazione di risposte tardive.

Il client ritenta POST soltanto su HTTP 404/405/501, che indicano route stream assente/non implementata. Rete, reader interrotto prima dei byte, 500/502/503 o body mancante non provocano una seconda generazione automatica ambigua.

## Verifiche eseguite

Prima di ogni conteggio, i test girano con `backend-nest/dist` rimosso: la suite completa non deve raccogliere artefatti compilati.

Dopo il primo run CI, due regressioni sono state corrette e verificate:
- il protocollo `PRESENTAZIONE` conserva il formato `regionIds`/`gli id`, i divieti (`niente HTML`, `niente geometrie`) e l’assenza di cifre proprie, come richiesto da `ws-minister-ux-03`/`ux-04`;
- il percorso stream ministeriale torna a invocare il callback di avanzamento, così il consumo SSE resta osservabile e il test HTTP di annullamento `ws-govux-p2-cancellation` passa senza reintrodurre una seconda generazione (`govuxTransport.test.ts` aggiornato: l’errore di rete non fa più fallback POST).

```sh
npm --prefix backend-nest run build
npm --prefix backend-nest test -- tests/ws-minister-natural-conversation.test.ts tests/ws-minister-natural-dialogue.test.ts tests/p02b-minister-chat.test.ts tests/ws-minister-ux-02.test.ts tests/ws-minister-ux-03.test.ts tests/ws-gov-dialogue-to-act.test.ts tests/ws-gov-minister-world-context.test.ts tests/ws-jev-w3-minister.test.ts tests/ws-jev-w4-context.test.ts
# 9 file, 93 test verdi; build backend verde.
npm --prefix backend-nest test -- tests/endpoint-inventory.test.ts
# 4 test verdi; nessun nuovo endpoint/snapshot da rigenerare.

cd frontend
../node_modules/.bin/vitest run src/components/Game/MinisterChat.dialogue.test.ts src/components/Game/ministerDialogueContext.test.ts src/services/ministerConversationTransport.test.ts src/components/Game/ministerChatInlineEvidence.test.tsx src/components/Game/decisionWorkspace.test.ts
# 5 file, 45 test verdi.
../node_modules/.bin/tsc --noEmit
# verde.
npm run build
# verde; warning preesistente su bundle grandi.

cd ../e2e
node_modules/.bin/playwright test tests/ws-minister-natural-dialogue.spec.mjs
# 1 test Chromium verde: cinque scambi, provenance e cancellazione/cambio sedia.

git diff --check
# verde.

# Suite complete, come nel gate CI test-build:
cd backend-nest && npm test
# 225 file, 2384 test verdi (dist rimosso prima).
cd ../frontend && ../node_modules/.bin/vitest run
# 149 file, 1287 test verdi.
cd .. && npm run build
# backend + frontend verdi.
```

I test real-route con provider stub coprono dieci turni per ciascun modo JEV, normal/stream alternati: ragionamento, follow-up, obiezione, ipotesi 50/50, conferma, cambio direzione, tavola, redirect. I messaggi passano nel parser/reducer DecisionWorkspace reale con riferimenti messageId verificati. Ulteriori casi mirati: guasto provider, stile rifiutato senza rigenerazione, cancellazione, isolamento concorrente ALS e dossier contraffatti sul Consigliere.

### Smoke con provider reale

Eseguito da `backend-nest` con `node_modules/.bin/tsx /tmp/ws-minister-live-smoke.cjs`, script temporaneo locale non aggiunto alla repository. Provider configurato: `glm-5.3-flash`. SQLite temporaneo e DTO sintetico distaccato, coerente su avanzo 7,60/debito 110; nessuna sessione/database operativo usata. Le prime prove esplorative avevano una fixture nazionale incoerente (debito zero nel WORLD): corretta prima della verifica finale.

Verifica finale: sei turni, **sei chiamate provider**, due risposte troppo lunghe sostituite dal fallback, nessuna rigenerazione. Sequenza: «Quanto?», «Perché?», «E il resto?», «Fammi vedere», «E se facessimo metà e metà?», «Va bene».

- «E il resto?» finale: «Per il resto mi riferisco alla quota per gli investimenti che abbiamo appena discusso. La ripartizione resta quella della proposta: va precisato l’impiego… Quale investimento vuoi confrontare per primo?»
- «Fammi vedere» ha prodotto tavola/focus/cifre e prosa breve.
- Ipotesi 50/50: due misure source president/status proposed; conferma: entrambe source president/status accepted, destinazione investimenti ancora aperta.
- Nessun heading di report o signature forzata. Il debito 110 non è ripetuto ad ogni risposta. Il modello può ancora richiamare una cifra pertinente; non si afferma che ogni possibile output LLM sia semanticamente perfetto.

Non è un nuovo fact checker: i controlli di questa modifica riguardano forma/stile e confini del contesto. Le fonti e le verifiche esistenti del motore rimangono autoritative. Il provider reale è stato provato JEV OFF; la parità JEV ON/OFF è verificata dai test real-route con stub, non da due conversazioni live complete.

## File toccati

Produzione: MinisterChat.ts, nuovi MinisterDialogue.ts/MinisterDialogueRules.ts; prompt-builder.ts; routes/games/advisor.routes.ts; frontend MinisterChat.tsx, GovernmentOffice.tsx, nuovo ministerDialogueContext.ts, services/api.ts.

Test: nuovo ws-minister-natural-conversation.test.ts; p02b-minister-chat, ws-minister-ux-02/03, ws-gov-dialogue-to-act, ws-gov-minister-world-context, ws-jev-w3-minister, ws-jev-w4-context; nuovi MinisterChat.dialogue, ministerDialogueContext e ministerConversationTransport; browser ws-minister-natural-dialogue.spec.mjs. Questo report.

## Gate di consegna

I risultati sopra sono quelli locali realmente eseguiti. Il merge è subordinato al check richiesto **test-build sul commit esatto della PR**, non a un bypass. Deploy standard completo backend + frontend/Worker solo dopo CI verde e merge. Gli esiti successivi sono consultabili nei check della PR e nel resoconto di consegna; non sono anticipati qui come già avvenuti.
