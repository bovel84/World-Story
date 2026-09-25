/**
 * World Story — M01: l'area «Popolo» del quadro d'insieme
 * ======================================================
 * Il quadro d'insieme del dossier aveva cinque aree: economia, risorse,
 * industria, forze armate, governo. La **qualità della vita** non era un'area:
 * chi voleva governare per il benessere del proprio popolo — istruzione,
 * sanità, ricerca, tenore di vita — non aveva un posto dove leggere se stava
 * ottenendo qualcosa. Le uniche cifre sociali comparivano dentro «Coesione
 * interna», e due delle tre erano rimandi.
 *
 * Questa area legge i dati che il motore **già pubblica** e che nessuna scheda
 * metteva in fila: la spesa sociale e per l'istruzione (`socialBurdenPct`,
 * `educationBurdenPct`), gli atenei, il tenore di vita (`gdpPerCapitaUsd`), la
 * ricerca accumulata e la tenuta interna (`stability`, `socialTension`). Nessuna
 * cifra nuova, nessuna chiamata in più: è una **lettura**, come lo sono le altre
 * cinque aree.
 *
 * Le soglie sono dichiarate qui e coperte dai test. Il giudizio non è un'opinione
 * sul valore di una società: misura se il paese **investe** nel proprio popolo e
 * se il popolo **regge**.
 */
import { formatNumber, formatPercent } from '../../utils/format';
import type { NationAccount, NationResources } from './NationDock/types';
import { finiteOrNull, round1, sharePct, type DomainDriver, type DomainStatus } from './domainStatus';

export interface PeoplePicture extends DomainStatus {
  /** Spesa sociale (sanità + sostegno) in % del PIL, dal motore. */
  socialBurdenPct: number | null;
  /** Spesa per istruzione e ricerca in % del PIL, dal motore. */
  educationBurdenPct: number | null;
  /** Spesa militare in % del PIL, per il confronto che il giocatore vuole fare. */
  defenceBurdenPct: number | null;
  /** Atenei: producono la ricerca. */
  universities: number | null;
  /** Popolazione. */
  population: number | null;
  /** Tenore di vita: PIL pro capite stimato dal motore. */
  gdpPerCapiteUsd: number | null;
  /** Punti ricerca accumulati e non ancora spesi. */
  researchPoints: number | null;
  /** Tecnologie già sbloccate: quante. */
  technologiesUnlocked: number | null;
  stability: number | null;
  socialTension: number | null;
  /**
   * Quanto della spesa pubblica va al popolo invece che alle armi.
   * `null` quando il motore non pubblica le voci: mai un rapporto inventato.
   */
  civilianShareOfSpendingPct: number | null;
}

export interface PeopleInput {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  budget?: { socialBurdenPct?: number; educationBurdenPct?: number; defenceBurdenPct?: number } | null;
}

/** Soglie dichiarate della spesa civile, in % del PIL. */
export const CIVIL_SPENDING_THRESHOLDS = {
  /** Sotto questa quota il popolo non è una priorità di bilancio. */
  thin: 4,
  /** Da qui in su l'investimento civile è sostanziale. */
  substantial: 8,
  /** Da qui in su è la voce che caratterizza il paese. */
  leading: 13,
} as const;

/** Quota di spesa militare oltre la quale l'apparato pesa sulla società. */
export const HEAVY_DEFENCE_PCT = 8;

const toneForCivilSpending = (pct: number | null): 'positive' | 'warning' | 'critical' | 'neutral' => {
  if (pct === null) return 'neutral';
  if (pct >= CIVIL_SPENDING_THRESHOLDS.substantial) return 'positive';
  if (pct >= CIVIL_SPENDING_THRESHOLDS.thin) return 'neutral';
  return 'warning';
};

