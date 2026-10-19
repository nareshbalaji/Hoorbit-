import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/paged.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'job_page.dart';

class ActivityPage extends StatelessWidget {
  const ActivityPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('activity'))),
        body: PagedList(
          cacheKey: 'activity',
          // only the columns this screen shows
          fetch: (cursor) async {
            var q = sb.from('jobs').select('id,status,category_id,scheduled_at,price_cents,payout_cents,created_at');
            if (cursor != null) q = q.lt('created_at', cursor);
            return ((await q.order('created_at', ascending: false).limit(pageSize)) as List).cast<Map<String, dynamic>>();
          },
          cursorOf: (j) => j['created_at'] as String,
          itemBuilder: (c, j) {
            final cat = catalog[j['category_id']];
            final st = j['status'] as String;
            final money = j['payout_cents'] != null ? '+${rm(j['payout_cents'] as int)}' : (j['price_cents'] as int? ?? 0) > 0 ? rm(j['price_cents'] as int) : '';
            return Card(
              child: ListTile(
                leading: CircleAvatar(backgroundColor: green.withValues(alpha: 0.12), child: Icon(iconFor(cat?['icon'] as String?), color: green)),
                title: Text(cat == null ? '' : loc(cat['name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${tr('s_$st')} · ${dateKL((j['scheduled_at'] ?? j['created_at']) as String)}'),
                trailing: Text(money, style: const TextStyle(fontWeight: FontWeight.w700)),
                onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => JobPage(jobId: j['id'] as String))),
              ),
            );
          },
        ),
      );
}
