# WS-GOV-MOBILE-FOCUS + FINAL-HARDENING — Report

**Branch:** `feat/ws-gov-mobile-focus`
**Base:** `main = 48003bb` (merge di WS-GOV-COUNCIL-HARDENING)
**Data:** 2026-10-02
**Ambito:** PARTE A (A1–A7) + PARTE B/H (mobile come macchina a stati) + PARTE C (gate E2E).

> Regola del task rispettata: **nessun motore nuovo**, nessuna modifica al CORE
> ENGINE (`simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
> `SessionStateStore`, schema, repository, `useSimulationPlayback`). Il desktop
> **non** è stato rimpicciolito: è stata cambiata l'information architecture del
> mobile, non la larghezza CSS della stanza.

---

## 1. Che cosa è stato consegnato

### PARTE A — i 4 difetti architetturali

| # | Difetto | Soluzione | Prove |
|---|---------|-----------|-------|
| **A1/A2** | Due riunioni nello stesso turno condividevano l'id perché derivato dai **partecipanti** | Nuova identità in due parti — `sessionId = game\|branch\|turn` e `meetingId = sourceMessageId \| hash(stable subject) \| seq`; `id = sessionId#meetingId`. Aggiornare una riunione è un'azione dichiarata (`continueMeeting`), non un riapri. | `frontend/src/components/Game/councilMeeting.ts`, `wsGovMobileFocus.test.ts` (3 test A1) |
| **A3** | Una lettura del motore poteva applicarsi a una riunione con **materia diversa** | `MeetingEngineRead.subject` + guardia in `applyEngineRead`: la lettura estranea è ignorata (le letture legacy senza `subject` sono ancora accettate). | `councilMeeting.ts`, test A2/A3 |
| **A4/A5** | Un'**opera fisica** poteva essere «pronta» senza localizzazione; «qui» non si risolveva | Blocco `location` («Dove deve sorgere l'opera?») quando il motore ha risolto un'opera (distinta/materiali/tempi) e il luogo è `missing`. La rinvia «qui / nella regione attuale» si risolve **solo** con una regione canonica nota (capitale marcata o una sola regione posseduta), con la stessa semantica di `nationalContext.nationalReference`; altrimenti resta mancante (nessun tie-break arbitrario). | `councilMeeting.ts`, `meetingLocalization.ts`, `meetingEngineRead.ts`, test A4/A5 |
| **A6/A7** | La narrativa della riunione passava dal percorso ministro normale (side-effect su memoria/JEV, possibili direttive) | **Percorso read-only** dedicato `POST /:id/government/minister/:seat/render`: compone la voce dal **brief verificato**, **non** chiama `persistMinisterMemory`/`persistJevConversation`, ripulisce le direttive ```` ```decision/```tavola/```presentation ````. Riusa `personaFor()`/`personaSection()` di `backend-nest/src/core/government/MinisterPersona.ts` e l'instradamento provider esistente via `session.getMinisterReply`. | `backend-nest/src/core/government/MeetingNarrative.ts`, `advisor.routes.ts`, `schemas.ts` (`meetingRenderSchema`), `frontend/src/services/api.ts` (`ministerApi.render`), `narrateMeeting` in `GovernmentOffice.tsx`, test backend `ws-gov-mobile-focus.test.ts` |

**Path reali verificati (PARTE K):**
`MinisterPersona.ts` → `backend-nest/src/core/government/MinisterPersona.ts` (unica fonte della persona, **nessuna** copia nel frontend);
`MinisterChat.ts` backend → `backend-nest/src/core/government/MinisterChat.ts` (non toccato: il render usa `getMinisterReply` della sessione).

### PARTE B/H — il mobile è una macchina a stati

`type GovernmentMobileView = 'dialogue' | 'board' | 'act' | 'evidence'` (`frontend/src/components/Game/mobileFocus.ts`). È **stato di presentazione**, non dominio: le stesse `DecisionWorkspace`/`CouncilMeeting`/atto alimentano desktop e mobile. Nessuna duplicazione di `DecisionWorkspace`, `CouncilMeeting`, `Feasibility`, `ActDraft`, `MinisterMemory`.

- `MINISTRI → DIALOGO → TAVOLA → ATTO → FIRMA`; `←` = navigazione interna, `×` = chiude il modulo (`GovernmentOffice.tsx`).
- Le viste restano **montate** e si mostrano via `hidden`: cambiare Dialogo↔Tavola **non** rifà `check-feasibility`/LLM/canvas derivation e **non** perde scroll né bozza nel compositore (H3/H4, PARTE I performance).
- Tavola mobile ordinata secondo H9: titolo → stato leggibile → **DA RISOLVERE** → decisione → interventi → CTA → Approfondimenti (chiusi) → Cronologia.
- Foglio di fondo generico `GovernmentBottomSheet` (`frontend/src/components/ui/`) per «Convoca un ministro», che **delega** a `AccessibleDialog` (portal, focus trap, Escape, overlay, ripristino focus) — soddisfa il contratto `accessibleDialogContract.test.ts`.
- Vista Atto distinta (`mobileView='act'`) con editing `Modifica → Salva modifica` (H20) tramite il nuovo prop `mobile` di `ActDraftPanel` (desktop invariato).
- Vista Evidenza (`mobileView='evidence'`) con «Torna alla decisione» (H23/B36).
- Pallino Tavola (H6): scatta su revisione proposta/riunione, blocco o nuova evidenza (riusa `shouldShowEvidenceBadge`), e si spegne quando la Tavola è aperta.

---

## 2. File modificati / creati

**Creati**
- `backend-nest/src/core/government/MeetingNarrative.ts`
- `backend-nest/tests/ws-gov-mobile-focus.test.ts`
- `frontend/src/components/Game/mobileFocus.ts`
- `frontend/src/components/ui/GovernmentBottomSheet.tsx`
- `frontend/src/hooks/useIsMobile.ts`
- `frontend/src/components/Game/wsGovMobileFocus.test.ts`
- `e2e/tests/ws-gov-mobile-focus.spec.mjs`
- `e2e/wsgovmobile-shot.mjs`
- `docs/implementation/screenshots/ws-gov-mobile-focus/*.png` e questo report

**Modificati**
- `backend-nest/src/routes/games/advisor.routes.ts`, `.../schemas.ts`, `docs/implementation/q02-endpoint-inventory.json`
- `frontend/src/components/Game/{GovernmentOffice,councilMeeting,meetingEngineRead,meetingLocalization,ActDraftPanel}.tsx/ts`
- `frontend/src/services/api.ts`, `frontend/src/editorial.css`
- `e2e/tests/{govux-p4-inline,govux-p7-consequence,ws-gov-council-meetings}.spec.mjs` (adattati ai nuovi selettori mobile)

---

## 3. Test eseguiti

| Suite | Esito |
|-------|-------|
| Frontend `vitest run` | **144 file / 1234 test passati** |
| Frontend `tsc --noEmit` | pulito |
| Frontend `npm run build` | ok |
| Backend `vitest run` | **221 file / 2351 test passati** (inventario rotte rigenerato con `-u`) |
| E2E nuovo `ws-gov-mobile-focus.spec.mjs` | **7/7** (360×844, 390×844, 412×844, 844×390) |
| E2E regressione `govux-p4/p7`, `ws-gov-council-meetings`, `modules`, `hud-mobile`, `smoke` | **26/26** |

Gate E2E coperti: nessun overflow orizzontale (`scrollWidth ≤ clientWidth+1`) a 360/390/412 e in landscape 844×390; un solo scroll owner; una sola CTA primaria; header ≤ 64px; blocco «Dove deve sorgere l'opera?» sopra la piega; foglio «+ Ministro» che si chiude con Escape.

---

## 4. Screenshot reali (390×844) e **screenshot review**

Reperti in `docs/implementation/screenshots/ws-gov-mobile-focus/`
(script riproducibile: `node e2e/wsgovmobile-shot.mjs <cartella>`; mock offline, nessun LLM).

| File | Stato |
|------|-------|
| `01-ministers.png` | scelta dei ministri (lista compatta) |
| `02-dialogue.png` | dialogo della seduta |
| `03-board-unresolved.png` | Tavola con «DA RISOLVERE» |
| `04-council-ready.png` | riunione Lavori+Tesoro pronta |
| `05-evidence-map.png` | evidenza in primo piano |
| `06-act.png` | vista Atto |
| `07-signed.png` | atto firmato |

**Esito della review (A–H).** Le domande sono state verificate con un'audit
strutturale del DOM allo stato di ciascuno screenshot (il modello agente di
questa sessione **non supporta l'input immagine**, quindi la revisione visiva è
stata fatta con misure oggettive + le PNG come reperto, non «a occhio»):

| Domanda | Esito | Prova |
|---------|-------|-------|
| A. So dove sono? | **sì** | header 52–60px; titolo «Ministro dei Lavori»/«Atto»/«Evidenza»; `NUOVA SEDUTA · Turno N` + data |
| B. Con chi parlo? | **sì** | chip partecipanti (`Lavori · capofila`, `Tesoro`, `+N`); intestazioni sedia negli interventi |
| C. Cosa decidiamo? | **sì** | `boardTitle` in cima (es. «Costruire una fabbrica siderurgica») |
| D. Cosa manca? | **sì** | `03`: alert «⚠ Dove deve sorgere l'opera?» **sopra la piega** (boundingBox.y < 844) |
| E. Vedo l'azione principale? | **sì** | una sola `.gov-mobile-cta .gov-mobile-primary` (audit: count = 1) |
| F. Info duplicate? | **no** | fonti/cronologia nel solo `<details>` Approfondimenti; il dettaglio desktop è chiuso |
| G. Scroll inutile? | **no** | `overflowX = 0` a 360/390/412 e landscape; un solo scroll owner |
| H. Card dentro card? | **no** | `.gov-mobile .seat-table/.council-meeting/.decision-board` a sfondo piatto, un solo livello di contenitore |

**«Si capisce cosa fare senza leggere tutta la pagina? → sì»** per il flusso
verificato (blocco in cima → CTA unica «Continua il dialogo»/«Convoca la
riunione»/«Prepara l'atto»/«Vai all'atto e firma»).

---

## 5. Bug gate (PARTE J) — tutti chiusi

| Gate | Stato | Prova |
|------|-------|-------|
| due riunioni nello stesso turno condividono l'ID | **chiuso** | test A1 (`councilMeeting` id diversi) |
| opera fisica pronta senza localizzazione | **chiuso** | blocco `location` (test A4) |
| renderer narrativo sporca memoria/JEV | **chiuso** | rotta `render` senza `persist*`; backend test |
| header mobile troppo grande | **chiuso** | gate E2E header ≤ 64px |
| composer dietro keyboard | **chiuso** | composer sticky in `.gov-mobile-scroll`, raggiungibile (gate) |
| Tavola con più di un primary CTA | **chiuso** | gate E2E count = 1 |
| source ripetuta per riga | **chiuso** | fonti nel solo `<details>` |
| altri ministri occupano spazio | **chiuso** | chip + `+N`; convoca in bottom sheet |
| atto sotto tutta la Tavola | **chiuso** | vista `act` distinta |
| scroll orizzontale a 360px | **chiuso** | gate `scrollWidth ≤ clientWidth` |
| nested vertical scroll | **chiuso** | gate un solo scroll owner |
| Dialogo↔Tavola perde posizione | **chiuso** | viste montate + `hidden`; scroll conservato |

---

## 6. Definition of Done (390×844)

Percorso `GOVERNO → Lavori → «Voglio costruire una fabbrica siderurgica» →
blocco «Dove…?» in cima → «A Sarajevo» → «Convoca la riunione» → riunione
Lavori+Tesoro → Tavola (materiali/tempi/costo/copertura) → «Prepara l'atto» →
vista Atto → Firma → «✓ Atto firmato — inserito nel registro»` verificato
dall'audit e dagli E2E, senza overflow, doppio scroll, fonti duplicate o
vecchia decisione confusa con la corrente. Il turno N→N+1 produce una **nuova
seduta** (`NUOVA SEDUTA · Turno N`) e un nuovo workspace/riunione/atto: la
memoria consolidata del turno N resta separata (logica WS-GOV-COUNCIL-HARDENING,
già provata).

---

## 7. Limitazioni residue reali

1. **Revisione visiva umana**: prodotta e referenziata, ma il modello di questa
   sessione non elabora immagini; la review A–H è documentata con misure DOM,
   non con un giudizio estetico. Va rifatta a occhio da un umano sulle PNG.
2. **Titolo della Tavola di riunione**: usa il soggetto della convocazione
   (es. «Costruiamola a Sarajevo.») invece del nome-catalogo dell'opera
   («Fabbrica siderurgica — Sarajevo»): non inventa, ma non è ancora la sintesi
   di H15.
3. **H22 (Consequence Board)**: resta dentro `ActDraftPanel` con il suo default
   esistente; non è stata aggiunta una regola mobile dedicata «aperto se rischio
   critico», per non introdurre logica nuova non richiesta dal gate.
4. **Evidenza mobile**: usa `SeatCanvas` con `max-height: 52dvh` via CSS, non un
   layout mappa dedicato 45–55dvh con «regione selezionata + dati» (H23/I).
5. **Performance**: verificata per costruzione (viste montate, nessun refetch al
   cambio vista), non con un test di conteggio chiamate dedicato.
