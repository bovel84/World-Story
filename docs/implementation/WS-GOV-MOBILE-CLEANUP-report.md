# WS-GOV-MOBILE-CLEANUP — Chiusura UX mobile del Governo

**Base commit:** `d11ce8d` (`main`, dopo il merge di PR #171 / WS-GOV-MOBILE-FOCUS)
**Head commit:** `46be8d3` (codice + test); questo report è il commit successivo sul branch `feat/ws-gov-mobile-cleanup`.
**Nessuna modifica al CORE ENGINE:** `backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`, `schema`, repository, `FeasibilityService`, `WorkCommit` sono intatti. In questo task non è stato toccato nemmeno il backend.

La regola UX resta:

> **Dialogo = discussione. Tavola = stato corrente della decisione. Atto = formalizzazione.**

> **Su mobile il Dialogo contiene le parole. La Tavola contiene soltanto la decisione che risulta dalle parole.**

---

## 1. File modificati

| File | Cosa cambia |
|---|---|
| `frontend/src/hooks/useIsMobile.ts` | Query compatta (`max-width:767px` **oppure** `max-width:950px and max-height:500px`), `useGovernmentCompactLayout`, predicato puro `isGovernmentCompactSize`. |
| `frontend/src/components/Game/councilMeeting.ts` | Interfaccia `MeetingPrompt` (`text`, `sourceMessageId`, `objective?`). |
| `frontend/src/components/Game/mobileFocus.ts` | `MobileMinisterSection` + `ministerSectionsFromMeeting` (risultato per ministero dal piano condiviso), `sourceLabel`/`uniqueSourceLabels` (fonti uniche e leggibili), titolo = `objective`, ramo «nuova convocazione». |
| `frontend/src/components/Game/MinisterChat.tsx` | Badge «↓ Nuovo messaggio» (M12): cresce solo per una risposta reale mentre non si è in fondo; azzera a invio, a fondo, a cambio sedia/seduta. |
| `frontend/src/components/Game/GovernmentOffice.tsx` | `meetingPrompt` con `sourceMessageId` stabile; `conveneMeeting(prompt)`; `runMeeting` usa `continueMeeting`; rimosso il transcript dalla Tavola e `SeatTable` dagli approfondimenti; approfondimenti nativi (Evidenze/Fonti/Cronologia); vista compatta via hook. |
| `frontend/src/components/Game/SeatTable.tsx` | Solo il **tipo** di `meetingPrompt`/`onConveneMeeting` passa a `MeetingPrompt` (il desktop resta identico). |
| `frontend/src/editorial.css` | Media query compatta (orizzontale incluso); Dialogo a **un solo scroll owner** (thread) col composer fisso; stili per sezioni ministero, approfondimenti nativi, badge. |
| `frontend/src/components/Game/wsGovMobileFocus.test.ts` | Test M1/M2/M3/M4/M8/M15. |
| `frontend/src/components/Game/governmentOfficeMobile.test.tsx` | Guardie CSS: query compatta, un solo scroll nel Dialogo, badge, sezioni ministero. |
| `e2e/tests/ws-gov-mobile-focus.spec.mjs` | Riscritto: 4 viewport compatti + 2 desktop, scroll/composer, badge, risultato per ministero, due convocazioni stesso turno. |
| `e2e/tests/govux-p7-consequence.spec.mjs` | Adattato: la plancia si raggiunge dalla CTA mobile, non dalla Tavola desktop reinnestata. |
| `e2e/wsgovmobilecleanup-shot.mjs`, `e2e/wsgovmobilecleanup-review.mjs` | Nuovi: screenshot reali (M29) e revisione oggettiva A–H. |

---

## 2. M1–M3 — Identità reale delle riunioni

**Come si costruisce `sourceMessageId`** (`GovernmentOffice.tsx`):

```ts
const sourceMessageId = `${sessionId}:${openSeat}:user-${index}`;
```

dove `index` è la posizione dell'**ultimo messaggio del Presidente** in `chatMessages` (la cronologia della seduta corrente) e `sessionId = game|branch|turn`. Non è il testo: due messaggi identici in posizioni diverse hanno id diversi.

`openMeeting` riceve `subject` (il testo mostrato) **e** `sourceMessageId`; l'identità risultante è `id = sessionId#meetingId`, con `meetingId = msg-<sourceMessageId>`.

**Invariante verificata** (`wsGovMobileFocus.test.ts`):

- `msg user-4` e `msg user-18` con lo stesso testo → `sessionId` uguale, `meetingId` e `id` **diversi**, `subject` e `participants` **uguali**;
- lo **stesso** `sourceMessageId` → stessa identità (idempotenza).

**`openMeeting` vs `continueMeeting`:**

- `conveneMeeting(prompt)` apre una convocazione. Se `existing.meetingId === opened.meetingId` (stesso messaggio) → `runMeeting` applica una **nuova lettura** con `continueMeeting` (stessa identità, nuova revisione); se `meetingId` differisce → sempre una **nuova** convocazione, anche con soggetto e partecipanti identici (M2/M27).
- L'identità non dipende mai da soggetto o partecipanti.

**E2E M27** (`390px: due convocazioni…`): due convocazioni con lo stesso testo nello stesso turno producono `data-meeting-key` diversi (`meetingId A ≠ meetingId B`). **Verde**.

---

## 3. M4–M5 — Telefono in orizzontale = compatto

```ts
export const GOVERNMENT_COMPACT_QUERY =
  '(max-width: 767px), (max-width: 950px) and (max-height: 500px)';
```

Il predicato puro `isGovernmentCompactSize(width, height)` restituisce compatto per `844×390`, `390×844`, `412×915`; desktop per `1024×768` e `1366×768`. La **stessa** query è usata dalle media query CSS: JS e CSS non divergono. L'hook si chiama `useGovernmentCompactLayout` (l'alias storico `useIsMobile` resta). Il breakpoint **non** è propagato a tutta World Story: vive nel layout del Governo.

