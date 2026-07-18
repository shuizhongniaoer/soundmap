import 'package:flutter/material.dart';

import '../api.dart';
import 'list_page.dart';
import 'login_page.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  Map<String, dynamic>? _user;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final user = await Api.me();
      if (mounted) {
        setState(() {
          _user = user;
          _loading = false;
        });
      }
    } on AuthRequiredException {
      if (mounted) setState(() => _loading = false);
    } catch (_) {
      // LoginPage includes server configuration and a useful connection error.
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    await Api.logout();
    if (mounted) setState(() => _user = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_user == null) {
      return LoginPage(onLoggedIn: (user) => setState(() => _user = user));
    }
    return ListPage(user: _user, onLogout: _logout);
  }
}
