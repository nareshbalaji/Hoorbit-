import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const $app = document.getElementById('app')
const rm = (c) => (c == null ? '-' : 'RM' + (c / 100).toFixed(2))
const KL = (t) => (t ? new Date(t).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) : '-')

// Safe DOM builder: text is always set via textContent/createTextNode (no innerHTML with data).
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'class') e.className = v
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)))
  return e
}
const fail = (e) => alert(e.message ?? String(e))

const tabs = { Providers: providers, Categories: categories, 'Scrap rates': scrapRates, Jobs: jobs, Disputes: disputes, SOS: sos, 'Demand map': heatmap, Regions: regions }
let current = 'Providers'

async function boot() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) return login()
  const { data: me } = await sb.from('profiles').select('role,full_name').eq('id', session.user.id).single()
  if (me?.role !== 'admin') { await sb.auth.signOut(); return login('This account is not an admin.') }
  shell()
}

function login(msg) {
  let phone, otp, sent = false
  const box = h('div', { class: 'card', id: 'login' })
  const draw = () => {
    box.replaceChildren(h('h2', {}, 'GiliranBox Admin'), msg ? h('p', {}, msg) : '',
      phone = h('input', { placeholder: '+60123456001', value: phone?.value ?? '' }),
      sent ? (otp = h('input', { placeholder: '6-digit code' })) : '',
      h('p', {}, h('button', { class: 'act', onclick: async () => {
        try {
          if (!sent) { await sb.auth.signInWithOtp({ phone: phone.value.trim() }); sent = true; draw() }
          else { const { error } = await sb.auth.verifyOtp({ phone: phone.value.trim(), token: otp.value.trim(), type: 'sms' }); if (error) throw error; boot() }
        } catch (e) { fail(e) }
      } }, sent ? 'Verify' : 'Send OTP')))
  }
  draw(); $app.replaceChildren(box)
}

function shell() {
  const main = h('main')
  const nav = h('nav')
  const show = async (name) => {
    current = name
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === name))
    main.replaceChildren(h('p', {}, 'Loading…'))
    try { main.replaceChildren(await tabs[name]()) } catch (e) { main.replaceChildren(h('p', {}, 'Error: ' + e.message)) }
  }
  for (const n of Object.keys(tabs)) nav.append(h('button', { onclick: () => show(n) }, n))
  $app.replaceChildren(h('header', {}, h('b', {}, 'GiliranBox'), nav, h('button', { class: 'act gray', onclick: () => sb.auth.signOut().then(boot) }, 'Sign out')), main)
  show(current)
}

const table = (head, rows) => h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)))
const reload = () => document.querySelector('nav button.on')?.click()

// ---- providers: approve / reject / suspend, review licences ----
async function providers() {
  const { data, error } = await sb.from('providers')
    .select('id,status,radius_km,rating_avg,rating_count,jobs_done,online,profile:profiles(full_name,phone),provider_categories(category_id),provider_documents(id,kind,status,file_path)')
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  const { data: cats } = await sb.from('categories').select('id,slug')
  const slug = Object.fromEntries(cats.map((c) => [c.id, c.slug]))
  const set = (id, s) => sb.rpc('admin_set_provider_status', { p_provider: id, p_status: s }).then(({ error }) => (error ? fail(error) : reload()))
  return table(['Name', 'Phone', 'Categories', 'Documents', 'Rating', 'Status', ''], data.map((p) => h('tr', {},
    h('td', {}, p.profile?.full_name ?? '-'), h('td', {}, p.profile?.phone ?? '-'),
    h('td', {}, p.provider_categories.map((c) => slug[c.category_id] ?? c.category_id).join(', ')),
    h('td', {}, p.provider_documents.map((d) => h('div', {},
      h('a', { href: '#', onclick: async (e) => { e.preventDefault(); const { data: u, error } = await sb.storage.from('provider-docs').createSignedUrl(d.file_path, 60); error ? fail(error) : window.open(u.signedUrl, '_blank', 'noopener') } }, d.kind),
      ' ', h('span', { class: 'tag ' + d.status }, d.status),
      d.status === 'pending' ? h('button', { class: 'act', onclick: () => sb.from('provider_documents').update({ status: 'approved' }).eq('id', d.id).then(reload) }, '✓') : ''))),
    h('td', {}, `★${p.rating_avg} (${p.rating_count}) · ${p.jobs_done} jobs`),
    h('td', {}, h('span', { class: 'tag ' + p.status }, p.status)),
    h('td', {}, p.status !== 'approved' ? h('button', { class: 'act', onclick: () => set(p.id, 'approved') }, 'Approve') : '',
      p.status === 'pending' ? h('button', { class: 'act red', onclick: () => set(p.id, 'rejected') }, 'Reject') : '',
      p.status === 'approved' ? h('button', { class: 'act red', onclick: () => set(p.id, 'suspended') }, 'Suspend') : ''))))
}

