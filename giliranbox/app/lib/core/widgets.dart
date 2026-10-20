import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'api.dart';
import 'cache.dart';
import 'i18n.dart';

/// Static grey placeholder block (no shimmer animation: cheaper on low-end GPUs).
class Skel extends StatelessWidget {
  const Skel({super.key, this.h = 16, this.w, this.r = 8});
  final double h, r;
  final double? w;
  @override
  Widget build(BuildContext context) => Container(
      height: h, width: w, decoration: BoxDecoration(color: const Color(0xFFE6E8EA), borderRadius: BorderRadius.circular(r)));
}

class SkelList extends StatelessWidget {
  const SkelList({super.key, this.n = 5});
  final int n;
  @override
  Widget build(BuildContext context) => ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      itemCount: n,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (_, _) => const Skel(h: 76, r: 16));
}

/// Builds from a stale-while-revalidate stream: skeleton only when there is no cache yet.
class Swr<T> extends StatefulWidget {
  const Swr({super.key, required this.cacheKey, required this.fetch, required this.decode, required this.builder, this.skeleton});
  final String cacheKey;
  final Future<dynamic> Function() fetch;
  final T Function(dynamic) decode;
  final Widget Function(BuildContext, T) builder;
  final Widget? skeleton;
  @override
  State<Swr<T>> createState() => SwrState<T>();
}

class SwrState<T> extends State<Swr<T>> {
  StreamSubscription<SwrResult<T>>? _sub;
  SwrResult<T>? _r;
  Object? _err;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    _sub?.cancel();
    setState(() => _err = null);
    _sub = swr<T>(widget.cacheKey, widget.fetch, widget.decode).listen((r) {
      if (mounted) setState(() => _r = r);
    }, onError: (Object e) {
      if (mounted) setState(() => _err = e);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_r == null && _err == null) return widget.skeleton ?? const SkelList();
    if (_r == null) return ErrorRetry(error: _err!, onRetry: reload);
    return Column(children: [
      if (_r!.offline) const OfflineBanner(),
      Expanded(child: widget.builder(context, _r!.data)),
    ]);
  }
}

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});
  @override
  Widget build(BuildContext context) => Container(
      width: double.infinity, color: const Color(0xFFFFF3CD), padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
      child: Row(children: [const Icon(Icons.cloud_off, size: 16), const SizedBox(width: 8), Text(tr('offline'), style: const TextStyle(fontSize: 12))]));
}

class ErrorRetry extends StatelessWidget {
  const ErrorRetry({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(errText(error), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, style: OutlinedButton.styleFrom(minimumSize: const Size(140, 44)), child: Text(tr('retry'))),
      ]));
}

/// Thumbnail image: decoded at display size (small memory), disk cached, lazy via the list builder.
class AvatarThumb extends StatelessWidget {
  const AvatarThumb(this.path, {super.key, this.size = 56});
  final String? path;
  final double size;
  @override
  Widget build(BuildContext context) {
    final url = imgUrl(path);
    final px = (size * MediaQuery.devicePixelRatioOf(context)).round();
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: size,
        height: size,
        child: url.isEmpty
            ? const ColoredBox(color: Color(0xFFE6E8EA), child: Icon(Icons.person, color: Colors.black38))
            : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover, memCacheWidth: px, memCacheHeight: px,
                placeholder: (_, _) => const ColoredBox(color: Color(0xFFE6E8EA)), errorWidget: (_, _, _) => const ColoredBox(color: Color(0xFFE6E8EA))),
      ),
    );
  }
}

void toast(BuildContext c, String m) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m), duration: const Duration(seconds: 3)));

const _icons = <String, IconData>{
  'ac_unit': Icons.ac_unit, 'cleaning_services': Icons.cleaning_services, 'recycling': Icons.recycling, 'plumbing': Icons.plumbing,
  'electrical_services': Icons.electrical_services, 'key': Icons.key, 'local_shipping': Icons.local_shipping, 'pest_control': Icons.pest_control,
  'handyman': Icons.handyman, 'home_repair_service': Icons.home_repair_service, 'water_drop': Icons.water_drop, 'local_car_wash': Icons.local_car_wash,
  'car_repair': Icons.car_repair, 'delete_sweep': Icons.delete_sweep, 'grass': Icons.grass, 'local_laundry_service': Icons.local_laundry_service,
  'content_cut': Icons.content_cut, 'weekend': Icons.weekend, 'format_paint': Icons.format_paint, 'school': Icons.school,
};
// Const map keeps icon-font tree shaking working in release builds.
IconData iconFor(String? n) => _icons[n] ?? Icons.build;
