import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/paged.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'provider_job_page.dart';

/// Upcoming scheduled jobs, soonest first (a light list instead of a month-grid widget).
class CalendarPage extends StatelessWidget {
  const CalendarPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('calendar'))),
        body: PagedList(
          cacheKey: 'calendar',
          fetch: (cursor) async {
            final from = cursor ?? DateTime.now().toUtc().subtract(const Duration(hours: 2)).toIso8601String();
            return ((await sb.from('jobs').select('id,status,category_id,scheduled_at,price_cents').eq('provider_id', uid!).not('scheduled_at', 'is', null)
                .inFilter('status', ['accepted', 'on_the_way', 'arrived', 'in_progress']).gt('scheduled_at', from).order('scheduled_at').limit(pageSize)) as List).cast<Map<String, dynamic>>();
          },
          cursorOf: (j) => j['scheduled_at'] as String,
          itemBuilder: (c, j) => Card(
              child: ListTile(
            leading: CircleAvatar(backgroundColor: green.withValues(alpha: 0.12), child: Icon(iconFor(catalog[j['category_id']]?['icon'] as String?), color: green)),
            title: Text(dateKL(j['scheduled_at'] as String), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${loc(catalog[j['category_id']]?['name'])} · ${tr('s_${j['status']}')}'),
            trailing: Text(rm(j['price_cents'] as int?)),
            onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ProviderJobPage(jobId: j['id'] as String))),
          )),
        ),
      );
}
