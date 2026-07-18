import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
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

  Future<void> _maybeRenderMindmap() async {
    final md = _rec?['mindmap'] as String?;
    if (md == null || md == _mmLoaded) return;
    _mmLoaded = md;
    // 渲染库由我们自己的服务器托管（/web/vendor），不依赖公网 CDN
    final base = await Api.base();
    final html = '''
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#mm{margin:0;width:100%;height:100%}</style></head>
<body><svg id="mm"></svg>
<script src="$base/vendor/d3.min.js"></script>
<script src="$base/vendor/markmap-lib.js"></script>
<script src="$base/vendor/markmap-view.js"></script>
<script>
window.onload = function() {
  const md = ${jsonEncode(md)};
  const { root } = new window.markmap.Transformer().transform(md);
  const mm = window.markmap.Markmap.create('#mm', { autoFit: true }, root);
  // WebView 尺寸在加载后才稳定，延迟多次自适应，避免只显示局部
  setTimeout(() => mm.fit(), 300);
  setTimeout(() => mm.fit(), 1000);
  window.addEventListener('resize', () => mm.fit());
};
</script></body></html>''';
    _mmController ??= WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted);
    // baseUrl 用服务器地址，保证 http 明文加载策略一致
    await _mmController!.loadHtmlString(html, baseUrl: base);
  }

  @override
  Widget build(BuildContext context) {
    final rec = _rec;
    final title =
        rec?['title'] as String? ?? rec?['originalName'] as String? ?? '详情';
    final status = rec?['status'] as String? ?? '';
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(title, overflow: TextOverflow.ellipsis),
          actions: [
            PopupMenuButton<String>(
              icon: const Icon(Icons.ios_share),
              tooltip: '导出',
              onSelected: (v) async {
                final format = v == 'word' ? 'docx' : v;
                final url = await Api.exportUrl(widget.id, format);
                await launchUrl(url, mode: LaunchMode.externalApplication);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'word', child: Text('导出 Word')),
                PopupMenuItem(value: 'txt', child: Text('导出 TXT')),
                PopupMenuItem(value: 'srt', child: Text('导出 SRT 字幕')),
                PopupMenuItem(value: 'sprouts', child: Text('导出灵感发芽 Markdown')),
                PopupMenuItem(
                    value: 'view', child: Text('浏览器打开（可导出导图 PNG/Markdown）')),
              ],
            ),
            PopupMenuButton<String>(
              icon: const Icon(Icons.refresh),
              tooltip: '重新生成',
              onSelected: (v) async {
                _mmLoaded = null;
                await Api.reprocess(widget.id, full: v == 'full');
                _load();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'llm', child: Text('重新生成总结/发芽/导图（不重转写）')),
                PopupMenuItem(value: 'full', child: Text('重新转写+AI 内容（应用最新热词）')),
              ],
            ),
          ],
          bottom: const TabBar(isScrollable: true, tabs: [
            Tab(text: '转写稿'),
            Tab(text: 'AI 总结'),
            Tab(text: '灵感发芽'),
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
                    _sproutsTab(rec),
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
            Text(s['text'] as String? ?? '',
                style: const TextStyle(height: 1.5)),
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
        if (s['type'] != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Chip(
              label: Text(s['type'] as String,
                  style: const TextStyle(fontSize: 12)),
              visualDensity: VisualDensity.compact,
            ),
          ),
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

  Widget _sproutsTab(Map<String, dynamic> rec) {
    final data = rec['sprouts'] as Map<String, dynamic>?;
    if (data == null) {
      if (rec['status'] != 'done') return _processing('正在寻找值得继续想的种子…');
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(28),
          child: Text('这条旧录音还没有生成发芽，点击右上角重新生成即可补上。',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey)),
        ),
      );
    }
    final items = (data['items'] as List?) ?? [];
    if (items.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(28),
          child: Text('这段录音没有足够扎实的发芽点。\n宁缺毋滥，不为凑数硬掰。',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, height: 1.7)),
        ),
      );
    }
    String fmt(num value) =>
        '${(value ~/ 60).toString().padLeft(2, '0')}:${(value % 60).toInt().toString().padLeft(2, '0')}';
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      itemCount: items.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('从原话种子继续生长的 AI 延展，不等同于事实摘要，请结合上下文判断。',
                style:
                    TextStyle(fontSize: 12, color: Colors.grey, height: 1.5)),
          );
        }
        final item = items[index - 1] as Map<String, dynamic>;
        return Card(
          color: const Color(0xFFFFFDF7),
          margin: const EdgeInsets.only(bottom: 14),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(index.toString().padLeft(2, '0'),
                      style: const TextStyle(
                          fontSize: 11, color: Color(0xFF9A8354))),
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEDF5E9),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(item['type']?.toString() ?? '联想',
                        style: const TextStyle(
                            fontSize: 11, color: Color(0xFF487C3D))),
                  ),
                ]),
                const SizedBox(height: 9),
                Text(item['title']?.toString() ?? '',
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF4F8F1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            '🌱 种子 · ${fmt(item['start'] as num? ?? 0)} ${item['speaker'] ?? ''}',
                            style: const TextStyle(
                                fontSize: 12, color: Color(0xFF487C3D))),
                        const SizedBox(height: 6),
                        Text('“${item['source'] ?? ''}”',
                            style: const TextStyle(height: 1.55)),
                      ]),
                ),
                const SizedBox(height: 13),
                Text(item['expansion']?.toString() ?? '',
                    style: const TextStyle(height: 1.7)),
                const SizedBox(height: 13),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF7DC),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text('✨ Aha　${item['aha'] ?? ''}',
                      style: const TextStyle(
                          color: Color(0xFF7A5B17), height: 1.55)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
