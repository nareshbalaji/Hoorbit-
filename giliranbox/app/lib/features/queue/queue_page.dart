import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/location.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'ticket_page.dart';

/// Shops with a counter queue (clinic reception, workshop, pharmacy, barber). Shows distance as plain text, no map.
class QueuePage extends StatefulWidget {
  const QueuePage({super.key});
  @override
  State<QueuePage> createState() => _QueuePageState();
}

class _QueuePageState extends State<QueuePage> {
  double? _lat, _lng;

  @override
  void initState() {
    super.initState();
    oneShotFix().then((p) {
      if (mounted) {
        setState(() {
          _lat = p?.latitude;
          _lng = p?.longitude;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('queue_shop'))),
        // Never block on GPS: the list loads at once (cache first); distances appear when the fix arrives.
        body: Swr<List<Map<String, dynamic>>>(
                key: ValueKey(_lat),
                cacheKey: 'shops',
                fetch: () => rpc('nearby_shops', {'p_lat': _lat, 'p_lng': _lng, 'p_limit': 20}),
                decode: (j) => (j as List).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
                builder: (c, shops) => ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: shops.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final s = shops[i];
                    final wait = ((s['wait_secs'] as int?) ?? 0) ~/ 60;
                    return Card(
                      child: ListTile(
                        leading: const CircleAvatar(backgroundColor: Color(0x2200B14F), child: Icon(Icons.storefront, color: green)),
                        title: Text(s['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${s['waiting']} ${tr('waiting')} · ~$wait ${tr('min')}  ${distanceText(s['distance_m'] as int?)}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => TicketPage(shopId: s['id'] as String, shopName: s['name'] as String))),
                      ),
                    );
                  },
                ),
              ),
      );
}
