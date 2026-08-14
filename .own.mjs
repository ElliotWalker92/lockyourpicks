import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const to=process.argv[2];
const {data:p}=await admin.from('profiles').select('id,display_name,email').eq('email',to).single();
const {data:lg}=await admin.from('leagues').select('id').eq('join_code','SUNDAY').single();
await admin.from('leagues').update({owner_id:p.id}).eq('id',lg.id);
console.log(`owner -> ${p.display_name} <${p.email}>`);
