import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api.dart';

class RecordPage extends StatefulWidget {
  const RecordPage({super.key});
  @override
  State<RecordPage> createState() => _RecordPageState();
}

class _RecordPageState extends State<RecordPage> {
  final _recorder = AudioRecorder();
  bool _recording = false;
  bool _uploading = false;
  int _seconds = 0;
  Timer? _timer;
  String? _path;

  @override
  void dispose() {
    _timer?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  String get _fmt =>
      '${(_seconds ~/ 60).toString().padLeft(2, '0')}:${(_seconds % 60).toString().padLeft(2, '0')}';

  Future<void> _start() async {
    if (!await _recorder.hasPermission()) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('没有麦克风权限')));
      }
      return;
    }
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
            numChannels: 1),
        path: _path!);
    setState(() { _recording = true; _seconds = 0; });
    _timer = Timer.periodic(
        const Duration(seconds: 1), (_) => setState(() => _seconds++));
  }

  Future<void> _stopAndUpload() async {
    _timer?.cancel();
    final path = await _recorder.stop();
    setState(() { _recording = false; _uploading = true; });
    try {
      final now = DateTime.now();
      final title =
          '录音 ${now.month}月${now.day}日 ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      final rec = await Api.upload(File(path ?? _path!), title: title);
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
                    color: _recording ? accent : Colors.grey)),
            const SizedBox(height: 12),
            Text(
                _uploading
                    ? '上传中…'
                    : _recording
                        ? '录音中'
                        : '点击开始录音',
                style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 48),
            if (_uploading)
              const CircularProgressIndicator()
            else
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
            const SizedBox(height: 24),
            if (_recording)
              const Text('停止后自动上传并开始转写',
                  style: TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
