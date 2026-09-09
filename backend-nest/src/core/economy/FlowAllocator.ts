/** M04 µ3 — capacità di flusso riassegnata ogni giorno (§6.2). */
import { IntString,intToString,parseInteger } from '../../domain/quantities';
export interface FlowDemand { readonly projectId:string; readonly priority:number; readonly queueSequence:number; readonly requested:IntString; readonly eligible:boolean; }
export interface FlowAllocation { readonly projectId:string; readonly granted:IntString; readonly blocked:boolean; }
/**
 * Allocazione SOLO per l'intervallo corrente: ordine priority/queue stabile.
 * Un progetto già bloccato non trattiene alcuna quota; il chiamante ricrea
 * integralmente la domanda il giorno seguente (nessuna riserva perpetua).
 */
export function allocateDailyFlow(capacity:IntString,demands:readonly FlowDemand[]):readonly FlowAllocation[]{let free=parseInteger(capacity,'capacity');if(free<0n)throw new Error('capacity negativa');const byId=new Map<string,FlowAllocation>();for(const d of [...demands].sort((a,b)=>a.priority-b.priority||a.queueSequence-b.queueSequence)){const requested=parseInteger(d.requested,`requested.${d.projectId}`);if(requested<0n)throw new Error('requested negativa');const granted=d.eligible?(requested<free?requested:free):0n;if(d.eligible)free-=granted;byId.set(d.projectId,{projectId:d.projectId,granted:intToString(granted),blocked:!d.eligible});}return demands.map(d=>byId.get(d.projectId) as FlowAllocation);}
