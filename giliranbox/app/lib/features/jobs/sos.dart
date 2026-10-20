import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api.dart';
import '../../core/env.dart';
import '../../core/i18n.dart';
import '../../core/location.dart';
import '../../core/widgets.dart';

/// SOS for both customers and providers: alerts GiliranBox support with a one-shot location, or dials 999.
Future<void> showSos(BuildContext context, String? jobId) => showDialog(
      context: context,
      builder: (d) => AlertDialog(
        icon: const Icon(Icons.sos, color: Colors.red, size: 40),
        title: Text(tr('sos_title')),
        content: Text(tr('sos_body')),
        actions: [
          TextButton(onPressed: () => launchUrl(Uri(scheme: 'tel', path: Env.emergencyNumber)), child: Text(tr('sos_999'))),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.red, minimumSize: const Size(140, 44)),
              onPressed: () async {
                final nav = Navigator.of(d);
                final p = await oneShotFix();
                try {
                  await rpc('send_sos', {'p_job': jobId, 'p_lat': p?.latitude, 'p_lng': p?.longitude});
                  if (context.mounted) toast(context, tr('sos_sent'));
                } catch (e) {
                  if (context.mounted) toast(context, errText(e));
                }
                nav.pop();
              },
              child: Text(tr('sos_send'))),
        ],
      ),
    );
