import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../call_recording_importer.dart';

class ImportPage extends StatefulWidget {
  const ImportPage({super.key, required this.userId});

  final String userId;

  @override
  State<ImportPage> createState() => _ImportPageState();
}

class _ImportPageState extends State<ImportPage> {
  late final CallRecordingImporter _importer;
  CallRecordingDirectory? _directory;
  bool _autoImport = false;
  bool _busy = false;
  String? _status;

  @override
  void initState() {
    super.initState();
    _importer = CallRecordingImporter(userId: widget.userId);
    _load();
  }

  Future<void> _load() async {
    final directory = await _importer.getDirectory();
    final autoImport = await _importer.autoImportEnabled();
    if (mounted) {
      setState(() {
        _directory = directory;
        _autoImport = autoImport && directory != null;
      });
    }
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const [
        'mp3',
        'm4a',
        'wav',
        'aac',
        'ogg',
        'opus',
        'flac',
        'mp4',
        'webm',
        'amr',
        '3gp',
      ],
    );
    final path = result?.files.single.path;
    if (path == null || !mounted) return;
    setState(() {
      _busy = true;
      _status = '正在上传 ${result!.files.single.name}…';
    });
    try {
      final rec =
          await Api.upload(File(path), originalName: result!.files.single.name);
      if (mounted) Navigator.pop(context, rec['id'] as String);
    } catch (error) {
      if (mounted) setState(() => _status = '上传失败：$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _chooseDirectory() async {
    try {
      final directory = await _importer.pickDirectory();
      if (directory == null || !mounted) return;
      await _importer.setAutoImportEnabled(true);
      setState(() {
        _directory = directory;
        _autoImport = true;
        _status = '目录已授权，准备扫描新录音。';
      });
      await _scan();
    } catch (error) {
      if (mounted) setState(() => _status = '目录授权失败：$error');
    }
  }

  Future<void> _toggleAutoImport(bool value) async {
    if (value && _directory == null) {
      await _chooseDirectory();
      return;
    }
    await _importer.setAutoImportEnabled(value);
    if (mounted) setState(() => _autoImport = value);
  }

  Future<void> _scan() async {
    if (_busy || _directory == null) return;
    setState(() {
      _busy = true;
      _status = '正在扫描目录并导入新录音…';
    });
    try {
      final report = await _importer.scanAndUpload();
      if (!mounted) return;
      setState(() {
        _status = report.discovered == 0
            ? '没有发现尚未导入的新录音。'
            : '发现 ${report.discovered} 条，成功导入 ${report.imported} 条'
                '${report.failed > 0 ? '，${report.failed} 条将在下次重试' : ''}。';
      });
    } catch (error) {
      if (mounted) setState(() => _status = '扫描失败：$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearDirectory() async {
    await _importer.clearDirectory();
    await _importer.setAutoImportEnabled(false);
    if (mounted) {
      setState(() {
        _directory = null;
        _autoImport = false;
        _status = '已取消目录授权。';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('导入录音')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _section(
            icon: Icons.upload_file,
            title: '从文件导入',
            subtitle: '支持常见音频与视频文件，上传后自动转写和整理。',
            child: FilledButton.icon(
              onPressed: _busy ? null : _pickFile,
              icon: const Icon(Icons.folder_open),
              label: const Text('选择文件'),
            ),
          ),
          const SizedBox(height: 14),
          if (_importer.isSupported)
            _section(
              icon: Icons.phone_in_talk_outlined,
              title: '通话录音自动导入',
              subtitle: '只读取你授权的目录，不需要整盘存储权限。打开或返回声图时，会自动扫描尚未导入的录音。',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color:
                          Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(children: [
                      const Icon(Icons.folder_outlined),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_directory?.label ?? '尚未选择通话录音目录',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            const SizedBox(height: 3),
                            Text(
                              _directory == null
                                  ? '小米常见：MIUI/sound_recorder/call_rec\n华为/荣耀常见：Sounds/CallRecord 或 Record'
                                  : 'Android 已保存此目录的持久读取权限',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ]),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('自动扫描新录音'),
                    subtitle: const Text('在 App 启动和回到前台时运行'),
                    value: _autoImport,
                    onChanged: _busy ? null : _toggleAutoImport,
                  ),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _chooseDirectory,
                      icon: const Icon(Icons.create_new_folder_outlined),
                      label: Text(_directory == null ? '选择目录' : '更换目录'),
                    ),
                    FilledButton.tonalIcon(
                      onPressed: _busy || _directory == null ? null : _scan,
                      icon: const Icon(Icons.sync),
                      label: const Text('立即扫描'),
                    ),
                    if (_directory != null)
                      TextButton(
                        onPressed: _busy ? null : _clearDirectory,
                        child: const Text('取消授权'),
                      ),
                  ]),
                ],
              ),
            ),
          if (_importer.isSupported) const SizedBox(height: 14),
          _section(
            icon: Icons.ios_share,
            title: '从其他 App 分享',
            subtitle: Platform.isIOS
                ? '在备忘录中选择系统通话录音，点“分享”后选择声图。'
                : '在微信、文件管理或录音机中选择音频，点“分享”后选择声图。',
            child: const Text('声图收到分享后会自动上传；网络失败的文件会进入待重试队列。'),
          ),
          if (_status != null) ...[
            const SizedBox(height: 16),
            Card(
              color: Theme.of(context).colorScheme.secondaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(children: [
                  if (_busy) ...[
                    const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                    const SizedBox(width: 12),
                  ],
                  Expanded(child: Text(_status!)),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 24),
          Text(
            '请确保你有权录制和处理相关通话。不同地区对通话录音的告知与同意要求不同，声图不会绕过系统限制进行通话截流。',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Theme.of(context).colorScheme.outline),
          ),
        ],
      ),
    );
  }

  Widget _section({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget child,
  }) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 10),
                Expanded(
                    child: Text(title,
                        style: Theme.of(context).textTheme.titleMedium)),
              ]),
              const SizedBox(height: 8),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 14),
              child,
            ],
          ),
        ),
      );
}
