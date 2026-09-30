# Fonti del catalogo `realism_test_world`

## fixture-tecnica

Questo catalogo è una **fixture tecnica sintetica e deterministica** per lo
sviluppo del realismo materiale (M01) e per i test numerici MAT01–MAT38.

- NON è storico: polities (Alphaland, Betaland), risorse, ricette e quantità
  sono inventate per rendere verificabili le proprietà (bilanci, chiusura
  delle filiere, DAG delle conoscenze, matrice di autorità).
- La valuta `TEST` è una convenzione di test (maestro §4.1.8): i suoi valori
  non sono prezzi storici e non diventano prezzi storici.
- Il deposito `dep_ore_beta` è `hidden` con stima `estimated`: serve a
  distinguere ignoranza modellata da assenza di dato (needs_data).

## WS-GOVOFFICE-06 — vocabolario delle opere nazionali

Il catalogo delle opere (`works.json`) è esteso da una a **dodici** opere: una
strada, più scuola, ateneo, ospedale, ponte, acquedotto, ferrovia, fabbrica,
centrale elettrica, quartiere residenziale, caserma e fortificazione. Ogni
opera è una **distinta dichiarata** (fasi, materiali, fondi, manodopera,
effetto e manutenzione), mai dedotta. Le grandezze sono dello stesso ordine di
`w_road`: valori inventati per essere verificabili, non prezzi.

Vocabolario aggiunto (tutto dichiarato, niente meccaniche nuove):

- **Risorse** (unità di catalogo): `cement` (massa, kg), `bricks` (conteggio,
  pz), `timber` (volume, m³), `machinery` (conteggio, pz), `fuel` (volume, L),
  `books` (conteggio, pz), `medicine` (massa, kg). Come per le risorse
  preesistenti, la loro giustificazione §4.4 è lo **stock iniziale**
  (`initial-state.json`): il mondo di prova nasce con una scorta, non con una
  filiera. Non si dichiara un produttore che non esiste.
- **Qualifiche** (manodopera, persone non ore): `insegnante`, `medico`,
  `ingegnere`, `tecnico`, `soldato`, accanto a `minatore`, `operaio`,
  `agricoltore`, con i relativi bacini in `initial-state.json`.
- **Tipi d'impianto** (`facilities.json`), uno per dominio d'opera, perché
  l'asset finale abbia una capacità coerente e non sia un'officina travestita:
  `ft_school`, `ft_university`, `ft_hospital`, `ft_bridge`, `ft_water`,
  `ft_railway`, `ft_factory`, `ft_power`, `ft_housing`, `ft_barracks`,
  `ft_fortification`.

L'`effect.kind` di un'opera è un'etichetta **dichiarativa** della capacità che
l'asset rende operativa (`transport`, `education`, `health`, `water`, `energy`,
`industry`, `housing`, `defence`); il motore la trasporta nei metadati
dell'asset consegnato senza interpretarla. Non è una leva materiale: le leve
materiali restano quelle del canale canonico.
