import 'dart:io';
import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/i18n.dart';
import '../../core/images.dart';
import '../../core/location.dart';
import '../../core/widgets.dart';

/// Provider onboarding (deferred-loaded: most users never open it). Admin must approve before going live.
class ProviderSignup extends StatefulWidget {
  const ProviderSignup({super.key});
  @override
  State<ProviderSignup> createState() => _ProviderSignupState();
}

class _ProviderSignupState extends State<ProviderSignup> {
  List<Map<String, dynamic>> _cats = [];
  final _sel = <int>{};
  double _radius = 10;
  final _ic = TextEditingController();
  File? _photo;
  final _docs = <String, File>{};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    sb.from('categories').select('id,name,license_kind').neq('slug', 'queue').order('sort').then((r) {
      if (mounted) setState(() => _cats = (r as List).cast<Map<String, dynamic>>());
    });
  }

  @override
  void dispose() {
    _ic.dispose();
    super.dispose();
  }

  Set<String> get _needed => {for (final c in _cats) if (_sel.contains(c['id']) && c['license_kind'] != null) c['license_kind'] as String};

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final p = await oneShotFix();
      await rpc('become_provider', {
        'p_categories': _sel.toList(), 'p_radius': _radius, 'p_ic_last4': _ic.text.trim(),
        'p_lat': p?.latitude ?? 3.1073, 'p_lng': p?.longitude ?? 101.6067,
      });
      if (_photo != null) {
        final path = await uploadWebp('public-img', 'avatar', _photo!);
        await sb.from('providers').update({'photo_url': path}).eq('id', uid!);
      }
      for (final e in _docs.entries) {
        final path = await uploadWebp('provider-docs', e.key, e.value);
        await sb.from('provider_documents').insert({'provider_id': uid, 'kind': e.key, 'file_path': path});
      }
      await app.setProviderMode(true);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        toast(context, errText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('become_provider'))),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Text(tr('categories'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          Wrap(spacing: 8, children: [for (final c in _cats) FilterChip(label: Text(loc(c['name'])), selected: _sel.contains(c['id']), onSelected: (v) => setState(() => v ? _sel.add(c['id'] as int) : _sel.remove(c['id'])))]),
          const SizedBox(height: 16),
          Text('${tr('service_area')}: ${_radius.round()}'),
          Slider(value: _radius, min: 2, max: 30, divisions: 14, onChanged: (v) => setState(() => _radius = v)),
          TextField(controller: _ic, keyboardType: TextInputType.number, maxLength: 4, decoration: InputDecoration(labelText: tr('ic_last4'))), // IC verification placeholder
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: () async { final f = await pickCompressed(); if (f != null) setState(() => _photo = f); }, icon: Icon(_photo == null ? Icons.camera_alt : Icons.check_circle), label: Text('${tr('upload')}: Photo')),
          if (_needed.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(tr('licences'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            for (final k in _needed)
              Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(
                  onPressed: () async { final f = await pickCompressed(); if (f != null) setState(() => _docs[k] = f); },
                  icon: Icon(_docs.containsKey(k) ? Icons.check_circle : Icons.upload_file), label: Text('${tr('upload')}: $k'))),
          ],
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy || _sel.isEmpty || !_needed.every(_docs.containsKey) ? null : _submit, child: Text(tr('submit_application'))),
        ]),
      );
}
