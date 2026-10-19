import 'package:flutter/material.dart';

const green = Color(0xFF00B14F); // Grab-like accent
const ink = Color(0xFF1B1B1B);

/// System fonts only (no font assets to download or bundle). Plain Material 3, no custom animations.
ThemeData buildTheme() {
  final base = ColorScheme.fromSeed(seedColor: green, primary: green, brightness: Brightness.light, surface: Colors.white);
  return ThemeData(
    useMaterial3: true,
    colorScheme: base,
    scaffoldBackgroundColor: const Color(0xFFF5F6F7),
    appBarTheme: const AppBarTheme(backgroundColor: Colors.white, foregroundColor: ink, elevation: 0, scrolledUnderElevation: 0),
    cardTheme: CardThemeData(color: Colors.white, elevation: 0, margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
    filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), backgroundColor: green,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
    outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)))),
    inputDecorationTheme: InputDecorationTheme(
        filled: true, fillColor: Colors.white, border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none)),
    navigationBarTheme: const NavigationBarThemeData(backgroundColor: Colors.white, indicatorColor: Color(0x2200B14F), height: 64),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),   // light, no heavy shared-axis effects
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
  );
}
