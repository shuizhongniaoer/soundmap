import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// 服务端 API 封装。
/// 服务器地址存在本地设置里：安卓模拟器访问宿主机用 10.0.2.2，真机填电脑局域网 IP。
class Api {
  static const _defaultBase = 'http://10.0.2.2:3000';

  static Future<String> base() async {
    final sp = await SharedPreferences.getInstance();
    return sp.getString('server_url') ?? _defaultBase;
  }

  static Future<void> setBase(String url) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString('server_url', url.replaceAll(RegExp(r'/$'), ''));
  }

  static Future<String> _tokenKey() async => 'auth_token:${await base()}';

  static Future<String?> token() async {
    final sp = await SharedPreferences.getInstance();
    return sp.getString(await _tokenKey());
  }

  static Future<void> _saveToken(String value) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(await _tokenKey(), value);
  }

  static Future<Map<String, String>> headers({bool json = false}) async {
    final value = await token();
    return {
      if (json) 'Content-Type': 'application/json',
      if (value != null) 'Authorization': 'Bearer $value',
    };
  }

  static Map<String, dynamic> _json(http.Response res) {
    final body = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception(body['error'] ?? 'HTTP ${res.statusCode}');
    }
    return body;
  }

  static Future<Map<String, dynamic>> authConfig() async {
    final res = await http.get(Uri.parse('${await base()}/api/auth/config'));
    return _json(res);
  }

  static Future<Map<String, dynamic>> me() async {
    final res = await http.get(
      Uri.parse('${await base()}/api/auth/me'),
      headers: await headers(),
    );
    return _json(res)['user'] as Map<String, dynamic>;
  }

  static Future<String> wechatState() async {
    final res =
        await http.get(Uri.parse('${await base()}/api/auth/wechat/state'));
    return _json(res)['state'] as String;
  }

  static Future<Map<String, dynamic>> wechatLogin(
      String code, String state) async {
    final res = await http.post(
      Uri.parse('${await base()}/api/auth/wechat'),
      headers: await headers(json: true),
      body: jsonEncode({'code': code, 'state': state}),
    );
    final body = _json(res);
    await _saveToken(body['token'] as String);
    return body['user'] as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> devLogin() async {
    final res = await http.post(Uri.parse('${await base()}/api/auth/dev'));
    final body = _json(res);
    await _saveToken(body['token'] as String);
    return body['user'] as Map<String, dynamic>;
  }

  static Future<void> logout() async {
    final sp = await SharedPreferences.getInstance();
    final key = await _tokenKey();
    try {
      await http.post(
        Uri.parse('${await base()}/api/auth/logout'),
        headers: await headers(),
      );
    } finally {
      await sp.remove(key);
    }
  }

  static Future<Uri> exportUrl(String recordingId, String format) async {
    final root = await base();
    final res = await http.post(
      Uri.parse('$root/api/recordings/$recordingId/export-link'),
      headers: await headers(json: true),
      body: jsonEncode({'format': format}),
    );
    final path = _json(res)['path'] as String;
    return Uri.parse('$root$path');
  }

  static Future<List<dynamic>> list({String query = ''}) async {
    final root = Uri.parse('${await base()}/api/recordings');
    final uri = query.trim().isEmpty
        ? root
        : root.replace(queryParameters: {'q': query.trim()});
    final res = await http.get(uri, headers: await headers());
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
  }

  static Future<Map<String, dynamic>> get(String id) async {
    final res = await http.get(
      Uri.parse('${await base()}/api/recordings/$id'),
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> upload(File file,
      {String? title, String? originalName}) async {
    final req = http.MultipartRequest(
        'POST', Uri.parse('${await base()}/api/recordings'));
    req.headers.addAll(await headers());
    req.files.add(await http.MultipartFile.fromPath(
      'audio',
      file.path,
      filename: originalName,
    ));
    if (title != null && title.isNotEmpty) req.fields['title'] = title;
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 201) throw Exception('上传失败 HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// part 可选 summary / sprouts / mindmap / proofread / ai / all；full 才重新转写。
  static Future<void> reprocess(String id,
      {String part = 'ai', bool full = false}) async {
    final uri = Uri.parse('${await base()}/api/recordings/$id/reprocess')
        .replace(queryParameters: {
      'part': part,
      if (full) 'full': '1',
    });
    final res = await http.post(
      uri,
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception(_json(res)['error'] ?? '重新生成失败');
    }
  }
}

class AuthRequiredException implements Exception {
  const AuthRequiredException();
  @override
  String toString() => '请先登录';
}
