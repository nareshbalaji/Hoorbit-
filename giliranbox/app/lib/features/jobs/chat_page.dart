import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgresChangeEvent, PostgresChangeFilter, PostgresChangeFilterType, RealtimeChannel;
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// In-app chat. Realtime channel lives only while the screen is open; sending is optimistic.
class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.jobId, required this.title});
  final String jobId, title;
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _msgs = <Map<String, dynamic>>[]; // newest first
  final _text = TextEditingController();
  RealtimeChannel? _ch;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    _ch = sb
        .channel('chat:${widget.jobId}')
        .onPostgresChanges(
            event: PostgresChangeEvent.insert, schema: 'public', table: 'messages',
            filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'job_id', value: widget.jobId),
            callback: (p) => _add(p.newRecord))
        .subscribe();
  }

  Future<void> _load() async {
    try {
      final r = await sb.from('messages').select('id,sender_id,body,created_at').eq('job_id', widget.jobId).order('id', ascending: false).limit(50);
      if (mounted) {
        setState(() {
          _msgs
            ..clear()
            ..addAll((r as List).cast<Map<String, dynamic>>());
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        toast(context, errText(e));
      }
    }
  }

  void _add(Map<String, dynamic> m) {
    if (!mounted || _msgs.any((x) => x['id'] == m['id'])) return;
    setState(() {
      _msgs.removeWhere((x) => x['pending'] == true && x['body'] == m['body'] && x['sender_id'] == m['sender_id']);
      _msgs.insert(0, m);
    });
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    _text.clear();
    final tmp = {'id': -DateTime.now().microsecondsSinceEpoch, 'sender_id': uid, 'body': body, 'pending': true};
    setState(() => _msgs.insert(0, tmp)); // optimistic
    try {
      final r = await sb.from('messages').insert({'job_id': widget.jobId, 'sender_id': uid, 'body': body}).select('id,sender_id,body,created_at').single();
      _add(r);
    } catch (e) {
      if (mounted) {
        setState(() => _msgs.remove(tmp));
        toast(context, errText(e));
      }
    }
  }

  @override
  void dispose() {
    if (_ch != null) sb.removeChannel(_ch!);
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: Column(children: [
          Expanded(
              child: _loading
                  ? const SkelList(n: 4)
                  : ListView.builder(
                      reverse: true, padding: const EdgeInsets.all(12), itemCount: _msgs.length,
                      itemBuilder: (_, i) {
                        final m = _msgs[i];
                        final mine = m['sender_id'] == uid;
                        return Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                                margin: const EdgeInsets.symmetric(vertical: 3), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
                                decoration: BoxDecoration(color: mine ? green : Colors.white, borderRadius: BorderRadius.circular(16)),
                                child: Opacity(opacity: m['pending'] == true ? 0.6 : 1, child: Text(m['body'] as String, style: TextStyle(color: mine ? Colors.white : ink)))));
                      })),
          SafeArea(
              child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(children: [
              Expanded(child: TextField(controller: _text, textInputAction: TextInputAction.send, onSubmitted: (_) => _send(), maxLength: 1000, decoration: const InputDecoration(counterText: '', isDense: true))),
              IconButton(onPressed: _send, icon: const Icon(Icons.send, color: green)),
            ]),
          )),
        ]),
      );
}