**E2E:** `844×390` → `.gov-mobile` presente, `.government-office-divider` **assente**; `1024×768` e `1366×768` → divisore **presente**. **Verdi.**

---

## 4. M6–M8 — Approfondimenti nativi, fonti uniche

- `SeatTable` (e `DecisionBoard`/`CouncilMeetingBoard`) **non sono più resi** dentro `.gov-mobile`: **SeatTable rimosso dal mobile: sì.**
- Gli approfondimenti mobile sono costruiti dallo stesso stato, leggeri: **Evidenze** (elenco dei blocchi della tela, apribili in vista Evidenza), **Fonti** (`uniqueSourceLabels`, deduplicate e tradotte: `check-feasibility` → «Motore di fattibilità»), **Cronologia** (una riga per revisione, `v1/v2/v3`).
- Le fonti non si ripetono per riga: l'`id` tecnico resta nel DOM solo come attributo `data-sources`, mai come testo dominante.

---

## 5. M9–M13 — Chat: un solo scroll, composer fisso, «↓ Nuovo messaggio»

- Nel Dialogo compatto il pannello ha `overflow: hidden` e layout flex; l'**unico scroll owner è `.minister-thread`**; `.minister-compose` è `flex: 0 0 auto` e resta ancorato in fondo (con `env(safe-area-inset-bottom)`). Nessun footer sotto il composer su mobile.
- Il badge `hasUnreadReply` compare quando una **risposta assistant** cresce o ne arriva una nuova mentre `stickToBottomRef === false` (rilevazione su **conteggio + lunghezza**, mai a ogni token); si azzera a invio, a ritorno in fondo, a cambio sedia/seduta; il tocco riporta in fondo.
- **E2E:** con 10 messaggi il thread scorre davvero; il composer resta visibile (fine ≤ 844); i contenitori con scroll reale nel pannello Dialogo sono **≤ 1**; con una risposta narrativa in arrivo mentre si legge in cima, `.minister-unread` compare e il tocco lo spegne. **Verdi.**

---

## 6. M14–M19 — La Tavola è il risultato, non una seconda chat

