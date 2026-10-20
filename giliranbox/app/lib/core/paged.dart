import 'package:flutter/material.dart';
import 'cache.dart';
import 'i18n.dart';
import 'widgets.dart';

const pageSize = 20; // every list is paginated at 20 items

/// Keyset-paginated list. Page 1 is served from the SQLite cache instantly, then refreshed.
/// `fetch(cursor)` must return at most [pageSize] rows ordered newest-first; `cursorOf(row)` gives the next cursor.
class PagedList extends StatefulWidget {
  const PagedList({super.key, required this.cacheKey, required this.fetch, required this.cursorOf, required this.itemBuilder, this.header});
  final String cacheKey;
  final Future<List<Map<String, dynamic>>> Function(String? cursor) fetch;
  final String Function(Map<String, dynamic>) cursorOf;
  final Widget Function(BuildContext, Map<String, dynamic>) itemBuilder;
  final Widget? header;
  @override
  State<PagedList> createState() => PagedListState();
}

class PagedListState extends State<PagedList> {
  final _sc = ScrollController();
  List<Map<String, dynamic>> _items = [];
  bool _loading = true, _end = false, _offline = false;
  Object? _err;

  @override
  void initState() {
    super.initState();
    _sc.addListener(() {
      if (_sc.position.pixels > _sc.position.maxScrollExtent - 300) _more();
    });
    refresh();
  }

  @override
  void dispose() {
    _sc.dispose();
    super.dispose();
  }

  Future<void> refresh() async {
    final cached = await Cache.get(widget.cacheKey);
    if (cached != null && mounted) {
      setState(() {
        _items = (cached as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    }
    try {
      final r = await widget.fetch(null);
      await Cache.put(widget.cacheKey, r);
      if (mounted) {
        setState(() {
          _items = r;
          _end = r.length < pageSize;
          _loading = false;
          _offline = false;
          _err = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _offline = _items.isNotEmpty;
          _err = _items.isEmpty ? e : null;
        });
      }
    }
  }

  Future<void> _more() async {
    if (_loading || _end || _items.isEmpty) return;
    setState(() => _loading = true);
    try {
      final r = await widget.fetch(widget.cursorOf(_items.last));
      if (mounted) {
        setState(() {
          _items = [..._items, ...r];
          _end = r.length < pageSize;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _items.isEmpty) return const SkelList();
    if (_err != null) return ErrorRetry(error: _err!, onRetry: refresh);
    return Column(children: [
      if (_offline) const OfflineBanner(),
      Expanded(
        child: RefreshIndicator(
          onRefresh: refresh,
          child: ListView.builder(
            controller: _sc,
            padding: const EdgeInsets.all(16),
            itemCount: _items.length + 1 + (widget.header != null ? 1 : 0),
            itemBuilder: (c, i) {
              if (widget.header != null) {
                if (i == 0) return widget.header!;
                i--;
              }
              if (i == _items.length) {
                return _items.isEmpty ? Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(tr('nothing')))) : _end ? const SizedBox(height: 16) : const Padding(padding: EdgeInsets.all(16), child: Skel(h: 48));
              }
              return Padding(padding: const EdgeInsets.only(bottom: 12), child: widget.itemBuilder(c, _items[i]));
            },
          ),
        ),
      ),
    ]);
  }
}
