import { compose } from './messages.ts'
import assert from 'node:assert/strict'

const kinds = ['new_job', 'job_accepted', 'job_on_the_way', 'job_arrived', 'job_in_progress', 'job_done', 'job_cancelled', 'job_expired', 'new_quote', 'chat', 'your_turn', 'almost_turn', 'repeat_reminder', 'repeat_booked']
for (const k of kinds) for (const l of ['ms', 'en', 'zh']) {
  const m = compose(k, { number: 7, distance_m: 2300, price_cents: 15000 }, l)
  assert.ok(m && m.title && m.body, `${k}/${l} missing`)
}
assert.equal(compose('your_turn', { number: 12 }, 'en')!.body.includes('#12'), true)
assert.equal(compose('new_job', { distance_m: 2300 }, 'en')!.body.includes('2.3 km'), true)
assert.equal(compose('new_quote', { price_cents: 15050 }, 'en')!.body.includes('RM150.50'), true)
assert.equal(compose('unknown', {}, 'en'), null)
assert.equal(compose('chat', {}, 'xx')!.title, 'Mesej baru') // unknown language falls back to BM
console.log('push message tests passed')
