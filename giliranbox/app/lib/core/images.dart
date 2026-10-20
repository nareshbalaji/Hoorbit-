import 'dart:io';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show FileOptions;
import 'api.dart';

const maxUploadBytes = 300 * 1024;

/// Pick a photo and shrink it to WebP under 300 KB (resize + quality ladder) before it touches the network.
Future<File?> pickCompressed({ImageSource source = ImageSource.camera}) async {
  final x = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 90);
  if (x == null) return null;
  final tmp = await getTemporaryDirectory();
  File? out;
  for (final (w, q) in const [(1280, 78), (1024, 65), (800, 55), (640, 45), (480, 35)]) {
    final r = await FlutterImageCompress.compressAndGetFile(x.path, '${tmp.path}/up_${DateTime.now().microsecondsSinceEpoch}.webp',
        format: CompressFormat.webp, minWidth: w, minHeight: w, quality: q);
    if (r == null) continue;
    out = File(r.path);
    if (await out.length() <= maxUploadBytes) return out;
  }
  return out != null && await out.length() <= maxUploadBytes ? out : null;
}

/// Upload to a private bucket under `<uid>/<folder>/<name>.webp`; returns the storage path.
Future<String> uploadWebp(String bucket, String folder, File f) async {
  final path = '$uid/$folder/${DateTime.now().millisecondsSinceEpoch}.webp';
  await sb.storage.from(bucket).upload(path, f, fileOptions: const FileOptions(contentType: 'image/webp', upsert: false));
  try {
    await f.delete();
  } catch (_) {}
  return path;
}
