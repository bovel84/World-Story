import type { ResourceKind, ResourceStock } from './MaterialEconomy';
import { creditLimit, debtOf, storageCapacity } from './MaterialEconomy';
import type { NationalAccount } from './WorldStateEngine';
import { tensionFromDebtRatio } from './SovereignDebt';
import { equipmentById } from './MilitaryIndustry';

/**
 * Effetti nazionali: le leve con cui il modello agisce sulla vita reale della
 * nazione (economia, società, militare, progetti).
 *
 * Il modello **propone**, il motore **dispone**: ogni delta è validato,
 * quantizzato e limitato da un tetto per turno. Nulla viene accettato alla
 * lettera: si evitano salti irreali (casse infinite, eserciti dal nulla).
 * Ogni effetto deve portare una `reason` leggibile; senza motivo viene scartato.
 */

export type ModifierField = 'stability' | 'socialTension' | 'warEffort';

export interface NationalModifiers {
  /** Variazioni persistenti (poi decadono) sull'indice 0-100. */
  stability: number;
  socialTension: number;
  warEffort: number;
  /** Moltiplicatore sulle entrate (1 = nessun effetto). */
  revenueMultiplier: number;
  /** Variazione sul tasso di crescita annuo (frazione, es. 0.01 = +1%). */
  growthModifier: number;
}

export const EMPTY_MODIFIERS: NationalModifiers = {
  stability: 0, socialTension: 0, warEffort: 0, revenueMultiplier: 1, growthModifier: 0,
};

export const MODIFIER_LIMITS = {
  stability: 45,
  socialTension: 45,
  warEffort: 45,
  revenueMultiplier: { min: 0.5, max: 2 },
  growthModifier: { min: -0.1, max: 0.1 },
};

/** Tetti per turno: il modello non può stravolgere la nazione in un colpo. */
export const EFFECT_LIMITS = {
  modifierDelta: 25,
  economyDelta: 0.25,
  researchDelta: 40,
  projectMonths: { min: 1, max: 60 },
  /** Il progetto non può essere chiuso dal modello sotto questa soglia. */
  projectCompletionThreshold: 60,
};

export type NationalEffect =
  | { kind: 'stock'; resource: ResourceKind; delta: number; reason: string; sourceActionId?: string; polityId?: string }
  | { kind: 'arsenal'; equipmentId: string; delta: number; reason: string; sourceActionId?: string; polityId?: string }
  | { kind: 'modifier'; field: ModifierField; delta: number; reason: string; sourceActionId?: string; polityId?: string }
  | { kind: 'economy'; revenueMultiplierDelta?: number; growthModifierDelta?: number; reason: string; sourceActionId?: string; polityId?: string };

