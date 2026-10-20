import 'dart:async';
import 'dart:convert';
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// SQLite key/value JSON cache. Screens show cached data instantly, then refresh from the network.
/// Keys are namespaced by user id; the whole table is wiped on sign-out (PDPA / shared devices).
class Cache {
  static Database? _db;
  static String ns = 'anon';

  static Future<Database> get _d async {
    if (_db != null) return _db!;
    final dir = await getApplicationSupportDirectory();
    return _db = await openDatabase('${dir.path}/cache.db', version: 1, onCreate: (db, _) async {
      await db.execute('create table kv (k text primary key, v text not null, ts integer not null)');
    });
  }

  static Future<dynamic> get(String key) async {
    try {
      final r = await (await _d).query('kv', columns: ['v'], where: 'k = ?', whereArgs: ['$ns:$key']);
      return r.isEmpty ? null : jsonDecode(r.first['v']! as String);
    } catch (_) {
      return null;
    }
  }

  static Future<void> put(String key, dynamic value) async {
    try {
      await (await _d).insert('kv', {'k': '$ns:$key', 'v': jsonEncode(value), 'ts': DateTime.now().millisecondsSinceEpoch},
          conflictAlgorithm: ConflictAlgorithm.replace);
    } catch (_) {}
  }

  static Future<void> clear() async {
    try {
      await (await _d).delete('kv');
    } catch (_) {}
  }
}

class SwrResult<T> {
  SwrResult(this.data, {this.fromCache = false, this.offline = false});
  final T data;
  final bool fromCache;
  final bool offline; // network failed, cached data shown
}

/// Stale-while-revalidate: emit cached value (if any) immediately, then the fresh value.
/// If the network fails and a cached value was shown, the error is swallowed and `offline` is reported.
Stream<SwrResult<T>> swr<T>(String key, Future<dynamic> Function() fetch, T Function(dynamic json) decode) async* {
  final cached = await Cache.get(key);
  var hadCache = false;
  if (cached != null) {
    try {
      yield SwrResult(decode(cached), fromCache: true);
      hadCache = true;
    } catch (_) {}
  }
  try {
    final fresh = await fetch();
    await Cache.put(key, fresh);
    yield SwrResult(decode(fresh));
  } catch (e) {
    if (!hadCache) rethrow;
    yield SwrResult(decode(cached), fromCache: true, offline: true);
  }
}
