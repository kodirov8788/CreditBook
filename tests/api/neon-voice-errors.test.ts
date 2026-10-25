import {describe,expect,it,vi} from 'vitest';
import {createNeonVoiceHandler} from '@/lib/api/neon-voice';
import type {VoiceProviderFailure} from '@/lib/ai/voice-provider';
import {VOICE_CONSENT_VERSION} from '@/lib/personal-finance/voice-contract';
vi.mock('next/headers',()=>({cookies:vi.fn(),headers:vi.fn()}));
vi.mock('@/lib/data/neon-personal',()=>({createNeonPersonalRepository:()=>({categories:async()=>({categories:[],nextOffset:null})})}));
const a={id:'11111111-1111-4111-8111-111111111111',email:'a@fixture.invalid'};
const config={origin:'http://localhost:4193',baseUrl:'https://auth.fixture.invalid',cookieSecret:'synthetic-only-secret'.repeat(3),identities:[a]};
describe('voice provider failures do not become user auth failures',()=>{
 it.each<VoiceProviderFailure>(['AI_PROVIDER_AUTH','AI_PROVIDER_BUDGET','AI_PROVIDER_BUSY','AI_PROVIDER_TIMEOUT','AI_UNAVAILABLE'])('returns an actionable private 503 for %s without a token/body leak',async failure=>{
  const finish=vi.fn(async()=>{});
  const infer=vi.fn(async()=>({draft:null,cost:null,failure}));
  const handler=createNeonVoiceHandler(config,{verify:async()=>({ok:true,user:a}),runtime:()=>({issuer:config.baseUrl,execute:async()=>[]}),infer,budget:()=>({reserve:async()=>({granted:true,reason:'ready',remainingMicros:'4000000'}),finish})});
  const res=await handler(new Request(config.origin+'/api/personal/voice-draft',{method:'POST',headers:{Host:'localhost:4193',Origin:config.origin,'Content-Type':'application/json','X-CreditBook-Owner':a.id},body:JSON.stringify({mode:'text',text:'Synthetic 100 yen',requestId:'22222222-2222-4222-8222-222222222222',defaultKind:'expense',consent:VOICE_CONSENT_VERSION})}));
  expect(res.status).toBe(503);expect(await res.json()).toEqual({ok:false,code:failure});expect(res.headers.get('cache-control')).toBe('private, no-store');expect(infer).toHaveBeenCalledOnce();expect(finish).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222',null);
 });
});
