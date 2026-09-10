# G7-C — Focus visibile da tastiera

Il gate a11y ora raggiunge «Ordini» tramite Tab reale e verifica che `:focus-visible` produca un outline prima dell’attivazione con Enter. La prova evita i falsi negativi del focus programmatico, che il browser non considera una modalità tastiera.

Verifica: `npm run test:a11y` verde (2/2).
