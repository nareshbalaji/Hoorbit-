import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import '../../core/api.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Staff counter screen (loaded on demand). NEXT / RECALL / SKIP, plus Raspberry Pi kiosk pairing by QR code.
class CounterPage extends StatefulWidget {
  const CounterPage({super.key, this.pairCode});
  final String? pairCode;
  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> {
  List<Map<String, dynamic>> _shops = [];
  String? _shop;
  Map<String, dynamic>? _snap;
  RealtimeChannel? _ch;
  bool _busy = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final r = await sb.from('shop_staff').select('shop_id,shops(name)').eq('user_id', uid!);
      _shops = (r as List).cast<Map<String, dynamic>>();
      if (_shops.isNotEmpty) await _select(_shops.first['shop_id'] as String);
      if (widget.pairCode != null && _shop != null && mounted) await _pair(widget.pairCode!);
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _select(String id) async {
    if (_ch != null) await sb.removeChannel(_ch!);
    _shop = id;
    await _snapshot();
    // Staff screen only: new walk-in / app tickets show up live.
    _ch = sb
        .channel('counter:$id')
        .onPostgresChanges(
            event: PostgresChangeEvent.all, schema: 'public', table: 'queue_tickets',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'shop_id', value: id),
            callback: (_) => _snapshot())
        .subscribe();
  }

  Future<void> _snapshot() async {
    final s = await rpc('queue_snapshot', {'p_shop': _shop});
    if (mounted) setState(() => _snap = Map<String, dynamic>.from(s as Map));
  }

  Future<void> _act(String fn) async {
    setState(() => _busy = true);
    try {
      await rpc(fn, {'p_shop': _shop});
      await _snapshot();
    } catch (e) {
      if (mounted) toast(context, errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pair(String code) async {
    try {
      await rpc('kiosk_pair_claim', {'p_code': code.trim().toUpperCase(), 'p_shop': _shop, 'p_name': 'Kiosk'});
      if (mounted) toast(context, '✓ ${tr('pair_kiosk')}');
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  Future<void> _pairDialog() async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(title: Text(tr('pair_kiosk')), content: TextField(controller: c, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: tr('pair_code'))), actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
              TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('submit'))),
            ]));
    final code = c.text;
    c.dispose();
    if (ok == true && code.trim().isNotEmpty) await _pair(code);
  }

  @override
  void dispose() {
    if (_ch != null) sb.removeChannel(_ch!);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('counter')), actions: [IconButton(icon: const Icon(Icons.qr_code), tooltip: tr('pair_kiosk'), onPressed: _shop == null ? null : _pairDialog)]),
        body: _loading
            ? const SkelList(n: 3)
            : _shop == null
                ? Center(child: Text(tr('nothing')))
                : Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(children: [
                      if (_shops.length > 1)
                        DropdownButton<String>(
                            value: _shop, isExpanded: true,
                            items: [for (final s in _shops) DropdownMenuItem(value: s['shop_id'] as String, child: Text((s['shops'] as Map)['name'] as String))],
                            onChanged: (v) => _select(v!)),
                      const Spacer(),
                      Text(tr('now_serving'), style: const TextStyle(color: Colors.black54)),
                      Text(_snap?['serving'] != null ? '#${_snap!['serving']}' : '-', style: const TextStyle(fontSize: 96, fontWeight: FontWeight.w900, color: green)),
                      Text('${_snap?['waiting'] ?? 0} ${tr('waiting')}  ·  ~${((_snap?['wait_secs'] as int?) ?? 0) ~/ 60} ${tr('min')}', style: const TextStyle(fontSize: 18)),
                      const Spacer(),
                      FilledButton(onPressed: _busy ? null : () => _act('queue_next'), child: Text(tr('next'))),
                      const SizedBox(height: 12),
                      Row(children: [
                        Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _act('queue_recall'), child: Text(tr('recall')))),
                        const SizedBox(width: 12),
                        Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _act('queue_skip'), child: Text(tr('skip')))),
                      ]),
                    ]),
                  ),
      );
}
