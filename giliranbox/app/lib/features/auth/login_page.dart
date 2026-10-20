import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show OtpType;
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/env.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Phone + OTP (+60). PDPA consent is required BEFORE an OTP is requested and is stored with a timestamp.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _phone = TextEditingController();
  final _otp = TextEditingController();
  bool _consent = false, _sent = false, _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    _otp.dispose();
    super.dispose();
  }

  /// "012-345 6789" / "0123456789" / "+60123456789" -> "+60123456789"
  String get _e164 {
    var d = _phone.text.replaceAll(RegExp(r'\D'), '');
    if (d.startsWith('60')) d = d.substring(2);
    if (d.startsWith('0')) d = d.substring(1);
    return '+60$d';
  }

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } catch (e) {
      if (mounted) toast(context, errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 40),
            const Icon(Icons.local_activity, size: 56, color: green),
            const SizedBox(height: 12),
            const Text('GiliranBox', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
            Text(tr('welcome'), style: const TextStyle(color: Colors.black54)),
            const SizedBox(height: 28),
            TextField(
                controller: _phone, keyboardType: TextInputType.phone, enabled: !_sent,
                decoration: InputDecoration(prefixText: '+60  ', labelText: tr('phone'))),
            if (_sent) ...[
              const SizedBox(height: 12),
              TextField(controller: _otp, keyboardType: TextInputType.number, maxLength: 6, decoration: InputDecoration(labelText: tr('otp'), counterText: '')),
            ],
            const SizedBox(height: 8),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _consent,
              onChanged: (v) => setState(() => _consent = v ?? false),
              title: Text(tr('consent'), style: const TextStyle(fontSize: 13)),
              subtitle: TextButton(
                  onPressed: () => launchUrl(Uri.parse(Env.privacyUrl), mode: LaunchMode.externalApplication),
                  style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft), child: Text(tr('privacy'))),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy || !_consent
                  ? null
                  : () => _run(() async {
                        if (!_sent) {
                          await sb.auth.signInWithOtp(phone: _e164);
                          setState(() => _sent = true);
                        } else {
                          await sb.auth.verifyOTP(phone: _e164, token: _otp.text.trim(), type: OtpType.sms);
                          await sb.from('profiles').update({
                            'pdpa_consent_at': DateTime.now().toUtc().toIso8601String(),
                            'pdpa_version': '2026-01',
                            'lang': app.lang,
                            'phone': _e164,
                          }).eq('id', uid!);
                        }
                      }),
              child: Text(_sent ? tr('verify') : tr('send_otp')),
            ),
            const SizedBox(height: 24),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (final l in const ['ms', 'en', 'zh'])
                TextButton(onPressed: () => app.setLang(l), child: Text(l == 'ms' ? 'BM' : l == 'en' ? 'English' : '中文',
                    style: TextStyle(fontWeight: app.lang == l ? FontWeight.bold : FontWeight.normal))),
            ]),
            Center(child: Text(tr('no_medical'), style: const TextStyle(fontSize: 11, color: Colors.black45))),
          ]),
        ),
      );
}
