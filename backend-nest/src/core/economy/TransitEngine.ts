/** M04 µ4 — spedizioni: custodia transito, consegna/loss idempotenti (§6.4). */
import { IntString,intToString,parseInteger } from '../../domain/quantities';
export type ShipmentStatus='planned'|'in_transit'|'blocked'|'delivered'|'lost';
export interface Shipment { readonly id:string; readonly resourceId:string; readonly quantity:IntString; readonly ownerRef:string; readonly originRef:string; readonly destinationRef:string; readonly carrierRef:string; readonly departureDate:string; readonly arrivalDate:string; readonly status:ShipmentStatus; }
export interface PhysicalMovement { readonly cause:'partenza'|'consegna'|'perdita'; readonly resourceId:string; readonly fromRef:string; readonly toRef:string|null; readonly quantity:IntString; }
export interface ShipmentTransition { readonly shipment:Shipment; readonly movements:readonly PhysicalMovement[]; }
function transitRef(s:Shipment){return `transit:${s.id}`;}
/** Partenza: proprietà resta al seller, custodia diventa transit/carrier; retry no-op. */
export function departShipment(s:Shipment,date:string,originAvailable:IntString,transportAvailable:boolean):ShipmentTransition{if(s.status!=='planned'&&s.status!=='blocked')return{shipment:s,movements:[]};if(date<s.departureDate||!transportAvailable||parseInteger(originAvailable,'origin')<parseInteger(s.quantity,'quantity'))return{shipment:{...s,status:'blocked'},movements:[]};return{shipment:{...s,status:'in_transit'},movements:[{cause:'partenza',resourceId:s.resourceId,fromRef:s.originRef,toRef:transitRef(s),quantity:s.quantity}]};}
/** Nessun arrivo anticipato: il lotto in transito non è stock utilizzabile del buyer. */
export function deliverShipment(s:Shipment,date:string):ShipmentTransition{if(s.status!=='in_transit'||date<s.arrivalDate)return{shipment:s,movements:[]};return{shipment:{...s,status:'delivered'},movements:[{cause:'consegna',resourceId:s.resourceId,fromRef:transitRef(s),toRef:s.destinationRef,quantity:s.quantity}]};}
/** Perdita esplicita: non ricrea merce; retry no-op. */
export function loseShipment(s:Shipment):ShipmentTransition{if(s.status!=='in_transit')return{shipment:s,movements:[]};return{shipment:{...s,status:'lost'},movements:[{cause:'perdita',resourceId:s.resourceId,fromRef:transitRef(s),toRef:null,quantity:s.quantity}]};}
/** Applica movimento a una proiezione stock per test/engine, senza Number. */
export function applyPhysicalMovements(stock:Readonly<Record<string,IntString>>,moves:readonly PhysicalMovement[]):Record<string,IntString>{const next:Record<string,IntString>={...stock};for(const m of moves){const q=parseInteger(m.quantity,'quantity');next[m.fromRef]=intToString(parseInteger(next[m.fromRef]??'0','stock')-q);if(m.toRef)next[m.toRef]=intToString(parseInteger(next[m.toRef]??'0','stock')+q);}return next;}
