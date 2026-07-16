# 声图 SoundMap

跨平台 AI 录音笔记应用：录音 / 导入 → 转写 → AI 总结 → 思维导图。声音变成图，一眼看懂一小时。

定位不是"录音转写工具"，而是**个人音频知识库**——转写与总结是入口，检索、问答与知识沉淀是留存壁垒。完整产品与技术设计见 [docs/](docs/)。

## 当前进度：Phase 0（Web 最小闭环）

上传音频 → ASR 转写（说话人区分）→ LLM 多维总结 → markmap 思维导图 → 编辑修正 → 导出。

```
soundmap/
├─ server/
│  ├─ index.js        # Express API + 静态页面
│  ├─ pipeline.js     # 异步处理管线（Phase 1 换队列+Worker）
│  ├─ store.js        # JSON 文件存储（Phase 1 换 PostgreSQL）
│  ├─ export.js       # Word 导出
│  ├─ asr/            # 转写供应商抽象（dashscope / mock）
│  └─ llm/            # LLM 抽象 + Prompt 模板（dashscope / mock）
├─ web/
│  ├─ index.html      # 浏览器录音 + 上传 + 录音列表
│  └─ detail.html     # 转写稿(可编辑) / AI 总结 / 思维导图 三 Tab + 导出
├─ app/               # Flutter App（安卓优先，见 app/README.md）
└─ docs/              # 产品与技术设计文档
```

## 快速开始

```bash
npm install
cp .env.example .env   # 默认 mock 模式，无需任何 Key 即可跑通全流程
npm start              # http://localhost:3000
```

mock 模式下上传任意音频文件，约 3 秒后可看到示例转写稿、总结和思维导图（假数据，用于验证流程和开发前端）。

## 接入真实 API（阿里百炼）

1. 在 [百炼控制台](https://bailian.console.aliyun.com/) 开通并创建 API Key（转写与 LLM 共用）。
2. `.env` 中设置：`DASHSCOPE_API_KEY=sk-xxx`、`LLM_PROVIDER=dashscope`、`ASR_PROVIDER=dashscope`、`ASR_MODEL=fun-asr`。
3. 业务空间专属 Key（`sk-ws-` 开头）需配套 `DASHSCOPE_BASE_URL`（专属 Host 只支持 LLM 兼容接口；转写走官方域名需用默认业务空间的普通 Key）。
4. **转写需要公网可访问的音频 URL**：本地开发用 cpolar/ngrok 内网穿透，把公网地址填入 `PUBLIC_BASE_URL`；部署后填服务器地址，生产环境应上传 OSS 后用 OSS URL。

## 本地转写引擎（免费，FunASR）

`local-asr/` 是跑在本机的 FunASR 转写服务（Paraformer-large + VAD + 标点 + CAM++ 说话人分离 + 热词），零 API 成本，录音不出本机：

```bash
./local-asr/start.sh   # 首次自动建 venv、装依赖、下载模型（约 1~2GB），之后离线运行
```

服务起在 `127.0.0.1:8100`。上传录音时转写引擎选"本地"，或 `.env` 设 `ASR_PROVIDER=local` 作为默认。热词表自动生效（SeACo 上下文偏置）。质量约等于云端"标准版"，低于讯飞/百炼大模型档；定位是免费档/隐私档。未来部署形态：云上轻量服务器做入口 + 本机跑此服务当 worker。

## 主要功能

- 上传音频/视频文件，异步转写（说话人区分）
- AI 多维总结：摘要 / 关键要点 / 待办 / 原话摘录
- 思维导图：可交互 markmap 渲染
- 转写稿修正：说话人批量重命名、单句改派、文字纠错（点击即改）
- 重新生成只重跑 LLM，不重复付费转写
- 导出：Word（总结+导图大纲+全文转写稿）、思维导图 PNG / Markdown

## API

| Method | Path | 说明 |
|---|---|---|
| POST | /api/recordings | 上传音频（form-data: audio, title?），异步处理 |
| GET | /api/recordings | 录音列表 |
| GET | /api/recordings/:id | 详情（transcript / summary / mindmap） |
| POST | /api/recordings/:id/reprocess | 重新生成（?full=1 强制重新转写） |
| PATCH | /api/recordings/:id/speakers | 批量重命名说话人 {from, to} |
| PATCH | /api/recordings/:id/segments/:idx | 修改单句 {speaker?, text?} |
| GET | /api/recordings/:id/export/docx | 导出 Word |

状态机：`uploaded → transcribing → summarizing → done | error`

## 路线图（详见设计文档第 7 章）

- [x] Phase 0：Web 最小闭环 + 浏览器录音 + 编辑修正 + 导出
- [ ] Phase 1：Flutter App（安卓优先，app/ 已有 MVP：录音/上传/列表/详情）+ 账号与同步 + PostgreSQL/队列
- [ ] Phase 2：安卓通话录音自动导入、iOS Share Extension、自定义模板、分享页
- [ ] Phase 3：会员体系 + 三端支付 + 国内外双站部署
- [ ] Phase 4：实时转写、跨录音 RAG 问答、会议 Bot、团队版
