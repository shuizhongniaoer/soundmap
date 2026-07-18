import 'dart:async';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api.dart';
import 'detail_page.dart';
import 'record_page.dart';

const _statusLabel = {
  'uploaded': '排队中',
  'transcribing': '转写中',
  'summarizing': 'AI 处理中',
  'done': '完成',
  'error': '失败',
};

class ListPage extends StatefulWidget {
  const ListPage({super.key, this.user, this.onLogout});
  final Map<String, dynamic>? user;
  final Future<void> Function()? onLogout;
  @override
  State<ListPage> createState() => _ListPageState();
}

class _ListPageState extends State<ListPage> {
  List<dynamic> _items = [];
  String? _error;
  Timer? _timer;
  Timer? _searchTimer;
  StreamSubscription? _shareSub;
  List<String> _pending = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    _refresh();
    _loadPending();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
    // 系统分享导入：App 运行中收到分享
    _shareSub = ReceiveSharingIntent.instance
        .getMediaStream()
        .listen(_handleShared, onError: (_) {});
    // App 因分享而被启动
    ReceiveSharingIntent.instance.getInitialMedia().then((files) {
      _handleShared(files);
      ReceiveSharingIntent.instance.reset();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _searchTimer?.cancel();
    _shareSub?.cancel();
    super.dispose();
  }

  Future<void> _handleShared(List<SharedMediaFile> files) async {
    for (final f in files) {
      await _uploadPath(f.path, fromShare: true);
    }
  }

  Future<void> _uploadPath(String path, {bool fromShare = false}) async {
    if (!File(path).existsSync()) return;
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(fromShare ? '收到分享，上传中…' : '上传中…')));
    }
    try {
      final rec = await Api.upload(File(path));
      await _removePending(path);
      _refresh();
      if (mounted && fromShare) _openDetail(rec['id'] as String);
    } catch (e) {
      await _addPending(path);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('上传失败，已加入待重试: $e')));
      }
    }
  }

  // ---- 失败重试队列（本地持久化）----
  Future<void> _loadPending() async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList('pending_uploads') ?? [];
    list.removeWhere((p) => !File(p).existsSync());
    await sp.setStringList('pending_uploads', list);
    if (mounted) setState(() => _pending = list);
  }

  Future<void> _addPending(String path) async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList('pending_uploads') ?? [];
    if (!list.contains(path)) list.add(path);
    await sp.setStringList('pending_uploads', list);
    if (mounted) setState(() => _pending = list);
  }

  Future<void> _removePending(String path) async {
    final sp = await SharedPreferences.getInstance();
    final list = sp.getStringList('pending_uploads') ?? [];
    list.remove(path);
    await sp.setStringList('pending_uploads', list);
    if (mounted) setState(() => _pending = list);
  }

  Future<void> _retryPending() async {
    for (final p in List<String>.from(_pending)) {
      await _uploadPath(p);
    }
  }

  Future<void> _refresh() async {
    try {
      final items = await Api.list(query: _query);
      if (mounted) {
        setState(() {
          _items = items;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _pickAndUpload() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.any);
    final path = result?.files.single.path;
    if (path == null) return;
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('上传中…')));
    try {
      final rec = await Api.upload(File(path));
      _refresh();
      if (mounted) _openDetail(rec['id'] as String);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('上传失败: $e')));
      }
    }
  }

  void _openDetail(String id) {
    Navigator.push(
            context, MaterialPageRoute(builder: (_) => DetailPage(id: id)))
        .then((_) => _refresh());
  }

  Future<void> _editServer() async {
    final ctrl = TextEditingController(text: await Api.base());
    final sp = await SharedPreferences.getInstance();
    var quality = sp.getString('rec_quality') ?? 'standard';
    if (!mounted) return;
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) => AlertDialog(
          title: const Text('设置'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: ctrl,
                decoration: const InputDecoration(
                    labelText: '服务器地址',
                    helperText:
                        '模拟器: http://10.0.2.2:3000\n真机: http://电脑局域网IP:3000'),
              ),
              const SizedBox(height: 12),
              if (widget.user != null)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.account_circle),
                  title: Text(widget.user?['nickname']?.toString() ?? '声图用户'),
                  subtitle: const Text('当前账号'),
                  trailing: widget.onLogout == null
                      ? null
                      : TextButton(
                          onPressed: () async {
                            Navigator.pop(ctx);
                            await widget.onLogout!();
                          },
                          child: const Text('退出登录'),
                        ),
                ),
              RadioGroup<String>(
                groupValue: quality,
                onChanged: (v) {
                  if (v != null) setDlg(() => quality = v);
                },
                child: const Column(
                  children: [
                    RadioListTile<String>(
                      title: Text('标准音质'),
                      subtitle: Text('96kbps 单声道，省流量'),
                      value: 'standard',
                      dense: true,
                    ),
                    RadioListTile<String>(
                      title: Text('高音质'),
                      subtitle: Text('192kbps / 48kHz，文件约大一倍'),
                      value: 'high',
                      dense: true,
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
            FilledButton(
                onPressed: () async {
                  await sp.setString('rec_quality', quality);
                  if (ctx.mounted) Navigator.pop(ctx, ctrl.text.trim());
                },
                child: const Text('保存')),
          ],
        ),
      ),
    );
    if (url != null && url.isNotEmpty) {
      await Api.setBase(url);
      _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('声图'),
        actions: [
          IconButton(
              onPressed: _pickAndUpload, icon: const Icon(Icons.upload_file)),
          IconButton(onPressed: _editServer, icon: const Icon(Icons.settings)),
        ],
      ),
      body: Column(children: [
        if (_pending.isNotEmpty)
          MaterialBanner(
            content: Text('有 ${_pending.length} 条录音未上传成功'),
            leading: const Icon(Icons.cloud_off, color: Colors.orange),
            actions: [
              TextButton(onPressed: _retryPending, child: const Text('重试')),
            ],
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: '搜索标题、转写全文、说话人或 AI 总结',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (value) {
              _query = value;
              _searchTimer?.cancel();
              _searchTimer = Timer(const Duration(milliseconds: 300), _refresh);
            },
          ),
        ),
        Expanded(
            child: RefreshIndicator(
          onRefresh: _refresh,
          child: _error != null
              ? ListView(children: [
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('连接服务器失败：$_error\n\n请检查右上角设置里的服务器地址',
                        style: const TextStyle(color: Colors.red)),
                  )
                ])
              : _items.isEmpty
                  ? ListView(children: const [
                      Padding(
                        padding: EdgeInsets.all(48),
                        child: Center(child: Text('暂无录音或没有匹配的搜索结果')),
                      )
                    ])
                  : ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (ctx, i) {
                        final r = _items[i] as Map<String, dynamic>;
                        final status = r['status'] as String? ?? '';
                        final done = status == 'done';
                        final err = status == 'error';
                        return ListTile(
                          title: Text(r['title'] as String? ??
                              r['originalName'] as String? ??
                              '未命名'),
                          subtitle: Text((r['createdAt'] as String? ?? '')
                              .replaceFirst('T', ' ')
                              .split('.')
                              .first),
                          trailing: Chip(
                            label: Text(_statusLabel[status] ?? status,
                                style: TextStyle(
                                    fontSize: 12,
                                    color: err
                                        ? Colors.red
                                        : done
                                            ? Colors.green.shade800
                                            : Colors.orange.shade800)),
                            visualDensity: VisualDensity.compact,
                          ),
                          onTap: () => _openDetail(r['id'] as String),
                        );
                      },
                    ),
        )),
      ]),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.push(context,
              MaterialPageRoute(builder: (_) => const RecordPage())).then((id) {
            _refresh();
            _loadPending();
            if (id is String) _openDetail(id);
          });
        },
        icon: const Icon(Icons.mic),
        label: const Text('录音'),
      ),
    );
  }
}
