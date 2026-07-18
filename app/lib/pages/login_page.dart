import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:fluwx/fluwx.dart';

import '../api.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLoggedIn});
  final ValueChanged<Map<String, dynamic>> onLoggedIn;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final Fluwx _fluwx = Fluwx();
  FluwxCancelable? _subscriber;
  Map<String, dynamic>? _config;
  String? _expectedState;
  String? _error;
  bool _busy = false;
  bool _registered = false;

  @override
  void initState() {
    super.initState();
    _subscriber = _fluwx.addSubscriber(_onWechatResponse);
    _loadConfig();
  }

  @override
  void dispose() {
    _subscriber?.cancel();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    try {
      final value = await Api.authConfig();
      var registered = false;
      final isMobile = !kIsWeb &&
          (defaultTargetPlatform == TargetPlatform.android ||
              defaultTargetPlatform == TargetPlatform.iOS);
      if (value['wechatEnabled'] == true && isMobile) {
        registered = await _fluwx.registerApi(
          appId: value['wechatAppId'] as String,
          universalLink: value['wechatUniversalLink'] as String?,
        );
      }
      if (mounted) {
        setState(() {
          _config = value;
          _registered = registered;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '连接服务器失败：$e');
    }
  }

  Future<void> _wechatLogin() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!await _fluwx.isWeChatInstalled) {
        throw Exception('未检测到微信，请先安装微信');
      }
      final state = await Api.wechatState();
      _expectedState = state;
      final opened = await _fluwx.authBy(
        which: NormalAuth(scope: 'snsapi_userinfo', state: state),
      );
      if (!opened) {
        throw Exception('无法唤起微信，请检查开放平台签名配置');
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _onWechatResponse(WeChatResponse response) async {
    if (response is! WeChatAuthResponse) return;
    if (!response.isSuccessful || response.code == null) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = response.errStr ?? '微信授权已取消';
        });
      }
      return;
    }
    if (_expectedState == null || response.state != _expectedState) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '微信登录校验失败，请重新尝试';
        });
      }
      return;
    }
    try {
      final user = await Api.wechatLogin(response.code!, _expectedState!);
      if (mounted) widget.onLoggedIn(user);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _devLogin() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final user = await Api.devLogin();
      if (mounted) widget.onLoggedIn(user);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _editServer() async {
    final ctrl = TextEditingController(text: await Api.base());
    if (!mounted) return;
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('服务器地址'),
        content: TextField(controller: ctrl, keyboardType: TextInputType.url),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('保存')),
        ],
      ),
    );
    if (value != null && value.isNotEmpty) {
      await Api.setBase(value);
      await _loadConfig();
    }
  }

  @override
  Widget build(BuildContext context) {
    final wechatEnabled = _config?['wechatEnabled'] == true;
    final devEnabled = _config?['devLoginEnabled'] == true;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.graphic_eq_rounded,
                      size: 72, color: Color(0xFF2E5A88)),
                  const SizedBox(height: 20),
                  const Text('声图 SoundMap',
                      textAlign: TextAlign.center,
                      style:
                          TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  const Text('声音变成图，一眼看懂一小时', textAlign: TextAlign.center),
                  const SizedBox(height: 40),
                  FilledButton.icon(
                    onPressed: !_busy && wechatEnabled && _registered
                        ? _wechatLogin
                        : null,
                    icon: const Icon(Icons.chat_bubble),
                    label: Text(_busy ? '登录中…' : '微信一键登录 / 注册'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF07C160),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                  if (!wechatEnabled)
                    const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child: Text('服务端尚未配置微信开放平台 AppID/AppSecret',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey)),
                    ),
                  if (wechatEnabled && !_registered)
                    const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child: Text('微信 SDK 注册失败，请检查 AppID、包名和应用签名',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.orange)),
                    ),
                  if (devEnabled) ...[
                    const SizedBox(height: 12),
                    OutlinedButton(
                        onPressed: _busy ? null : _devLogin,
                        child: const Text('本地测试登录')),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: Text(_error!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error)),
                    ),
                  const SizedBox(height: 12),
                  TextButton.icon(
                      onPressed: _busy ? null : _editServer,
                      icon: const Icon(Icons.settings),
                      label: const Text('设置服务器地址')),
                  const SizedBox(height: 16),
                  const Text('登录即表示同意用户协议和隐私政策',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
