import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'api.dart';

/// Streams the provider's position to `ping_location` ONLY while a job is active (accepted -> arrived).
/// Android runs it as a visible foreground service so Waze/Maps in front doesn't kill updates; iOS shows the
/// blue location indicator. `stop()` cancels the stream completely: no location use outside an active job.
class JobLocationSession {
  StreamSubscription<Position>? _sub;
  DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);
  String? jobId;

  bool get running => _sub != null;

  static Future<bool> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  Future<bool> start(String job) async {
    if (_sub != null && jobId == job) return true;
    await stop();
    if (!await ensurePermission()) return false;
    jobId = job;
    final LocationSettings settings = defaultTargetPlatform == TargetPlatform.android
        ? AndroidSettings(
            accuracy: LocationAccuracy.medium,
            distanceFilter: 10,
            intervalDuration: const Duration(seconds: 7), // spec: every 5-10 s
            foregroundNotificationConfig: const ForegroundNotificationConfig(
                notificationTitle: 'GiliranBox', notificationText: 'Sharing your location with the customer for this job'))
        : AppleSettings(
            accuracy: LocationAccuracy.medium,
            distanceFilter: 10,
            pauseLocationUpdatesAutomatically: true,
            allowBackgroundLocationUpdates: true,
            showBackgroundLocationIndicator: true,
            activityType: ActivityType.automotiveNavigation);
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen((pos) {
      final now = DateTime.now();
      if (now.difference(_last).inSeconds < 6) return; // client throttle; server also throttles at 4 s
      _last = now;
      rpc('ping_location', {'p_job': job, 'p_lat': pos.latitude, 'p_lng': pos.longitude, 'p_heading': pos.heading.round() % 360})
          .catchError((_) => null); // best effort: next fix will retry
    }, onError: (_) {});
    return true;
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    jobId = null;
  }
}

/// One-shot position fix (going online, "distance away", address picker). Returns null if unavailable.
Future<Position?> oneShotFix() async {
  try {
    if (!await JobLocationSession.ensurePermission()) return Geolocator.getLastKnownPosition();
    return await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.low, timeLimit: Duration(seconds: 8)));
  } catch (_) {
    return Geolocator.getLastKnownPosition();
  }
}
