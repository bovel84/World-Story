/**
 * WS-GOV-COUNCIL-HARDENING — La lettura del motore per la riunione
 * ================================================================
 * Questo modulo puro traduce la risposta autorevole di `check-feasibility`
 * nell'`MeetingEngineRead` che la Tavola e i contributi mostrano. È l'unico
 * punto in cui nascono i numeri della riunione, e nascono **solo** da campi del
 * motore:
 *
 *  - la localizzazione viene dalla **geografia canonica** della partita
 *    (`resolveMeetingLocation`), mai dal testo;
 *  - il costo monetario viene da `costs.inputs` (il prezzo del catalogo);
 *  - il disponibile e il mancante vengono da `deficits`/`availability`, cioè
 *    dalla stessa `measureDeficits` che produce `workDeclaration.funded`;
 *  - `margin` è l'unica cifra derivata ed è marcata come di visualizzazione:
 *    è la differenza fra due numeri del motore, non un numero nuovo inventato.
 *
 * Nessun I/O, nessuno stato: così la localizzazione, la copertura e l'accordo
 * Tavola/`funded` si possono provare senza montare la stanza.
 */
import type { MeetingEngineRead, MeetingMoneyCoverage, MeetingWorkDeclaration } from './councilMeeting';
import { resolveMeetingLocation, type CanonicalRegionRef } from './meetingLocalization';

/** Il minimo strutturale di `check-feasibility` che la lettura usa. */
export interface MeetingFeasibilityInput {
  readonly feasible: boolean;
  readonly summary?: string;
  readonly risks?: readonly string[];
  readonly prerequisites?: readonly string[];
  readonly costs: {
    readonly timeDays?: number;
    readonly note?: string | null;
    readonly inputs: readonly { readonly resourceId: string; readonly name?: string; readonly quantity: string; readonly unit: string }[];
  };
  readonly workDeclaration?: MeetingWorkDeclaration | null;
  readonly deficits?: readonly { readonly code: string; readonly id: string; readonly required: string; readonly available: string; readonly missing: string; readonly holder: string }[];
  readonly availability?: { readonly money?: readonly { readonly holder: string; readonly unitId: string; readonly available: string }[] };
}

/** Interpreta una quantità del motore come numero (solo per il margine visivo). */
function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Formatta il margine nella convenzione italiana, senza unità (la aggiunge la Tavola). */
function formatAmount(value: number): string {
  return value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * La copertura monetaria autorevole. Non sceglie fra numeri diversi: prende il
 * richiesto/disponibile/mancante dai campi del motore e ne deduce solo il
 * margine. Se il motore dichiara un deficit di cassa, la copertura è `short`
 * per costruzione (stessa fonte di `funded`).
 */
export function moneyCoverageFromFeasibility(input: MeetingFeasibilityInput): MeetingMoneyCoverage | null {
  const moneyInput = input.costs.inputs.find(entry => entry.resourceId === 'money') ?? null;
  const cashDeficit = (input.deficits ?? []).find(deficit => deficit.code === 'INSUFFICIENT_CASH') ?? null;
  const availability = input.availability?.money ?? [];
  const availableEntry = cashDeficit
    ? null
    : (moneyInput ? availability.find(entry => entry.unitId.toLowerCase() === moneyInput.unit.toLowerCase()) : undefined) ?? availability[0] ?? null;

  const unit = moneyInput?.unit ?? (cashDeficit?.id ?? null);
  const required = cashDeficit?.required ?? moneyInput?.quantity ?? null;
  const available = cashDeficit?.available ?? availableEntry?.available ?? null;
  const missing = cashDeficit?.missing ?? null;
  const holder = cashDeficit?.holder ?? availableEntry?.holder ?? input.workDeclaration?.payerActorId ?? null;

  if (required == null && available == null && missing == null && !input.workDeclaration) return null;

  const coverage: MeetingMoneyCoverage['coverage'] = cashDeficit
    ? 'short'
    : (available != null || input.workDeclaration?.funded || input.feasible) ? 'covered' : 'unknown';

  const requiredNumber = parseAmount(required);
  const availableNumber = parseAmount(available);
  const margin = requiredNumber != null && availableNumber != null && coverage === 'covered'
    ? formatAmount(availableNumber - requiredNumber)
    : null;

  return { required, available, missing, margin, holder, unit, coverage };
}

/**
 * Traduce la risposta del preflight in lettura della riunione. `regions` è la
 * geografia canonica della partita: se il testo non nomina nessuna regione la
 * localizzazione resta `missing` (nessun blocco, si agisce come prima); se ne
 * nomina più di una resta `ambiguous` e la riunione non è pronta.
 */
export function meetingReadFromFeasibility(
  meeting: { readonly subject: string },
  feasibility: MeetingFeasibilityInput,
  regions: readonly CanonicalRegionRef[],
  /** WS-GOV-MOBILE-FOCUS (A5) — la regione attuale, se risolvibile. */
  currentRegion: CanonicalRegionRef | null = null,
): MeetingEngineRead {
  const moneyInput = feasibility.costs.inputs.find(input => input.resourceId === 'money') ?? null;
  const declaration = feasibility.workDeclaration ?? null;
  const missingByResource = new Map((declaration?.missingMaterials ?? []).map(material => [material.resourceId, material.missing]));

  const materials = feasibility.costs.inputs
    .filter(input => input.resourceId !== 'money')
    .map(input => {
      const missing = missingByResource.get(input.resourceId);
      return missing != null
        ? { name: input.name || input.resourceId, ok: false, missing }
        : { name: input.name || input.resourceId, ok: true };
    });
  for (const [resourceId, missing] of missingByResource) {
    if (!feasibility.costs.inputs.some(input => input.resourceId === resourceId)) {
      materials.push({ name: resourceId, ok: false, missing });
    }
  }

  const coverage = declaration
    ? (declaration.funded && declaration.materialActorId ? 'covered' : 'short')
    : (feasibility.feasible ? 'covered' : 'short');
  const location = resolveMeetingLocation(meeting.subject, regions, currentRegion);
  const resolvedRegion = location.status === 'resolved' ? location.region : null;

  return {
    workLabel: meeting.subject,
    subject: meeting.subject,
    regionLabel: resolvedRegion?.regionLabel ?? null,
    durationDays: Number.isFinite(feasibility.costs.timeDays) ? (feasibility.costs.timeDays as number) : null,
    materials,
    costLabel: moneyInput ? `${moneyInput.quantity} ${moneyInput.unit}`.trim() : null,
    costNote: feasibility.costs.note ?? null,
    coverage,
    availableLabel: null,
    money: moneyCoverageFromFeasibility(feasibility),
    location,
    risks: feasibility.risks ?? [],
    prerequisites: feasibility.prerequisites ?? [],
    summary: feasibility.summary ?? '',
    workId: declaration?.workId ?? null,
    regionId: resolvedRegion?.regionId ?? null,
    workDeclaration: declaration,
    source: 'check-feasibility',
  };
}
