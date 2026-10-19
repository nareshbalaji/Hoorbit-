import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/cache.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'chat_page.dart';
import 'sos.dart';
import 'tracking_map.dart' deferred as track;

const _steps = ['accepted', 'on_the_way', 'arrived', 'in_progress', 'done'];

/// Customer view of one job. Realtime is subscribed only while this screen is open and the job is active.
class JobPage extends StatefulWidget {
  const JobPage({super.key, required this.jobId});
  final String jobId;
  @override
  State<JobPage> createState() => _JobPageState();
}

class _JobPageState extends State<JobPage> {
  Map<String, dynamic>? _job;
  List<Map<String, dynamic>> _quotes = [];
  Map<String, dynamic>? _contact;
  RealtimeChannel? _ch;
  Object? _err;
  bool _trackLoaded = false;

  static const _cols = 'id,status,type,category_id,scheduled_at,price_cents,payout_cents,tip_cents,provider_id,created_at,done_at,description,'
      'provider:providers(photo_url,rating_avg,rating_count,profiles(full_name))';

  bool get _active => _job != null && !const ['done', 'cancelled', 'expired'].contains(_job!['status']);

  @override
  void initState() {
    super.initState();
    _load(first: true);
  }

  @override
  void dispose() {
    if (_ch != null) sb.removeChannel(_ch!);
    super.dispose();
  }

  Future<void> _load({bool first = false}) async {
    final key = 'job:${widget.jobId}';
    if (first) {
      final c = await Cache.get(key);
      if (c != null && mounted) setState(() => _job = Map<String, dynamic>.from(c as Map));
    }
    try {
      final j = await sb.from('jobs').select(_cols).eq('id', widget.jobId).single();
      await Cache.put(key, j);
      if (j['status'] == 'quoting') {
        _quotes = ((await sb.from('quotes').select('id,price_cents,message,status,provider:providers(rating_avg,rating_count,profiles(full_name))').eq('job_id', widget.jobId).order('price_cents')) as List).cast<Map<String, dynamic>>();
      }
      if (j['provider_id'] != null && !const ['cancelled', 'expired'].contains(j['status'])) {
        final c = await rpc('job_contact', {'p_job': widget.jobId}) as List;
        _contact = c.isEmpty ? null : Map<String, dynamic>.from(c.first as Map);
      }
      if (!mounted) return;
      setState(() {
        _job = j;
        _err = null;
      });
      _subscribe();
    } catch (e) {
      if (mounted && _job == null) setState(() => _err = e);
    }
  }

