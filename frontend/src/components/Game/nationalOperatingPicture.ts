/**
 * World Story — COUNTRY-CLARITY: National Operating Picture
 * ========================================================
 * Il punto d'ingresso della lettura: mette in fila i cinque domini del paese
 * (economia, risorse, industria, forze armate, governo), dice come sta il
 * paese in una riga e che cosa chiede attenzione per primo.
 *
 * In più compone la **sala operativa**: le risposte brevi alle domande che il
 * giocatore si fa davvero, tutte derivate dai read model qui sopra. Nessuna
 * chiamata, nessun LLM, nessun numero nuovo: solo ciò che il motore pubblica.
 */
import { formatMoney, formatNumber, formatPercent } from '../../utils/format';
import type { NationAccount, NationResources, HistoryPoint } from './NationDock/types';
import type { ArsenalResponse, Commitment, GovernmentSnapshot, NationalBudgetDetail, PeacetimePressure } from '../../services/api';
import type { CrisisSnapshot } from '../../services/api';
import type { NationalProcess } from './nationDossier';
import { economyOperatingPicture, type EconomyPicture } from './economyOperatingPicture';
import { resourceOperatingPicture, type ResourcePicture } from './resourceOperatingPicture';
import { industryOperatingPicture, type IndustryPicture } from './industryOperatingPicture';
import { governmentOperatingPicture, type GovernmentPicture } from './governmentOperatingPicture';
import { militaryOperatingPicture, type MilitaryPicture } from './militaryOperatingPicture';
import {
  DOMAIN_STATUS_LABEL, attentionFrom, finiteOrNull, statusTone, worstStatus,
  type DomainDriver, type DomainStatus, type DomainStatusLevel, type DriverTone,
} from './domainStatus';
import type { Tone } from './NationDock/types';

/** I toni del Dossier non conoscono «critical»: qui la mappa, senza ambiguità. */
const driverTone = (tone: Tone): DriverTone => (tone === 'negative' ? 'critical' : tone);

export interface OperatingDomain extends DomainStatus {
  id: 'economia' | 'risorse' | 'industria' | 'militare' | 'governo';
  label: string;
  /** Cifre chiave del dominio, già formattate. */
  facts: Array<{ label: string; value: string; tone?: DriverTone }>;
}

export interface OperatingAnswer {
  id: string;
  question: string;
  answer: string;
  detail?: string;
  tone: DriverTone;
}

export interface NationalOperatingPicture {
  status: DomainStatusLevel;
  headline: string;
  summary: string;
  domains: OperatingDomain[];
  attention: Array<DomainDriver & { domain: string }>;
  answers: OperatingAnswer[];
  economy: EconomyPicture;
  resources: ResourcePicture;
  industry: IndustryPicture;
  military: MilitaryPicture;
  government: GovernmentPicture;
}

export interface OperatingPictureInput {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  arsenal?: Partial<ArsenalResponse> | null;
  /** Risorse/assets del paese: reparti della base nazionale (`capacityBase`). */
  assets?: { capacityBase?: { forces?: number } } | null;
  government?: Partial<GovernmentSnapshot> | null;
  budget?: Partial<NationalBudgetDetail> | null;
  commitments?: { commitments: Commitment[]; attention: Commitment[] } | null;
  history?: HistoryPoint[];
  processes?: NationalProcess[] | null;
  completedProcesses?: unknown[] | null;
  maintenance?: Array<{ facilityId: string; typeName: string; operational: boolean; sufficient: boolean; resourceId: string; shortfall: string }> | null;
  crisis?: Partial<CrisisSnapshot> | null;
  pressures?: PeacetimePressure[] | null;
  today?: string | null;
}

const money = (value: number | null, decimals = 1): string => (value === null ? '—' : formatMoney(value, { currency: 'mld', decimals, sign: true }));

