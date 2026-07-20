import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api.dart';
import '../call_recording_importer.dart';
import 'detail_page.dart';
import 'import_page.dart';
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

class _ListPageState extends State<ListPage> with WidgetsBindingObserver {
  List<dynamic> _items = [];
  String? _error;
  Timer? _timer;
  Timer? _searchTimer;
  StreamSubscription? _shareSub;
  List<String> _pending = [];
  String _query = '';
  late final CallRecordingImporter _callImporter;
  bool _callImportRunning = false;
  int _processingCount = 0; // 正在处理的录音数（显示角标）

  // 文件夹/标签筛选
  List<Map<String, dynamic>> _folders = [];
  List<Map<String, dynamic>> _tags = [];
  String? _folderFilter; // null=全部, ''=未分类, 'xxx'=指定文件夹
  String? _tagFilter; // null=全部, 'xxx'=指定标签

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _callImporter = CallRecordingImporter(
        userId: widget.user?['id']?.toString() ?? 'local');
    _refresh();
    _loadPending();
    _loadFilters();
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _autoImportCallRecordings());
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
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _searchTimer?.cancel();
    _shareSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _autoImportCallRecordings();
  }

  Future<void> _autoImportCallRecordings() async {
    if (!_callImporter.isSupported || _callImportRunning) return;
    if (!await _callImporter.autoImportEnabled()) return;
    if (await _callImporter.getDirectory() == null) return;
    _callImportRunning = true;
    try {
      final report = await _callImporter.scanAndUpload();
      if (report.hasChanges) {
        await _refresh();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('已自动导入 ${report.imported} 条通话录音')));
        }
      } else if (report.failed > 0 && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('通话录音自动导入失败，将在下次重试')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('通话录音目录扫描失败：$error')));
      }
    } finally {
      _callImportRunning = false;
    }
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
      final rec = await Api.uploadFile(File(path));
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
      final items = await Api.list(
        query: _query,
        folder: _folderFilter,
        tag: _tagFilter,
      );
      final processing = items.where((r) {
        final s = (r as Map<String, dynamic>)['status'] as String? ?? '';
        return s == 'uploaded' || s == 'transcribing' || s == 'summarizing';
      }).length;
      if (mounted) {
        setState(() {
          _items = items;
          _processingCount = processing;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _loadFilters() async {
    try {
      final results = await Future.wait([Api.folders(), Api.tags()]);
      if (mounted) {
        setState(() {
          _folders = (results[0]['folders'] as List).cast<Map<String, dynamic>>();
          _tags = (results[1]['tags'] as List).cast<Map<String, dynamic>>();
        });
      }
    } catch (_) {}
  }

  Future<void> _openImport() async {
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            ImportPage(userId: widget.user?['id']?.toString() ?? 'local'),
      ),
    );
    await _refresh();
    if (mounted && result is String) _openDetail(result);
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
    Map<String, dynamic>? syncStats;
    if (!mounted) return;
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) {
          // 异步加载同步状态（只触发一次）
          if (syncStats == null) {
            Api.syncStatus().then((s) {
              if (ctx.mounted) setDlg(() => syncStats = s);
            }).catchError((_) {});
          }
          return AlertDialog(
            title: const Text('设置'),
            content: SizedBox(
              width: double.maxFinite,
              child: Column(
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
                      subtitle: Text(
                        '当前账号${widget.user?['stats'] != null ? ' · ${widget.user!['stats']['total'] ?? 0} 条录音' : ''}',
                      ),
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
                  // 同步状态卡片
                  if (syncStats != null) ...[
                    const Divider(),
                    _buildSyncStatusCard(syncStats!),
                  ] else
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: SizedBox(
                          width: 20, height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2)),
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
            ),
          );
        },
      ),
    );
    if (url != null && url.isNotEmpty) {
      await Api.setBase(url);
      _refresh();
    }
  }

  Widget _buildSyncStatusCard(Map<String, dynamic> s) {
    final total = s['total'] as num? ?? 0;
    final done = s['done'] as num? ?? 0;
    final error = s['error'] as num? ?? 0;
    final processing = (s['uploaded'] as num? ?? 0) +
        (s['transcribing'] as num? ?? 0) +
        (s['summarizing'] as num? ?? 0);
    final sizeBytes = s['totalSize'] as num? ?? 0;
    final durationSec = s['totalDuration'] as num? ?? 0;
    final lastSync = s['lastSyncAt'] as String?;

    String fmtSize(int bytes) {
      if (bytes < 1024) return '$bytes B';
      if (bytes < 1048576) return '${(bytes / 1024).toStringAsFixed(1)} KB';
      if (bytes < 1073741824) return '${(bytes / 1048576).toStringAsFixed(1)} MB';
      return '${(bytes / 1073741824).toStringAsFixed(1)} GB';
    }

    String fmtDur(int sec) {
      final h = sec ~/ 3600;
      final m = (sec % 3600) ~/ 60;
      if (h > 0) return '$h 时 $m 分';
      return '$m 分钟';
    }

    String fmtTime(String? iso) {
      if (iso == null || iso.isEmpty) return '无';
      try {
        final dt = DateTime.parse(iso).toLocal();
        return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
      } catch (_) {
        return iso;
      }
    }

    return Card(
      elevation: 0,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.cloud_done, size: 18),
                const SizedBox(width: 6),
                Text('同步状态', style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                Text('总录音 $total 条'),
                Text('已完成 $done 条'),
                if (processing > 0)
                  Text('处理中 $processing 条',
                      style: const TextStyle(color: Colors.orange)),
                if (error > 0)
                  Text('失败 $error 条',
                      style: const TextStyle(color: Colors.red)),
              ],
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                Text('存储 ${fmtSize(sizeBytes.toInt())}'),
                if (durationSec > 0) Text('时长 ${fmtDur(durationSec.toInt())}'),
              ],
            ),
            const SizedBox(height: 4),
            Text('最近活动 ${fmtTime(lastSync)}',
                style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasFilter = _folderFilter != null || _tagFilter != null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('声图'),
        actions: [
          IconButton(
            onPressed: _openImport,
            tooltip: '导入录音',
            icon: const Icon(Icons.move_to_inbox_outlined),
          ),
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                onPressed: _editServer,
                tooltip: '设置',
                icon: const Icon(Icons.settings),
              ),
              if (_processingCount > 0)
                Positioned(
                  right: 8,
                  top: 8,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: Colors.orange,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    constraints: const BoxConstraints(minWidth: 16),
                    child: Text(
                      '$_processingCount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
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
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
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
        // 文件夹/标签筛选栏
        if (_folders.isNotEmpty || _tags.isNotEmpty || hasFilter)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Row(children: [
              // 文件夹下拉
              PopupMenuButton<String>(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: _folderFilter != null
                        ? Theme.of(context).colorScheme.primaryContainer
                        : Theme.of(context).chipTheme.backgroundColor,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.folder_outlined,
                        size: 16,
                        color: Theme.of(context).hintColor),
                    const SizedBox(width: 4),
                    Text(
                      _folderFilter == null
                          ? '全部'
                          : _folderFilter!.isEmpty
                              ? '未分类'
                              : _folderFilter!,
                      style: const TextStyle(fontSize: 13),
                    ),
                    const Icon(Icons.arrow_drop_down, size: 18),
                  ]),
                ),
                onSelected: (v) {
                  setState(() => _folderFilter = v == '__all__' ? null : v);
                  _refresh();
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: '__all__', child: Text('全部')),
                  const PopupMenuItem(value: '', child: Text('未分类')),
                  ..._folders.map((f) => PopupMenuItem(
                        value: f['name'] as String,
                        child: Text('${f['name']} (${f['count']})'),
                      )),
                ],
              ),
              if (hasFilter) ...[
                const SizedBox(width: 4),
                ActionChip(
                  label: const Text('清除', style: TextStyle(fontSize: 12)),
                  onPressed: () {
                    setState(() {
                      _folderFilter = null;
                      _tagFilter = null;
                    });
                    _refresh();
                  },
                ),
              ],
            ]),
          ),
        if (_tags.isNotEmpty)
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: _tags.map((t) {
                final name = t['name'] as String;
                final count = t['count'];
                final selected = _tagFilter == name;
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: FilterChip(
                    label: Text('$name ($count)', style: const TextStyle(fontSize: 12)),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _tagFilter = selected ? null : name);
                      _refresh();
                    },
                    visualDensity: VisualDensity.compact,
                  ),
                );
              }).toList(),
            ),
          ),
        Expanded(
            child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([_refresh(), _loadFilters()]);
          },
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
                        final createdAt = (r['createdAt'] as String? ?? '')
                            .replaceFirst('T', ' ')
                            .split('.')
                            .first;
                        final dur = r['duration'] as num?;
                        String fmtDur(int s) {
                          final h = s ~/ 3600;
                          final m = (s % 3600) ~/ 60;
                          final sec = s % 60;
                          if (h > 0) return '$h:${m.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
                          return '${m.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
                        }
                        final durText = dur != null ? fmtDur(dur.toInt()) : null;
                        final folder = r['folder'] as String?;
                        final tags = (r['tags'] as List?)?.cast<String>() ?? [];
                        return ListTile(
                          title: Text(r['title'] as String? ??
                              r['originalName'] as String? ??
                              '未命名'),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                durText != null ? '$durText · $createdAt' : createdAt,
                                style: TextStyle(fontSize: 12, color: Theme.of(ctx).hintColor),
                              ),
                              if (folder != null || tags.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Wrap(
                                    spacing: 4,
                                    runSpacing: 2,
                                    children: [
                                      if (folder != null)
                                        _miniChip(ctx, Icons.folder_outlined, folder,
                                            Theme.of(ctx).colorScheme.primaryContainer),
                                      ...tags.map((t) => _miniChip(
                                          ctx, Icons.label_outline, t,
                                          Theme.of(ctx).chipTheme.backgroundColor)),
                                    ],
                                  ),
                                ),
                            ],
                          ),
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
                          onLongPress: () => _editFolderTags(r),
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

  Widget _miniChip(BuildContext ctx, IconData icon, String label, Color? bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 11, color: Theme.of(ctx).hintColor),
        const SizedBox(width: 2),
        Text(label, style: TextStyle(fontSize: 11, color: Theme.of(ctx).hintColor)),
      ]),
    );
  }

  Future<void> _editFolderTags(Map<String, dynamic> rec) async {
    final id = rec['id'] as String;
    final folderCtrl = TextEditingController(text: rec['folder'] as String? ?? '');
    final tagsCtrl = TextEditingController(text:
        ((rec['tags'] as List?)?.cast<String>() ?? []).join(', '));
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('文件夹与标签'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: folderCtrl,
              decoration: const InputDecoration(
                labelText: '文件夹',
                hintText: '如：工作、会议',
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: tagsCtrl,
              decoration: const InputDecoration(
                labelText: '标签',
                hintText: '逗号分隔，如：重要, 待跟进',
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('保存')),
        ],
      ),
    );
    if (result == true) {
      try {
        final tags = tagsCtrl.text.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();
        await Api.updateRecording(id, folder: folderCtrl.text.trim(), tags: tags);
        await Future.wait([_refresh(), _loadFilters()]);
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('保存失败: $e')));
        }
      }
    }
  }
}
