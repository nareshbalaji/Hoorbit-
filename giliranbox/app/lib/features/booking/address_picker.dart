import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/i18n.dart';
import '../../core/location.dart';
import '../../core/widgets.dart';

/// Loaded on demand (deferred import) - the full Google Maps SDK is only pulled in for this screen
/// and the live-tracking screen. Drag the map under the centre pin, name the place, confirm.
class AddressPicker extends StatefulWidget {
  const AddressPicker({super.key});
  @override
  State<AddressPicker> createState() => _AddressPickerState();
}

class _AddressPickerState extends State<AddressPicker> {
  LatLng _c = const LatLng(3.1073, 101.6067); // Petaling Jaya
  final _label = TextEditingController(text: 'Home');
  final _line = TextEditingController();
  GoogleMapController? _map;

  @override
  void initState() {
    super.initState();
    oneShotFix().then((p) {
      if (p != null && mounted) _map?.animateCamera(CameraUpdate.newLatLng(LatLng(p.latitude, p.longitude)));
    });
  }

  @override
  void dispose() {
    _label.dispose();
    _line.dispose();
    _map?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('add_address'))),
        body: Column(children: [
          Expanded(
            child: Stack(alignment: Alignment.center, children: [
              GoogleMap(
                initialCameraPosition: CameraPosition(target: _c, zoom: 15),
                onMapCreated: (m) => _map = m,
                onCameraMove: (p) => _c = p.target,
                myLocationEnabled: false, // we use a one-shot fix instead of a continuous blue dot
                zoomControlsEnabled: false, mapToolbarEnabled: false, liteModeEnabled: false,
              ),
              const Padding(padding: EdgeInsets.only(bottom: 36), child: Icon(Icons.location_pin, size: 44, color: Colors.red)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              TextField(controller: _label, decoration: InputDecoration(labelText: tr('name'))),
              const SizedBox(height: 8),
              TextField(controller: _line, decoration: InputDecoration(labelText: tr('address')), maxLines: 2),
              const SizedBox(height: 12),
              FilledButton(
                  onPressed: () {
                    if (_line.text.trim().isEmpty) return toast(context, tr('address'));
                    Navigator.pop(context, {'label': _label.text.trim(), 'line': _line.text.trim(), 'lat': _c.latitude, 'lng': _c.longitude});
                  },
                  child: Text(tr('submit'))),
            ]),
          ),
        ]),
      );
}
