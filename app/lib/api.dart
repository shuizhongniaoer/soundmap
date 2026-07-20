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

  static Future<List<dynamic>> list(
      {String query = '', String? folder, String? tag}) async {
    final root = Uri.parse('${await base()}/api/recordings');
    final params = <String, String>{};
    if (query.trim().isNotEmpty) params['q'] = query.trim();
    if (folder != null) params['folder'] = folder;
    if (tag != null && tag.isNotEmpty) params['tag'] = tag;
    final uri = params.isEmpty ? root : root.replace(queryParameters: params);
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
      {String? title, String? originalName, String? folder, List<String>? tags}) async {
    final req = http.MultipartRequest(
        'POST', Uri.parse('${await base()}/api/recordings'));
    req.headers.addAll(await headers());
    req.files.add(await http.MultipartFile.fromPath(
      'audio',
      file.path,
      filename: originalName,
    ));
    if (title != null && title.isNotEmpty) req.fields['title'] = title;
    if (folder != null && folder.isNotEmpty) req.fields['folder'] = folder;
    if (tags != null && tags.isNotEmpty) req.fields['tags'] = tags.join(',');
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 201) throw Exception('上传失败 HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  // ===== 分片上传（大文件 + 断点续传）=====

  /// 分片上传阈值：文件 >= 此大小自动走分片上传
  static const int chunkThreshold = 10 * 1024 * 1024; // 10MB
  /// 分片大小：2MB
  static const int _chunkSize = 2 * 1024 * 1024;

  /// 自动选择上传方式：大文件走分片，小文件走简单上传
  static Future<Map<String, dynamic>> uploadFile(File file,
      {String? title,
      String? originalName,
      String? folder,
      List<String>? tags,
      void Function(int sent, int total)? onProgress}) async {
    final fileSize = await file.length();
    if (fileSize < chunkThreshold) {
      return upload(file, title: title, originalName: originalName);
    }
    return uploadChunked(file,
        title: title,
        originalName: originalName,
        folder: folder,
        tags: tags,
        onProgress: onProgress);
  }

  /// 分片上传（支持断点续传）
  ///
  /// [onProgress] 回调：(已上传字节数, 总字节数)
  static Future<Map<String, dynamic>> uploadChunked(File file,
      {String? title,
      String? originalName,
      String? folder,
      List<String>? tags,
      void Function(int sent, int total)? onProgress}) async {
    final fileSize = await file.length();
    final name = originalName ?? file.path.split('/').last;
    final modified = (await file.stat()).modified.millisecondsSinceEpoch;

    // 断点续传：检查是否有未完成的会话
    final sessionKey = 'chunked_upload:${await base()}:${file.path}:$fileSize:$modified';
    String? uploadId = await _getSavedUploadId(sessionKey);

    Map<String, dynamic>? session;
    if (uploadId != null) {
      // 查询已有会话状态
      try {
        final status = await _getUploadStatus(uploadId);
        if (status != null && status['status'] == 'uploading') {
          session = status;
        }
      } catch (_) {
        // 会话已过期或不存在，重新初始化
      }
    }

    // 初始化新会话
    if (session == null) {
      uploadId = await _initUpload(
        filename: name,
        size: fileSize,
        chunkSize: _chunkSize,
      );
      session = await _getUploadStatus(uploadId);
      if (session == null) throw Exception('初始化上传会话失败');
    }
    await _saveUploadId(sessionKey, uploadId!);

    final chunkSize = session['chunkSize'] as int;
    final totalChunks = session['totalChunks'] as int;
    final received = (session['received'] as List).cast<int>().toSet();

    // 上传缺失的分片
    final raf = await file.open();
    try {
      for (var i = 0; i < totalChunks; i++) {
        if (received.contains(i)) continue;
        final start = i * chunkSize;
        final end = (start + chunkSize > fileSize) ? fileSize : start + chunkSize;
        await raf.setPosition(start);
        final chunkData = await raf.read(end - start);
        await _uploadChunk(uploadId, i, chunkData);
        onProgress?.call(end, fileSize);
      }
    } finally {
      await raf.close();
    }

    // 完成上传
    final rec = await _completeUpload(uploadId,
        title: title, originalName: name, folder: folder, tags: tags);

    // 清理保存的 uploadId
    await _clearSavedUploadId(sessionKey);

    return rec;
  }

  static Future<String> _initUpload({
    required String filename,
    required int size,
    required int chunkSize,
  }) async {
    final res = await http.post(
      Uri.parse('${await base()}/api/uploads'),
      headers: await headers(json: true),
      body: jsonEncode({
        'filename': filename,
        'size': size,
        'chunkSize': chunkSize,
      }),
    );
    final body = _json(res);
    return body['uploadId'] as String;
  }

  static Future<Map<String, dynamic>?> _getUploadStatus(String uploadId) async {
    final res = await http.get(
      Uri.parse('${await base()}/api/uploads/$uploadId'),
      headers: await headers(),
    );
    if (res.statusCode == 404) return null;
    return _json(res);
  }

  static Future<void> _uploadChunk(
      String uploadId, int index, List<int> data) async {
    final res = await http.post(
      Uri.parse('${await base()}/api/uploads/$uploadId/chunks/$index'),
      headers: {
        ...await headers(),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('分片上传失败: HTTP ${res.statusCode}');
    }
  }

  static Future<Map<String, dynamic>> _completeUpload(String uploadId,
      {String? title,
      String? originalName,
      String? folder,
      List<String>? tags}) async {
    final body = <String, dynamic>{};
    if (title != null && title.isNotEmpty) body['title'] = title;
    if (folder != null && folder.isNotEmpty) body['folder'] = folder;
    if (tags != null && tags.isNotEmpty) body['tags'] = tags;
    final res = await http.post(
      Uri.parse('${await base()}/api/uploads/$uploadId/complete'),
      headers: await headers(json: true),
      body: jsonEncode(body),
    );
    return _json(res);
  }

  /// 中止分片上传会话（取消上传时调用）
  static Future<void> abortUpload(String uploadId) async {
    await http.delete(
      Uri.parse('${await base()}/api/uploads/$uploadId'),
      headers: await headers(),
    );
  }

  static Future<String?> _getSavedUploadId(String key) async {
    final sp = await SharedPreferences.getInstance();
    return sp.getString(key);
  }

  static Future<void> _saveUploadId(String key, String uploadId) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(key, uploadId);
  }

  static Future<void> _clearSavedUploadId(String key) async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(key);
  }

  /// 场景模板列表
  static Future<List<Map<String, dynamic>>> templates() async {
    final res = await http.get(
      Uri.parse('${await base()}/api/templates'),
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    final list = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// part 可选 summary / sprouts / mindmap / proofread / ai / all；full 才重新转写。
  /// template 可选场景模板 id（auto/meeting/sales/lecture/interview/memo）。
  static Future<void> reprocess(String id,
      {String part = 'ai', bool full = false, String? template}) async {
    final uri = Uri.parse('${await base()}/api/recordings/$id/reprocess')
        .replace(queryParameters: {
      'part': part,
      if (full) 'full': '1',
      if (template != null && template.isNotEmpty) 'template': template,
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

  /// 修改单句转写：说话人 和/或 文字
  static Future<Map<String, dynamic>> updateSegment(
      String id, int idx, {String? speaker, String? text}) async {
    final res = await http.patch(
      Uri.parse('${await base()}/api/recordings/$id/segments/$idx'),
      headers: await headers(json: true),
      body: jsonEncode({
        if (speaker != null) 'speaker': speaker,
        if (text != null) 'text': text,
      }),
    );
    return _json(res);
  }

  /// 批量重命名说话人
  static Future<Map<String, dynamic>> renameSpeakers(
      String id, {required String from, required String to}) async {
    final res = await http.patch(
      Uri.parse('${await base()}/api/recordings/$id/speakers'),
      headers: await headers(json: true),
      body: jsonEncode({'from': from, 'to': to}),
    );
    return _json(res);
  }

  /// 更新录音元信息（文件夹、标签）
  /// folder 传空字符串表示移出文件夹，null 表示不修改
  /// tags 传列表表示替换全部标签，null 表示不修改
  static Future<Map<String, dynamic>> updateRecording(String id,
      {String? folder, List<String>? tags}) async {
    final body = <String, dynamic>{};
    if (folder != null) body['folder'] = folder;
    if (tags != null) body['tags'] = tags;
    final res = await http.patch(
      Uri.parse('${await base()}/api/recordings/$id'),
      headers: await headers(json: true),
      body: jsonEncode(body),
    );
    return _json(res);
  }

  /// 获取文件夹列表（含数量）
  static Future<Map<String, dynamic>> folders() async {
    final res = await http.get(
      Uri.parse('${await base()}/api/folders'),
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// 获取标签列表（含数量）
  static Future<Map<String, dynamic>> tags() async {
    final res = await http.get(
      Uri.parse('${await base()}/api/tags'),
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// 音频播放 URL（需带 Authorization header）
  static Future<Uri> audioUri(String id) async {
    return Uri.parse('${await base()}/api/recordings/$id/audio');
  }

  /// 同步状态：各处理阶段的录音数量、存储用量、最近同步时间
  static Future<Map<String, dynamic>> syncStatus() async {
    final res = await http.get(
      Uri.parse('${await base()}/api/sync/status'),
      headers: await headers(),
    );
    if (res.statusCode == 401) throw const AuthRequiredException();
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }
}

class AuthRequiredException implements Exception {
  const AuthRequiredException();
  @override
  String toString() => '请先登录';
}
