import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/images.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../jobs/job_page.dart';
import 'address_picker.dart' deferred as picker;

/// One adaptive booking screen for the 3 booking types (+ scrap special case).
/// instant: request now | scheduled: date + slot | quote: photos + description | scrap: items + est. kg.
class BookingPage extends StatefulWidget {
  const BookingPage({super.key, required this.category});
  final Map<String, dynamic> category;
  @override
  State<BookingPage> createState() => _BookingPageState();
}

class _BookingPageState extends State<BookingPage> {
  List<Map<String, dynamic>> _addrs = [];
  Map<String, dynamic>? _addr;
  DateTime? _day;
  int? _hour;
  final _desc = TextEditingController();
  final _photos = <File>[];
  final _kg = <String, double>{};
  String _pay = 'cash';
  bool _busy = false;
  List<Map<String, dynamic>> _rates = [];

  String get _type => widget.category['type'] as String;
  bool get _scrap => widget.category['slug'] == 'scrap';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final a = await rpc('my_addresses') as List;
      if (_scrap) {
        _rates = ((await sb.from('scrap_rates').select('item_type,name,cents_per_kg').eq('active', true)) as List).cast<Map<String, dynamic>>();
      }
      if (!mounted) return;
      setState(() {
        _addrs = a.cast<Map<String, dynamic>>();
        _addr ??= _addrs.firstOrNull;
      });
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  Future<void> _pin() async {
    await picker.loadLibrary(); // Google Maps code is only loaded now
    if (!mounted) return;
    final r = await Navigator.push<Map<String, dynamic>>(context, MaterialPageRoute(builder: (_) => picker.AddressPicker()));
    if (r == null) return;
    try {
      await rpc('add_address', {'p_label': r['label'], 'p_line': r['line'], 'p_lat': r['lat'], 'p_lng': r['lng']});
      await _load();
      if (mounted) setState(() => _addr = _addrs.firstOrNull);
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  double get _estPayout => _kg.entries.fold(0.0, (s, e) => s + e.value * ((_rates.firstWhere((r) => r['item_type'] == e.key)['cents_per_kg']) as int));

  bool get _ready {
    if (_addr == null) return false;
    if (_type == 'scheduled' && (_day == null || _hour == null)) return false;
    if (_type == 'quote' && _photos.isEmpty) return false;
    if (_scrap && _kg.values.every((v) => v <= 0)) return false;
    return true;
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    HapticFeedback.lightImpact();
    try {
      final jobId = _newUuid();
      final paths = <String>[];
      for (final f in _photos) {
        paths.add(await uploadWebp('job-photos', jobId, f));
      }
      final id = await rpc('create_job', {
        'p_category': widget.category['id'],
        'p_lat': _addr!['lat'],
        'p_lng': _addr!['lng'],
        'p_address': _addr!['line'],
        'p_phone': sb.auth.currentUser?.phone == null ? null : '+${sb.auth.currentUser!.phone}',
        'p_description': _desc.text.trim().isEmpty ? null : _desc.text.trim(),
        'p_photos': paths,
        'p_scheduled': _type == 'scheduled' ? klToUtc(_day!.year, _day!.month, _day!.day, _hour!).toIso8601String() : null,
        'p_pay': _pay,
        'p_scrap': _scrap ? [for (final e in _kg.entries) if (e.value > 0) {'item_type': e.key, 'est_kg': e.value}] : null,
        'p_id': jobId,
      });
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => JobPage(jobId: id as String)));
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        toast(context, errText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.category;
    final from = c['from'] as int?;
    final today = DateTime.now();
    return Scaffold(
      appBar: AppBar(title: Text(loc(c['name']))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (from != null) _Pill('${loc(c['label'])} ${rm(from)}'),
        if (_scrap) _Pill(tr('scrap_note')),
        _H(tr('address')),
        RadioGroup<String>(
          groupValue: _addr?['id'] as String?,
          onChanged: (v) => setState(() => _addr = _addrs.firstWhere((a) => a['id'] == v)),
          child: Column(children: [
            for (final a in _addrs)
              RadioListTile<String>(
                  value: a['id'] as String, title: Text(a['label'] as String), subtitle: Text(a['line'] as String, maxLines: 2, overflow: TextOverflow.ellipsis)),
          ]),
        ),
        OutlinedButton.icon(onPressed: _pin, icon: const Icon(Icons.add_location_alt), label: Text(tr('add_address'))),
        if (_type == 'scheduled') ...[
          _H(tr('pick_date')),
          SizedBox(
              height: 64,
              child: ListView.separated(
                  scrollDirection: Axis.horizontal, itemCount: 14, separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final d = DateTime(today.year, today.month, today.day + i + 1);
                    return ChoiceChip(
                        label: Text('${d.day}/${d.month}'), selected: _day == d, onSelected: (_) => setState(() => _day = d));
                  })),
          _H(tr('pick_slot')),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final h in const [9, 11, 13, 15, 17])
              ChoiceChip(label: Text('${two(h)}:00 – ${two(h + 2)}:00'), selected: _hour == h, onSelected: (_) => setState(() => _hour = h)),
          ]),
        ],
        if (_scrap) ...[
          _H(tr('scrap_items')),
          for (final r in _rates)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(child: Text('${loc(r['name'])}\n${rm(r['cents_per_kg'] as int)}/kg', style: const TextStyle(fontSize: 14))),
                SizedBox(
                    width: 120,
                    child: TextField(
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(labelText: tr('est_kg'), isDense: true),
                        onChanged: (v) => setState(() => _kg[r['item_type'] as String] = double.tryParse(v) ?? 0))),
              ]),
            ),
          if (_estPayout > 0) _Pill('${tr('you_receive')} ${rm(_estPayout.round())}'),
        ],
        if (_type == 'quote') ...[
          _H(tr('photos')),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final f in _photos) ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(f, width: 72, height: 72, fit: BoxFit.cover, cacheWidth: 144)),
            if (_photos.length < 5)
              InkWell(
                  onTap: () async {
                    final f = await pickCompressed();
                    if (f != null) setState(() => _photos.add(f));
                  },
                  child: Container(width: 72, height: 72, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.add_a_photo))),
          ]),
        ],
        _H(tr('describe')),
        TextField(controller: _desc, maxLines: 3, maxLength: 500),
        _H(tr('payment')),
        RadioGroup<String>(
          groupValue: _pay,
          onChanged: (v) => setState(() => _pay = v ?? 'cash'),
          child: Column(children: [
            RadioListTile<String>(value: 'cash', title: Text(tr('cash'))),
            // Online payment is a placeholder: DuitNow / FPX gateway is not implemented yet.
            RadioListTile<String>(value: 'duitnow', enabled: false, title: Text(tr('duitnow'))),
            RadioListTile<String>(value: 'fpx', enabled: false, title: Text(tr('fpx'))),
          ]),
        ),
        const SizedBox(height: 12),
        FilledButton(
            onPressed: _busy || !_ready ? null : _submit,
            child: _busy
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(_type == 'instant' ? tr('request_now') : _type == 'quote' ? tr('request_quotes') : tr('book'))),
        const SizedBox(height: 24),
      ]),
    );
  }
}

class _H extends StatelessWidget {
  const _H(this.t);
  final String t;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 20, bottom: 8), child: Text(t, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)));
}

class _Pill extends StatelessWidget {
  const _Pill(this.t);
  final String t;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: green.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)), child: Text(t));
}

String _newUuid() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}
