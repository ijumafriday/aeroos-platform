import { verifyWithPublicKey, type SignatureEnvelope } from '@aeroos/signing';
import type { EventEnvelope, EventType } from '@aeroos/contracts';


export interface OperationalFlightPlanInput { flightId:string;provider:string;providerRef:string;revision:number;tail:string;etd:string;generatedAt:string;route:string;cruiseLevel?:number|null;alternate?:string|null;etopsMinutes?:number|null;redispatchPoint?:string|null;tripFuelKg:number;contingencyFuelKg:number;alternateFuelKg:number;finalReserveFuelKg:number;blockFuelKg:number;payloadKg:number;takeoffMassKg:number;landingMassKg:number;performanceRef:string;navDataCycle:string;weatherRef:string;notamRef:string;payload?:Record<string,unknown> }
export interface FrmsAssessmentInput { crewId:string;dutyId:string;provider:string;model:string;modelVersion:string;score:number;riskBand:'LOW'|'MODERATE'|'HIGH'|'CRITICAL';generatedAt:string;sourceRef:string;recommendation?:string|null;payload?:Record<string,unknown> }
export interface ProviderReceipt { id:string;sha256:string }

export interface AeroOsClientOptions { baseUrl:string; token?:string; fetch?:typeof fetch }
export class AeroOsApiError extends Error { constructor(readonly status:number,readonly body:unknown){super(`AeroOS API ${status}`)} }

export class AeroOsClient {
  private readonly http:typeof fetch;
  constructor(private readonly options:AeroOsClientOptions){this.http=options.fetch??fetch}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const headers=new Headers(init.headers);headers.set('accept','application/json');
    if(this.options.token)headers.set('authorization',`Bearer ${this.options.token}`);
    if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');
    const r=await this.http(`${this.options.baseUrl.replace(/\/$/,'')}${path}`,{...init,headers});
    const text=await r.text();let body:unknown=null;if(text){try{body=JSON.parse(text)}catch{body=text}}
    if(!r.ok)throw new AeroOsApiError(r.status,body);return body as T;
  }
  get<T>(path:string){return this.request<T>(path)}
  post<T>(path:string,body:unknown){return this.request<T>(path,{method:'POST',body:JSON.stringify(body)})}
  openApi(){return this.get<unknown>('/api/contracts/openapi')}
  asyncApi(){return this.get<unknown>('/api/contracts/asyncapi')}
  webhooks(){return this.get<unknown[]>('/api/v1/platform/integrations/webhooks')}
  createWebhook(name:string,endpoint:string,eventTypes:EventType[]){return this.post('/api/v1/platform/integrations/webhooks',{name,endpoint,eventTypes})}
  deliveries(subscriptionId:string){return this.get<unknown[]>(`/api/v1/platform/integrations/webhooks/${encodeURIComponent(subscriptionId)}/deliveries`)}
  private providerPost<T>(path:string,apiKey:string,body:unknown){return this.request<T>(path,{method:'POST',headers:{'x-api-key':apiKey},body:JSON.stringify(body)})}
  submitOperationalFlightPlan(apiKey:string,payload:OperationalFlightPlanInput){return this.providerPost<ProviderReceipt>('/api/v1/integrations/ops-planning/ofp',apiKey,payload)}
  submitFrmsAssessment(apiKey:string,payload:FrmsAssessmentInput){return this.providerPost<ProviderReceipt>('/api/v1/integrations/frms/assessments',apiKey,payload)}
}

export interface AeroOsWebhookHeaders { keyId:string;signedAt:string;payloadSha256:string;signature:string }
export function webhookHeaders(h:Headers|Record<string,string|undefined>):AeroOsWebhookHeaders{
  const get=(n:string)=>h instanceof Headers?h.get(n)??'':h[n]??h[n.toLowerCase()]??'';
  const x={keyId:get('x-aeroos-key-id'),signedAt:get('x-aeroos-signed-at'),payloadSha256:get('x-aeroos-payload-sha256'),signature:get('x-aeroos-signature')};
  if(Object.values(x).some(v=>!v))throw new Error('Missing AeroOS webhook signature header');return x;
}
export function verifyWebhook(publicKeyPem:string,payload:EventEnvelope,headers:AeroOsWebhookHeaders):boolean{
  const env:SignatureEnvelope={alg:'Ed25519',...headers};return verifyWithPublicKey(publicKeyPem,payload,env);
}
