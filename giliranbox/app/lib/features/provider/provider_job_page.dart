import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../jobs/chat_page.dart';
import '../jobs/sos.dart';
import 'tracker.dart';

/// Provider's working screen: customer contact (visible only after accept), navigation, status buttons,
/// scrap weigh-in. Location sharing runs only while status is accepted / on_the_way / arrived.
class ProviderJobPage extends StatefulWidget {
  const ProviderJobPage({super.key, required this.jobId});
  final String jobId;
  @override
  State<ProviderJobPage> createState() => _ProviderJobPageState();
}

class _ProviderJobPageState extends State<ProviderJobPage> {
  Map<String, dynamic>? _job, _contact;
  List<Map<String, dynamic>> _items = [], _rates = [];
  final _kg = <String, TextEditingController>{};
  final _price = TextEditingController();
  Object? _err;
  bool _busy = false;

  bool get _isScrap => catalog[_job?['category_id']]?['slug'] == 'scrap';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _price.dispose();
    for (final c in _kg.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final j = await sb.from('jobs').select('id,status,category_id,customer_id,scheduled_at,price_cents,description,pay_method,customer:profiles!jobs_customer_id_fkey(full_name)').eq('id', widget.jobId).single();
      final c = await rpc('job_contact', {'p_job': widget.jobId}) as List;
      if (catalog[j['category_id']]?['slug'] == 'scrap' && _rates.isEmpty) {
        _rates = ((await sb.from('scrap_rates').select('item_type,name,cents_per_kg').eq('active', true)) as List).cast<Map<String, dynamic>>();
        _items = ((await sb.from('scrap_items').select('item_type,est_kg').eq('job_id', widget.jobId)) as List).cast<Map<String, dynamic>>();
        for (final r in _rates) {
          final est = _items.where((i) => i['item_type'] == r['item_type']).firstOrNull?['est_kg'];
          _kg.putIfAbsent(r['item_type'] as String, () => TextEditingController(text: est?.toString() ?? ''));
        }
      }
      if (_price.text.isEmpty && j['price_cents'] != null) _price.text = ((j['price_cents'] as int) / 100).toStringAsFixed(0);
      if (!mounted) return;
      setState(() {
        _job = j;
        _contact = c.isEmpty ? null : Map<String, dynamic>.from(c.first as Map);
        _err = null;
      });
      _syncTracking(j['status'] as String);
    } catch (e) {
      if (mounted) setState(() => _err = e);
    }
  }

  void _syncTracking(String st) {
    if (const ['accepted', 'on_the_way', 'arrived'].contains(st)) {
      tracker.start(widget.jobId);
    } else {
      tracker.stop(); // location stops completely once the job is in progress / finished
    }
  }

  Future<void> _go(String to) async {
    final before = _job;
    setState(() {
      _busy = true;
      _job = {...?_job, 'status': to}; // optimistic
    });
    try {
      if (to == 'done') {
        final cents = ((double.tryParse(_price.text) ?? 0) * 100).round();
        if (cents > 0 && cents != before?['price_cents']) await rpc('set_final_price', {'p_job': widget.jobId, 'p_price': cents});
      }
      await rpc('set_job_status', {'p_job': widget.jobId, 'p_to': to});
      await _load();
    } catch (e) {
      if (mounted) {
        setState(() => _job = before);
        toast(context, errText(e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  double get _payout => _rates.fold(0.0, (s, r) => s + (double.tryParse(_kg[r['item_type']]?.text ?? '') ?? 0) * (r['cents_per_kg'] as int));

  Future<void> _weigh() async {
    final items = [
      for (final r in _rates)
        if ((double.tryParse(_kg[r['item_type']]!.text) ?? 0) > 0) {'item_type': r['item_type'], 'actual_kg': double.parse(_kg[r['item_type']]!.text)}
    ];
    if (items.isEmpty) return;
    setState(() => _busy = true);
    try {
      await rpc('complete_scrap', {'p_job': widget.jobId, 'p_items': items});
      await _load();
    } catch (e) {
      if (mounted) toast(context, errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _nav(String app) async {
    final lat = _contact?['lat'], lng = _contact?['lng'];
    if (lat == null) return;
    final u = app == 'waze' ? 'https://waze.com/ul?ll=$lat,$lng&navigate=yes' : 'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng';
    await launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    if (_job == null) return Scaffold(appBar: AppBar(), body: _err != null ? ErrorRetry(error: _err!, onRetry: _load) : const SkelList(n: 3));
    final j = _job!;
    final st = j['status'] as String;
    final cname = (j['customer'] as Map?)?['full_name'] as String?;
    final live = !const ['done', 'cancelled', 'expired'].contains(st);
    return Scaffold(
      appBar: AppBar(title: Text(loc(catalog[j['category_id']]?['name'])), actions: [
        if (live) IconButton(icon: const Icon(Icons.sos, color: Colors.red), onPressed: () => showSos(context, widget.jobId)),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
            child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('s_$st'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            if (j['scheduled_at'] != null) Text(dateKL(j['scheduled_at'] as String)),
            const Divider(height: 24),
            Text(cname ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
            if (_contact != null) ...[
              Text(_contact!['address_line'] as String), // revealed only after accept
              if (_contact!['contact_phone'] != null) Text(_contact!['contact_phone'] as String),
            ] else
              const Text('—'),
            if ((j['description'] as String?)?.isNotEmpty ?? false) Padding(padding: const EdgeInsets.only(top: 8), child: Text(j['description'] as String)),
          ]),
        )),
        if (live && _contact != null) ...[
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => _nav('waze'), icon: const Icon(Icons.navigation), label: const Text('Waze'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: () => _nav('gmaps'), icon: const Icon(Icons.map), label: const Text('Maps'))),
            const SizedBox(width: 8),
            IconButton.outlined(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatPage(jobId: widget.jobId, title: cname ?? ''))), icon: const Icon(Icons.chat)),
          ]),
        ],
        const SizedBox(height: 16),
        if (_isScrap && (st == 'arrived' || st == 'in_progress')) ...[
          Text(tr('weigh'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          for (final r in _rates)
            Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(children: [
                  Expanded(child: Text('${loc(r['name'])}  (${rm(r['cents_per_kg'] as int)}/kg)')),
                  SizedBox(width: 110, child: TextField(controller: _kg[r['item_type']], keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('actual_kg'), isDense: true))),
                ])),
          const SizedBox(height: 12),
          Text('${tr('payout')}: ${rm(_payout.round())}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: green)),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _weigh, child: Text(tr('weigh'))),
        ] else if (st == 'accepted')
          FilledButton(onPressed: _busy ? null : () => _go('on_the_way'), child: Text(tr('on_the_way')))
        else if (st == 'on_the_way')
          FilledButton(onPressed: _busy ? null : () => _go('arrived'), child: Text(tr('arrived')))
        else if (st == 'arrived')
          FilledButton(onPressed: _busy ? null : () => _go('in_progress'), child: Text(tr('start')))
        else if (st == 'in_progress') ...[
          TextField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('final_price'))),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : () => _go('done'), child: Text(tr('complete'))),
        ] else if (st == 'done')
          Center(child: Text(rm(j['price_cents'] as int?), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: green))),
        if (live && st != 'in_progress') ...[
          const SizedBox(height: 8),
          TextButton(onPressed: _busy ? null : () => _go('cancelled'), child: Text(tr('cancel'))),
        ],
      ]),
    );
  }
}
