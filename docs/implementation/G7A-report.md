# G7-A — Gate accessibilità aggiornato

Il test Playwright a11y ora attraversa la command rail corrente invece della shell/FAB rimossi. L’audit riconosce sia `label[for]` sia le label contenitore, semantica valida per i checkbox della legenda mappa.

Verifica: `npm run test:a11y` verde (1/1).
