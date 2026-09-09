# World Story — Roadmap e stato

**Aggiornato:** 2026-09-08, dopo il completamento dei pacchetti F00–F02 (pi coding agent, report in `docs/implementation/`).

> Nota: il documento storico di gap-analysis (in russo, del 2026-07-17) è stato rimosso dai pacchetti F00–F02; questo file ne raccoglie lo stato attuale. Fonte operativa: [PIANO_ESECUTIVO_LLM_REALISMO_UX.md](PIANO_ESECUTIVO_LLM_REALISMO_UX.md).

## Pacchetti del piano esecutivo (19 totali)

### Fondamentali F00–F06

| Pacchetto | Stato |
|---|---|
| F00 Baseline affidabile e regressioni | ✅ fatto (15:04) |
| F01 ID e contratti end-to-end | ✅ fatto (15:04) |
| F02 Checkpoint atomici, revisioni, rami, outbox | ✅ fatto (15:09) |
| F03 Contratto pubblico run, no esiti per posizione | ✅ fatto (15:33) |
| F04 Save/Load/Rewind e chat sicuri per ramo | ✅ fatto (15:49) |
| F05 Job asincroni, lease e recovery post-crash | ✅ fatto (16:07) |
| F06 Unico stato client, reset ramo, riconciliazione | ✅ fatto (16:20) |

### Realismo
### Realismo materiale M01–M07

| Pacchetto | Stato |
|---|---|
| M01 Cataloghi, preset, qualità dati | ✅ fatto (18:08, 4 micro-consegne) |
| M02 Quantità, ledger append-only, prenotazioni | ✅ fatto (19:13, 3 micro-consegne) |
| M03 Interpretazione controllata + preflight lotto | ✅ fatto (20:54) |
| M04 Produzione, energia, logistica | ✅ fatto (21:17) |
| M05 Progetti a fasi, tecnologia, personale | ✅ fatto (21:44) |
| M06 Collegamento al simulatore (integrazione critica) | ⬜ |
| M07 Delega, servizi, politiche nazionali (R2) | ⬜ |

### Grafica/accessibilità e harness

| Pacchetto | Stato |
|---|---|
| U01 Shell operativa + migrazione CSS | ⬜ |
| U02 Ordini guidati e catena fattibilità | ⬜ |
| U03 Dossier Nazione, chat/accordi, lettore causale | ⬜ |
| Q01 Harness frontend/E2E (Playwright + test store) | ⬜ avviabile subito, chiusura dopo M06 |

## Fatto prima dei pacchetti F (già in produzione)

- Layer LLM: provider `openai-compatible` → Ollama Cloud (glm-5.3-flash), tutte le 9 meccaniche
- Preset come pacchetti: lore.md + rules.md + base_prompt/prompts (5 preset)
- UX mobile completa: bottom-sheet, FAB, tema Dispacci, Worker Cloudflare con URL fisso
- Live simulazione con fallback polling; test 224/224 verdi alla baseline F00

## Prossimi passi

1. **Revisione indipendente di F00–F06** (chi implementa non auto-approva)
2. **Q01** harness frontend/E2E (avviabile subito)
3. **M06** integrazione end-to-end (µ1–µ6a implementate: economia denaro live via bootstrap+route; progetti/spedizioni server-internal per M07; quinta revisione indipendente: ACCETTABILE — M06 CHIUSO) → M07 delega/servizi (R2)
4. **HANDOFF-LLM.md** presente in docs/implementation/ per il passaggio tra esecutori
4. Rilievi audit residuali fuori dal gruppo F verificati durante i pacchetti