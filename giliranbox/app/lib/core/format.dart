import 'i18n.dart';

String rm(num? cents) => cents == null ? '-' : 'RM${(cents / 100).toStringAsFixed(cents % 100 == 0 ? 0 : 2)}';

String distanceText(num? meters) {
  if (meters == null) return '';
  final km = meters / 1000;
  return '${km < 10 ? km.toStringAsFixed(1) : km.round()} km ${tr('away')}';
}

/// Malaysia has no DST: Asia/Kuala_Lumpur is a fixed UTC+8.
DateTime toKL(DateTime t) => t.toUtc().add(const Duration(hours: 8));
DateTime klToUtc(int y, int m, int d, int h) => DateTime.utc(y, m, d, h).subtract(const Duration(hours: 8));

const _mon = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
String two(int n) => n.toString().padLeft(2, '0');
String dateKL(String iso) {
  final t = toKL(DateTime.parse(iso));
  return '${t.day} ${_mon[t.month - 1]} ${two(t.hour)}:${two(t.minute)}';
}
