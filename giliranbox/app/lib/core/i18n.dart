import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Tiny in-code localisation (BM / English / 中文): no codegen, no asset loading, instant startup.
class AppState extends ChangeNotifier {
  String lang = 'ms';
  bool providerMode = false;

  Future<void> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      lang = p.getString('lang') ?? lang;
      providerMode = p.getBool('providerMode') ?? false;
    } catch (_) {}
  }

  Future<void> setLang(String l) async {
    lang = l;
    notifyListeners();
    try {
      (await SharedPreferences.getInstance()).setString('lang', l);
    } catch (_) {}
  }

  Future<void> setProviderMode(bool v) async {
    providerMode = v;
    notifyListeners();
    try {
      (await SharedPreferences.getInstance()).setBool('providerMode', v);
    } catch (_) {}
  }
}

final app = AppState();

/// Translate a UI key. Falls back to English, then to the key itself.
String tr(String key) => _s[app.lang]?[key] ?? _s['en']![key] ?? key;

/// Pick the current language from a {"en":..,"ms":..,"zh":..} JSON value.
String loc(dynamic m) {
  if (m is Map) return (m[app.lang] ?? m['en'] ?? m.values.firstOrNull ?? '').toString();
  return (m ?? '').toString();
}

const _s = <String, Map<String, String>>{
  'en': {
    'app': 'GiliranBox', 'home': 'Home', 'activity': 'Activity', 'messages': 'Messages', 'account': 'Account',
    'search': 'Search services', 'book_again': 'Book again', 'queue_shop': 'Queue at a shop', 'queue_sub': 'Join remotely, get notified',
    'phone': 'Phone number', 'send_otp': 'Send OTP', 'otp': '6-digit code', 'verify': 'Verify', 'consent': 'I agree to the Privacy Policy and consent to my data being processed under PDPA 2010.',
    'privacy': 'Privacy policy', 'welcome': 'Welcome', 'from': 'from', 'rm': 'RM', 'away': 'away',
    'address': 'Address', 'add_address': 'Pin new address', 'pick_date': 'Choose a date', 'pick_slot': 'Time slot',
    'describe': 'Describe the job', 'photos': 'Photos (up to 5)', 'add_photo': 'Add photo', 'request_now': 'Request now', 'book': 'Book', 'request_quotes': 'Request quotes',
    'payment': 'Payment', 'cash': 'Cash', 'duitnow': 'DuitNow (coming soon)', 'fpx': 'FPX (coming soon)',
    'scrap_items': 'What do you have?', 'est_kg': 'Estimated kg', 'you_receive': 'You receive about', 'scrap_note': 'The collector weighs on site; you are paid by actual weight.',
    's_searching': 'Finding a provider…', 's_quoting': 'Waiting for quotes', 's_pending': 'Waiting for provider to confirm', 's_accepted': 'Accepted',
    's_on_the_way': 'On the way', 's_arrived': 'Arrived', 's_in_progress': 'In progress', 's_done': 'Done', 's_cancelled': 'Cancelled', 's_expired': 'No provider available',
    'cancel': 'Cancel', 'chat': 'Chat', 'call': 'Call', 'sos': 'SOS', 'report': 'Report a problem', 'rate': 'Rate & tip', 'submit': 'Submit', 'tip': 'Tip',
    'quotes': 'Quotes', 'accept': 'Accept', 'decline': 'Decline', 'send_quote': 'Send quote', 'price': 'Price (RM)', 'repeat': 'Repeat', 'every_days': 'Remind me every (days)',
    'auto_book': 'Book automatically (otherwise just remind me)', 'reminder_set': 'Saved', 'nothing': 'Nothing here yet', 'offline': 'Offline – showing saved data', 'retry': 'Retry', 'load_more': 'Load more',
    'language': 'Language', 'saved_addresses': 'Saved addresses', 'delete_account': 'Delete my account', 'delete_confirm': 'This permanently removes your personal data. Continue?',
    'sign_out': 'Sign out', 'become_provider': 'Become a provider', 'provider_mode': 'Provider mode', 'customer_mode': 'Customer mode', 'name': 'Name',
    'online': 'Online', 'offline_s': 'Offline', 'new_jobs': 'New jobs', 'no_jobs': 'No jobs right now', 'navigate': 'Navigate', 'on_the_way': 'I\'m on the way', 'arrived': 'I\'ve arrived',
    'start': 'Start job', 'complete': 'Complete', 'final_price': 'Final price (RM)', 'weigh': 'Weigh & pay out', 'actual_kg': 'Actual kg', 'payout': 'Payout to customer',
    'calendar': 'Calendar', 'earnings': 'Earnings', 'gross': 'Gross', 'commission': 'Commission', 'net': 'Net', 'jobs': 'Jobs', 'tips': 'Tips',
    'pending_approval': 'Your application is being reviewed. You can go online once an admin approves it.', 'service_area': 'Service radius (km)', 'categories': 'Categories', 'licences': 'Licences',
    'ic_last4': 'IC last 4 digits (verification coming soon)', 'upload': 'Upload', 'submit_application': 'Submit application',
    'join_queue': 'Join queue', 'your_number': 'Your number', 'now_serving': 'Now serving', 'ahead': 'ahead of you', 'est_wait': 'Estimated wait', 'min': 'min', 'your_turn': 'It\'s your turn!', 'leave_queue': 'Leave queue',
    'counter': 'Counter', 'next': 'NEXT', 'recall': 'RECALL', 'skip': 'SKIP', 'waiting': 'waiting', 'pair_kiosk': 'Pair kiosk', 'pair_code': 'Kiosk code',
    'err_area_not_served': 'We are not in your area yet.', 'err_category_unavailable': 'This service is not available yet.', 'err_already_taken': 'Another provider took this job.',
    'err_offer_expired': 'This offer has expired.', 'err_not_approved_provider': 'Your provider account is not approved yet.', 'err_quote_limit': 'This job already has 3 quotes.',
    'err_report_window_closed': 'Reports must be made within 7 days.', 'err_photos_required': 'Please add at least one photo.', 'err_bad_schedule': 'Pick a time at least 1 hour from now.',
    'err_generic': 'Something went wrong. Please try again.', 'err_license_missing': 'Licence document missing.', 'err_shop_closed': 'This shop is closed.',
    'sos_title': 'Emergency', 'sos_body': 'Alert GiliranBox support with your location, or call 999.', 'sos_send': 'Alert support', 'sos_999': 'Call 999', 'sos_sent': 'Support alerted.',
    'no_medical': 'GiliranBox does not offer medical services.', 'masked_call': 'Calls are routed through a private number.',
  },
  'ms': {
    'home': 'Utama', 'activity': 'Aktiviti', 'messages': 'Mesej', 'account': 'Akaun', 'search': 'Cari perkhidmatan', 'book_again': 'Tempah semula',
    'queue_shop': 'Beratur di kedai', 'queue_sub': 'Sertai dari jauh, dapat notifikasi', 'phone': 'Nombor telefon', 'send_otp': 'Hantar OTP', 'otp': 'Kod 6 digit', 'verify': 'Sahkan',
    'consent': 'Saya bersetuju dengan Dasar Privasi dan membenarkan data saya diproses di bawah PDPA 2010.', 'privacy': 'Dasar privasi', 'welcome': 'Selamat datang', 'from': 'dari', 'away': 'dari anda',
    'address': 'Alamat', 'add_address': 'Pin alamat baru', 'pick_date': 'Pilih tarikh', 'pick_slot': 'Slot masa', 'describe': 'Terangkan kerja', 'photos': 'Gambar (maks 5)', 'add_photo': 'Tambah gambar',
    'request_now': 'Minta sekarang', 'book': 'Tempah', 'request_quotes': 'Minta sebut harga', 'payment': 'Bayaran', 'cash': 'Tunai', 'duitnow': 'DuitNow (akan datang)', 'fpx': 'FPX (akan datang)',
    'scrap_items': 'Apa yang anda ada?', 'est_kg': 'Anggaran kg', 'you_receive': 'Anda akan terima kira-kira', 'scrap_note': 'Pengutip menimbang di tempat; anda dibayar mengikut berat sebenar.',
    's_searching': 'Mencari penyedia…', 's_quoting': 'Menunggu sebut harga', 's_pending': 'Menunggu pengesahan penyedia', 's_accepted': 'Diterima', 's_on_the_way': 'Dalam perjalanan',
    's_arrived': 'Telah tiba', 's_in_progress': 'Sedang dibuat', 's_done': 'Selesai', 's_cancelled': 'Dibatalkan', 's_expired': 'Tiada penyedia tersedia',
    'cancel': 'Batal', 'chat': 'Sembang', 'call': 'Panggil', 'report': 'Laporkan masalah', 'rate': 'Nilai & tip', 'submit': 'Hantar', 'tip': 'Tip', 'quotes': 'Sebut harga', 'accept': 'Terima', 'decline': 'Tolak',
    'send_quote': 'Hantar sebut harga', 'price': 'Harga (RM)', 'repeat': 'Ulang', 'every_days': 'Ingatkan saya setiap (hari)', 'auto_book': 'Tempah secara automatik (jika tidak, hanya ingatkan)', 'reminder_set': 'Disimpan', 'nothing': 'Tiada apa-apa lagi', 'offline': 'Luar talian – data tersimpan',
    'retry': 'Cuba lagi', 'load_more': 'Muat lagi', 'language': 'Bahasa', 'saved_addresses': 'Alamat tersimpan', 'delete_account': 'Padam akaun saya', 'delete_confirm': 'Data peribadi anda akan dipadam kekal. Teruskan?',
    'sign_out': 'Log keluar', 'become_provider': 'Jadi penyedia', 'provider_mode': 'Mod penyedia', 'customer_mode': 'Mod pelanggan', 'name': 'Nama', 'online': 'Dalam talian', 'offline_s': 'Luar talian',
    'new_jobs': 'Kerja baru', 'no_jobs': 'Tiada kerja buat masa ini', 'navigate': 'Navigasi', 'on_the_way': 'Saya dalam perjalanan', 'arrived': 'Saya sudah tiba', 'start': 'Mula kerja', 'complete': 'Siap',
    'final_price': 'Harga akhir (RM)', 'weigh': 'Timbang & bayar', 'actual_kg': 'Kg sebenar', 'payout': 'Bayaran kepada pelanggan', 'calendar': 'Kalendar', 'earnings': 'Pendapatan', 'gross': 'Kasar',
    'commission': 'Komisen', 'net': 'Bersih', 'jobs': 'Kerja', 'tips': 'Tip', 'pending_approval': 'Permohonan anda sedang disemak. Anda boleh online selepas diluluskan admin.', 'service_area': 'Radius kawasan (km)',
    'categories': 'Kategori', 'licences': 'Lesen', 'ic_last4': '4 digit akhir IC (pengesahan akan datang)', 'upload': 'Muat naik', 'submit_application': 'Hantar permohonan', 'join_queue': 'Sertai giliran',
    'your_number': 'Nombor anda', 'now_serving': 'Sedang dilayan', 'ahead': 'di hadapan anda', 'est_wait': 'Anggaran tunggu', 'min': 'min', 'your_turn': 'Giliran anda!', 'leave_queue': 'Keluar giliran',
    'counter': 'Kaunter', 'next': 'SETERUSNYA', 'recall': 'PANGGIL SEMULA', 'skip': 'LANGKAU', 'waiting': 'menunggu', 'pair_kiosk': 'Pasang kiosk', 'pair_code': 'Kod kiosk',
    'err_area_not_served': 'Kami belum ada di kawasan anda.', 'err_category_unavailable': 'Perkhidmatan ini belum tersedia.', 'err_already_taken': 'Penyedia lain telah mengambil kerja ini.',
    'err_offer_expired': 'Tawaran ini telah tamat.', 'err_not_approved_provider': 'Akaun penyedia anda belum diluluskan.', 'err_quote_limit': 'Kerja ini sudah ada 3 sebut harga.',
    'err_report_window_closed': 'Laporan mesti dibuat dalam 7 hari.', 'err_photos_required': 'Sila tambah sekurang-kurangnya satu gambar.', 'err_bad_schedule': 'Pilih masa sekurang-kurangnya 1 jam dari sekarang.',
    'err_generic': 'Ada masalah. Sila cuba lagi.', 'err_shop_closed': 'Kedai ini tutup.', 'sos_title': 'Kecemasan', 'sos_body': 'Maklumkan sokongan GiliranBox dengan lokasi anda, atau hubungi 999.',
    'sos_send': 'Maklumkan sokongan', 'sos_999': 'Hubungi 999', 'sos_sent': 'Sokongan dimaklumkan.', 'no_medical': 'GiliranBox tidak menyediakan perkhidmatan perubatan.', 'masked_call': 'Panggilan melalui nombor persendirian.',
  },
  'zh': {
    'home': '首页', 'activity': '订单', 'messages': '消息', 'account': '我的', 'search': '搜索服务', 'book_again': '再次预订', 'queue_shop': '到店排队', 'queue_sub': '远程取号，轮到您时通知',
    'phone': '手机号码', 'send_otp': '发送验证码', 'otp': '6位验证码', 'verify': '验证', 'consent': '我同意隐私政策，并同意根据2010年个人资料保护法处理我的资料。', 'privacy': '隐私政策', 'welcome': '欢迎',
    'from': '起', 'away': '距离', 'address': '地址', 'add_address': '标记新地址', 'pick_date': '选择日期', 'pick_slot': '时间段', 'describe': '描述工作内容', 'photos': '照片（最多5张）', 'add_photo': '添加照片',
    'request_now': '立即呼叫', 'book': '预订', 'request_quotes': '索取报价', 'payment': '付款', 'cash': '现金', 'duitnow': 'DuitNow（即将推出）', 'fpx': 'FPX（即将推出）', 'scrap_items': '您有什么废品？',
    'est_kg': '预估公斤数', 'you_receive': '您将收到约', 'scrap_note': '回收员现场过磅，按实际重量付款给您。', 's_searching': '正在寻找服务者…', 's_quoting': '等待报价', 's_pending': '等待服务者确认',
    's_accepted': '已接单', 's_on_the_way': '在途中', 's_arrived': '已到达', 's_in_progress': '进行中', 's_done': '已完成', 's_cancelled': '已取消', 's_expired': '暂无服务者', 'cancel': '取消', 'chat': '聊天',
    'call': '通话', 'report': '举报问题', 'rate': '评分与小费', 'submit': '提交', 'tip': '小费', 'quotes': '报价', 'accept': '接受', 'decline': '拒绝', 'send_quote': '发送报价', 'price': '价格 (RM)', 'repeat': '重复',
    'every_days': '每隔几天提醒我', 'auto_book': '自动预订（否则仅提醒我）', 'reminder_set': '已保存', 'nothing': '暂无内容', 'offline': '离线 – 显示已保存的数据', 'retry': '重试', 'load_more': '加载更多', 'language': '语言', 'saved_addresses': '已保存地址',
    'delete_account': '删除我的账户', 'delete_confirm': '这将永久删除您的个人资料。继续吗？', 'sign_out': '退出登录', 'become_provider': '成为服务者', 'provider_mode': '服务者模式', 'customer_mode': '客户模式',
    'name': '姓名', 'online': '在线', 'offline_s': '离线', 'new_jobs': '新工作', 'no_jobs': '暂无工作', 'navigate': '导航', 'on_the_way': '我已出发', 'arrived': '我已到达', 'start': '开始工作', 'complete': '完成',
    'final_price': '最终价格 (RM)', 'weigh': '过磅并付款', 'actual_kg': '实际公斤数', 'payout': '付给客户', 'calendar': '日程', 'earnings': '收入', 'gross': '总额', 'commission': '佣金', 'net': '净收入',
    'jobs': '工作', 'tips': '小费', 'pending_approval': '您的申请正在审核中，管理员批准后即可上线。', 'service_area': '服务半径（公里）', 'categories': '类别', 'licences': '执照', 'ic_last4': '身份证后4位（验证即将推出）',
    'upload': '上传', 'submit_application': '提交申请', 'join_queue': '排队', 'your_number': '您的号码', 'now_serving': '当前叫号', 'ahead': '位在您前面', 'est_wait': '预计等待', 'min': '分钟',
    'your_turn': '轮到您了！', 'leave_queue': '退出排队', 'counter': '柜台', 'next': '下一位', 'recall': '重新呼叫', 'skip': '跳过', 'waiting': '等待中', 'pair_kiosk': '配对取号机', 'pair_code': '取号机代码',
    'err_area_not_served': '您所在地区暂未开通。', 'err_category_unavailable': '该服务暂未开通。', 'err_already_taken': '其他服务者已接单。', 'err_offer_expired': '此邀请已过期。', 'err_not_approved_provider': '您的服务者账户尚未获批。',
    'err_quote_limit': '此工作已有3个报价。', 'err_report_window_closed': '须在7天内举报。', 'err_photos_required': '请至少添加一张照片。', 'err_bad_schedule': '请选择至少1小时后的时间。', 'err_generic': '出错了，请重试。',
    'err_shop_closed': '店铺已打烊。', 'sos_title': '紧急求助', 'sos_body': '将您的位置发送给GiliranBox客服，或拨打999。', 'sos_send': '通知客服', 'sos_999': '拨打999', 'sos_sent': '已通知客服。',
    'no_medical': 'GiliranBox不提供医疗服务。', 'masked_call': '通话将通过隐私号码转接。',
  },
};
