# WS-MINISTER-UX-01 — La seduta: dialogo a sinistra, tavola a destra

> **Prima consegna** della roadmap WS-MINISTER-UX: rifare la gerarchia visiva
> della seduta del ministro. Non un ritocco di colore: la chat torna a essere la
> **superficie principale** e la destra diventa una **tavola di lavoro** ampia,
> ridimensionabile e sempre all'altezza della sedia.

- **Ramo**: `feat/ws-minister-ux-00-01-dialogo-e-tavola` (base `336e170`).
- **Contesto**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fasi UX-00 / UX-01.
- **Contratti di riferimento**: `docs/implementation/WS-MINISTER-UX-00-report.md`.
- **Freeze**: CORE ENGINE FREEZE rispettato (solo frontend).

---

## 1. Cosa cambia, in una frase

Prima la seduta apriva un **dossier numerico** che spingeva la chat in secondo
piano (e su mobile la copriva); ora apre un **saluto in prima persona** a
sinistra — con il compositore subito visibile — e a destra una **tavola visiva**
(l'atto del Tesoro, il piano a cascata, la mappa, il grafico, le cifre e le
idee), con un **divisore ridimensionabile** a 42/58 e una **sola superficie alla
volta su mobile**.

## 2. Composizione

### Desktop (≥ 768 px)
- Griglia `.government-office-split`:
  `var(--dialogue-pct) 8px minmax(0, 1fr)` — default **42% / 58%**, maniglia di
  8 px.
- La maniglia è `role="separator"` verticale, `aria-valuenow` = percentuale,
  trascinabile col puntatore e regolabile con **←/→** (passo 2%, limiti **32–60%**).
- **Pannello dialogo** (sinistra, scuro): `SeatBrief` (fascicolo chiuso) +
  `MinisterChat` + l'eventuale esito della seduta. Il thread scorre, il
  compositore resta ancorato in basso.
- **Pannello tavola** (destra, chiaro): `TreasuryActPanel` in testa, poi la
  gerarchia dei blocchi (`SeatTable`, §4).

### Mobile (< 768 px)
- Una superficie alla volta (`data-mobile-pane="dialogo" | "tavola"`), con due
  linguette `role="tab"` in testata (`Dialogo` / `Tavola`).
- All'apertura di una sedia si riparte sempre dal **dialogo**.
- La maniglia è nascosta; il resto della seduta è a colonna singola.

### Fascicolo della sedia
`SeatBrief` è un `<details>` **chiuso di default**: espande le questioni della
sedia e le loro cifre con provenienza. Lo stesso linguaggio visivo dei numeri
(`basisLabel`, `isUnknown`, `formatFigureValue`) del vecchio dossier, senza
rubare spazio alla conversazione. Se la sedia non ha questioni, non compare.

## 3. Il minimo perché la chat sia «immediatamente accessibile»

- **Saluto in prima persona**: all'apertura della sedia compare una entry
  assistente con `Signor Presidente,` + `address.opening` (es. «La cassa regge,
  ma il margine si assottiglia.»). Sparisce quando si invia il primo messaggio.
- **Composer sempre visibile**: misurato a 1440×900, 1024×768 e 390×844
  (`composer.bottom` < `office.bottom` in tutti e tre).
- Nessuna intestazione `minister-head` ridondante: la testata della seduta porta
  nome sedia, competenza (`reads`), Stato e data.

## 4. La tavola: gerarchia dei blocchi

`SeatTable` ordina i blocchi di `deriveSeatCanvasBlocks` per **priorità**:

1. `strategy` → visualizzazione **principale** (il piano a cascata);
2. `map`, `chart` → fino a **2 supporti**;
3. `metrics`, `ideas` → dentro `<details>` **Approfondimenti** (chiuso di default).

`SeatCanvas` resta il renderer generico per tutte le sedie: qui si cambia la
**composizione**, non il modello. Per il Tesoro la principale è il piano di
stabilizzazione, i supporti sono mappa delle zone e grafico del bilancio, gli
approfondimenti portano le cifre della sedia e le idee. Se una sedia non ha
blocchi, la tavola lo dichiara («Nessuna evidenza pubblicata») invece di fingere.

## 5. File

