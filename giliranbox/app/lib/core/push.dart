import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'api.dart';

/// Firebase push. Initialised AFTER the first frame so it never delays cold start, and fully optional:
/// without google-services.json / GoogleService-Info.plist the app runs, just without push.
class Push {
  /// Bumped when a foreground "new_job" arrives so the provider screen can refresh and ring.
  static final ValueNotifier<int> newJob = ValueNotifier(0);
  static StreamSubscription<RemoteMessage>? _fg;
  static StreamSubscription<String>? _tok;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      final m = FirebaseMessaging.instance;
      await m.requestPermission();
      await _register(await m.getToken());
      _tok ??= m.onTokenRefresh.listen(_register);
      _fg ??= FirebaseMessaging.onMessage.listen((msg) {
        if (msg.data['kind'] == 'new_job') {
          SystemSound.play(SystemSoundType.alert);
          HapticFeedback.heavyImpact();
          newJob.value++;
        }
      });
    } catch (_) {/* push unavailable: fine */}
  }

  static Future<void> _register(String? token) async {
    if (token == null || uid == null) return;
    try {
      await sb.from('device_tokens').upsert({
        'token': token,
        'user_id': uid,
        'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {}
  }

  static Future<void> dispose() async {
    await _fg?.cancel();
    await _tok?.cancel();
    _fg = _tok = null;
  }
}
