import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart' show Geolocator;
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import '../../core/api.dart';
import '../../core/i18n.dart';

/// Live provider position. Deferred-loaded (the only other user of the Maps SDK besides the address picker).
/// Subscribes to the single `job_tracking` row of this job and unsubscribes on dispose.
class TrackingMap extends StatefulWidget {
  const TrackingMap({super.key, required this.jobId, this.dest});
  final String jobId;
  final (num, num)? dest;
  @override
  State<TrackingMap> createState() => _TrackingMapState();
}

class _TrackingMapState extends State<TrackingMap> {
  LatLng? _p;
  GoogleMapController? _map;
  RealtimeChannel? _ch;

  @override
  void initState() {
    super.initState();
    sb.from('job_tracking').select('lat,lng').eq('job_id', widget.jobId).maybeSingle().then((r) {
      if (r != null) _set(r);
    });
    _ch = sb
        .channel('track:${widget.jobId}')
        .onPostgresChanges(
            event: PostgresChangeEvent.all, schema: 'public', table: 'job_tracking',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'job_id', value: widget.jobId),
            callback: (payload) => _set(payload.newRecord))
        .subscribe();
  }

  void _set(Map<String, dynamic> r) {
    if (r['lat'] == null || !mounted) return;
    final p = LatLng((r['lat'] as num).toDouble(), (r['lng'] as num).toDouble());
    setState(() => _p = p);
    _map?.animateCamera(CameraUpdate.newLatLng(p));
  }

  @override
  void dispose() {
    if (_ch != null) sb.removeChannel(_ch!);
    _map?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.dest;
    final km = _p != null && d != null ? Geolocator.distanceBetween(_p!.latitude, _p!.longitude, d.$1.toDouble(), d.$2.toDouble()) : null;
    return Stack(children: [
      GoogleMap(
        initialCameraPosition: CameraPosition(target: _p ?? LatLng(d?.$1.toDouble() ?? 3.1073, d?.$2.toDouble() ?? 101.6067), zoom: 14),
        onMapCreated: (m) => _map = m,
        markers: {
          if (_p != null) Marker(markerId: const MarkerId('p'), position: _p!, icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen)),
          if (d != null) Marker(markerId: const MarkerId('d'), position: LatLng(d.$1.toDouble(), d.$2.toDouble())),
        },
        zoomControlsEnabled: false, mapToolbarEnabled: false, myLocationButtonEnabled: false,
      ),
      if (km != null)
        Positioned(left: 8, bottom: 8, child: Chip(label: Text('${(km / 1000).toStringAsFixed(1)} km ${tr('away')}'))),
    ]);
  }
}
