import 'package:flutter/foundation.dart';

/// Startup markers for tools/measure_android.sh. Enabled only with --dart-define=PERF_LOG=true; zero cost otherwise.
const _perf = bool.fromEnvironment('PERF_LOG');
final _seen = <String>{};

void perfMark(String name) {
  if (_perf && _seen.add(name)) debugPrint('GB_PERF $name epoch=${DateTime.now().millisecondsSinceEpoch}');
}