  void _subscribe() {
    if (_ch != null || !_active) return;
    _ch = sb
        .channel('job:${widget.jobId}')
        .onPostgresChanges(
            event: PostgresChangeEvent.all, schema: 'public', table: 'jobs',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'id', value: widget.jobId),
            callback: (_) => _load())
        .onPostgresChanges(
            event: PostgresChangeEvent.insert, schema: 'public', table: 'quotes',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'job_id', value: widget.jobId),
            callback: (_) => _load())
        .subscribe();
  }

  Future<void> _do(Future<dynamic> Function() f, {Map<String, dynamic>? optimistic}) async {
    final before = _job;
    if (optimistic != null && _job != null) setState(() => _job = {..._job!, ...optimistic}); // instant feedback, sync after
    try {
      await f();
      await _load();
    } catch (e) {
      if (mounted) {
        setState(() => _job = before);
        toast(context, errText(e));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_job == null) return Scaffold(appBar: AppBar(), body: _err != null ? ErrorRetry(error: _err!, onRetry: () => _load(first: true)) : const SkelList(n: 3));
    final j = _job!;
    final st = j['status'] as String;
    final cat = catalog[j['category_id']];
    final prov = j['provider'] as Map?;
    final pname = (prov?['profiles'] as Map?)?['full_name'] as String?;
    final stepIdx = _steps.indexOf(st);
    return Scaffold(
      appBar: AppBar(title: Text(cat == null ? tr('activity') : loc(cat['name'])), actions: [
        if (_active) IconButton(icon: const Icon(Icons.sos, color: Colors.red), onPressed: () => showSos(context, widget.jobId)),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
            child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('s_$st'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            if (j['scheduled_at'] != null) Text(dateKL(j['scheduled_at'] as String)),
            if (st == 'searching') const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator()),
            if (stepIdx >= 0) ...[
              const SizedBox(height: 12),
              Row(children: [for (var i = 0; i < _steps.length; i++) Expanded(child: Container(height: 5, margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(color: i <= stepIdx ? green : const Color(0xFFE6E8EA), borderRadius: BorderRadius.circular(3))))]),
            ],
            if (j['price_cents'] != null && (j['price_cents'] as int) > 0) Padding(padding: const EdgeInsets.only(top: 12), child: Text(rm(j['price_cents'] as int), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
            if (j['payout_cents'] != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text('${tr('you_receive')} ${rm(j['payout_cents'] as int)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: green))),
          ]),
        )),
        if (st == 'on_the_way') ...[
          const SizedBox(height: 12),
          SizedBox(
              height: 220,
              child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: FutureBuilder<void>(
                      future: _trackLoaded ? null : track.loadLibrary().then((_) => _trackLoaded = true),
                      builder: (_, s) => s.connectionState == ConnectionState.done || _trackLoaded
                          ? track.TrackingMap(jobId: widget.jobId, dest: _contact == null ? null : (_contact!['lat'] as num, _contact!['lng'] as num))
                          : const Skel(h: 220, r: 16)))),
        ],
        if (prov != null) ...[
          const SizedBox(height: 12),
          Card(
              child: ListTile(
            leading: AvatarThumb(prov['photo_url'] as String?),
            title: Text(pname ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('★ ${prov['rating_avg']} (${prov['rating_count']})'),
            trailing: _active
                ? Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(icon: const Icon(Icons.chat), tooltip: tr('chat'), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatPage(jobId: widget.jobId, title: pname ?? '')))),
                    IconButton(icon: const Icon(Icons.phone), tooltip: tr('call'), onPressed: () => _maskedCall()),
                  ])
                : null,
          )),
        ],
        if (st == 'quoting') ...[
          const SizedBox(height: 12),
          Text(tr('quotes'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          for (final q in _quotes)
            Card(
                child: ListTile(
              title: Text('${rm(q['price_cents'] as int)}  ·  ${((q['provider'] as Map?)?['profiles'] as Map?)?['full_name'] ?? ''}'),
              subtitle: Text('${q['message'] ?? ''}\n★ ${(q['provider'] as Map?)?['rating_avg']}'),
              isThreeLine: true,
              trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 40)), onPressed: () => _do(() => rpc('accept_quote', {'p_quote': q['id']})), child: Text(tr('accept'))),
            )),
        ],
        const SizedBox(height: 16),
        if (_active && const ['searching', 'quoting', 'pending', 'accepted', 'on_the_way', 'arrived'].contains(st))
          OutlinedButton(onPressed: () => _do(() => rpc('set_job_status', {'p_job': widget.jobId, 'p_to': 'cancelled'}), optimistic: {'status': 'cancelled'}), child: Text(tr('cancel'))),
        if (st == 'done') ...[
          FilledButton(onPressed: () => _review(), child: Text(tr('rate'))),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => _repeat(), child: Text(tr('repeat'))),
        ],
        if (st == 'done' || st == 'cancelled') ...[
          const SizedBox(height: 8),
          TextButton(onPressed: () => _report(), child: Text(tr('report'))),
        ],
      ]),
    );
  }

  /// Masked call: the Edge Function `mask-call` returns a proxy number (Twilio Proxy / similar). Placeholder-safe.
  Future<void> _maskedCall() async {
    try {
      final r = await sb.functions.invoke('mask-call', body: {'job_id': widget.jobId});
      final n = (r.data as Map)['number'] as String;
      await launchUrl(Uri(scheme: 'tel', path: n));
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  Future<void> _review() async {
    var stars = 5;
    final comment = TextEditingController();
    var tip = 0;
    final ok = await showModalBottomSheet<bool>(
        context: context, isScrollControlled: true,
        builder: (c) => StatefulBuilder(
            builder: (c, set) => Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(c).bottom),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [for (var i = 1; i <= 5; i++) IconButton(onPressed: () => set(() => stars = i), icon: Icon(i <= stars ? Icons.star : Icons.star_border, color: Colors.amber, size: 36))]),
                  TextField(controller: comment, decoration: InputDecoration(labelText: tr('rate'))),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: [for (final t in const [0, 200, 500, 1000]) ChoiceChip(label: Text(t == 0 ? '-' : '${tr('tip')} ${rm(t)}'), selected: tip == t, onSelected: (_) => set(() => tip = t))]),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('submit'))),
                ]))));
    final text = comment.text.trim();
    comment.dispose();
    if (ok == true) await _do(() => rpc('submit_review', {'p_job': widget.jobId, 'p_rating': stars, 'p_comment': text.isEmpty ? null : text, 'p_tip': tip}));
  }

  Future<void> _report() async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(title: Text(tr('report')), content: TextField(controller: c, maxLines: 3, maxLength: 500), actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
              TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('submit'))),
            ]));
    final reason = c.text.trim();
    c.dispose();
    if (ok == true && reason.isNotEmpty) await _do(() => rpc('report_problem', {'p_job': widget.jobId, 'p_reason': reason}));
  }

  Future<void> _repeat() async {
    final cat = catalog[_job!['category_id']];
    var days = (cat?['repeat'] as int?) ?? 30;
    var auto = days <= 14; // weekly cleaning books itself; "aircond every 4 months" just reminds
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => StatefulBuilder(
            builder: (d, set) => AlertDialog(title: Text(tr('repeat')), content: Column(mainAxisSize: MainAxisSize.min, children: [
                  Row(children: [
                    Expanded(child: Text(tr('every_days'))),
                    DropdownButton<int>(value: const [7, 14, 30, 60, 90, 120, 180, 365].contains(days) ? days : null, items: [for (final x in const [7, 14, 30, 60, 90, 120, 180, 365]) DropdownMenuItem(value: x, child: Text('$x'))], onChanged: (v) => set(() => days = v ?? days)),
                  ]),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('auto_book'), style: const TextStyle(fontSize: 14)), value: auto, onChanged: (v) => set(() => auto = v)),
                ]), actions: [
                  TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
                  TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('submit'))),
                ])));
    if (ok != true) return;
    await _do(() => rpc('repeat_job', {'p_job': widget.jobId, 'p_every_days': days, 'p_auto_book': auto}));
    if (mounted) toast(context, tr('reminder_set'));
  }
}
