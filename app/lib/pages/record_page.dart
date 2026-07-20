import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api.dart';

class RecordPage extends StatefulWidget {
  const RecordPage({super.key});
  @override
  State<RecordPage> createState() => _RecordPageState();
}

class _RecordPageState extends State<RecordPage> with WidgetsBindingObserver {
  final _recorder = AudioRecorder();
  bool _recording = false;
  bool _paused = false;
  bool _uploading = false;
  Timer? _timer;

  // 墙钟计时：用 DateTime 差值算实际经过时间，app 退到后台再回来不会丢时长
  DateTime? _recStart; // 本次录音开始时刻
  Duration _totalPaused = Duration.zero; // 累计暂停时长
  DateTime? _pauseStart; // 当前暂停开始时刻

  String? _path;
  final List<int> _marks = []; // 标记时间点（秒）

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this); // 监听 app 生命周期
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  /// app 从后台回到前台时触发：重新计算经过时间，Timer 自动恢复
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _recording && !_paused) {
      _tick(); // 立即刷新一次，避免界面卡在旧时间
    }
  }

  /// 实际录音经过的秒数（排除暂停时段）
  int get _elapsedSeconds {
    if (_recStart == null) return 0;
    final now = DateTime.now();
    var elapsed = now.difference(_recStart!);
    // 减去累计暂停 + 当前正在暂停的时段
    if (_paused && _pauseStart != null) {
      elapsed -= now.difference(_pauseStart!);
    }
    elapsed -= _totalPaused;
    return elapsed.inSeconds.clamp(0, 999999);
  }

  String get _fmt {
    final s = _elapsedSeconds;
    return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  }

  String _fmtMark(int s) =>
      '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';

  void _tick() {
    if (mounted) setState(() {});
  }

  Future<void> _start() async {
    // 1. 麦克风权限
    if (!await _recorder.hasPermission()) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('没有麦克风权限')));
      }
      return;
    }

    // 2. 通知权限（Android 13+ 需要才能显示前台服务通知）
    //    不阻断流程——用户拒绝后录音照常工作，只是没有通知栏提示
    await Permission.notification.request();

    final dir = await getApplicationDocumentsDirectory();
    _path =
        '${dir.path}/rec_${DateTime.now().millisecondsSinceEpoch}.m4a';
    // 单声道（说话人分离要求）；码率按用户设置：标准 96k / 高音质 192k@48kHz
    final sp = await SharedPreferences.getInstance();
    final high = (sp.getString('rec_quality') ?? 'standard') == 'high';

    await _recorder.start(
        RecordConfig(
            encoder: AudioEncoder.aacLc,
            bitRate: high ? 192000 : 96000,
            sampleRate: high ? 48000 : 44100,
            numChannels: 1,
            // Android 前台服务：app 退到后台后录音不中断，通知栏显示"声图录音中"
            androidConfig: const AndroidRecordConfig(
              service: AndroidService(
                title: '声图录音中',
                content: '点击返回 App 查看录音',
              ),
            )),
        path: _path!);

    setState(() {
      _recording = true;
      _paused = false;
      _recStart = DateTime.now();
      _totalPaused = Duration.zero;
      _pauseStart = null;
      _marks.clear();
    });
    // 每秒刷新 UI（实际时间从墙钟算，Timer 只负责触发重绘）
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_paused) _tick();
    });
  }

  Future<void> _togglePause() async {
    if (_paused) {
      await _recorder.resume();
      // 累加本次暂停时长
      if (_pauseStart != null) {
        _totalPaused += DateTime.now().difference(_pauseStart!);
        _pauseStart = null;
      }
      setState(() => _paused = false);
    } else {
      await _recorder.pause();
      _pauseStart = DateTime.now();
      setState(() => _paused = true);
    }
  }

  void _addMark() {
    if (!_recording || _paused) return;
    final sec = _elapsedSeconds;
    setState(() => _marks.add(sec));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('已标记 ${_fmtMark(sec)}'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  Future<void> _stopAndUpload() async {
    _timer?.cancel();
    final path = await _recorder.stop();
    setState(() { _recording = false; _paused = false; _uploading = true; });
    try {
      final now = DateTime.now();
      final title =
          '录音 ${now.month}月${now.day}日 ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      final rec = await Api.uploadFile(File(path ?? _path!), title: title);
      if (mounted) Navigator.pop(context, rec['id'] as String);
    } catch (e) {
      // 上传失败：录音已在本机，加入待重试队列（列表页顶部可一键重传）
      final sp = await SharedPreferences.getInstance();
      final list = sp.getStringList('pending_uploads') ?? [];
      final p = path ?? _path!;
      if (!list.contains(p)) list.add(p);
      await sp.setStringList('pending_uploads', list);
      if (mounted) {
        setState(() => _uploading = false);
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('上传失败: $e（录音已保存，可在列表页重试）')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return Scaffold(
      appBar: AppBar(title: const Text('录音')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_fmt,
                style: TextStyle(
                    fontSize: 64,
                    fontWeight: FontWeight.w300,
                    color: _recording
                        ? (_paused ? Colors.grey : accent)
                        : Colors.grey)),
            const SizedBox(height: 12),
            Text(
                _uploading
                    ? '上传中…'
                    : _recording
                        ? (_paused ? '已暂停' : '录音中')
                        : '点击开始录音',
                style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 48),
            if (_uploading)
              const CircularProgressIndicator()
            else ...[
              // 主按钮：开始 / 停止
              GestureDetector(
                onTap: _recording ? _stopAndUpload : _start,
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _recording ? Colors.red : accent,
                  ),
                  child: Icon(_recording ? Icons.stop : Icons.mic,
                      color: Colors.white, size: 44),
                ),
              ),
              if (_recording) ...[
                const SizedBox(height: 28),
                // 辅助按钮行：标记 / 暂停续录
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Column(children: [
                      IconButton.filled(
                        onPressed: _paused ? null : _addMark,
                        icon: const Icon(Icons.bookmark_add_outlined),
                        iconSize: 28,
                        style: IconButton.styleFrom(
                          backgroundColor: accent.withValues(alpha: 0.15),
                          foregroundColor: accent,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text('标记', style: TextStyle(fontSize: 11)),
                    ]),
                    const SizedBox(width: 32),
                    Column(children: [
                      IconButton.filled(
                        onPressed: _togglePause,
                        icon: Icon(_paused ? Icons.play_arrow : Icons.pause),
                        iconSize: 28,
                      ),
                      const SizedBox(height: 4),
                      Text(_paused ? '续录' : '暂停',
                          style: const TextStyle(fontSize: 11)),
                    ]),
                  ],
                ),
                // 标记列表
                if (_marks.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  SizedBox(
                    height: 120,
                    child: ListView(
                      shrinkWrap: true,
                      padding: const EdgeInsets.symmetric(horizontal: 32),
                      children: [
                        Text('标记 (${_marks.length})',
                            style: const TextStyle(
                                fontSize: 12, color: Colors.grey)),
                        const SizedBox(height: 4),
                        Wrap(
                          spacing: 8,
                          runSpacing: 4,
                          children: _marks
                              .asMap()
                              .entries
                              .map((e) => Chip(
                                    label: Text(
                                        '${e.key + 1} · ${_fmtMark(e.value)}',
                                        style: const TextStyle(fontSize: 11)),
                                    visualDensity: VisualDensity.compact,
                                    padding: EdgeInsets.zero,
                                  ))
                              .toList(),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                const Text('停止后自动上传并开始转写',
                    style: TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