export function nationalOperatingPicture(input: OperatingPictureInput): NationalOperatingPicture {
  const economy = economyOperatingPicture({ account: input.account, budget: input.budget, resources: input.resources, history: input.history });
  const resources = resourceOperatingPicture(input.resources);
  const industry = industryOperatingPicture({
    account: input.account,
    resources: input.resources,
    arsenal: input.arsenal,
    processes: input.processes,
    maintenance: input.maintenance,
  });
  const military = militaryOperatingPicture({
    account: input.account,
    resources: input.resources,
    arsenal: input.arsenal,
    assets: input.assets,
  });
  const government = governmentOperatingPicture({
    government: input.government,
    commitments: input.commitments,
    stability: finiteOrNull(input.account?.stability),
    socialTension: finiteOrNull(input.account?.socialTension),
    today: input.today,
  });

  const domains: OperatingDomain[] = [
    {
      id: 'economia',
      label: 'Economia e cassa',
      status: economy.status,
      headline: economy.headline,
      drivers: economy.drivers,
      facts: [
        { label: 'PIL', value: economy.metrics.find(metric => metric.id === 'gdp')?.value === null ? '—' : formatMoney(economy.metrics.find(metric => metric.id === 'gdp')?.value ?? 0, { currency: 'mld', decimals: 0 }), tone: 'neutral' },
        { label: 'Saldo mensile', value: money(economy.balance), tone: economy.balance === null ? 'neutral' : economy.balance >= 0 ? 'positive' : 'critical' },
        { label: 'Debito', value: money(finiteOrNull(input.resources?.debt), 0), tone: (finiteOrNull(input.resources?.debt) ?? 0) > 0 ? 'warning' : 'positive' },
        { label: 'Debito / PIL', value: economy.debtRatioPct === null ? '—' : formatPercent(economy.debtRatioPct, 0), tone: economy.debtRatioPct === null ? 'neutral' : economy.debtRatioPct >= 100 ? 'critical' : economy.debtRatioPct >= 60 ? 'warning' : 'positive' },
      ],
    },
    {
      id: 'risorse',
      label: 'Risorse e magazzino',
      status: resources.status,
      headline: resources.headline,
      drivers: resources.drivers,
      facts: [
        { label: 'Carburante', value: resources.fuel?.autonomy.text ?? '—', tone: resources.fuel?.tone ?? 'neutral' },
        { label: 'Materiali sotto soglia', value: `${resources.critical.length}`, tone: resources.critical.length === 0 ? 'positive' : 'warning' },
        { label: 'Giacimenti', value: `${resources.natural.length}`, tone: 'neutral' },
        { label: 'Ricerca', value: resources.researchPoints === null ? '—' : formatNumber(resources.researchPoints), tone: 'neutral' },
      ],
    },
    {
      id: 'industria',
      label: 'Industria e produzione',
      status: industry.status,
      headline: industry.headline,
      drivers: industry.drivers,
      facts: [
        { label: 'Stabilimenti', value: formatNumber(industry.capacityTotal), tone: industry.capacityTotal > 0 ? 'neutral' : 'warning' },
        { label: 'Capacità usata', value: formatPercent(industry.usedPct, 0), tone: industry.usedPct >= 95 ? 'warning' : industry.usedPct >= 60 ? 'positive' : 'neutral' },
        { label: 'Linee libere', value: formatNumber(industry.capacityFree), tone: industry.capacityFree > 0 ? 'positive' : 'warning' },
        { label: 'Lavorazioni attive', value: formatNumber(industry.assignments.length), tone: 'neutral' },
      ],
    },
    {
      id: 'militare',
      label: 'Forze armate',
      status: military.status,
      headline: military.headline,
      drivers: military.drivers,
      facts: [
        { label: 'Reparti in armi', value: military.manpower ? formatNumber(military.manpower.standing) : '—', tone: military.manpower && military.manpower.standing > 0 ? 'neutral' : 'warning' },
        { label: 'Prontezza', value: `${military.readiness.readinessPct}%`, tone: statusTone(military.readiness.status) },
        { label: 'Copertura armi individuali', value: `${military.coverage.find(row => row.id === 'individualWeapons')?.pct ?? 0}%`, tone: military.coverage.find(row => row.id === 'individualWeapons')?.tone ?? 'neutral' },
        { label: 'Prodotti in casa', value: `${military.procurement.filter(row => row.domestic).length}`, tone: 'neutral' },
      ],
    },
    {
      id: 'governo',
      label: 'Governo e società',
      status: government.status,
      headline: government.headline,
      drivers: government.drivers,
      facts: [
        { label: 'Stabilità', value: government.stability === null ? '—' : formatPercent(government.stability, 0), tone: government.stability === null ? 'neutral' : government.stability >= 55 ? 'positive' : government.stability >= 40 ? 'warning' : 'critical' },
        { label: 'Tensione sociale', value: government.socialTension === null ? '—' : formatPercent(government.socialTension, 0), tone: government.socialTension === null ? 'neutral' : government.socialTension >= 55 ? 'critical' : government.socialTension >= 35 ? 'warning' : 'positive' },
        { label: 'Fazioni che sostengono', value: `${government.supporting.length}`, tone: government.supporting.length > 0 ? 'positive' : 'warning' },
        { label: 'Fazioni insoddisfatte', value: `${government.unsatisfied.length}`, tone: government.unsatisfied.length === 0 ? 'positive' : 'warning' },
      ],
    },
  ];

  const status = worstStatus(domains.map(domain => domain.status));
  const attention = attentionFrom(domains, 5);
  const worst = [...domains].sort((a, b) => domains.indexOf(b) - domains.indexOf(a)).find(domain => domain.status === status) ?? domains[0];

  const headline = status === 'healthy'
    ? 'Il paese tiene: nessun dominio in difficoltà.'
    : status === 'stable'
      ? 'Situazione sotto controllo, con margini da difendere.'
      : `Il punto debole è ${worst.label.toLowerCase()}: ${worst.headline}`;

  const summary = `${DOMAIN_STATUS_LABEL[status]} · ${attention.length === 0 ? 'nessuna attenzione urgente' : `${attention.length} attenzioni da decidere`}`;

  const answers = operatingAnswers({ economy, resources, industry, military, government, input, status, attention });

  return { status, headline, summary, domains, attention, answers, economy, resources, industry, military, government };
}

