import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import '../../core/api.dart';
import '../../core/cache.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Live queue position. Realtime is used only on this screen: a public broadcast channel per shop
/// (fires when any number is called) + the customer's own ticket row. Everything else is push.
class TicketPage extends StatefulWidget {
  const TicketPage({super.key, required this.shopId, required this.shopName});
  final String shopId, shopName;
  @override
  State<TicketPage> createState() => _TicketPageState();
}

class _TicketPageState extends State<TicketPage> {
  String? _ticketId;
  Map<String, dynamic>? _pos;
  final _chans = <RealtimeChannel>[];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final cached = await Cache.get('ticket:${widget.shopId}');
    if (cached != null && mounted) setState(() => _pos = Map<String, dynamic>.from(cached as Map));
    try {
      final r = await sb.from('queue_tickets').select('id').eq('shop_id', widget.shopId).inFilter('status', ['waiting', 'called', 'serving']).order('created_at', ascending: false).limit(1);
      if ((r as List).isNotEmpty) {
        _ticketId = r.first['id'] as String;
        await _refresh();
        _subscribe();
      } else if (mounted) {
        setState(() => _pos = null);
      }
    } catch (_) {/* offline: cached ticket stays visible */}
  }

  Future<void> _join() async {
    setState(() => _busy = true);
    HapticFeedback.mediumImpact();
    try {
      final t = await rpc('join_queue', {'p_shop': widget.shopId});
      _ticketId = (t as Map)['id'] as String;
      await _refresh();
      _subscribe();
    } catch (e) {
      if (mounted) toast(context, errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refresh() async {
    final p = await rpc('ticket_position', {'p_ticket': _ticketId});
    if (p == null) return;
    final m = Map<String, dynamic>.from(p as Map);
    await Cache.put('ticket:${widget.shopId}', m);
    if (!mounted) return;
    if (m['status'] == 'called' && _pos?['status'] != 'called') HapticFeedback.heavyImpact();
    setState(() => _pos = m);
  }

  void _subscribe() {
    if (_chans.isNotEmpty) return;
    _chans.add(sb.channel('shop:${widget.shopId}').onBroadcast(event: 'call', callback: (_) => _refresh()).subscribe());
    _chans.add(sb
        .channel('ticket:$_ticketId')
        .onPostgresChanges(
            event: PostgresChangeEvent.update, schema: 'public', table: 'queue_tickets',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'id', value: _ticketId!),
            callback: (_) => _refresh())
        .subscribe());
  }

  @override
  void dispose() {
    for (final c in _chans) {
      sb.removeChannel(c);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = _pos;
    final st = p?['status'] as String?;
    final active = st == 'waiting' || st == 'called' || st == 'serving';
    return Scaffold(
      appBar: AppBar(title: Text(widget.shopName)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          if (!active) ...[
            const Icon(Icons.confirmation_number, size: 72, color: green),
            const SizedBox(height: 24),
            FilledButton(onPressed: _busy ? null : _join, child: Text(tr('join_queue'))),
          ] else ...[
            Text(tr('your_number'), style: const TextStyle(color: Colors.black54)),
            Text('#${p!['number']}', style: const TextStyle(fontSize: 72, fontWeight: FontWeight.w900, color: green)),
            if (st == 'called') Container(
                padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: green, borderRadius: BorderRadius.circular(16)),
                child: Text(tr('your_turn'), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)))
            else ...[
              Text('${p['ahead'] ?? 0} ${tr('ahead')}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              Text('${tr('est_wait')}: ~${((p['wait_secs'] as int?) ?? 0) ~/ 60} ${tr('min')}'),
            ],
            const SizedBox(height: 8),
            Text('${tr('now_serving')}: ${p['serving'] != null ? '#${p['serving']}' : '-'}'),
            const SizedBox(height: 32),
            OutlinedButton(
                onPressed: () async {
                  final nav = Navigator.of(context);
                  await rpc('cancel_ticket', {'p_ticket': _ticketId});
                  await Cache.put('ticket:${widget.shopId}', null);
                  nav.pop();
                },
                child: Text(tr('leave_queue'))),
          ],
        ]),
      ),
    );
  }
}
