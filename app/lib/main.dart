import 'package:flutter/material.dart';
import 'pages/list_page.dart';

const kAccent = Color(0xFF2E5A88);

void main() => runApp(const SoundMapApp());

class SoundMapApp extends StatelessWidget {
  const SoundMapApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '声图 SoundMap',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: kAccent),
        useMaterial3: true,
      ),
      home: const ListPage(),
    );
  }
}