/**
 * Sala operativa: le risposte brevi alle domande del giocatore. Ogni risposta
 * cita il numero del motore da cui deriva; se il dato non esiste, lo dice.
 */
function operatingAnswers(args: {
  economy: EconomyPicture;
  resources: ResourcePicture;
  industry: IndustryPicture;
  military: MilitaryPicture;
  government: GovernmentPicture;
  input: OperatingPictureInput;
  status: DomainStatusLevel;
  attention: Array<DomainDriver & { domain: string }>;
}): OperatingAnswer[] {
  const { economy, resources, industry, military, government, input, status, attention } = args;
  const answers: OperatingAnswer[] = [];

  answers.push({
    id: 'situazione',
    question: 'Come sta il paese?',
    answer: `${DOMAIN_STATUS_LABEL[status]}`,
    tone: statusTone(status),
    detail: attention.length > 0 ? `Prima attenzione: ${attention[0].label} (${attention[0].domain}).` : 'Nessuna attenzione urgente.',
  });

  answers.push({
    id: 'problema',
    question: 'Qual è il problema più urgente?',
    answer: attention.length > 0 ? attention[0].label : 'Nessun problema urgente',
    tone: attention.length > 0 ? attention[0].tone : 'positive',
    detail: attention.length > 0 ? attention[0].detail ?? attention[0].domain : 'Tutti i domini sono sopra le soglie di allerta.',
  });

  if (military.manpower) {
    const reparti = (value: number) => `${formatNumber(value)} ${value === 1 ? 'reparto' : 'reparti'}`;
    answers.push({
      id: 'manpower',
      question: 'Quante forze ho sotto le armi?',
      answer: `${reparti(military.manpower.standing)} sotto le armi`,
      tone: military.manpower.standing > 0 ? 'neutral' : 'warning',
      detail: `${formatNumber(military.manpower.active)} in servizio permanente · ${formatNumber(military.manpower.mobilized)} richiamati${military.manpower.baseline !== null ? ` · base nazionale ${formatNumber(military.manpower.baseline)}` : ''}. Il motore conta reparti, non teste: la conversione in uomini non è modellata.`,
    });
    answers.push({
      id: 'mobilitati',
      question: 'Quanti reparti sono mobilitati?',
      answer: reparti(military.manpower.mobilized),
      tone: military.manpower.mobilized > 0 ? 'warning' : 'positive',
      detail: military.manpower.mobilized > 0
        ? `${formatPercent(military.manpower.mobilizedPct, 1)} delle forze in armi è richiamata e consuma scorte per diventare operativa.`
        : 'Nessuna riserva richiamata: la forza permanente basta al momento.',
    });
  } else {
    answers.push({
      id: 'manpower',
      question: 'Quante forze ho sotto le armi?',
      answer: 'Dato non pubblicato',
      tone: 'neutral',
      detail: 'Il motore non espone reparti in armi per questa partita.',
    });
  }

  const equipped = military.coverage.filter(row => row.actual > 0);
  answers.push({
    id: 'equipaggiamenti',
    question: 'Con quali equipaggiamenti combattono?',
    answer: equipped.length > 0 ? `${equipped.length} categorie in servizio` : 'Nessun equipaggiamento in servizio',
    tone: equipped.length > 0 ? 'neutral' : 'warning',
    detail: equipped.length > 0
      ? equipped.map(row => `${row.label} ×${formatNumber(row.actual)}`).join(' · ') + '.'
      : 'Costruisci o importa dal catalogo della sezione Forze armate.',
  });

  const weakest = [...military.coverage].sort((a, b) => a.pct - b.pct)[0];
  answers.push({
    id: 'sufficienza',
    question: 'Sono equipaggiati a sufficienza?',
    answer: weakest ? `Copertura più debole: ${weakest.pct}%` : 'Dato non disponibile',
    tone: weakest?.tone ?? 'neutral',
    detail: weakest
      ? `${weakest.label}: ${formatNumber(weakest.actual)} in servizio su ${formatNumber(weakest.required)} della dotazione di riferimento.`
      : 'Il motore non pubblica l’arsenale di questa partita.',
  });

  answers.push({
    id: 'carburante',
    question: 'Quanto carburante possiedo?',
    answer: resources.fuel ? resources.fuel.autonomy.text : 'Dato non pubblicato',
    tone: resources.fuel?.tone ?? 'neutral',
    detail: resources.fuel
      ? `Scorta ${formatNumber(resources.fuel.stock ?? 0)}${resources.fuel.capacity ? ` su un tetto di ${formatNumber(resources.fuel.capacity)}` : ''} · consumo ${formatNumber(resources.fuel.consumptionPerMonth ?? 0)}/mese.`
      : 'Il bilancio materiale del carburante non è pubblicato.',
  });

  answers.push({
    id: 'operazioni',
    question: 'Quanto tempo posso sostenere le operazioni?',
    answer: `Prontezza ${military.readiness.readinessPct}%`,
    tone: statusTone(military.readiness.status),
    detail: military.readiness.drivers.filter(driver => driver.tone !== 'positive')[0]?.label
      ?? 'Nessun vincolo materiale rilevante: copertura, carburante e scorte sono sopra le soglie.',
  });

  answers.push({
    id: 'fabbriche',
    question: 'Che cosa producono le mie fabbriche?',
    answer: industry.assignments.length > 0
      ? `${industry.assignments.length} lavorazioni su ${industry.capacityTotal} stabilimenti`
      : 'Nessuna lavorazione attiva',
    tone: industry.assignments.length > 0 ? 'neutral' : 'warning',
    detail: industry.assignments.length > 0
      ? industry.assignments.slice(0, 3).map(item => `${item.label} (${item.sector})`).join(' · ') + '.'
      : 'Le linee sono libere: avvia un ordine di produzione o un progetto.',
  });

  answers.push({
    id: 'capacita',
    question: 'Quanto della capacità industriale sto usando?',
    answer: `${formatPercent(industry.usedPct, 0)}`,
    tone: industry.usedPct >= 95 ? 'warning' : industry.usedPct >= 60 ? 'positive' : 'neutral',
    detail: `${industry.capacityUsed} linee occupate, ${industry.capacityFree} libere su ${industry.capacityTotal} stabilimenti.`,
  });

  const domestic = military.procurement.filter(row => row.domestic);
  const inProduction = military.procurement.filter(row => row.inProduction > 0);
  answers.push({
    id: 'produzione-interna',
    question: 'Quali armi produco internamente?',
    answer: domestic.length > 0 ? `${domestic.length} sistemi producibili` : 'Nessun sistema producibile',
    tone: domestic.length > 0 ? 'positive' : 'warning',
    detail: inProduction.length > 0
      ? `In costruzione adesso: ${inProduction.map(row => `${row.name} ×${formatNumber(row.inProduction)}`).join(', ')}.`
      : domestic.slice(0, 3).map(row => row.name).join(' · ') + (domestic.length > 3 ? ' …' : ''),
  });

  const importOnly = military.procurement.filter(row => !row.canBuild && row.canBuy);
  answers.push({
    id: 'importazioni',
    question: 'Quali devo importare?',
    answer: importOnly.length > 0 ? `${importOnly.length} sistemi solo dall’estero` : 'Nessuna dipendenza obbligata',
    tone: importOnly.length > 0 ? 'warning' : 'positive',
    detail: importOnly.length > 0
      ? importOnly.slice(0, 3).map(row => row.name).join(' · ') + (importOnly.length > 3 ? ' …' : '')
      : 'Tutto ciò che è in servizio è producibile in casa o già acquisito.',
  });

  // Ricerca e infrastrutture: le due leve che non hanno una sezione propria.
  const technologies = Array.isArray(input.resources?.technologies) ? input.resources!.technologies! : [];
  answers.push({
    id: 'ricerca',
    question: 'Quanta ricerca ho e che cosa ho sbloccato?',
    answer: resources.researchPoints === null ? 'Ricerca non pubblicata' : `${formatNumber(resources.researchPoints)} punti ricerca`,
    tone: resources.researchPoints === null ? 'neutral' : 'neutral',
    detail: `${formatNumber(finiteOrNull(input.account?.universities) ?? 0)} atenei · ${technologies.length > 0 ? `${technologies.length} tecnologie sbloccate` : 'nessuna tecnologia sbloccata'}.`,
  });
  answers.push({
    id: 'infrastrutture',
    question: 'Che infrastrutture ho?',
    answer: `${formatNumber(industry.capacityTotal)} stabilimenti · ${formatNumber(industry.ports)} porti · ${formatNumber(industry.universities)} atenei`,
    tone: 'neutral',
    detail: input.account?.capacitySources
      ? `Base nazionale calcolata dal motore: ${input.account.capacitySources}.`
      : 'Fabbriche, porti e atenei sono quelli del conto nazionale e della mappa.',
  });

  answers.push({
    id: 'economia',
    question: 'Quanto produce e quanto spende il paese?',
    answer: economy.balance === null ? 'Bilancio non pubblicato' : `${economy.diagnosis.title}`,
    tone: economy.diagnosis.tone,
    detail: economy.diagnosis.detail,
  });

  answers.push({
    id: 'debito',
    question: 'Sto accumulando debito?',
    answer: finiteOrNull(input.resources?.debt) !== null && (finiteOrNull(input.resources?.debt) ?? 0) > 0
      ? `${money(finiteOrNull(input.resources?.debt), 0)} (${economy.debtRatioPct === null ? '—' : formatPercent(economy.debtRatioPct, 0)} del PIL)`
      : 'Nessun debito pubblico',
    tone: (economy.debtRatioPct ?? 0) >= 100 ? 'critical' : (economy.balance ?? 0) < 0 ? 'warning' : 'positive',
    detail: economy.balance !== null && economy.balance < 0
      ? `Con un disavanzo di ${money(economy.balance)} al mese il debito cresce dello stesso ordine ogni mese.`
      : 'Il saldo non alimenta nuovo debito.',
  });

  answers.push({
    id: 'sostegno',
    question: 'Quale fazione politica mi sostiene?',
    answer: government.supporting.length > 0
      ? `${government.supporting[0].name} (${formatPercent(government.supporting[0].satisfaction, 0)})`
      : government.dominant ? `${government.dominant.name}: appoggio tiepido` : 'Nessuna fazione pubblicata',
    tone: government.supporting.length > 0 ? 'positive' : 'neutral',
    detail: government.supporting.length > 0
      ? government.supporting.map(faction => `${faction.name} ${formatPercent(faction.satisfaction, 0)}`).join(' · ') + '.'
      : 'Nessuna fazione è sopra la soglia di sostegno dichiarato.',
  });

  answers.push({
    id: 'opposizione',
    question: 'Quale fazione è arrabbiata e perché?',
    answer: government.unsatisfied.length > 0
      ? `${government.unsatisfied[0].name} (${formatPercent(government.unsatisfied[0].satisfaction, 0)})`
      : 'Nessuna fazione insoddisfatta',
    tone: government.unsatisfied.length > 0 ? 'warning' : 'positive',
    detail: government.unsatisfied.length > 0
      ? (government.unsatisfied[0].grievance ?? `Chiede: ${government.unsatisfied[0].demand}.`)
      : 'Tutte le fazioni sono almeno neutrali.',
  });

  const processes = input.processes ?? [];
  const blocked = industry.assignments.filter(item => item.blocker);
  answers.push({
    id: 'progetti',
    question: 'Quali progetti sono in corso e cosa li rallenta?',
    answer: processes.length > 0 ? `${processes.length} progetti attivi` : 'Nessun progetto in corso',
    tone: blocked.length > 0 ? 'warning' : 'neutral',
    detail: processes.length > 0
      ? blocked.length > 0
        ? `Rallentati: ${blocked.slice(0, 2).map(item => `${item.label} (${item.blocker})`).join(' · ')}.`
        : `In corso: ${processes.slice(0, 3).map(process => process.title).join(' · ')}${processes.length > 3 ? ' …' : ''}.`
      : 'Apri la sezione Progetti per avviarne uno.',
  });

  answers.push({
    id: 'promesse',
    question: 'Quali promesse sto mantenendo o tradendo?',
    answer: `${government.promises.kept} mantenute · ${government.promises.open} aperte${government.promises.broken > 0 ? ` · ${government.promises.broken} tradite` : ''}`,
    tone: government.promises.broken > government.promises.kept ? 'warning' : 'neutral',
    detail: government.promises.dueSoon > 0
      ? `${government.promises.dueSoon} impegni scadono entro 30 giorni.`
      : 'Nessuna scadenza imminente nel registro degli impegni.',
  });

  return answers;
}
