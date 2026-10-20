// Edge Function: drains `outbox` rows to Firebase Cloud Messaging (HTTP v1).
// Trigger: Database Webhook on INSERT into public.outbox -> POST here with header `x-webhook-secret`.
// Secrets: FCM_SERVICE_ACCOUNT (service-account JSON), WEBHOOK_SECRET. SUPABASE_URL / SERVICE_ROLE are injected.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { compose } from './messages.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let cached: { token: string; exp: number } | null = null
async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const pem = sa.private_key.replace(/-----[^-]+-----|\s/g, '')
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  })
  const j = await r.json()
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return cached.token
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 })
  const { record } = await req.json() as { record: { id: number; user_id: string; kind: string; data: Record<string, unknown> } }
  const { data: prof } = await sb.from('profiles').select('lang').eq('id', record.user_id).single()
  const msg = compose(record.kind, record.data, prof?.lang ?? 'ms')
  const { data: toks } = await sb.from('device_tokens').select('token').eq('user_id', record.user_id)
  if (!msg || !toks?.length) { await sb.from('outbox').delete().eq('id', record.id); return new Response('skipped') }

  const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!)
  const bearer = await accessToken(sa)
  let delivered = 0
  for (const { token } of toks) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        notification: { title: msg.title, body: msg.body },
        data: { kind: record.kind, ...Object.fromEntries(Object.entries(record.data).map(([k, v]) => [k, String(v)])) },
        // high priority + default sound = job alert sound even when the app is closed
        android: { priority: 'HIGH', notification: { sound: 'default', channel_id: 'fcm_fallback_notification_channel' } },
        apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
      } }),
    })
    if (r.ok) delivered++
    else if (r.status === 404 || r.status === 400) await sb.from('device_tokens').delete().eq('token', token) // stale token
  }
  if (delivered > 0) await sb.from('outbox').delete().eq('id', record.id)
  return new Response(JSON.stringify({ delivered }), { headers: { 'content-type': 'application/json' } })
})
