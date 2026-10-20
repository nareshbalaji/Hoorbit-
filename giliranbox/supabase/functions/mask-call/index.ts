// Edge Function: masked call. Verifies the caller is a participant of an active job (RLS does the check),
// then returns a proxy number so neither side sees the other's real phone number.
// PLACEHOLDER: wire PROXY_NUMBER_POOL to a telephony proxy (e.g. Twilio Proxy / Vonage) before launch.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { job_id } = await req.json()
  const { data: job } = await sb.from('jobs').select('id,status,provider_id').eq('id', job_id).maybeSingle()
  if (!job || !job.provider_id || ['done', 'cancelled', 'expired'].includes(job.status)) {
    return new Response(JSON.stringify({ message: 'not_allowed' }), { status: 403, headers: { 'content-type': 'application/json' } })
  }
  const pool = (Deno.env.get('PROXY_NUMBER_POOL') ?? '').split(',').filter(Boolean)
  if (!pool.length) return new Response(JSON.stringify({ message: 'masked_call_not_configured' }), { status: 501, headers: { 'content-type': 'application/json' } })
  // TODO(telephony): create a proxy session binding (customer, provider) to a pool number for the life of the job.
  return new Response(JSON.stringify({ number: pool[0] }), { headers: { 'content-type': 'application/json' } })
})
