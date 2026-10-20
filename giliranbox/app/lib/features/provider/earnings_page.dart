import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/paged.dart';
import '../../core/widgets.dart';

/// Earnings dashboard (last 30 days) + commission statement (paginated).
class EarningsPage extends StatelessWidget {
  const EarningsPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('earnings'))),
        body: Column(children: [
          SizedBox(
            height: 128,
            child: Swr<Map<String, dynamic>>(
              cacheKey: 'earnings30',
              fetch: () => rpc('provider_earnings', {'p_days': 30}),
              decode: (j) => Map<String, dynamic>.from(j as Map),
              skeleton: const Padding(padding: EdgeInsets.all(16), child: Skel(h: 96, r: 16)),
              builder: (_, e) => Padding(
                padding: const EdgeInsets.all(16),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                      _Stat(tr('jobs'), '${e['jobs']}'),
                      _Stat(tr('gross'), rm(e['gross'] as num)),
                      _Stat(tr('commission'), rm(e['commission'] as num)),
                      _Stat(tr('net'), rm(e['net'] as num)),
                    ]),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: PagedList(
              cacheKey: 'statement',
              fetch: (cursor) async {
                var q = sb.from('jobs').select('id,category_id,done_at,price_cents,commission_cents,tip_cents,payout_cents').eq('provider_id', uid!).eq('status', 'done');
                if (cursor != null) q = q.lt('done_at', cursor);
                return ((await q.order('done_at', ascending: false).limit(pageSize)) as List).cast<Map<String, dynamic>>();
              },
              cursorOf: (j) => j['done_at'] as String,
              itemBuilder: (_, j) => Card(
                  child: ListTile(
                title: Text(loc(catalog[j['category_id']]?['name'])),
                subtitle: Text('${dateKL(j['done_at'] as String)}  ·  ${tr('commission')} -${rm(j['commission_cents'] as num)}'),
                trailing: Text(j['payout_cents'] != null ? '-${rm(j['commission_cents'] as num)}' : rm((j['price_cents'] as int) - (j['commission_cents'] as int) + (j['tip_cents'] as int)),
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              )),
            ),
          ),
        ]),
      );
}

class _Stat extends StatelessWidget {
  const _Stat(this.l, this.v);
  final String l, v;
  @override
  Widget build(BuildContext context) => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(v, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        Text(l, style: const TextStyle(fontSize: 12, color: Colors.black54)),
      ]);
}
