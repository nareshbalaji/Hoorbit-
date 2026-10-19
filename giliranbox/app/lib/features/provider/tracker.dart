import '../../core/location.dart';

/// Single app-wide location session for the provider's active job (survives navigating between screens).
/// Started on job accept; stopped the moment the job is in progress, done or cancelled.
final tracker = JobLocationSession();
