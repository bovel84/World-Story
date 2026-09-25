/**
 * World Story — N01: il nome della nazione giocata
 * ================================================
 * Il dossier si intitola con il nome del **paese del giocatore**. Fino a ieri lo
 * ricavava da `polityName` della regione (`state.routes.ts`), che su un mondo
 * provinciale è il nome della **capitale** — quindi «Alaska» — e altrove è il
 * nome **inglese** del registro — quindi «Italy» invece di «Italia».
 *
 * La fonte autorevole esiste già ed è quella che usano cronaca e diplomazia: la
 * mappa `names` che il motore pubblica con `GET /:id/relationships`
 * (`publicPolityName`: registro dei paesi, nomi italiani curati, nomi storici del
 * preset). Qui si legge quella, e **solo** quella.
 *
 * Perché un modulo puro: la catena di risoluzione è una decisione di prodotto
 * («quale nome è quello vero?») e va testata da sola, senza React e senza rete —
 * come `diplomacyPresence` e `nationalSynthesis`.
 */

/** Marca dell'assenza: il nome non è noto. Non è una stringa vuota. */
export const UNKNOWN_POLITY_NAME = '';

export interface PolityNameInput {
  polityId: string;
  /** Nome pubblicato dal motore (`GET /:id/relationships` → `names`). */
  authoritativeName?: string | null;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Il nome della nazione giocata, oppure `UNKNOWN_POLITY_NAME` se non è noto.
 *
 * **Una sola fonte: `names` del motore.** Non esiste un secondo gradino che
 * ricavi il nome dalla geografia, perché ogni ripiego geografico è già stato la
 * causa di un nome falso:
 *
 *  - il nome della **regione capitale** è il nome di una **provincia** sui mondi
 *    provinciali (misurato: `Alaska`, `Texas`… per gli USA di `pax_modern`);
 *  - il nome del **registro** è in inglese e ignora la curatela del preset
 *    («Italy» invece di «Regno d'Italia»).
 *
 * Se il motore non pubblica il nome per questa polity (accade alle politie senza
 * relazioni diplomatiche: `LKA` su 112, `AUT`/`CHE`/`KEN` su 40 nel mondo 1951),
 * la risposta corretta è **dichiarare l'assenza**: un nome mancante si nota e si
 * corregge, un nome falso no. Il codice della polity **non** è mai un nome.
 */
export function resolvePolityName({ authoritativeName }: PolityNameInput): string {
  const name = clean(authoritativeName);
  if (!name) return UNKNOWN_POLITY_NAME;
  // Un codice polity (tre lettere maiuscole) non è un nome: se il motore avesse
  // pubblicato il codice, non va mostrato come se fosse il nome del paese.
  if (/^[A-Z]{3}$/.test(name)) return UNKNOWN_POLITY_NAME;
  return name;
}

/** true quando il nome non è noto: la UI dichiara l'assenza invece di inventare. */
export function isNameUnknown(name: string): boolean {
  return clean(name) === '';
}
