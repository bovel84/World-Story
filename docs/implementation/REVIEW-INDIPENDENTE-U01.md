# Revisione indipendente — U01 (shell operativa e migrazione CSS)

- **Revisore**: ≠ implementatore (gate F00–F06 / pacchetti U).
- **Oggetto**: `frontend/src/stores/moduleState.ts` + `uiStore.activeModule`
  (µ1, passo 2) e la disciplina CSS dei moduli migrati (passo 4/5, DoD).
- **Metodo**: lettura dei call path + prove riproducibili (`moduleState.test.ts`,
  `cssDiscipline.test.ts`).
- **Esito**: **ACCETTABILE** per le parti di codice; chiusura formale del pacchetto
  con i residui manuali dichiarati.

## Claim verificati

| Requisito U01 | Evidenza |
|---|---|
| Passo 2 — un `activeModule` enum al posto di booleans concorrenti | `moduleState.ts` puro (`openModule`/`closeModule`/`toggleModule`); `uiStore.activeModule` (rimosso `showActions`); App deriva i valori legacy |
| UI01 — Nazione chiusa all'ingresso, **un solo modulo attivo** | `moduleState.test.ts` (9 casi: ingresso `none`, apertura chiude il precedente, Nazione↔Ordini, `openModule(none)`, toggle) |
| Passo 4/5 DoD — nessun nuovo `!important` nei moduli migrati; vendor non travasato | `cssDiscipline.test.ts` (3 casi): nessun `!important` nei prefissi `nation-dock`/`feasibility`/`module-`/`command-` in `foundations.css`/`index.css`/`editorial.css`; `foundations.css` senza `@import` e senza righe minificate (max < 400) |
| Dialoghi accessibili (focus/return) | `components/ui/AccessibleDialog.tsx` + `accessibleDialogContract.test.ts`; `GameShell`/`DeskContent` presenti |

## Verifica dei residui (dichiarati, non bloccanti)

- **Passo 1** (prototipo statico + screenshot di tutti gli stati): non automatizzabile
  senza harness browser/screenshot → tracciato in Q01 passo 4 (matrice viewport).
- **Passo 3**: shell grid + registry z-index + focus/inert/return — `GameShell` e
  `AccessibleDialog` realizzano il focus/return; il registry z-index è espresso dai
  livelli CSS. Test UI06–UI12 (tastiera/viewport/contrasto/reflow) richiedono Q01.
- Le eccezioni `!important` residue in `foundations.css` sono **motivate e fuori dai
  moduli migrati**: `.map-view-container .zoom-controls` (mappa), `.diplomacy-panel
  .diplomacy-header span:first-child` (override di contrasto di `editorial.css`),
  `.hud-advance-btn--busy` (HUD). Nessuna nei prefissi migrati.

## Esito

Nessun difetto bloccante. La parte implementabile di U01 è verificata e coperta da
prove; le verifiche manuali (screenshot, tastiera reale, viewport) sono demandate a
Q01 e dichiarate. **U01 CHIUSO** per la parte di codice.