- **Transcript rimosso dalla Tavola: sì.** La `.gov-mobile-talks` non è più resa e i suoi stili sono stati tolti.
- `ministerSectionsFromMeeting(meeting)` raggruppa `meeting.workspace.lines` per sedia (capofila per primo), non i `contributions[].text`.
- Ordine visivo: **titolo → località → stato → DA RISOLVERE (se c'è) → sezioni ministero → CTA primaria → Approfondimenti**.
- **Titolo (M17):** `meeting.objective` (dal `DecisionWorkspace`), non la frase del Presidente. La localizzazione è una riga separata (`meeting.workspace.region`).
- **M18:** non si inventa un nome d'opera: `workLabel` resta il soggetto dichiarato (nessuna etichetta di catalogo inesistente); il titolo UI è l'`objective`; `workId` resta l'identità tecnica.

---

## 7. M20–M22 — Azioni secondarie, Atto, Evidenza

- `+ Ministro` resta un'azione **secondaria** nel bottom sheet; la CTA primaria è una sola.
- La vista Atto resta separata (`mobileView='act'`) con `Modifica/Salva/Firma`, staleness, idempotenza e `ConsequenceBoard`.
- La vista Evidenza resta separata (`mobileView='evidence'`) con «Torna alla decisione».

---

## 8. Test eseguiti

| Suite | Esito |
|---|---|
| Frontend `vitest run` | **144 file / 1244 test pass** |
| Frontend `tsc --noEmit` | **pulito** |
| Frontend `npm run build` | **ok** |
| Backend `vitest run` | **2351 test pass** (i 6 file `dist/**` falliti sono artefatti di build locali, non tracciati: su CI non esistono) |
| E2E nuovo `ws-gov-mobile-focus.spec.mjs` (11 test) | **11/11** |
| E2E P7, P4, P1, council-meetings, dialogue-to-act, seat-boards, turn-sessions (10 test) | **10/10** |
| E2E modules + hud-mobile (21 test) | **21/21** |

Viewport E2E: **360×800, 390×844, 412×915, 844×390** (compatti) e **1024×768, 1366×768** (desktop).

---

## 9. Screenshot reali (M29)

Prodotti con `e2e/wsgovmobilecleanup-shot.mjs` in
`docs/implementation/screenshots/ws-gov-mobile-cleanup/`:

`390x844-dialogue-long`, `390x844-unread`, `390x844-board-blocked`, `390x844-council-ready`, `390x844-act`, `844x390-dialogue`, `844x390-board`, `1366x768-desktop`.

`390x844-dialogue-long` contiene una conversazione abbastanza lunga da far scorrere il thread, con il composer ancora visibile; `390x844-unread` ritrae il badge «↓ Nuovo messaggio» attivo.

**Limite dichiarato onestamente:** il modello di questa sessione **non supporta l'input immagine**, quindi **non** è stata fatta una review visiva umana delle PNG. Al suo posto c'è una **revisione oggettiva A–H** misurata sul DOM reale (`e2e/wsgovmobilecleanup-review.mjs`), riportata sotto. Le PNG restano il reperto per l'occhio umano.

---

## 10. Revisione A–H (misure reali, 390×844 e 844×390)

```
=== 390×844 — blocco di localizzazione ===
A. Dove sono       : header «Ministro dei Lavori»
B. Con chi parlo   : cronaca nel thread = altezza del thread (nessun overflow inutile)
C. Cosa decidiamo  : «Costruire una fabbrica siderurgica» — stato «Da completare»
D. Cosa manca      : ⚠ Dove deve sorgere l’opera?
E. Azione primaria : «Continua il dialogo» (CTA visibili: 1) — y=376, fine=424 (< 844)
F. Duplicazioni    : transcript nella Tavola=0, SeatTable nel mobile=0, sezioni ministero=0
G. Scroll          : composer fine=831 (< 844), scroll reali nel Dialogo=0
H. Layout          : .gov-mobile=1, divisore desktop=0

=== 390×844 — riunione convocata ===
C. Cosa decidiamo  : «Costruire una fabbrica siderurgica» — stato «Pronta per l’atto»
D. Cosa manca      : nessun blocco
E. Azione primaria : «Prepara l’atto» (CTA visibili: 1) — y=618, fine=666 (< 844)
F. Duplicazioni    : transcript=0, SeatTable=0, sezioni ministero=2 (LAVORI, TESORO)

=== 844×390 — telefono in orizzontale ===
A. Dove sono       : header «Ministro dei Lavori»
D. Cosa manca      : ⚠ Dove deve sorgere l’opera?
E. Azione primaria : «Continua il dialogo» (CTA visibili: 1) — y=349, fine=397 (< 390)
F. Duplicazioni    : transcript=0, SeatTable=0
G. Scroll          : composer fine=377 (< 390), scroll reali nel Dialogo=1
H. Layout          : .gov-mobile=1, divisore desktop=0
```

Risposte sintetiche:

- **Si capisce cosa fare senza leggere tutta la pagina? SÌ.** In ogni misura la CTA primaria è **una sola**, visibile senza scorrere; il blocco, quando c'è, è in cima.
- **Informazioni duplicate? NO.** Transcript e Tavola desktop non sono più presenti nel mobile.
- **Scroll inutile? NO.** Un solo scroll owner nel Dialogo; composer sempre in vista.
- **Card dentro card? NO.** Il divisore desktop è assente in compatto; nessun pannello desktop reinnestato.

---

## 11. Bug gate (PARTE J) — tutti chiusi

| Gate | Esito | Prova |
|---|---|---|
| Due riunioni stesso turno → id diversi | **chiuso** | `wsGovMobileFocus.test.ts` + E2E M27 (`data-meeting-key` ≠) |
| Opera fisica senza localizzazione → blocco | **chiuso** | E2E 390 `Dove deve sorgere l’opera?` |
| Renderer narrativo sporca la memoria | **chiuso** | rotta read-only già corretta (nessuna modifica di memoria/JEV) |
| Header mobile troppo grande | **chiuso** | E2E: altezza ≤ 64px su 4 viewport |
| Composer dietro la tastiera / fuori schermo | **chiuso** | E2E: composer visibile e fine ≤ viewport |
| Tavola con più di una CTA primaria | **chiuso** | E2E: `toHaveCount(1)` |
| Fonte ripetuta per riga | **chiuso** | `uniqueSourceLabels` + review (Fonti uniche) |
| Altri ministri occupano spazio | **chiuso** | chip + `+ Ministro` nel bottom sheet |
| Atto sotto tutta la Tavola | **chiuso** | `mobileView='act'` distinta |
| Scroll orizzontale a 360px | **chiuso** | E2E `scrollWidth ≤ clientWidth + 1` |
| Scroll verticale annidato | **chiuso** | E2E: ≤ 1 scroll reale nel pannello Dialogo |
| Dialogo↔Tavola perde la posizione | **chiuso** | viste montate + `hidden`; E2E rientro senza ricarica |
| SeatTable desktop dentro il mobile | **chiuso** | E2E: `.gov-mobile .seat-table` = 0 |
| Transcript duplicato nella Tavola | **chiuso** | E2E: `.gov-mobile-talk` = 0 |

---

## 12. Limitazioni residue reali

1. **Review visiva non umana.** L'immagine non è leggibile dal modello di questa sessione; la validazione è oggettiva (DOM/misure) + PNG come reperto, non un giudizio estetico sull'immagine.
2. **Test del badge in E2E, non in unit.** Il progetto non ha un DOM nei test (environment `node`); il comportamento di scroll/badge è coperto dagli E2E Playwright (informativi), non da un test unit con `scrollTop`.
3. **Backend non toccato.** La voce narrativa read-only era già corretta (WS-GOV-MOBILE-FOCUS): qui è stata solo consumata dal client, senza regressioni.
4. **Nessuna nuova funzionalità di gioco.** Il task era una pulizia UX: nessun motore, nessuna cifra, nessuno stato di dominio nuovo.
