import 'package:supabase_flutter/supabase_flutter.dart';
import 'cache.dart';
import 'env.dart';
import 'i18n.dart';

SupabaseClient get sb => Supabase.instance.client;
String? get uid => sb.auth.currentUser?.id;

Future<void> initBackend() async {
  // ignore: deprecated_member_use
  await Supabase.initialize(url: Env.supabaseUrl, anonKey: Env.supabaseAnonKey);
  Cache.ns = uid ?? 'anon';
}

/// Call a Postgres RPC.
Future<dynamic> rpc(String fn, [Map<String, dynamic>? params]) => sb.rpc(fn, params: params);

/// Turn a server error code (e.g. `already_taken`) into localized text.
String errText(Object e) {
  final raw = e is PostgrestException ? e.message : e.toString();
  final code = RegExp(r'^[a-z_]+$').hasMatch(raw.trim()) ? raw.trim() : '';
  final k = 'err_$code';
  final t = tr(k);
  return t == k ? tr('err_generic') : t;
}

/// Public image URL via CDN (WebP only). Thumbnails first: pass the small path for lists.
String imgUrl(String? path) {
  if (path == null || path.isEmpty) return '';
  if (path.startsWith('http')) return path;
  if (Env.cdnBase.isNotEmpty) return '${Env.cdnBase}/$path';
  return sb.storage.from('public-img').getPublicUrl(path);
}

/// Catalogue cached in memory after the home feed loads (id -> category json).
final Map<int, Map<String, dynamic>> catalog = {};