// ---- categories: on/off, commission %, from-price ----
async function categories() {
  const { data, error } = await sb.from('categories').select('*').order('sort')
  if (error) throw error
  return table(['Category', 'Type', 'Enabled', 'Commission %', 'From price (RM)'], data.map((c) => {
    const patch = (o) => sb.from('categories').update(o).eq('id', c.id).then(({ error }) => (error ? fail(error) : null))
    return h('tr', {}, h('td', {}, c.name.en), h('td', {}, c.booking_type),
      h('td', {}, h('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => patch({ enabled: e.target.checked }) })),
      h('td', {}, h('input', { type: 'number', min: 0, max: 50, step: 0.5, value: c.commission_pct, onchange: (e) => patch({ commission_pct: +e.target.value }) })),
      h('td', {}, h('input', { type: 'number', min: 0, step: 1, value: c.from_price_cents == null ? '' : c.from_price_cents / 100, onchange: (e) => patch({ from_price_cents: e.target.value === '' ? null : Math.round(+e.target.value * 100) }) })))
  }))
}

async function scrapRates() {
  const { data, error } = await sb.from('scrap_rates').select('*').order('item_type')
  if (error) throw error
  return table(['Item', 'RM per kg', 'Active'], data.map((r) => h('tr', {}, h('td', {}, r.name.en),
    h('td', {}, h('input', { type: 'number', step: 0.05, min: 0, value: r.cents_per_kg / 100, onchange: (e) => sb.from('scrap_rates').update({ cents_per_kg: Math.round(+e.target.value * 100) }).eq('id', r.id).then(({ error }) => error && fail(error)) })),
    h('td', {}, h('input', { type: 'checkbox', checked: r.active, onchange: (e) => sb.from('scrap_rates').update({ active: e.target.checked }).eq('id', r.id).then(({ error }) => error && fail(error)) })))))
}

async function jobs() {
  const { data, error } = await sb.from('jobs').select('id,status,type,category_id,region_code,price_cents,commission_cents,payout_cents,pay_status,created_at,customer:profiles!jobs_customer_id_fkey(full_name)').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return table(['When (KL)', 'Customer', 'Type', 'Region', 'Status', 'Price', 'Commission', 'Scrap payout', 'Payment'], data.map((j) => h('tr', {},
    h('td', {}, KL(j.created_at)), h('td', {}, j.customer?.full_name ?? '-'), h('td', {}, j.type), h('td', {}, j.region_code),
    h('td', {}, h('span', { class: 'tag' }, j.status)), h('td', {}, rm(j.price_cents)), h('td', {}, rm(j.commission_cents)), h('td', {}, rm(j.payout_cents)), h('td', {}, j.pay_status))))
}

// ---- disputes & refunds ----
async function disputes() {
  const { data, error } = await sb.from('reports').select('id,job_id,reason,status,refund_cents,admin_note,created_at,reporter:profiles!reports_reporter_id_fkey(full_name)').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return table(['When', 'Reporter', 'Reason', 'Status', 'Refund RM', 'Note', ''], data.map((r) => {
    const st = h('select', {}, ['open', 'investigating', 'resolved', 'refunded', 'rejected'].map((s) => h('option', { value: s, selected: s === r.status }, s)))
    const refund = h('input', { type: 'number', step: 1, min: 0, value: r.refund_cents / 100 })
    const note = h('input', { value: r.admin_note ?? '' })
    return h('tr', {}, h('td', {}, KL(r.created_at)), h('td', {}, r.reporter?.full_name ?? '-'), h('td', {}, r.reason), h('td', {}, st), h('td', {}, refund), h('td', {}, note),
      h('td', {}, h('button', { class: 'act', onclick: () => sb.from('reports').update({ status: st.value, refund_cents: Math.round(+refund.value * 100), admin_note: note.value }).eq('id', r.id).then(({ error }) => (error ? fail(error) : alert('Saved. Refund payout itself is manual until the payment gateway is integrated.'))) }, 'Save')))
  }))
}

async function sos() {
  const { data, error } = await sb.rpc('admin_sos')
  if (error) throw error
  return table(['When', 'Who', 'Phone', 'Location', ''], data.map((s) => h('tr', {}, h('td', {}, KL(s.created_at)), h('td', {}, s.who), h('td', {}, s.phone),
    h('td', {}, s.lat ? h('a', { href: `https://www.google.com/maps?q=${s.lat},${s.lng}`, target: '_blank', rel: 'noopener' }, 'Open map') : '-'),
    h('td', {}, h('button', { class: 'act', onclick: () => sb.from('sos_events').update({ resolved: true }).eq('id', s.id).then(reload) }, 'Resolve')))))
}

// ---- heatmap of demand by area (1 km grid) ----
async function heatmap() {
  const days = h('select', {}, [7, 30, 90].map((d) => h('option', { value: d }, d + ' days')))
  const box = h('div', { id: 'map' })
  const wrap = h('div', {}, h('div', { class: 'row' }, 'Period: ', days), box)
  setTimeout(async () => {
    const map = L.map(box).setView([3.1073, 101.6067], 11)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map)
    const layer = L.layerGroup().addTo(map)
    const draw = async () => {
      layer.clearLayers()
      const { data, error } = await sb.rpc('demand_heatmap', { p_days: +days.value })
      if (error) return fail(error)
      const total = {}
      data.forEach((c) => { const k = c.lat + ',' + c.lng; total[k] = (total[k] ?? 0) + Number(c.jobs) })
      const max = Math.max(1, ...Object.values(total))
      Object.entries(total).forEach(([k, n]) => {
        const [lat, lng] = k.split(',').map(Number)
        L.circle([lat, lng], { radius: 500, stroke: false, fillColor: '#e11d48', fillOpacity: 0.15 + 0.6 * (n / max) }).bindTooltip(n + ' jobs').addTo(layer)
      })
    }
    days.onchange = draw; draw()
  })
  return wrap
}

async function regions() {
  const { data, error } = await sb.from('regions').select('code,name,enabled,radius_km').order('code')
  if (error) throw error
  return table(['Code', 'Name', 'Radius km', 'Open for bookings'], data.map((r) => h('tr', {}, h('td', {}, r.code), h('td', {}, r.name), h('td', {}, r.radius_km),
    h('td', {}, h('input', { type: 'checkbox', checked: r.enabled, onchange: (e) => sb.from('regions').update({ enabled: e.target.checked }).eq('code', r.code).then(({ error }) => error && fail(error)) })))))
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') login() })
boot()