const RESOURCE_KINDS: ResourceKind[] = ['money', 'food', 'clothing', 'weapons', 'fuel', 'research'];
const MODIFIER_FIELDS: ModifierField[] = ['stability', 'socialTension', 'warEffort'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const text = (value: unknown, max = 280): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Normalizza le proposte del modello: scarta forme ignote, senza motivo o non
 * numeriche; limita i delta ai tetti di turno. Ritorna solo effetti applicabili.
 */
export function parseNationalEffects(raw: unknown): NationalEffect[] {
  if (!Array.isArray(raw)) return [];
  const effects: NationalEffect[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const reason = text(value.reason);
    if (!reason) continue;
    const sourceActionId = text(value.sourceActionId, 80) || undefined;
    const polityId = text(value.polityId, 40) || text(value.polity, 40) || undefined;
    const kind = text(value.kind, 40);
    if (kind === 'stock') {
      const resource = text(value.resource, 20) as ResourceKind;
      const delta = finite(value.delta);
      if (!RESOURCE_KINDS.includes(resource) || delta === null || delta === 0) continue;
      effects.push({ kind, resource, delta, reason, sourceActionId, polityId });
    } else if (kind === 'arsenal') {
      const equipmentId = text(value.equipmentId, 60);
      const delta = finite(value.delta);
      if (!equipmentById(equipmentId) || delta === null || delta === 0) continue;
      effects.push({ kind, equipmentId, delta, reason, sourceActionId, polityId });
    } else if (kind === 'modifier') {
      const field = text(value.field, 20) as ModifierField;
      const delta = finite(value.delta);
      if (!MODIFIER_FIELDS.includes(field) || delta === null || delta === 0) continue;
      effects.push({ kind, field, delta: clamp(delta, -EFFECT_LIMITS.modifierDelta, EFFECT_LIMITS.modifierDelta), reason, sourceActionId, polityId });
    } else if (kind === 'economy') {
      const revenueMultiplierDelta = finite(value.revenueMultiplierDelta);
      const growthModifierDelta = finite(value.growthModifierDelta);
      if (revenueMultiplierDelta === null && growthModifierDelta === null) continue;
      effects.push({
        kind,
        revenueMultiplierDelta: revenueMultiplierDelta === null ? undefined
          : clamp(revenueMultiplierDelta, -EFFECT_LIMITS.economyDelta, EFFECT_LIMITS.economyDelta),
        growthModifierDelta: growthModifierDelta === null ? undefined
          : clamp(growthModifierDelta, -EFFECT_LIMITS.economyDelta / 10, EFFECT_LIMITS.economyDelta / 10),
        reason, sourceActionId, polityId,
      });
    }
  }
  return effects;
}

/** Applica i delta alle scorte con quantizzazione e clamp (mai materiali < 0). */
export function applyStockEffects(
  stock: ResourceStock, effects: NationalEffect[], account?: NationalAccount,
): { stock: ResourceStock; applied: Array<{ effect: NationalEffect; delta: number }>; rejected: string[] } {
  const next: ResourceStock = { ...stock, technologies: [...stock.technologies] };
  const applied: Array<{ effect: NationalEffect; delta: number }> = [];
  const rejected: string[] = [];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  for (const effect of effects) {
    if (effect.kind !== 'stock') continue;
    const resource = effect.resource;
    const cap = stockCap(resource, stock, account);
    let delta = clamp(effect.delta, -cap, cap);
    if (delta === 0) { rejected.push(effect.reason); continue; }
    if (resource === 'money') {
      next.money = round(next.money + delta);
    } else if (resource === 'research') {
      next.research = round(Math.max(0, next.research + delta));
    } else {
      // Il magazzino ha un tetto reale: un aiuto non può sfondare i silos.
      const ceiling = storageCapacity(account)[resource as 'food' | 'clothing' | 'weapons' | 'fuel'] ?? 0;
      const value = round(Math.max(0, Math.min(ceiling, next[resource] + delta)));
      delta = round(value - next[resource]);
      if (delta === 0) { rejected.push(effect.reason); continue; }
      next[resource] = value;
    }
    applied.push({ effect: { ...effect, delta }, delta });
  }
  return { stock: next, applied, rejected };
}

/** Tetto per turno su una risorsa: proporzionale allo stato, mai illimitato. */
export function stockCap(resource: ResourceKind, stock: ResourceStock, account?: NationalAccount): number {
  if (resource === 'money') {
    const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions || 0));
    return Math.max(5, gdp * 0.03);
  }
  if (resource === 'research') return Math.max(10, stock.research * 0.25 + 10);
  const current = Number(stock[resource] || 0);
  // Il tetto di turno tiene conto della capacità di stoccaggio reale: un aiuto
  // o una requisizione non possono valere una frazione arbitraria di scorte
  // minuscole. Minimo assoluto basso per non gonfiare i paesi fragili.
  const ceiling = storageCapacity(account)[resource as 'food' | 'clothing' | 'weapons' | 'fuel'] ?? 0;
  return Math.max(1, current * 0.2, ceiling * 0.35);
}

/** Applica i delta all'arsenale (catture, perdite, aiuti), con tetto per voce. */
export function applyArsenalEffects(
  units: Record<string, number>, effects: NationalEffect[],
): { units: Record<string, number>; applied: Array<{ equipmentId: string; delta: number }> } {
  const next = { ...units };
  const applied: Array<{ equipmentId: string; delta: number }> = [];
  for (const effect of effects) {
    if (effect.kind !== 'arsenal') continue;
    const current = next[effect.equipmentId] || 0;
    const cap = Math.max(3, Math.round(current * 0.25));
    const delta = Math.round(clamp(effect.delta, -cap, cap));
    if (delta === 0) continue;
    const value = Math.max(0, current + delta);
    if (value <= 0) delete next[effect.equipmentId];
    else next[effect.equipmentId] = value;
    applied.push({ equipmentId: effect.equipmentId, delta: value - current });
  }
  return { units: next, applied };
}

/** Applica i delta ai modificatori nazionali persistenti, entro i limiti. */
export function applyModifierEffects(
  modifiers: NationalModifiers, effects: NationalEffect[],
): { modifiers: NationalModifiers; applied: NationalEffect[] } {
  const next: NationalModifiers = { ...modifiers };
  const applied: NationalEffect[] = [];
  const round = (value: number) => Math.round(value * 10000) / 10000;
  for (const effect of effects) {
    if (effect.kind === 'modifier') {
      next[effect.field] = round(clamp(next[effect.field] + effect.delta, -MODIFIER_LIMITS[effect.field], MODIFIER_LIMITS[effect.field]));
      applied.push(effect);
    } else if (effect.kind === 'economy') {
      if (effect.revenueMultiplierDelta !== undefined) {
        next.revenueMultiplier = round(clamp(
          next.revenueMultiplier + effect.revenueMultiplierDelta,
          MODIFIER_LIMITS.revenueMultiplier.min, MODIFIER_LIMITS.revenueMultiplier.max,
        ));
      }
      if (effect.growthModifierDelta !== undefined) {
        next.growthModifier = round(clamp(
          next.growthModifier + effect.growthModifierDelta,
          MODIFIER_LIMITS.growthModifier.min, MODIFIER_LIMITS.growthModifier.max,
        ));
      }
      applied.push(effect);
    }
  }
  return { modifiers: next, applied };
}

