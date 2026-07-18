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
                PopupMenuItem(value: 'sprouts', child: Text('导出发芽报告 Markdown')),
                PopupMenuItem(
                    value: 'view', child: Text('浏览器打开（可导出导图 PNG/Markdown）')),
              ],
            ),
            PopupMenuButton<String>(
              icon: const Icon(Icons.refresh),
              tooltip: '重新生成',
              onSelected: (v) async {
                final full = v == 'full';
                if (full) {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('重新转写并全部生成？'),
                      content: const Text('这会覆盖人工修正，并产生新的语音识别和大模型调用费用。'),
                      actions: [
                        TextButton(
                            onPressed: () => Navigator.pop(context, false),
                            child: const Text('取消')),
                        FilledButton(
                            onPressed: () => Navigator.pop(context, true),
                            child: const Text('继续')),
                      ],
                    ),
                  );
                  if (confirmed != true) return;
                }
                if (['mindmap', 'all', 'full'].contains(v)) _mmLoaded = null;
                await Api.reprocess(widget.id,
                    part: full ? 'all' : v, full: full);
                await _load();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'summary', child: Text('重新生成 AI 总结')),
                PopupMenuItem(value: 'sprouts', child: Text('重新生成灵感发芽')),
                PopupMenuItem(value: 'mindmap', child: Text('重新生成思维导图')),
                PopupMenuItem(value: 'proofread', child: Text('优化转写稿')),
                PopupMenuDivider(),
                PopupMenuItem(value: 'all', child: Text('全部重新生成（不重转写）')),
                PopupMenuItem(value: 'full', child: Text('重新转写并全部生成')),
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
      if (rec['status'] != 'done') {
        return Container(
          color: const Color(0xFFF4EFE3),
          child: const Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.spa_outlined, size: 52, color: Color(0xFF637B51)),
              SizedBox(height: 18),
              Text('有些念头，需要一点时间才肯显出形状',
                  style:
                      TextStyle(fontFamily: 'serif', color: Color(0xFF544E42))),
              SizedBox(height: 14),
              Text('筛选种子　·　寻找回声　·　等待开花',
                  style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.2,
                      color: Color(0xFF8C826F))),
            ]),
          ),
        );
      }
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
    final generatedAt = DateTime.tryParse(
        data['generatedAt']?.toString() ?? rec['updatedAt']?.toString() ?? '');
    final date = generatedAt == null
        ? ''
        : '${generatedAt.year} · ${generatedAt.month.toString().padLeft(2, '0')} · ${generatedAt.day.toString().padLeft(2, '0')}';
    return ListView.builder(
      padding: EdgeInsets.zero,
      physics: const BouncingScrollPhysics(),
      itemCount: items.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Container(
            color: const Color(0xFFF4EFE3),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: Color(0x385F523C))),
                ),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('SOUNDMAP · SPROUT REPORT',
                          style: TextStyle(
                              fontSize: 9,
                              letterSpacing: 2,
                              color: Color(0xFF7E745F),
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 13),
                      Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            const Expanded(
                              child: Text('发芽报告',
                                  style: TextStyle(
                                      fontFamily: 'serif',
                                      fontSize: 31,
                                      letterSpacing: 4,
                                      fontWeight: FontWeight.w800,
                                      color: Color(0xFF2F2B23))),
                            ),
                            Text('$date\n${items.length} 枚种子',
                                textAlign: TextAlign.right,
                                style: const TextStyle(
                                    fontSize: 10,
                                    height: 1.6,
                                    color: Color(0xFF756B58))),
                          ]),
                      const SizedBox(height: 15),
                      const Text('从一段声音里拾取尚未说完的念头，让它越过日常，\n与更辽阔的人类经验彼此照亮。',
                          style: TextStyle(
                              fontFamily: 'serif',
                              fontSize: 12,
                              height: 1.8,
                              color: Color(0xFF736B5D))),
                    ]),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(24, 14, 24, 8),
                child: Text('AI 启发式延展不等同于事实摘要；典故与判断值得继续核验。',
                    style: TextStyle(
                        fontSize: 10, height: 1.5, color: Color(0xFF827866))),
              ),
            ]),
          );
        }
        final item = items[index - 1] as Map<String, dynamic>;
        return Container(
          color: const Color(0xFFF4EFE3),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 30),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(index.toString().padLeft(2, '0'),
                      style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 19,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF9D8655))),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item['title']?.toString() ?? '',
                              style: const TextStyle(
                                  fontFamily: 'serif',
                                  fontSize: 21,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: .6,
                                  color: Color(0xFF302B23))),
                          const SizedBox(height: 4),
                          Text('${item['type'] ?? '联想'} · GERMINATION',
                              style: const TextStyle(
                                  fontSize: 9,
                                  letterSpacing: 1.3,
                                  color: Color(0xFF587348))),
                        ]),
                  ),
                ]),
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 13),
                  decoration: const BoxDecoration(
                    color: Color(0xBFEFF4E6),
                    border: Border(
                        left: BorderSide(color: Color(0xFF71885F), width: 2)),
                  ),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            '🌱 种子 · ${fmt(item['start'] as num? ?? 0)} ${item['speaker'] ?? ''}',
                            style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                                color: Color(0xFF4C6840))),
                        const SizedBox(height: 7),
                        Text('“${item['source'] ?? ''}”',
                            style: const TextStyle(
                                fontFamily: 'serif',
                                height: 1.7,
                                color: Color(0xFF45473D))),
                      ]),
                ),
                if (item['seedSummary'] != null) ...[
                  const SizedBox(height: 15),
                  Text(item['seedSummary'].toString(),
                      style: const TextStyle(
                          fontFamily: 'serif',
                          height: 1.85,
                          color: Color(0xFF4A4439))),
                ],
                if (item['echo'] != null) ...[
                  const SizedBox(height: 24),
                  _sproutLabel('遥远的回声'),
                  const SizedBox(height: 9),
                  Text(item['reference']?.toString() ?? '',
                      style: const TextStyle(
                          fontFamily: 'serif',
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF44392B))),
                  const SizedBox(height: 7),
                  Text(item['echo'].toString(),
                      textAlign: TextAlign.justify,
                      style: const TextStyle(
                          fontFamily: 'serif',
                          height: 1.9,
                          color: Color(0xFF39342C))),
                ],
                const SizedBox(height: 24),
                _sproutLabel('开花'),
                const SizedBox(height: 9),
                Text(item['expansion']?.toString() ?? '',
                    textAlign: TextAlign.justify,
                    style: const TextStyle(
                        fontFamily: 'serif',
                        height: 1.9,
                        color: Color(0xFF39342C))),
                const SizedBox(height: 24),
                Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: const BoxDecoration(
                    color: Color(0x9FFFF2C8),
                    border: Border(
                      top: BorderSide(color: Color(0x47A68030)),
                      bottom: BorderSide(color: Color(0x47A68030)),
                    ),
                  ),
                  child: Text('✦  Aha　${item['aha'] ?? ''}',
                      style: const TextStyle(
                          fontFamily: 'serif',
                          color: Color(0xFF72591F),
                          height: 1.7)),
                ),
                const SizedBox(height: 30),
                const Divider(color: Color(0x385F523C), height: 1),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _sproutLabel(String text) => Row(children: [
        Text(text,
            style: const TextStyle(
                fontSize: 10,
                letterSpacing: 1.2,
                fontWeight: FontWeight.bold,
                color: Color(0xFF8A7040))),
        const SizedBox(width: 10),
        const Expanded(child: Divider(color: Color(0x33765C2F))),
      ]);
}
