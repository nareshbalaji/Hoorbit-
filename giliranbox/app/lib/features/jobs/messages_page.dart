import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/paged.dart';
import '../../core/widgets.dart';
import 'chat_page.dart';

/// Conversations = jobs that have an assigned provider (chat is per job).
class MessagesPage extends StatelessWidget {
  const MessagesPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('messages'))),
        body: PagedList(
          cacheKey: 'conversations',
          fetch: (cursor) async {
            var q = sb.from('jobs').select('id,category_id,customer_id,created_at,customer:profiles!jobs_customer_id_fkey(full_name),provider:providers(photo_url,profiles(full_name))').not('provider_id', 'is', null).neq('status', 'cancelled');
            if (cursor != null) q = q.lt('created_at', cursor);
            return ((await q.order('created_at', ascending: false).limit(pageSize)) as List).cast<Map<String, dynamic>>();
          },
          cursorOf: (j) => j['created_at'] as String,
          itemBuilder: (c, j) {
            final me = j['customer_id'] == uid;
            final Map? provider = j['provider'] as Map?;
            final Map? customer = j['customer'] as Map?;
            final Map? pprofile = provider?['profiles'] as Map?;
            final other = me ? _name(pprofile) : _name(customer);
            final cat = catalog[j['category_id']];
            return Card(
              child: ListTile(
                leading: AvatarThumb(me ? (provider?['photo_url'] as String?) : null, size: 44),
                title: Text(other, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${cat == null ? '' : loc(cat['name'])} · ${dateKL(j['created_at'] as String)}'),
                onTap: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ChatPage(jobId: j['id'] as String, title: other))),
              ),
            );
          },
        ),
      );
}

String _name(Map? m) => '${m?['full_name'] ?? ''}';
