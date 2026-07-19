import 'dart:io';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

class CallRecordingDirectory {
  const CallRecordingDirectory({required this.uri, required this.label});

  final String uri;
  final String label;

  factory CallRecordingDirectory.fromMap(Map<Object?, Object?> map) =>
      CallRecordingDirectory(
        uri: map['uri']?.toString() ?? '',
        label: map['label']?.toString() ?? '已授权目录',
      );
}

class CallRecordingCandidate {
  const CallRecordingCandidate({
    required this.sourceId,
    required this.path,
    required this.name,
    required this.size,
    required this.modifiedAt,
  });

  final String sourceId;
  final String path;
  final String name;
  final int size;
  final int modifiedAt;

  factory CallRecordingCandidate.fromMap(Map<Object?, Object?> map) =>
      CallRecordingCandidate(
        sourceId: map['sourceId']?.toString() ?? '',
        path: map['path']?.toString() ?? '',
        name: map['name']?.toString() ?? '通话录音.m4a',
        size: (map['size'] as num?)?.toInt() ?? 0,
        modifiedAt: (map['modifiedAt'] as num?)?.toInt() ?? 0,
      );
}

class CallRecordingBackgroundStatus {
  const CallRecordingBackgroundStatus({
    required this.enabled,
    required this.scheduled,
    required this.pendingCount,
    required this.intervalMinutes,
    required this.lastScanAt,
    required this.lastDiscovered,
    this.lastError,
  });

  final bool enabled;
  final bool scheduled;
  final int pendingCount;
  final int intervalMinutes;
  final int lastScanAt;
  final int lastDiscovered;
  final String? lastError;

  factory CallRecordingBackgroundStatus.fromMap(Map<Object?, Object?> map) =>
      CallRecordingBackgroundStatus(
        enabled: map['enabled'] == true,
        scheduled: map['scheduled'] == true,
        pendingCount: (map['pendingCount'] as num?)?.toInt() ?? 0,
        intervalMinutes: (map['intervalMinutes'] as num?)?.toInt() ?? 15,
        lastScanAt: (map['lastScanAt'] as num?)?.toInt() ?? 0,
        lastDiscovered: (map['lastDiscovered'] as num?)?.toInt() ?? 0,
        lastError: map['lastError']?.toString(),
      );
}

class CallRecordingImportReport {
  const CallRecordingImportReport({
    required this.discovered,
    required this.imported,
    required this.failed,
  });

  final int discovered;
  final int imported;
  final int failed;

  bool get hasChanges => imported > 0;
}

class CallRecordingImporter {
  CallRecordingImporter({required this.userId});

  static const _channel = MethodChannel('soundmap/call_recordings');
  static const _autoKey = 'call_recording_auto_import';
  static Future<CallRecordingImportReport>? _activeScan;
  final String userId;

  bool get isSupported => Platform.isAndroid;

  Future<CallRecordingDirectory?> getDirectory() async {
    if (!isSupported) return null;
    final value =
        await _channel.invokeMapMethod<Object?, Object?>('getDirectory');
    return value == null ? null : CallRecordingDirectory.fromMap(value);
  }

  Future<CallRecordingDirectory?> pickDirectory() async {
    if (!isSupported) return null;
    final value =
        await _channel.invokeMapMethod<Object?, Object?>('pickDirectory');
    return value == null ? null : CallRecordingDirectory.fromMap(value);
  }

  Future<void> clearDirectory() async {
    if (!isSupported) return;
    await _channel.invokeMethod<void>('clearDirectory');
  }

  Future<bool> autoImportEnabled() async {
    if (!isSupported) return false;
    final enabled =
        (await SharedPreferences.getInstance()).getBool(_autoKey) ?? false;
    await _configureBackground(enabled);
    return enabled;
  }

  Future<void> setAutoImportEnabled(bool value) async {
    await (await SharedPreferences.getInstance()).setBool(_autoKey, value);
    if (isSupported) await _configureBackground(value);
  }

  Future<CallRecordingBackgroundStatus?> backgroundStatus() async {
    if (!isSupported) return null;
    final value = await _channel.invokeMapMethod<Object?, Object?>(
      'backgroundStatus',
      {'contextId': await _contextId()},
    );
    return value == null ? null : CallRecordingBackgroundStatus.fromMap(value);
  }

  Future<List<CallRecordingCandidate>> scan({int limit = 50}) async {
    if (!isSupported) return const [];
    final seen = await _seenIds();
    final rows = await _channel.invokeListMethod<Object?>('scan', {
          'seen': seen,
          'limit': limit,
          'contextId': await _contextId(),
        }) ??
        const [];
    return rows
        .whereType<Map<Object?, Object?>>()
        .map(CallRecordingCandidate.fromMap)
        .where((item) => item.sourceId.isNotEmpty && item.path.isNotEmpty)
        .toList();
  }

  Future<CallRecordingImportReport> scanAndUpload({int limit = 50}) async {
    final active = _activeScan;
    if (active != null) return active;
    final task = _scanAndUpload(limit: limit);
    _activeScan = task;
    try {
      return await task;
    } finally {
      if (identical(_activeScan, task)) _activeScan = null;
    }
  }

  Future<CallRecordingImportReport> _scanAndUpload({int limit = 50}) async {
    final candidates = await scan(limit: limit);
    var imported = 0;
    var failed = 0;
    for (final item in candidates) {
      final file = File(item.path);
      if (!file.existsSync()) {
        failed++;
        continue;
      }
      try {
        await Api.upload(file, originalName: item.name);
        await _markSeen(item.sourceId);
        await _acknowledgeBestEffort(item.sourceId);
        imported++;
        try {
          await file.delete();
        } catch (_) {
          // Cache cleanup is best effort; the source fingerprint still prevents duplicates.
        }
      } catch (_) {
        failed++;
      }
    }
    return CallRecordingImportReport(
      discovered: candidates.length,
      imported: imported,
      failed: failed,
    );
  }

  Future<String> _seenKey() async =>
      'call_recording_seen:$userId:${await Api.base()}';

  Future<String> _contextId() async => '$userId:${await Api.base()}';

  Future<List<String>> _seenIds() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(await _seenKey()) ?? const [];
  }

  Future<void> _markSeen(String sourceId) async {
    final prefs = await SharedPreferences.getInstance();
    final key = await _seenKey();
    final values = mergeSeenIds(prefs.getStringList(key) ?? const [], sourceId);
    await prefs.setStringList(key, values);
  }

  Future<CallRecordingBackgroundStatus?> _configureBackground(
      bool enabled) async {
    final value = await _channel.invokeMapMethod<Object?, Object?>(
      'configureBackground',
      {
        'enabled': enabled,
        'contextId': await _contextId(),
        'seen': await _seenIds(),
      },
    );
    return value == null ? null : CallRecordingBackgroundStatus.fromMap(value);
  }

  Future<void> _acknowledgeBestEffort(String sourceId) async {
    try {
      await _channel.invokeMethod<void>('acknowledge', {
        'contextId': await _contextId(),
        'sourceId': sourceId,
      });
    } catch (_) {
      // Dart's seen list remains authoritative and is synchronized on the next scan.
    }
  }
}

List<String> mergeSeenIds(List<String> existing, String sourceId,
    {int maxItems = 3000}) {
  final values = <String>[...existing.where((id) => id != sourceId), sourceId];
  return values.length <= maxItems
      ? values
      : values.sublist(values.length - maxItems);
}