/**
 * Decadimento dei modificatori verso la neutralità: gli effetti durano finché
 * la causa persiste, poi si dissolvono (half-life mensile ~metà).
 */
export function decayModifiers(modifiers: NationalModifiers, factor = 0.7): NationalModifiers {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const shrink = (value: number) => round(Math.abs(value) < 0.5 ? 0 : value * factor);
  return {
    stability: shrink(modifiers.stability),
    socialTension: shrink(modifiers.socialTension),
    warEffort: shrink(modifiers.warEffort),
    revenueMultiplier: round(1 + (modifiers.revenueMultiplier - 1) * factor),
    growthModifier: shrink(modifiers.growthModifier),
  };
}

export function hasModifiers(modifiers: NationalModifiers): boolean {
  return modifiers.stability !== 0 || modifiers.socialTension !== 0 || modifiers.warEffort !== 0
    || Math.abs(modifiers.revenueMultiplier - 1) > 0.001 || modifiers.growthModifier !== 0;
}

/** Applica i modificatori ai conti nazionali (overlay deterministico). */
export function applyModifiersToAccounts(
  accounts: Record<string, NationalAccount>,
  modifiersFor: (polityId: string) => NationalModifiers,
): Record<string, NationalAccount> {
  const out: Record<string, NationalAccount> = {};
  for (const [polityId, account] of Object.entries(accounts)) {
    const modifiers = modifiersFor(polityId);
    if (!hasModifiers(modifiers)) { out[polityId] = account; continue; }
    const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
    const stability = round(clamp(account.stability + modifiers.stability, 0, 100), 1);
    const socialTension = round(clamp(account.socialTension + modifiers.socialTension, 0, 100), 1);
    const warEffort = round(clamp(account.warEffort + modifiers.warEffort, 0, 100), 1);
    const monthlyRevenue = round(account.monthlyRevenue * modifiers.revenueMultiplier, 3);
    const monthlyBalance = round((monthlyRevenue - account.monthlyExpenses), 3);
    out[polityId] = {
      ...account,
      stability,
      socialTension,
      warEffort,
      monthlyRevenue,
      monthlyBalance,
      annualGrowthRate: round(clamp(account.annualGrowthRate + modifiers.growthModifier, -0.5, 1), 4),
    };
  }
  return out;
}

/** Debito disponibile residuo: utile al modello per sapere quanto può spendere. */
export function affordability(stock: ResourceStock, account?: NationalAccount): { debt: number; headroom: number } {
  return { debt: Math.round(debtOf(stock) * 100) / 100, headroom: Math.round(Math.max(0, creditLimit(account) - debtOf(stock)) * 100) / 100 };
}

/**
 * Overlay del debito reale sui conti nazionali: il rapporto debito/PIL effettivo
 * (titoli + scoperto) diventa `debtRatioPct` e alza la tensione, logorando la
 * stabilità: la nazione che si indebita ne paga il prezzo sociale, non solo
 * quello finanziario. `debtBurdenPct` resta il rapporto di partenza, che fissa
 * il tetto di credito: il tetto non cresce da solo con il nuovo debito.
 *
 * `debtFor` restituisce `null` per le polity senza magazzino noto: si evita di
 * seminarne uno solo per leggere un numero.
 */
export function applyDebtBurdenToAccounts(
  accounts: Record<string, NationalAccount>,
  debtFor: (polityId: string) => { debtRatioPct: number; serviceRatioPct: number } | null,
): Record<string, NationalAccount> {
  const rounded = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
  const out: Record<string, NationalAccount> = {};
  for (const [polityId, account] of Object.entries(accounts)) {
    const debt = debtFor(polityId);
    if (!debt || !Number.isFinite(debt.debtRatioPct)) { out[polityId] = account; continue; }
    const { socialTension, stability } = tensionFromDebtRatio(debt.debtRatioPct, debt.serviceRatioPct);
    out[polityId] = {
      ...account,
      debtRatioPct: rounded(debt.debtRatioPct),
      debtServicePct: rounded(Math.max(0, debt.serviceRatioPct)),
      socialTension: rounded(clamp((account.socialTension || 0) + socialTension, 0, 100)),
      stability: rounded(clamp((account.stability || 0) + stability, 0, 100)),
    };
  }
  return out;
}

/** Riga leggibile per la cronaca: mostra cosa il modello ha davvero cambiato. */
export function describeNationalEffects(effects: NationalEffect[]): string[] {
  const lines: string[] = [];
  for (const effect of effects) {
    if (effect.kind === 'stock') lines.push(`${effect.resource} ${effect.delta > 0 ? '+' : ''}${Math.round(effect.delta * 100) / 100}: ${effect.reason}`);
    else if (effect.kind === 'arsenal') lines.push(`${effect.equipmentId} ${effect.delta > 0 ? '+' : ''}${effect.delta} unità: ${effect.reason}`);
    else if (effect.kind === 'modifier') lines.push(`${effect.field} ${effect.delta > 0 ? '+' : ''}${effect.delta}: ${effect.reason}`);
    else if (effect.kind === 'economy') lines.push(`entrate/crescita modificate: ${effect.reason}`);
  }
  return lines;
}
