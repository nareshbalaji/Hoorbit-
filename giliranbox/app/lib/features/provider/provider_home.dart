import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/location.dart';
import '../../core/push.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'provider_job_page.dart';
import 'provider_signup.dart' deferred as signup;

/// Provider landing tab. Realtime listens to this provider's own job_offers ONLY while this tab is alive;
/// when the app is in the background the push notification (with sound) does the alerting.
class ProviderHome extends StatefulWidget {
  const ProviderHome({super.key});
  @override
  State<ProviderHome> createState() => _ProviderHomeState();
}

class _ProviderHomeState extends State<ProviderHome> with WidgetsBindingObserver {
  Map<String, dynamic>? _me; // providers row (or null if not signed up)
  List<Map<String, dynamic>> _offers = [];
  Map<String, dynamic>? _active;
  RealtimeChannel? _ch;
  bool _loading = true;
  Object? _err;

  @override
  void initState() {
    super.initState();
    Push.newJob.addListener(_load);
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  /// Idle position is refreshed with ONE fix whenever the app returns to the foreground while online
  /// (no continuous tracking while idle). Providers also drop offline automatically after 8 h of silence.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _me?['online'] == true) {
      oneShotFix().then((p) => rpc('set_online', {'p_online': true, 'p_lat': p?.latitude, 'p_lng': p?.longitude}).catchError((_) => null));
      _load();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    Push.newJob.removeListener(_load);
    if (_ch != null) sb.removeChannel(_ch!);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final me = await sb.from('providers').select('status,online,rating_avg,jobs_done').eq('id', uid!).maybeSingle();
      List offers = [];
      Map<String, dynamic>? active;
      if (me != null && me['status'] == 'approved') {
        offers = await sb
            .from('job_offers')
            .select('job_id,distance_m,expires_at,job:jobs(category_id,type,description,scheduled_at,price_cents)')
            .eq('status', 'offered')
            .gt('expires_at', DateTime.now().toUtc().toIso8601String())
            .order('created_at', ascending: false)
            .limit(20);
        final a = await sb.from('jobs').select('id,status,category_id').eq('provider_id', uid!).inFilter('status', ['accepted', 'on_the_way', 'arrived', 'in_progress']).limit(1);
        active = (a as List).isEmpty ? null : Map<String, dynamic>.from(a.first as Map);
        _subscribe();
      }
      if (!mounted) return;
      setState(() {
        _me = me;
        _offers = offers.cast<Map<String, dynamic>>();
        _active = active;
        _loading = false;
        _err = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _err = e;
        });
      }
    }
  }

  void _subscribe() {
    if (_ch != null) return;
    _ch = sb
        .channel('offers:$uid')
        .onPostgresChanges(
            event: PostgresChangeEvent.insert, schema: 'public', table: 'job_offers',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'provider_id', value: uid!),
            callback: (_) {
              SystemSound.play(SystemSoundType.alert); // job alert sound
              HapticFeedback.heavyImpact();
              _load();
            })
        .subscribe();
  }

  Future<void> _toggle(bool on) async {
    final before = _me;
    setState(() => _me = {...?_me, 'online': on}); // optimistic
    try {
      final p = on ? await oneShotFix() : null; // a single position fix; no continuous tracking while idle
      await rpc('set_online', {'p_online': on, 'p_lat': p?.latitude, 'p_lng': p?.longitude});
    } catch (e) {
      if (mounted) {
        setState(() => _me = before);
        toast(context, errText(e));
      }
    }
  }

  Future<void> _accept(Map<String, dynamic> o) async {
    final job = o['job'] as Map;
    final type = job['type'] as String;
    if (type == 'quote') return _quote(o);
    setState(() => _offers.remove(o));
    try {
      await rpc('accept_offer', {'p_job': o['job_id']});
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => ProviderJobPage(jobId: o['job_id'] as String)));
      _load();
    } catch (e) {
      if (mounted) toast(context, errText(e));
      _load();
    }
  }

  Future<void> _quote(Map<String, dynamic> o) async {
    final price = TextEditingController();
    final msg = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(title: Text(tr('send_quote')), content: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('price'))),
              const SizedBox(height: 8),
              TextField(controller: msg, maxLines: 2, decoration: InputDecoration(labelText: tr('describe'))),
            ]), actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
              TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('submit'))),
            ]));
    final cents = ((double.tryParse(price.text) ?? 0) * 100).round();
    final text = msg.text.trim();
    price.dispose();
    msg.dispose();
    if (ok != true || cents <= 0) return;
    try {
      await rpc('submit_quote', {'p_job': o['job_id'], 'p_price': cents, 'p_message': text.isEmpty ? null : text});
      if (mounted) toast(context, '✓ ${tr('send_quote')}');
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  Future<void> _decline(Map<String, dynamic> o) async {
    setState(() => _offers.remove(o)); // optimistic
    rpc('decline_offer', {'p_job': o['job_id']}).catchError((_) => null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const SafeArea(child: SkelList());
    if (_err != null && _me == null) return SafeArea(child: ErrorRetry(error: _err!, onRetry: _load));
    if (_me == null || _me!['status'] == 'rejected') {
      return SafeArea(child: Center(child: Padding(padding: const EdgeInsets.all(24), child: FilledButton(
          onPressed: () async {
            final nav = Navigator.of(context);
            await signup.loadLibrary();
            await nav.push(MaterialPageRoute(builder: (_) => signup.ProviderSignup()));
            _load();
          }, child: Text(tr('become_provider'))))));
    }
    if (_me!['status'] != 'approved') {
      return SafeArea(child: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(tr('pending_approval'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 16)))));
    }
    final online = _me!['online'] == true;
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
              child: SwitchListTile(
            value: online, onChanged: _toggle, activeThumbColor: green,
            title: Text(online ? tr('online') : tr('offline_s'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
            subtitle: Text('★ ${_me!['rating_avg']} · ${_me!['jobs_done']} ${tr('jobs')}'),
          )),
          if (_active != null) ...[
            const SizedBox(height: 12),
            Card(
                color: green,
                child: ListTile(
                  textColor: Colors.white, iconColor: Colors.white,
                  title: Text('${loc(catalog[_active!['category_id']]?['name'])} · ${tr('s_${_active!['status']}')}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await Navigator.push(context, MaterialPageRoute(builder: (_) => ProviderJobPage(jobId: _active!['id'] as String)));
                    _load();
                  },
                )),
          ],
          const SizedBox(height: 16),
          Text(tr('new_jobs'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 8),
          if (_offers.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(tr('no_jobs')))),
          for (final o in _offers) _OfferCard(o, onAccept: () => _accept(o), onDecline: () => _decline(o)),
        ]),
      ),
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard(this.o, {required this.onAccept, required this.onDecline});
  final Map<String, dynamic> o;
  final VoidCallback onAccept, onDecline;
  @override
  Widget build(BuildContext context) {
    final j = o['job'] as Map;
    final cat = catalog[j['category_id']];
    final type = j['type'] as String;
    final secs = DateTime.parse(o['expires_at'] as String).difference(DateTime.now()).inSeconds;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(iconFor(cat?['icon'] as String?), color: green),
              const SizedBox(width: 8),
              Expanded(child: Text(cat == null ? '' : loc(cat['name']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              Text(distanceText(o['distance_m'] as int?), style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            if (j['scheduled_at'] != null) Text(dateKL(j['scheduled_at'] as String)),
            if (j['price_cents'] != null) Text(rm(j['price_cents'] as int)),
            if ((j['description'] as String?)?.isNotEmpty ?? false) Padding(padding: const EdgeInsets.only(top: 4), child: Text(j['description'] as String, maxLines: 2, overflow: TextOverflow.ellipsis)),
            if (type == 'instant' && secs > 0) Text('⏱ ${secs}s', style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: onDecline, child: Text(tr('decline')))),
              const SizedBox(width: 12),
              Expanded(child: FilledButton(onPressed: onAccept, child: Text(type == 'quote' ? tr('send_quote') : tr('accept')))),
            ]),
          ]),
        ),
      ),
    );
  }
}
