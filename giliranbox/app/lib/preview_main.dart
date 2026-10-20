// Backend-less preview used to screenshot real screens: flutter run/build -t lib/preview_main.dart
import 'package:flutter/material.dart';
import 'core/api.dart';
import 'core/i18n.dart';
import 'core/theme.dart';
import 'features/auth/login_page.dart';
import 'features/home/home_page.dart';
import 'features/queue/queue_page.dart';

const _cats = [
  [1, 'aircond', 'Aircond servicing', 'Servis aircond', 'ac_unit', 'scheduled', 6000, 'Wall unit from'],
  [2, 'cleaning', 'House cleaning', 'Pembersihan rumah', 'cleaning_services', 'scheduled', 8000, 'From (2 hours)'],
  [3, 'scrap', 'Scrap & recycling pickup', 'Kutipan besi buruk', 'recycling', 'instant', null, 'We pay you per kg'],
];

void main(List<String> _) {
  const page = String.fromEnvironment('PAGE', defaultValue: 'home');
  rpcOverride = (fn, p) async {
    if (fn == 'home_feed') {
      return {
        'categories': [for (final c in _cats) {'id': c[0], 'slug': c[1], 'name': {'en': c[2], 'ms': c[3]}, 'icon': c[4], 'type': c[5], 'from': c[6], 'label': {'en': c[7]}}],
        'promos': [{'id': 'a', 'title': {'en': 'RM10 off your first aircond service', 'ms': 'Diskaun RM10 servis aircond pertama'}}, {'id': 'b', 'title': {'en': 'Get paid for your old newspapers', 'ms': 'Dapat duit dari suratkhabar lama'}}],
        'again': [{'id': 'j', 'cat': 1, 'at': '2026-09-01'}],
      };
    }
    if (fn == 'nearby_shops') {
      return [
        {'id': '1', 'name': 'Gunting Rambut Ah Seng', 'kind': 'barber', 'open': true, 'distance_m': 420, 'waiting': 4, 'wait_secs': 3600},
        {'id': '2', 'name': 'Farmasi Sihat (counter queue)', 'kind': 'pharmacy', 'open': true, 'distance_m': 2300, 'waiting': 2, 'wait_secs': 480},
        {'id': '3', 'name': 'Bengkel Maju Motor', 'kind': 'workshop', 'open': true, 'distance_m': 3100, 'waiting': 1, 'wait_secs': 1200},
      ];
    }
    return null;
  };
  runApp(MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(), home: switch (page) {
    'login' => const LoginPage(),
    'queue' => const QueuePage(),
    _ => Scaffold(body: const HomePage(), bottomNavigationBar: NavigationBar(selectedIndex: 0, destinations: [
        NavigationDestination(icon: const Icon(Icons.home), label: tr('home')),
        NavigationDestination(icon: const Icon(Icons.receipt_long), label: tr('activity')),
        NavigationDestination(icon: const Icon(Icons.chat_bubble), label: tr('messages')),
        NavigationDestination(icon: const Icon(Icons.person), label: tr('account')),
      ])),
  }));
}
