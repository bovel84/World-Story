# World Story

**Simulatore di storia alternativa guidato dall'IA.**

> Governa una nazione. Cambia una decisione. Osserva un mondo che ricorda.

World Story è un gioco di strategia a turni in cui scrivi gli ordini in
linguaggio naturale e un grande modello linguistico (LLM) li trasforma in
eventi storici coerenti. Il motore di simulazione deterministico tiene i
conti — economia, debito, risorse, consenso, capacità militare, crisi — mentre
l'IA racconta e interpreta le conseguenze. Nessun evento è "inventato" contro
i numeri: se la cassa non copre un ordine, l'ordine fallisce davvero.

---

## Indice

- [Caratteristiche](#caratteristiche)
- [Stack e architettura](#stack-e-architettura)
- [Struttura del progetto](#struttura-del-progetto)
- [Avvio rapido](#avvio-rapido)
- [Configurazione](#configurazione)
- [Script e test](#script-e-test)
- [Deploy](#deploy)
- [Documentazione](#documentazione)
- [Licenza](#licenza)

---

## Caratteristiche

### Gioco

- **Ordini in linguaggio naturale** — «Nazionalizza le acciaierie e avvia un
  piano di riarmo» viene convertito in un'azione concreta, con costo e esito.
- **Simulazione a checkpoint** — il salto temporale produce eventi datati uno
  alla volta; puoi seguire la cronaca, **continuare** o **intervenire** fermando
  il mondo all'istante che preferisci.
- **Mondo che ricorda** — cronologia consolidata, progetti in corso, processi
  che maturano nel tempo, cicatrici temporali e un feed eventi persistente.
- **Nazione viva** — Dossier con tesoreria, bilancio, fazioni di governo,
  progetti, cassa, risorse naturali, industria, armamenti e conoscenze.
- **Leve del giocatore** — pressione fiscale scelta liberamente, emissione di
  debito sovrano, commercio di risorse, procurement militare.
- **Sfide di pace** — ogni turno porta pressioni interne ed esterne (scioperi,
  scandali, carestie, crisi di confine, offerte di alleanza…). Ignorarle ha un
  costo.
- **Crisi e fine partita** — rivolta, default sovrano e invasione sono
  calcolati dagli indicatori reali. Tre turni di criticità consecutivi e la
  nazione cade. Si può tornare indietro di un turno o ricominciare.
- **Diplomazia e advisor** — chat con le altre nazioni e un consulente che
  commenta la situazione.
- **Mappe** — rendering MapLibre con overlay tattico, unità in movimento,
  province ispezionabili e strati tematici.

### Motore

- **Deterministico e testabile** — il mondo è calcolato dal motore
  (`WorldStateEngine`, `MaterialEconomy`, `SovereignDebt`, `NationalBudget`,
  `NationCrisis`, `PeacetimePressures`, `FiscalPolicy`); l'LLM non può
  modificare direttamente i numeri.
- **Modalità storica vs moderna** — i fatti di riferimento moderni non vengono
  applicati ai mondi storici (niente anacronismi): una partita del 1951 usa la
  tabella di conversione del PIL dell'epoca.
- **Strict economy** (opzionale) — percorso con validazione degli effetti,
  catalogo di simulazione, ledger e prenotazioni.
- **Job asincroni e SSE** — i run LLM sopravvivono a ricariche e disconnessioni;
  il browser riceve eventi in tempo reale via Server-Sent Events.
- **Sessioni ripristinabili** — le partite attive vengono ricaricate dal
  database al riavvio del server.

---

## Stack e architettura

| Livello    | Tecnologie |
|------------|------------|
| Frontend   | React 18, TypeScript, Vite, Zustand, MapLibre GL |
| Backend    | Node.js, Express, TypeScript, better-sqlite3 |
| IA         | LLM multi-provider: `openai-compatible`, `anthropic`, `minimax` |
| Database   | SQLite (file locale) |
| Test       | Vitest (unit), Playwright (e2e + a11y) |
| Deploy     | Cloudflare Worker + tunnel, oppure processo locale |

Il backend serve **anche** la build React (`frontend/dist`), quindi in
produzione un unico processo espone UI e API sullo stesso host.

---

## Struttura del progetto

```
World Story/
├── frontend/                  # React + Vite (UI di gioco)
│   └── src/
│       ├── components/        # Game, Map, Shell, WorldBuilder…
│       ├── services/          # client API + hook SSE
│       ├── stores/            # stato Zustand
│       └── utils/
├── backend-nest/              # Express + SQLite (API e motore)
│   ├── src/
│   │   ├── core/simulation/   # motore deterministico (economia, crisi…)
│   │   ├── prompts/           # template dei prompt LLM
│   │   ├── repositories/      # accesso dati
│   │   ├── routes/            # API REST
│   │   ├── llm/               # router multi-provider
│   │   ├── game-session.ts    # stato e regole di una partita
│   │   └── database.ts        # schema e migrazioni
│   ├── data/presets/          # mondi predefiniti (1951, 2024, WWII…)
│   └── tests/                 # unit e integrazione
├── e2e/                       # Playwright (mock + accessibilità)
├── cloudflare/                # Worker e configurazione tunnel
├── docs/                      # specifiche, piani e report
├── scripts/                   # avvio, deploy, import preset
├── start.command              # launcher macOS
└── ROADMAP.md
```

---

## Avvio rapido

### Prerequisiti

- **Node.js ≥ 18** (consigliato 20/22)
- npm
- Un provider LLM raggiungibile (Ollama, OpenRouter, Anthropic, MiniMax…) con
  la relativa chiave API

### Installazione

```bash
git clone https://github.com/bovel84/World-Story.git
cd World-Story
npm install
```

### Configurazione minima

```bash
cp backend-nest/.env.example backend-nest/.env
```

Poi imposta almeno una chiave e, se serve, il provider:

```dotenv
LLM_API_KEY=la_tua_chiave
# LLM_PROVIDER=openai-compatible
# LLM_BASE_URL=https://ollama.com/v1
# LLM_MODEL=glm-5.3-flash
```

In alternativa puoi configurare tutto da `backend-nest/llm.config.json` (per
meccanica) o dall'interfaccia web (**Impostazioni tecniche** → provider,
modello, chiave).

### Sviluppo

```bash
npm run start:dev      # backend (tsx watch) + frontend (Vite), log in ./logs
# oppure separatamente:
npm --prefix backend-nest run dev     # API su :8000
npm --prefix frontend run dev         # UI su :5173
```

### Produzione locale

```bash
npm run build          # compila backend e frontend
npm --prefix backend-nest start
# UI + API su http://localhost:8000
```

Su macOS puoi usare il launcher `start.command` (doppio clic): avvia il
backend, sincronizza il tunnel e apre il browser.

---

## Configurazione

### Variabili d'ambiente (`backend-nest/.env`)

| Variabile          | Default                      | Descrizione |
|--------------------|------------------------------|-------------|
| `LLM_API_KEY`      | —                            | Chiave API generica per il provider attivo |
| `MINIMAX_API_KEY`  | —                            | Chiave dedicata MiniMax (fallback) |
| `LLM_PROVIDER`     | `minimax`                    | `openai-compatible` \| `anthropic` \| `minimax` |
| `LLM_BASE_URL`     | `https://api.minimax.io/v1`  | Endpoint del provider |
| `LLM_MODEL`        | `MiniMax-M2.5`               | Modello predefinito |
| `PORT`             | `8000`                       | Porta del server |
| `OPEN_PAX_DB_PATH` | `./data/world-story.db`      | Percorso del database SQLite |

### `llm.config.json`

Configurazione per **meccanica** (`jump`, `converter`, `advisor`,
`suggestions`, `narration`, `consolidation`…): provider, modello, timeout,
retry, streaming, `extraBody`. Le chiavi possono puntare a variabili
d'ambiente con la sintassi `"apiKey": "env:LLM_API_KEY"`.

Vedi `backend-nest/llm.config.example.json` per l'esempio completo.

### Frontend (`frontend/.env`)

| Variabile      | Default | Descrizione |
|----------------|---------|-------------|
| `VITE_API_URL` | `/api`  | Base URL dell'API backend |

---

## Script e test

```bash
# Test unitari (backend + frontend)
npm run test:unit

# Solo backend (Vitest)
npm --prefix backend-nest test

# Solo frontend (Vitest)
cd frontend && ../node_modules/.bin/vitest run

# End-to-end (Playwright, API mockate — nessun credito LLM)
npm run test:e2e:mock

# Accessibilità
npm run test:a11y

# Performance
npm run test:perf
```

Copertura attuale: **855 test backend**, **183 test frontend**, **17 e2e** e
**3 audit di accessibilità**. La CI (`.github/workflows/ci.yml`) esegue test e
build a ogni push su `main` e su ogni pull request.

---

## Deploy

### Worker Cloudflare + tunnel

Il gioco può essere esposto tramite un Worker Cloudflare che inoltra al backend
locale attraverso un tunnel. Vedi `docs/CLOUDFLARE_RUNBOOK.md` e
`cloudflare/wrangler.jsonc`.

```bash
bash scripts/deploy-cloudflare.sh
```

### Processo locale (produzione)

```bash
npm run build
npm --prefix backend-nest start
```

Il backend pubblica anche `frontend/dist`, quindi l'app è completa su una sola
porta.

---

## Documentazione

- [`ROADMAP.md`](ROADMAP.md) — roadmap tecnica
- [`docs/`](docs) — specifiche, piani esecutivi e report di implementazione
- [`docs/CLOUDFLARE_RUNBOOK.md`](docs/CLOUDFLARE_RUNBOOK.md) — deploy e tunnel
- [`docs/PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md`](docs/PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md) — modello di realismo nazionale

---

## Licenza

Distribuito con licenza **MIT**. Vedi [`LICENSE`](LICENSE).

Copyright © 2026 Andrea Cannas.