### Nuovi
| File | Ruolo |
|---|---|
| `frontend/src/components/Game/SeatBrief.tsx` | fascicolo della sedia espandibile (questioni + cifre con provenienza) |
| `frontend/src/components/Game/SeatTable.tsx` | tavola a destra con gerarchia principale/supporti/approfondimenti |
| `frontend/src/components/Game/ministerUx01Render.test.tsx` | 4 test di render sulla nuova gerarchia |
| `e2e/ux01-shot.mjs` | cattura scelta → dialogo → fascicolo → tavola → risposta → registro |
| `e2e/ux01-check.mjs` | controlli di layout sui tre viewport |

### Modificati
| File | Cosa |
|---|---|
| `frontend/src/components/Game/GovernmentOffice.tsx` | split 42/58 ridimensionabile (puntatore + tastiera), viste mobile, composizione a due pannelli, rimosso l'innesto del dossier |
| `frontend/src/components/Game/MinisterChat.tsx` | rimosso `minister-head`; saluto del ministro al posto dell'empty-state generico |
| `frontend/src/editorial.css` | `.government-office-session`, split/divisore, panes, `.seat-table`, `.seat-brief`, override chiaro scoped, mobile |
| `frontend/src/components/Game/governmentOfficeMobile.test.tsx` | difende una superficie per volta, maniglia nascosta, `min-height: 0` |
| `e2e/tests/modules.spec.mjs` | P04/P04b aggiornati alla tavola (blocchi dietro gli approfondimenti) |
| `e2e/a11y/a11y.spec.mjs` | `.seat-canvas` con più istanze → `.first()` |
| `e2e/govoffice-shot.mjs` | locator tela a istanza singola (`.first()`) |

### Asset
`docs/implementation/assets/ws-minister-ux-01/` — prima/dopo a 1440×900,
1024×768, 390×844 (`before-*`, `after-1440[-tavola|-fascicolo]`,
`after-1024[-tavola]`, `after-390-dialogo`, `after-390-tavola`).

## 6. Comportamento funzionante (verificato)

- Aprire il Governo → scegliere il Tesoro → **saluto** e **composer** visibili
  senza scorrere; il fascicolo è chiuso e si apre su richiesta.
- Trascinare la maniglia o usare ←/→ cambia il rapporto dialogo/tavola entro
  32–60%; il rapporto misurato resta 0,73 (chat/tavola ≈ 42/58).
- La tavola mostra l'atto del Tesoro, il piano (principale), mappa e grafico
  (supporti); aprendo **Approfondimenti** compaiono le cifre (`12,40 mld`,
  `misurato · Tesoro`) e le idee.
- Inviare un messaggio → risposta in streaming → «Prepara l'atto» → l'atto è nel
  **registro**; firmare una strada d'investimento la **accoglie** e la porta nel
  registro (P04b).
- «Nulla di fatto» chiude la seduta senza atti.
- Mobile: una superficie alla volta, linguette funzionanti, nessun overflow.

## 7. Controlli eseguiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **111 file / 933 test** verdi (baseline 110/928 → +1 file / +5 test) |
| `vitest governmentOfficeMobile` + `cssDiscipline` + `seatCanvasRender` | 3 file / 19 test verdi |
| `npm run build:frontend` | build ok |
| E2E `modules.spec.mjs` (mock) | **7/7** (P04 aggiornato, P04b firmabile) |
| E2E a11y `HUD di gioco` | **1/1** |
| `ux01-check.mjs` @1440×900 / 1024×768 / 390×844 | tutti i controlli OK (nessun overflow, composer visibile, saluto presente, una superficie su mobile) |

## 8. Limiti residui e passi successivi

- **Memoria non persistente**: la cronaca per sedia vive in RAM (`chatStore`,
  nessun `persist`); si perde al reload. Innesto previsto in **UX-05**, con il
  contratto già fissato in UX-00 §3.
- **Nessuna selezione dinamica delle evidenze**: la tavola è statica; il modello
  non può ancora «mostrare/focalizzare/confrontare» (UX-03).
- **Identità e direttive** sono contratti di UX-02/UX-03, non implementati qui:
  non promettiamo personalità né memoria.
- **Nessun nuovo effetto sociale/economico**: gli esiti restano quelli del motore
  (registro, settlement, `decisionImpact`); l'atto del Tesoro dichiara i limiti
  (nessuna azione di rimborso: le scadenze sono un rollover).
- Il **piano strategico** resta contenuto d'autore (UX-07 lo dichiara fuori scope).
- `MinisterDossier.tsx` non è più montato ma resta coperto dal suo test: la
  rimozione è un lavoro di pulizia successivo.

---

**Cronologia**: implementazione e screenshot prima/dopo prodotti durante la
sessione; report di consegna allineato a `main` @ `336e170`.
