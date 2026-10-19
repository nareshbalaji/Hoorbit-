import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'core/i18n.dart';
import 'core/widgets.dart';
import 'features/account/account_page.dart';
import 'features/home/home_page.dart';
import 'features/jobs/activity_page.dart';
import 'features/jobs/messages_page.dart';
import 'features/provider/calendar_page.dart';
import 'features/provider/earnings_page.dart';
import 'features/provider/provider_home.dart';
import 'features/queue/counter_page.dart' deferred as counter;

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;
  final _built = <int>{0};
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    app.addListener(_onApp);
    // Kiosk QR (giliranbox://pair?code=XXXX) scanned with the phone camera lands here.
    try {
      _links = AppLinks().uriLinkStream.listen((u) async {
        if (u.scheme == 'giliranbox' && u.host == 'pair' && mounted) {
          await counter.loadLibrary();
          if (mounted) await Navigator.push(context, MaterialPageRoute(builder: (_) => counter.CounterPage(pairCode: u.queryParameters['code'])));
        }
      });
    } catch (_) {}
  }

  void _onApp() => setState(() {
        _i = 0;
        _built
          ..clear()
          ..add(0);
      });

  @override
  void dispose() {
    app.removeListener(_onApp);
    _links?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prov = app.providerMode;
    final tabs = prov
        ? <(IconData, String, Widget Function())>[
            (Icons.bolt, tr('new_jobs'), () => const ProviderHome()),
            (Icons.calendar_month, tr('calendar'), () => const CalendarPage()),
            (Icons.payments, tr('earnings'), () => const EarningsPage()),
            (Icons.person, tr('account'), () => const AccountPage()),
          ]
        : <(IconData, String, Widget Function())>[
            (Icons.home, tr('home'), () => const HomePage()),
            (Icons.receipt_long, tr('activity'), () => const ActivityPage()),
            (Icons.chat_bubble, tr('messages'), () => const MessagesPage()),
            (Icons.person, tr('account'), () => const AccountPage()),
          ];
    return Scaffold(
      // Tabs are built lazily on first visit, then kept alive: cheap startup, no rebuild when switching.
      body: Stack(children: [
        for (var n = 0; n < tabs.length; n++)
          Offstage(offstage: n != _i, child: TickerMode(enabled: n == _i, child: _built.contains(n) ? tabs[n].$3() : const SizedBox.shrink())),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (n) => setState(() {
          _i = n;
          _built.add(n);
        }),
        destinations: [for (final t in tabs) NavigationDestination(icon: Icon(t.$1), label: t.$2)],
      ),
    );
  }
}

/// Shows the `Skel` placeholder while a deferred library loads.
Future<T?> pushDeferred<T>(BuildContext context, Future<void> Function() load, Widget Function() page) async {
  final nav = Navigator.of(context);
  await load();
  return nav.push<T>(MaterialPageRoute(builder: (_) => page()));
}

const skelPage = Scaffold(body: SkelList());
