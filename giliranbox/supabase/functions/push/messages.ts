// Push copy for every outbox kind, in BM / English / 中文. Pure module: unit-tested without Deno or FCM.
type Lang = 'ms' | 'en' | 'zh'
type Copy = Record<Lang, { title: string; body: string }>

const rm = (c?: number) => (c == null ? '' : `RM${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`)

export function compose(kind: string, data: Record<string, unknown>, lang: string): { title: string; body: string } | null {
  const km = (m?: unknown) => (typeof m === 'number' ? `${(m / 1000).toFixed(1)} km` : '')
  const table: Record<string, Copy> = {
    new_job: {
      ms: { title: 'Kerja baru!', body: `Pelanggan ${km(data.distance_m)} dari anda. Ketik untuk terima.` },
      en: { title: 'New job!', body: `Customer ${km(data.distance_m)} away. Tap to accept.` },
      zh: { title: '新工作！', body: `客户距离您 ${km(data.distance_m)}，点击接单。` },
    },
    job_accepted: {
      ms: { title: 'Tempahan diterima', body: 'Penyedia telah menerima tempahan anda.' },
      en: { title: 'Booking accepted', body: 'A provider accepted your booking.' },
      zh: { title: '已接单', body: '服务者已接受您的预订。' },
    },
    job_on_the_way: {
      ms: { title: 'Dalam perjalanan', body: 'Penyedia sedang menuju ke lokasi anda.' },
      en: { title: 'On the way', body: 'Your provider is heading to you.' },
      zh: { title: '在途中', body: '服务者正在前往您的位置。' },
    },
    job_arrived: {
      ms: { title: 'Telah tiba', body: 'Penyedia sudah sampai.' },
      en: { title: 'Arrived', body: 'Your provider has arrived.' },
      zh: { title: '已到达', body: '服务者已到达。' },
    },
    job_in_progress: {
      ms: { title: 'Kerja bermula', body: 'Kerja sedang dilakukan.' },
      en: { title: 'Job started', body: 'Work is in progress.' },
      zh: { title: '服务开始', body: '服务进行中。' },
    },
    job_done: {
      ms: { title: 'Selesai', body: 'Sila nilai penyedia anda.' },
      en: { title: 'Done', body: 'Please rate your provider.' },
      zh: { title: '已完成', body: '请为服务者评分。' },
    },
    job_cancelled: {
      ms: { title: 'Dibatalkan', body: 'Tempahan telah dibatalkan.' },
      en: { title: 'Cancelled', body: 'The booking was cancelled.' },
      zh: { title: '已取消', body: '预订已取消。' },
    },
    job_expired: {
      ms: { title: 'Tiada penyedia', body: 'Maaf, tiada penyedia tersedia sekarang. Cuba lagi.' },
      en: { title: 'No provider available', body: 'Sorry, nobody is available right now. Please try again.' },
      zh: { title: '暂无服务者', body: '抱歉，目前没有服务者，请稍后再试。' },
    },
    new_quote: {
      ms: { title: 'Sebut harga baru', body: `Anda terima sebut harga ${rm(data.price_cents as number)}.` },
      en: { title: 'New quote', body: `You received a quote of ${rm(data.price_cents as number)}.` },
      zh: { title: '新报价', body: `您收到报价 ${rm(data.price_cents as number)}。` },
    },
    chat: {
      ms: { title: 'Mesej baru', body: 'Anda ada mesej baru.' },
      en: { title: 'New message', body: 'You have a new message.' },
      zh: { title: '新消息', body: '您有一条新消息。' },
    },
    your_turn: {
      ms: { title: 'Giliran anda!', body: `Nombor #${data.number} dipanggil. Sila ke kaunter.` },
      en: { title: "It's your turn!", body: `Number #${data.number} is being called. Please go to the counter.` },
      zh: { title: '轮到您了！', body: `#${data.number} 号，请到柜台。` },
    },
    repeat_reminder: {
      ms: { title: 'Masa untuk servis semula', body: 'Sudah tiba masanya untuk tempah semula. Ketik untuk tempah.' },
      en: { title: 'Time to book again', body: "It's time for your next service. Tap to book." },
      zh: { title: '该再次预订了', body: '您的下一次服务时间到了，点击预订。' },
    },
    repeat_booked: {
      ms: { title: 'Tempahan berulang dibuat', body: 'Kami telah menempah servis seterusnya untuk anda.' },
      en: { title: 'Repeat booking created', body: 'We booked your next service for you.' },
      zh: { title: '已创建重复预订', body: '我们已为您预订下一次服务。' },
    },
    almost_turn: {
      ms: { title: 'Hampir giliran anda', body: 'Tinggal 2 orang di hadapan anda.' },
      en: { title: 'Almost your turn', body: 'Only 2 people ahead of you.' },
      zh: { title: '快到您了', body: '前面还有 2 位。' },
    },
  }
  const l = (['ms', 'en', 'zh'] as const).includes(lang as Lang) ? (lang as Lang) : 'ms'
  return table[kind]?.[l] ?? null
}
