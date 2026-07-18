import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:soundmap/main.dart';

void main() {
  testWidgets('renders the SoundMap recording library', (tester) async {
    SharedPreferences.setMockInitialValues({
      'server_url': 'http://127.0.0.1:9',
    });
    await tester.pumpWidget(const SoundMapApp());
    await tester.pump();

    expect(find.text('声图'), findsOneWidget);
    expect(find.text('搜索标题、转写全文、说话人或 AI 总结'), findsOneWidget);
    expect(find.text('录音'), findsOneWidget);
  });
}
