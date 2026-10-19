/// Build-time config: flutter build ... --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
class Env {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  /// Image CDN origin (Cloudflare/Supabase CDN in front of the public-img bucket). Empty = Supabase storage URL.
  static const cdnBase = String.fromEnvironment('CDN_BASE');
  static const privacyUrl = String.fromEnvironment('PRIVACY_URL', defaultValue: 'https://giliranbox.my/privacy');
  static const emergencyNumber = '999';
  static bool get configured => supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;
}
