# 回声笔记 EchoNote

跨平台 AI 录音笔记应用：录音 / 导入 → 转写 → AI 总结 → 思维导图。

定位不是"录音转写工具"，而是**个人音频知识库**——转写与总结是入口，检索、问答与知识沉淀是留存壁垒。完整产品与技术设计见 [docs/回声笔记EchoNote产品与技术设计文档.docx](docs/)。

## 当前进度：Phase 0（Web 最小闭环）

上传音频 → ASR 转写（说话人区分）→ LLM 多维总结 → markmap 思维导图。

```
echonote/
├─ server/
│  ├─ index.js        # Express API + 静态页面
│  ├─ pipeline.js     # 异步处理管线（Phase 1 换队列+Worker）
│  ├─ store.js        # JSON 文件存储（Phase 1 换 PostgreSQL）
│  ├─ asr/            # 转写供应商抽象（dashscope / mock）
│  └─ llm/            # LLM 抽象 + Prompt 模板（dashscope / mock）
├─ web/
│  ├─ index.html      # 上传 + 录音列表
│  └─ detail.html     # 转写稿 / AI 总结 / 思维导图 三 Tab
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
2. `.env` 中设置：`DASHSCOPE_API_KEY=sk-xxx`、`LLM_PROVIDER=dashscope`、`ASR_PROVIDER=dashscope`。
3. **注意**：Paraformer 文件转写要求音频 URL 可公网访问。本地开发需内网穿透（ngrok / cpolar），将公网地址填入 `PUBLIC_BASE_URL`；部署到服务器后填服务器公网地址，生产环境应上传 OSS 后用 OSS URL。
4. LLM 无此限制，只配 `LLM_PROVIDER=dashscope` + 留 `ASR_PROVIDER=mock` 也可以（真总结 + 假转写稿）。

## API

| Method | Path | 说明 |
|---|---|---|
| POST | /api/recordings | 上传音频（form-data: audio, title?），返回记录并异步处理 |
| GET | /api/recordings | 录音列表（不含正文） |
| GET | /api/recordings/:id | 详情（transcript / summary / mindmap） |
| POST | /api/recordings/:id/reprocess | 重新处理 |

状态机：`uploaded → transcribing → summarizing → done | error`

## 路线图（详见设计文档第 7 章）

- [x] Phase 0：Web 最小闭环（本仓库当前状态）
- [ ] Phase 1：Flutter App（iOS/Android）+ 账号与同步 + PostgreSQL/队列
- [ ] Phase 2：安卓通话录音自动导入、iOS Share Extension、自定义模板、分享页
- [ ] Phase 3：会员体系 + 三端支付 + 国内外双站部署
- [ ] Phase 4：实时转写、跨录音 RAG 问答、会议 Bot、团队版
