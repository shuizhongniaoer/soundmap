# 声图 SoundMap

跨平台 AI 录音笔记应用：录音 / 导入 → 转写 → AI 总结 → 灵感发芽 → 思维导图。声音变成图，一眼看懂一小时。

定位不是"录音转写工具"，而是**个人音频知识库**——转写与总结是入口，检索、问答与知识沉淀是留存壁垒。完整产品与技术设计见 [docs/](docs/)。

## 当前进度：Phase 1（App MVP）

上传音频 → ASR 转写（说话人区分）→ LLM 多维总结与灵感发芽 → markmap 思维导图 → 编辑修正 → 导出。

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
│  └─ detail.html     # 转写稿(可编辑) / AI 总结 / 灵感发芽 / 思维导图 + 导出
├─ app/               # Flutter App（安卓优先，见 app/README.md）
└─ docs/              # 产品与技术设计文档
```

## 快速开始

```bash
npm install
cp .env.example .env   # 默认 mock 模式，无需任何 Key 即可跑通全流程
npm start              # http://localhost:3000
```

mock 模式下上传任意音频文件，约 3 秒后可看到示例转写稿、总结、灵感发芽和思维导图（假数据，用于验证流程和开发前端）。

## 微信登录 / 注册

微信首次授权会自动创建声图账号，后续授权登录同一账号。客户端只获取一次性 `code`，`WECHAT_APP_SECRET`、微信 `access_token` 与声图会话均由服务端处理；业务会话是 30 天有效的随机令牌，数据库只保存其 SHA-256 摘要。录音、转写稿、热词和导出接口均按账号隔离，ASR 拉取音频改用 15 分钟有效的签名地址。

1. 在微信开放平台注册并完成开发者认证，创建并审核「移动应用」，申请微信登录能力。
2. Android 应用包名填写 `com.soundmap.soundmap`，并配置正式签名 MD5；上线前请同时替换当前调试签名配置。
3. `.env` 填写 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`MEDIA_SIGNING_SECRET`，正式环境设置 `AUTH_REQUIRED=1`、`AUTH_DEV_LOGIN=0`。
4. iOS 接入时还需填写 `WECHAT_UNIVERSAL_LINK` 并配置 Associated Domains；当前仓库暂未生成 iOS 工程。

本地联调可保持 `AUTH_REQUIRED=1`、`AUTH_DEV_LOGIN=1`，登录页会显示“本地测试登录”。该入口在正式环境必须关闭。国内正式上架还需补充短信验证码手机号绑定/实名流程与隐私政策；当前版本不提供不安全的“无验证码手机号注册”。

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

服务起在 `127.0.0.1:8100`。上传录音时转写引擎选"本地"，或 `.env` 设 `ASR_PROVIDER=local` 作为默认。

本地服务支持三个识别引擎（`LOCAL_ASR_ENGINE` 切换，重启生效）：

| 引擎 | 启动方式 | 状态（电话录音实测，2026-07） |
|---|---|---|
| **firered-onnx** | `./local-asr/setup-firered-onnx.sh` 后 `LOCAL_ASR_ENGINE=firered-onnx ./local-asr/start.sh` | FireRed 一代 int8 量化 + sherpa-onnx，CPU 预期提速 3~6 倍，质量同 firered（待测） |
| **firered2** | `./local-asr/setup-firered2.sh` 后 `LOCAL_ASR_ENGINE=firered2 ./local-asr/start.sh` | 二代全家桶（自带VAD/标点/句级时间戳），准确率再高一档；CPU 仍慢，NVIDIA 上 `FIRERED2_GPU=1` 快一个量级（待测） |
| firered | `LOCAL_ASR_ENGINE=firered ./local-asr/start.sh` | 质量可用但 PyTorch CPU 太慢（3分钟音频转197秒），被 onnx 版取代 |
| funasr（默认） | `./local-asr/start.sh` | 有分人和热词但准确率不行（Paraformer 过时） |
| qwen3 | 已淘汰 | 实测内容与录音偏差过大 |

结论：云端主力=讯飞大模型；本地线看 firered-onnx（Mac 速度解）与 firered2（质量上限，配 NVIDIA 才起飞）。未来部署形态：云上轻量服务器做入口 + 本机/GPU 主机跑此服务当 worker。

## 主要功能

- 上传音频/视频文件，异步转写（说话人区分）
- Android 通话录音目录导入：SAF 一次授权、WorkManager 后台定期发现、私有队列缓存、账号级来源去重；App 启动或回到前台时使用当前登录态自动上传
- AI 多维总结：摘要 / 关键要点 / 待办 / 原话摘录
- 灵感发芽：从真实原话选取少量“种子”，经种子提炼、历史/文学“遥远回声”、开花延展与 Aha 形成独立报告；允许 0 条，不强行凑数或伪造典故
- 思维导图：可交互 markmap 渲染
- 转写稿修正：说话人批量重命名、单句改派、文字纠错（点击即改）
- 按项重新生成：可分别重做 AI 总结、灵感发芽、思维导图、转写稿优化，或选择全部；只有“重新转写并全部生成”会再次调用 ASR
- 录音库全文搜索：标题、转写稿、说话人、AI 总结和灵感发芽
- 转写稿与音频联动：点句子跳转播放，播放时高亮当前句；发芽种子回听会在该句结束时自动暂停
- 导出：Word（总结+发芽报告+导图大纲+全文转写稿）、TXT、SRT、发芽报告 Markdown、思维导图 PNG / Markdown
- 微信一键登录（首次授权即注册）、30 天会话、账号级录音/热词隔离
- 私有音频播放与 ASR 临时签名下载地址

## API

| Method | Path | 说明 |
|---|---|---|
| POST | /api/recordings | 上传音频（form-data: audio, title?），异步处理 |
| GET | /api/recordings | 录音列表（`?q=` 全文搜索） |
| GET | /api/recordings/:id | 详情（transcript / summary / sprouts / mindmap） |
| POST | /api/recordings/:id/reprocess | 按项重新生成（`?part=summary|sprouts|mindmap|proofread|ai|all`；`full=1` 强制重新转写） |
| PATCH | /api/recordings/:id/speakers | 批量重命名说话人 {from, to} |
| PATCH | /api/recordings/:id/segments/:idx | 修改单句 {speaker?, text?} |
| GET | /api/recordings/:id/export/docx | 导出 Word |
| GET | /api/recordings/:id/export/txt | 导出纯文本转写稿 |
| GET | /api/recordings/:id/export/srt | 导出 SRT 字幕 |
| GET | /api/recordings/:id/export/sprouts.md | 导出发芽报告 Markdown |
| GET | /api/auth/config | 登录能力配置（不含 Secret） |
| GET | /api/auth/wechat/state | 生成一次性 OAuth state |
| POST | /api/auth/wechat | 微信 code 换取声图会话 |
| GET | /api/auth/me | 当前账号 |
| POST | /api/auth/logout | 注销当前会话 |

状态机：`uploaded → transcribing → summarizing → done | error`

## 路线图（详见设计文档第 7 章）

- [x] Phase 0：Web 最小闭环 + 浏览器录音 + 编辑修正 + 导出
- [ ] Phase 1（进行中）：Flutter App（安卓优先，录音/上传/列表/详情/微信账号隔离已完成）；待 PostgreSQL、队列与云端对象存储
- [ ] Phase 2（已启动）：Android SAF 目录授权、WorkManager 后台发现、前台自动上传与系统分享导入已完成；待 iOS Share Extension、自定义模板、分享页、声纹资料库
- [ ] Phase 3：会员体系 + 三端支付 + 国内外双站部署
- [ ] Phase 4：实时转写、跨录音 RAG 问答、会议 Bot、团队版