export function peopleOperatingPicture(input: PeopleInput): PeoplePicture {
  const account = input.account ?? null;
  const resources = input.resources ?? null;
  const budget = input.budget ?? null;

  const socialBurdenPct = finiteOrNull(budget?.socialBurdenPct);
  const educationBurdenPct = finiteOrNull(budget?.educationBurdenPct);
  const defenceBurdenPct = finiteOrNull(budget?.defenceBurdenPct) ?? finiteOrNull(account?.defenceBurdenPct);
  const universities = finiteOrNull(account?.universities);
  const population = finiteOrNull(account?.population);
  const gdpPerCapiteUsd = finiteOrNull(account?.gdpPerCapitaUsd);
  const researchPoints = finiteOrNull(resources?.research);
  const technologiesUnlocked = Array.isArray(resources?.technologies) ? resources!.technologies!.length : null;
  const stability = finiteOrNull(account?.stability);
  const socialTension = finiteOrNull(account?.socialTension);

  // Quota civile sul totale delle due voci dichiarate. Se il motore non
  // pubblica **entrambe**, il rapporto non è calcolabile: `null`, non una stima.
  const civilTotal = socialBurdenPct !== null && educationBurdenPct !== null ? socialBurdenPct + educationBurdenPct : null;
  const civilianShareOfSpendingPct = (civilTotal !== null && defenceBurdenPct !== null)
    ? round1(sharePct(civilTotal, civilTotal + defenceBurdenPct) ?? 0)
    : null;

  const drivers: DomainDriver[] = [];

  if (civilTotal !== null) {
    drivers.push({
      tone: toneForCivilSpending(civilTotal),
      label: `Spesa civile ${formatPercent(civilTotal, 1)} del PIL`,
      detail: civilTotal >= CIVIL_SPENDING_THRESHOLDS.substantial
        ? 'Istruzione, sanità e sostegno sono una voce sostanziale del bilancio.'
        : civilTotal >= CIVIL_SPENDING_THRESHOLDS.thin
          ? 'Investimento civile presente ma non dominante.'
          : 'Al popolo va una quota sottile del bilancio: istruzione, sanità e sostegno sono ai minimi.',
    });
  }
  if (civilianShareOfSpendingPct !== null && defenceBurdenPct !== null) {
    drivers.push({
      tone: civilianShareOfSpendingPct >= 60 ? 'positive' : civilianShareOfSpendingPct >= 40 ? 'neutral' : 'warning',
      label: `${formatPercent(civilianShareOfSpendingPct, 0)} della spesa va al civile`,
      detail: `Spesa militare ${formatPercent(defenceBurdenPct, 1)} del PIL: ${defenceBurdenPct >= HEAVY_DEFENCE_PCT ? 'l\'apparato pesa sul bilancio civile.' : 'il confronto regge.'}`,
    });
  } else if (defenceBurdenPct !== null) {
    drivers.push({
      tone: defenceBurdenPct >= HEAVY_DEFENCE_PCT ? 'warning' : 'neutral',
      label: `Spesa militare ${formatPercent(defenceBurdenPct, 1)} del PIL`,
      detail: 'Per il confronto con la spesa civile serve che il motore pubblichi le voci sociali.',
    });
  }

  if (universities !== null && universities > 0) {
    drivers.push({
      tone: 'positive',
      label: `${formatNumber(universities)} atenei`,
      detail: 'Producono la ricerca che sblocca le tecnologie.',
    });
  } else if (universities !== null) {
    drivers.push({
      tone: 'warning',
      label: 'Nessun ateneo',
      detail: 'Senza atenei la ricerca cresce solo con la popolazione.',
    });
  }

  if (researchPoints !== null) {
    drivers.push({
      tone: researchPoints > 0 ? 'positive' : 'neutral',
      label: `${formatNumber(researchPoints)} punti ricerca`,
      detail: technologiesUnlocked !== null
        ? `${formatNumber(technologiesUnlocked)} tecnologie sbloccate su questo scenario.`
        : 'Accumulati e non ancora spesi.',
    });
  }

  if (gdpPerCapiteUsd !== null) {
    drivers.push({
      tone: 'neutral',
      label: `PIL pro capite ${formatNumber(gdpPerCapiteUsd)}`,
      detail: 'Tenore di vita medio, in dollari di oggi (stima del motore).',
    });
  }

  if (socialTension !== null) {
    drivers.push({
      tone: socialTension >= 55 ? 'critical' : socialTension >= 35 ? 'warning' : 'positive',
      label: `Tensione sociale ${formatPercent(socialTension, 0)}`,
      detail: socialTension >= 55
        ? 'Il malessere della popolazione è una minaccia alla tenuta.'
        : 'Il paese regge senza fratture gravi.',
    });
  }
  if (stability !== null) {
    drivers.push({
      tone: stability >= 55 ? 'positive' : stability >= 40 ? 'warning' : 'critical',
      label: `Stabilità ${formatPercent(stability, 0)}`,
      detail: 'Consenso e tenuta delle istituzioni.',
    });
  }

  if (drivers.length === 0) {
    drivers.push({
      tone: 'neutral',
      label: 'Dati sociali non pubblicati',
      detail: 'Questo scenario non espone spesa civile né Atenei: l\'area resta vuota invece di inventare.',
    });
  }

  // Stato: il popolo si legge dal punto debole (tensione) e dalla tenuta.
  const strain = Math.max(socialTension ?? 0, 0);
  let status: PeoplePicture['status'] = 'stable';
  if (strain >= 70 || (stability !== null && stability < 25)) status = 'critical';
  else if (strain >= 55 || (stability !== null && stability < 40)) status = 'fragile';
  else if (strain >= 35 || (civilTotal !== null && civilTotal < CIVIL_SPENDING_THRESHOLDS.thin)) status = 'pressure';
  else if (strain < 20 && civilTotal !== null && civilTotal >= CIVIL_SPENDING_THRESHOLDS.substantial && stability !== null && stability >= 55) status = 'healthy';

  const headline = civilTotal !== null
    ? `Al popolo va il ${formatPercent(civilTotal, 1)} del PIL${civilianShareOfSpendingPct !== null ? `, il ${formatPercent(civilianShareOfSpendingPct, 0)} della spesa` : ''}.`
    : socialTension !== null
      ? `Tensione sociale al ${formatPercent(socialTension, 0)}; il motore non pubblica la spesa civile.`
      : 'Questo scenario non pubblica dati sulla popolazione.';

  return {
    status,
    headline,
    drivers,
    socialBurdenPct,
    educationBurdenPct,
    defenceBurdenPct,
    universities,
    population,
    gdpPerCapiteUsd,
    researchPoints,
    technologiesUnlocked,
    stability,
    socialTension,
    civilianShareOfSpendingPct,
  };
}
