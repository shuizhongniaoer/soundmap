# 声图 SoundMap — Flutter App（安卓优先）

App 内录音 → 上传到服务端 → 转写/总结/灵感发芽/思维导图（与 Web 端共用同一后端）。

## 首次运行（三步）

前提：装好 [Flutter SDK](https://docs.flutter.dev/get-started/install/macos) 和 Android Studio（含模拟器或连真机）。

```bash
cd app
flutter create . --org com.soundmap --platforms android,ios   # 生成 android/ios 平台工程（只需一次）
flutter pub get
```

然后给安卓加录音权限：编辑 `android/app/src/main/AndroidManifest.xml`，在 `<manifest>` 根节点下加入：

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

开发期后端是 http 明文地址，还需在 `<application>` 标签上加 `android:usesCleartextTraffic="true"`。

运行：

```bash
flutter run    # 选择模拟器或已连接的真机
```

## 连接后端

先在电脑上启动服务端（仓库根目录 `npm start`），然后在 App 右上角设置里配服务器地址：

- 安卓模拟器：`http://10.0.2.2:3000`（默认值，10.0.2.2 = 模拟器眼中的宿主机）
- 安卓真机：手机和电脑连同一 WiFi，填 `http://电脑局域网IP:3000`（`ifconfig | grep "inet "` 查看）

## 当前功能 / TODO

- [x] 录音（AAC/m4a）并自动上传转写
- [x] 录音列表（状态实时刷新）、本地文件上传
- [x] 详情页：转写稿 / AI 总结 / 灵感发芽 / 思维导图（WebView + markmap）
- [x] 录音库全文搜索（标题 / 转写 / 说话人 / AI 总结 / 灵感发芽）
- [x] 导出 Word / TXT / SRT / 发芽 Markdown，并可在浏览器导出导图
- [ ] 说话人/文字修正（Web 端已有，App 待移植）
- [ ] 后台录音、锁屏录音
- [ ] 安卓系统通话录音目录自动导入（Phase 2 核心差异化）
- [x] 微信登录、30 天会话与账号级数据隔离
- [ ] PostgreSQL 与云端对象存储
