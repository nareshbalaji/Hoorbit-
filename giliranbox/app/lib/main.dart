import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthChangeEvent;
import 'core/api.dart';
import 'core/cache.dart';
import 'core/env.dart';
import 'core/i18n.dart';
import 'core/perf.dart';
import 'core/push.dart';
import 'core/theme.dart';
import 'features/auth/login_page.dart';
import 'shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await app.load();
  if (Env.configured) await initBackend();
  runApp(const GiliranApp());
  // Everything non-essential starts after the first frame so cold start stays fast.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    perfMark('first_frame');
    Push.init();
  });
}

class GiliranApp extends StatelessWidget {
  const GiliranApp({super.key});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: app,
        builder: (_, _) => MaterialApp(
          title: 'GiliranBox',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          home: Env.configured ? const AuthGate() : const _MissingConfig(),
        ),
      );
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});
  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  StreamSubscription? _sub;
  bool _signedIn = sb.auth.currentSession != null;

  @override
  void initState() {
    super.initState();
    _sub = sb.auth.onAuthStateChange.listen((s) async {
      if (s.event == AuthChangeEvent.signedOut) await Cache.clear();
      Cache.ns = uid ?? 'anon';
      if (mounted) setState(() => _signedIn = s.session != null);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _signedIn ? const Shell() : const LoginPage();
}

class _MissingConfig extends StatelessWidget {
  const _MissingConfig();
  @override
  Widget build(BuildContext context) => const Scaffold(
      body: Center(
          child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('Missing SUPABASE_URL / SUPABASE_ANON_KEY.\nRun with --dart-define (see docs/SETUP.md).', textAlign: TextAlign.center))));
}
