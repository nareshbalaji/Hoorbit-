import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/cache.dart';
import '../../core/env.dart';
import '../../core/i18n.dart';
import '../../core/widgets.dart';
import '../provider/provider_signup.dart' deferred as signup;
import '../queue/counter_page.dart' deferred as counter;

class AccountPage extends StatefulWidget {
  const AccountPage({super.key});
  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  Map<String, dynamic>? _p;
  bool _isProvider = false, _isStaff = false;
  List<Map<String, dynamic>> _addrs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final c = await Cache.get('account');
    if (c != null && mounted) setState(() => _p = Map<String, dynamic>.from(c as Map));
    try {
      final p = await sb.from('profiles').select('full_name,phone,role').eq('id', uid!).single();
      final pr = await sb.from('providers').select('status').eq('id', uid!).maybeSingle();
      final st = await sb.from('shop_staff').select('shop_id').eq('user_id', uid!).limit(1);
      final a = await rpc('my_addresses') as List;
      await Cache.put('account', p);
      if (mounted) {
        setState(() {
          _p = p;
          _isProvider = pr != null;
          _isStaff = (st as List).isNotEmpty;
          _addrs = a.cast<Map<String, dynamic>>();
        });
      }
    } catch (_) {/* offline: cached profile shown */}
  }

  Future<void> _editName() async {
    final c = TextEditingController(text: _p?['full_name'] as String? ?? '');
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(title: Text(tr('name')), content: TextField(controller: c, autofocus: true), actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
              TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('submit'))),
            ]));
    final name = c.text.trim();
    c.dispose();
    if (ok == true && name.isNotEmpty) {
      setState(() => _p = {...?_p, 'full_name': name}); // optimistic
      await sb.from('profiles').update({'full_name': name}).eq('id', uid!);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(title: Text(tr('delete_account')), content: Text(tr('delete_confirm')), actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('cancel'))),
              TextButton(onPressed: () => Navigator.pop(d, true), child: Text(tr('delete_account'), style: const TextStyle(color: Colors.red))),
            ]));
    if (ok != true) return;
    try {
      await rpc('delete_my_account');
      await sb.auth.signOut();
    } catch (e) {
      if (mounted) toast(context, errText(e));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('account'))),
        body: ListView(children: [
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person)),
            title: Text((_p?['full_name'] as String?)?.isNotEmpty == true ? _p!['full_name'] as String : tr('name')),
            subtitle: Text(_p?['phone'] as String? ?? ''),
            trailing: const Icon(Icons.edit, size: 18),
            onTap: _editName,
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.language),
            title: Text(tr('language')),
            trailing: SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const [ButtonSegment(value: 'ms', label: Text('BM')), ButtonSegment(value: 'en', label: Text('EN')), ButtonSegment(value: 'zh', label: Text('中文'))],
              selected: {app.lang},
              onSelectionChanged: (s) {
                app.setLang(s.first);
                sb.from('profiles').update({'lang': s.first}).eq('id', uid!);
              },
            ),
          ),
          if (_isProvider)
            SwitchListTile(
              secondary: const Icon(Icons.handyman),
              title: Text(tr('provider_mode')),
              value: app.providerMode,
              onChanged: (v) => app.setProviderMode(v),
            )
          else
            ListTile(
              leading: const Icon(Icons.handyman),
              title: Text(tr('become_provider')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final nav = Navigator.of(context);
                await signup.loadLibrary();
                await nav.push(MaterialPageRoute(builder: (_) => signup.ProviderSignup()));
                _load();
              },
            ),
          if (_isStaff)
            ListTile(
              leading: const Icon(Icons.storefront),
              title: Text(tr('counter')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final nav = Navigator.of(context);
                await counter.loadLibrary();
                nav.push(MaterialPageRoute(builder: (_) => counter.CounterPage()));
              },
            ),
          if (_addrs.isNotEmpty) ...[
            Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(tr('saved_addresses'), style: const TextStyle(fontWeight: FontWeight.w700))),
            for (final a in _addrs)
              ListTile(
                dense: true, leading: const Icon(Icons.place_outlined),
                title: Text(a['label'] as String), subtitle: Text(a['line'] as String, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      setState(() => _addrs.remove(a));
                      await sb.from('addresses').delete().eq('id', a['id'] as String);
                    }),
              ),
          ],
          const Divider(),
          ListTile(leading: const Icon(Icons.privacy_tip_outlined), title: Text(tr('privacy')), onTap: () => launchUrl(Uri.parse(Env.privacyUrl), mode: LaunchMode.externalApplication)),
          ListTile(leading: const Icon(Icons.logout), title: Text(tr('sign_out')), onTap: () => sb.auth.signOut()),
          ListTile(leading: const Icon(Icons.delete_forever, color: Colors.red), title: Text(tr('delete_account'), style: const TextStyle(color: Colors.red)), onTap: _delete),
          Padding(padding: const EdgeInsets.all(16), child: Text(tr('no_medical'), style: const TextStyle(fontSize: 11, color: Colors.black45), textAlign: TextAlign.center)),
        ]),
      );
}
