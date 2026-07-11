import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../api.dart';

class DetailPage extends StatefulWidget {
  final String id;
  const DetailPage({super.key, required this.id});
  @override
  State<DetailPage> createState() => _DetailPageState();
}

class _DetailPageState extends State<DetailPage> {
  Map<String, dynamic>? _rec;
  Timer? _timer;
  WebViewController? _mmController;
  String? _mmLoaded; // 已渲染的导图内容，变化时重新加载

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      final st = _rec?['status'];
      if (st == 'done' || st == 'error') return;
      _load();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final rec = await Api.get(widget.id);
      if (mounted) setState(() => _rec = rec);
      _maybeRenderMindmap();
    } catch (_) {}
  }

  void _maybeRenderMindmap() {
    final md = _rec?['mindmap'] as String?;
    if (md == null || md == _mmLoaded) return;
    _mmLoaded = md;
    final html = '''
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#mm{margin:0;width:100%;height:100%}</style></head>
<body><svg id="mm"></svg>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://cdn.jsdelivr.net/npm/markmap-lib@0.15.4/dist/browser/index.js"></script>
<script src="https://cdn.jsdelivr.net/npm/markmap-view@0.15.4/dist/browser/index.js"></script>
<script>
const md = ${jsonEncode(md)};
const { root } = new window.markmap.Transformer().transform(md);
window.markmap.Markmap.create('#mm', { autoFit: true }, root);
</script></body></html>''';
    _mmController ??= WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted);
    _mmController!.loadHtmlString(html);
  }

  @override
  Widget build(BuildContext context) {
    final rec = _rec;
    final title =
        rec?['title'] as String? ?? rec?['originalName'] as String? ?? '详情';
    final status = rec?['status'] as String? ?? '';
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(title, overflow: TextOverflow.ellipsis),
          actions: [
            IconButton(
              tooltip: '重新生成',
              icon: const Icon(Icons.refresh),
              onPressed: () async {
                await Api.reprocess(widget.id);
                _load();
              },
            ),
          ],
          bottom: const TabBar(tabs: [
            Tab(text: '转写稿'),
            Tab(text: 'AI 总结'),
            Tab(text: '思维导图'),
          ]),
        ),
        body: rec == null
            ? const Center(child: CircularProgressIndicator())
            : status == 'error'
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text('处理失败：${rec['error'] ?? ''}',
                          style: const TextStyle(color: Colors.red)),
                    ),
                  )
                : TabBarView(children: [
                    _transcriptTab(rec),
                    _summaryTab(rec),
                    _mindmapTab(rec),
                  ]),
      ),
    );
  }

  Widget _processing(String label) => Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(label, style: const TextStyle(color: Colors.grey)),
        ]),
      );

  Widget _transcriptTab(Map<String, dynamic> rec) {
    final segs = (rec['transcript']?['segments'] as List?) ?? [];
    if (segs.isEmpty) return _processing('转写中…');
    String fmt(num s) =>
        '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toInt().toString().padLeft(2, '0')}';
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: segs.length,
      separatorBuilder: (_, __) => const Divider(height: 16),
      itemBuilder: (ctx, i) {
        final s = segs[i] as Map<String, dynamic>;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Text(s['speaker'] as String? ?? '',
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Theme.of(ctx).colorScheme.primary)),
              const SizedBox(width: 8),
              Text(fmt(s['start'] as num? ?? 0),
                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ]),
            const SizedBox(height: 4),
            Text(s['text'] as String? ?? '', style: const TextStyle(height: 1.5)),
          ],
        );
      },
    );
  }

  Widget _summaryTab(Map<String, dynamic> rec) {
    final s = rec['summary'] as Map<String, dynamic>?;
    if (s == null) return _processing('AI 总结中…');
    Widget h(String t) => Padding(
          padding: const EdgeInsets.only(top: 18, bottom: 6),
          child: Text(t,
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: Theme.of(context).colorScheme.primary)),
        );
    Widget li(String t) => Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text('• $t', style: const TextStyle(height: 1.5)),
        );
    final todos = (s['todos'] as List?) ?? [];
    final quotes = (s['quotes'] as List?) ?? [];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        h('摘要'),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: const Color(0xFFF2F6FA),
              borderRadius: BorderRadius.circular(8)),
          child: Text(s['abstract'] as String? ?? '',
              style: const TextStyle(height: 1.6)),
        ),
        h('关键要点'),
        ...((s['key_points'] as List?) ?? []).map((k) => li(k as String)),
        if (todos.isNotEmpty) h('待办事项'),
        ...todos.map((t) {
          final m = t as Map<String, dynamic>;
          final owner = m['owner'];
          return li('${m['task']}${owner != null ? '（$owner）' : ''}');
        }),
        if (quotes.isNotEmpty) h('原话摘录'),
        ...quotes.map((q) => li('"$q"')),
      ],
    );
  }

  Widget _mindmapTab(Map<String, dynamic> rec) {
    if (rec['mindmap'] == null) return _processing('思维导图生成中…');
    if (_mmController == null) _maybeRenderMindmap();
    return WebViewWidget(controller: _mmController!);
  }
}
