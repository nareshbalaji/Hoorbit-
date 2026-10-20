import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/perf.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../booking/booking_page.dart';
import '../queue/queue_page.dart';

typedef Feed = Map<String, dynamic>;

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String _q = '';

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Swr<Feed>(
          cacheKey: 'home',
          // ONE request returns categories + promos + book-again (a few KB, far below the 50 KB budget).
          fetch: () => rpc('home_feed'),
          decode: (j) => Map<String, dynamic>.from(j as Map),
          skeleton: const _HomeSkeleton(),
          builder: (ctx, feed) {
            perfMark('home_ready'); // categories painted: "usable home screen"
            final cats = (feed['categories'] as List).cast<Map<String, dynamic>>();
            for (final c in cats) {
              catalog[c['id'] as int] = c;
            }
            final q = _q.trim().toLowerCase();
            final shown = q.isEmpty ? cats : cats.where((c) => loc(c['name']).toLowerCase().contains(q)).toList();
            final promos = (feed['promos'] as List).cast<Map<String, dynamic>>();
            final again = (feed['again'] as List).cast<Map<String, dynamic>>().where((a) => catalog.containsKey(a['cat'])).toList();
            return CustomScrollView(slivers: [
              SliverToBoxAdapter(
                  child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('search'))),
              )),
              if (promos.isNotEmpty && q.isEmpty)
                SliverToBoxAdapter(
                    child: SizedBox(
                  height: 96,
                  child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: promos.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 12),
                      itemBuilder: (_, i) => Container(
                          width: 280,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(color: green, borderRadius: BorderRadius.circular(16)),
                          child: Text(loc(promos[i]['title']), style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)))),
                )),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                sliver: SliverGrid.builder(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: 1.0),
                  itemCount: shown.length,
                  itemBuilder: (_, i) => _CatTile(shown[i]),
                ),
              ),
              if (again.isNotEmpty && q.isEmpty) ...[
                SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 8), child: Text(tr('book_again'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)))),
                SliverToBoxAdapter(
                    child: SizedBox(
                        height: 48,
                        child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: again.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 8),
                            itemBuilder: (_, i) {
                              final c = catalog[again[i]['cat']]!;
                              return ActionChip(avatar: Icon(iconFor(c['icon'] as String?), size: 18), label: Text(loc(c['name'])), onPressed: () => _open(context, c));
                            }))),
              ],
              SliverToBoxAdapter(
                  child: Padding(
                padding: const EdgeInsets.all(16),
                child: Card(
                    child: ListTile(
                  leading: const Icon(Icons.people_alt, color: green),
                  title: Text(tr('queue_shop'), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(tr('queue_sub')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const QueuePage())),
                )),
              )),
            ]);
          },
        ),
      );
}

void _open(BuildContext c, Map<String, dynamic> cat) => Navigator.push(c, MaterialPageRoute(builder: (_) => BookingPage(category: cat)));

class _CatTile extends StatelessWidget {
  const _CatTile(this.c);
  final Map<String, dynamic> c;
  @override
  Widget build(BuildContext context) {
    final from = c['from'] as int?;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => _open(context, c),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(iconFor(c['icon'] as String?), size: 32, color: green),
            const SizedBox(height: 6),
            Text(loc(c['name']), textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            if (from != null) Text('${tr('from')} ${rm(from)}', style: const TextStyle(fontSize: 11, color: Colors.black54)),
          ]),
        ),
      ),
    );
  }
}

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.all(16),
      child: Column(children: [
        const Skel(h: 52, r: 14),
        const SizedBox(height: 16),
        const Skel(h: 96, r: 16),
        const SizedBox(height: 16),
        Expanded(
            child: GridView.count(
                crossAxisCount: 3, mainAxisSpacing: 12, crossAxisSpacing: 12, physics: const NeverScrollableScrollPhysics(),
                children: List.generate(6, (_) => const Skel(r: 16)))),
      ]));
}
