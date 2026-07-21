import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:soundmap/call_recording_importer.dart';
import 'package:soundmap/pages/import_page.dart';

void main() {
  test('keeps source fingerprints unique and bounded', () {
    expect(mergeSeenIds(['a', 'b'], 'a'), ['b', 'a']);
    expect(mergeSeenIds(['a', 'b', 'c'], 'd', maxItems: 3), ['b', 'c', 'd']);
  });

  test('parses a native SAF scan result', () {
    final item = CallRecordingCandidate.fromMap({
      'sourceId': 'document:12:100:200',
      'path': '/cache/call.mp3',
      'name': '张先生_20260719.mp3',
      'size': 100,
      'modifiedAt': 200,
    });
    expect(item.name, '张先生_20260719.mp3');
    expect(item.size, 100);
    expect(item.modifiedAt, 200);
  });

  test('infers a contact folder from common call recording names', () {
    final named = inferCallRecordingArchive('通话录音_张三_20260719_1530.m4a');
    expect(named.contactName, '张三');
    expect(named.folder, '通话录音/张三');
    expect(named.tags, ['通话录音', '张三']);
    expect(named.recognized, isTrue);

    final phone = inferCallRecordingArchive('call_13800138000_20260719.mp3');
    expect(phone.contactName, '未识别联系人');
    expect(phone.folder, '通话录音/未识别联系人');
    expect(phone.tags, ['通话录音']);
    expect(phone.recognized, isFalse);
  });

  test('parses Android background scan status', () {
    final status = CallRecordingBackgroundStatus.fromMap({
      'enabled': true,
      'scheduled': true,
      'pendingCount': 3,
      'intervalMinutes': 15,
      'lastScanAt': 1784421000000,
      'lastDiscovered': 2,
      'lastError': null,
    });
    expect(status.scheduled, isTrue);
    expect(status.pendingCount, 3);
    expect(status.intervalMinutes, 15);
    expect(status.lastDiscovered, 2);
  });

  testWidgets('import page keeps file and system-share fallbacks visible',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ImportPage(userId: 'local')),
    );
    await tester.pumpAndSettle();
    expect(find.text('导入录音'), findsOneWidget);
    expect(find.text('从文件导入'), findsOneWidget);
    expect(find.text('从其他 App 分享'), findsOneWidget);
  });
}
