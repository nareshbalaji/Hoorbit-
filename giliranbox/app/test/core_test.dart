import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:giliranbox/core/format.dart';
import 'package:giliranbox/core/i18n.dart';
import 'package:giliranbox/core/theme.dart';
import 'package:giliranbox/core/widgets.dart';

void main() {
  test('money and distance formatting', () {
    expect(rm(6000), 'RM60');
    expect(rm(2543), 'RM25.43');
    expect(rm(null), '-');
    app.lang = 'en';
    expect(distanceText(2300), '2.3 km away');
    expect(distanceText(14200), '14 km away');
  });

  test('Malaysia time is fixed UTC+8', () {
    expect(klToUtc(2026, 3, 5, 9), DateTime.utc(2026, 3, 5, 1));
    expect(toKL(DateTime.utc(2026, 3, 5, 17)).hour, 1);
    expect(toKL(DateTime.utc(2026, 3, 5, 17)).day, 6);
  });

  test('every language has every UI string', () {
    // Reads the private map through tr() by probing each key in each language.
    final missing = <String>[];
    for (final lang in ['ms', 'zh']) {
      app.lang = lang;
      for (final k in _keys) {
        // tr() falls back to English; a missing translation returns the English text. Compare.
        app.lang = 'en';
        final en = tr(k);
        app.lang = lang;
        final t = tr(k);
        if (t == en && !_sameInAllLangs.contains(k)) missing.add('$lang:$k');
      }
    }
    expect(missing, isEmpty, reason: 'untranslated: $missing');
  });

  test('loc picks language with English fallback', () {
    app.lang = 'zh';
    expect(loc({'en': 'Plumber', 'zh': '水喉工'}), '水喉工');
    app.lang = 'ms';
    expect(loc({'en': 'Plumber', 'zh': '水喉工'}), 'Plumber');
  });

  testWidgets('skeleton list renders without animation', (t) async {
    await t.pumpWidget(MaterialApp(theme: buildTheme(), home: const Scaffold(body: SkelList(n: 3))));
    expect(find.byType(Skel), findsNWidgets(3));
  });
}

// Keys used by the app. Kept in sync with lib/core/i18n.dart (the test fails if a translation is missing).
const _sameInAllLangs = {'app', 'rm', 'sos', 'online', 'chat', 'phone', 'tip', 'tips', 'duitnow', 'fpx', 'min'};
const _keys = [
  'home', 'activity', 'messages', 'account', 'search', 'book_again', 'queue_shop', 'queue_sub', 'phone', 'send_otp', 'otp', 'verify', 'consent', 'privacy', 'welcome',
  'from', 'away', 'address', 'add_address', 'pick_date', 'pick_slot', 'describe', 'photos', 'add_photo', 'request_now', 'book', 'request_quotes', 'payment', 'cash', 'duitnow', 'fpx',
  'scrap_items', 'est_kg', 'you_receive', 'scrap_note', 's_searching', 's_quoting', 's_pending', 's_accepted', 's_on_the_way', 's_arrived', 's_in_progress', 's_done', 's_cancelled', 's_expired',
  'cancel', 'chat', 'call', 'sos', 'report', 'rate', 'submit', 'tip', 'quotes', 'accept', 'decline', 'send_quote', 'price', 'repeat', 'every_days', 'auto_book', 'reminder_set', 'nothing', 'offline', 'retry', 'load_more',
  'language', 'saved_addresses', 'delete_account', 'delete_confirm', 'sign_out', 'become_provider', 'provider_mode', 'customer_mode', 'name', 'online', 'offline_s', 'new_jobs', 'no_jobs',
  'navigate', 'on_the_way', 'arrived', 'start', 'complete', 'final_price', 'weigh', 'actual_kg', 'payout', 'calendar', 'earnings', 'gross', 'commission', 'net', 'jobs', 'tips',
  'pending_approval', 'service_area', 'categories', 'licences', 'ic_last4', 'upload', 'submit_application', 'join_queue', 'your_number', 'now_serving', 'ahead', 'est_wait', 'min', 'your_turn',
  'leave_queue', 'counter', 'next', 'recall', 'skip', 'waiting', 'pair_kiosk', 'pair_code', 'err_area_not_served', 'err_category_unavailable', 'err_already_taken', 'err_offer_expired',
  'err_not_approved_provider', 'err_quote_limit', 'err_report_window_closed', 'err_photos_required', 'err_bad_schedule', 'err_generic', 'err_shop_closed', 'sos_title', 'sos_body', 'sos_send',
  'sos_999', 'sos_sent', 'no_medical', 'masked_call',
];
