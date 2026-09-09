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
