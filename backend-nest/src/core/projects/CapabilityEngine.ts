/** M05 µ3 — capability graph: conoscenza/progetto/uso ≠ fabbricazione (§7.3). */
export type CapabilityKind='knowledge'|'design'|'manufacture'|'operate'|'maintain';
export interface CapabilityNode { readonly id:string; readonly kind:CapabilityKind; readonly requires:readonly string[]; }
export interface CapabilityAssessment { readonly allowed:boolean; readonly missing:readonly string[]; }
export class CapabilitySchemaError extends Error { constructor(message:string){super(message);this.name='CapabilitySchemaError';} }
function map(nodes:readonly CapabilityNode[]){const by=new Map(nodes.map(n=>[n.id,n]));if(by.size!==nodes.length)throw new CapabilitySchemaError('capability ID duplicato');for(const n of nodes)for(const r of n.requires)if(!by.has(r))throw new CapabilitySchemaError('prerequisito capability sconosciuto');return by;}
/** Verifica chiusura transitiva: avere un leaf senza i suoi requires non basta. */
export function assessCapability(nodes:readonly CapabilityNode[],granted:ReadonlySet<string>,targetId:string):CapabilityAssessment{const by=map(nodes);const target=by.get(targetId);if(!target)throw new CapabilitySchemaError('capability sconosciuta');const missing=new Set<string>();const visit=(id:string):void=>{if(!granted.has(id))missing.add(id);for(const r of by.get(id)?.requires??[])visit(r);};visit(target.id);return{allowed:missing.size===0,missing:[...missing].sort()};}
/** Contratto import: può aggiungere SOLO operate/maintain esplicitamente concessi. */
export function grantImportedCapabilities(nodes:readonly CapabilityNode[],granted:ReadonlySet<string>,contractualIds:readonly string[]):ReadonlySet<string>{const by=map(nodes);const next=new Set(granted);for(const id of contractualIds){const node=by.get(id);if(!node)throw new CapabilitySchemaError('capability import sconosciuta');if(node.kind!=='operate'&&node.kind!=='maintain')throw new CapabilitySchemaError('import non concede design/manufacture');next.add(id);}return next;}
