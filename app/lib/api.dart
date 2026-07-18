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

  static Future<List<dynamic>> list({String query = ''}) async {
    final root = Uri.parse('${await base()}/api/recordings');
    final uri = query.trim().isEmpty
        ? root
        : root.replace(queryParameters: {'q': query.trim()});
    final res = await http.get(uri);
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
  }

  static Future<Map<String, dynamic>> get(String id) async {
    final res = await http.get(Uri.parse('${await base()}/api/recordings/$id'));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> upload(File file, {String? title}) async {
    final req = http.MultipartRequest(
        'POST', Uri.parse('${await base()}/api/recordings'));
    req.files.add(await http.MultipartFile.fromPath('audio', file.path));
    if (title != null && title.isNotEmpty) req.fields['title'] = title;
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode != 201) throw Exception('上传失败 HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// full=true 时重新转写（重新计费、应用最新热词），否则只重跑 AI 总结
  static Future<void> reprocess(String id, {bool full = false}) async {
    await http.post(Uri.parse(
        '${await base()}/api/recordings/$id/reprocess${full ? '?full=1' : ''}'));
  }
}
