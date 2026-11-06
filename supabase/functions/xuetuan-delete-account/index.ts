import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { makeDeleteAccountHandler } from './handler.mjs';

Deno.serve(makeDeleteAccountHandler({
  createClient,
  url: Deno.env.get('SUPABASE_URL')!,
  key: Deno.env.get('SUPABASE_ANON_KEY')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
}));
