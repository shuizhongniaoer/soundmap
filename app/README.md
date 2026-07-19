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

## Android 通话录音自动导入

进入右上角“导入录音”页面，选择系统通话录音目录并开启自动扫描。声图使用 Android SAF 目录授权，只能读取用户明确选择的目录，不需要 `READ_EXTERNAL_STORAGE` 或“所有文件访问”权限。

常见目录仅供选择时参考（不同系统版本可能变化）：

- 小米：`MIUI/sound_recorder/call_rec`
- 华为 / 荣耀：`Sounds/CallRecord`、`Record` 或系统录音机下的通话目录
- OPPO / vivo：在系统录音机目录中选择“通话录音”子目录

扫描会递归识别常见音视频格式，并按“账号 + 服务器 + 来源文件指纹”去重。只有上传成功后才标记为已导入，失败项目会在下次启动或回到前台时重试。

开启自动扫描后，Android WorkManager 会使用最短 15 分钟的周期在后台发现新录音（实际时间由系统根据电量、存储和休眠策略决定，不保证准点）。后台任务只把已发现文件缓存在 App 私有目录；下次打开声图时才使用当前登录态上传，避免在原生后台任务中复制登录凭证。切换账号或服务器会隔离去重上下文并清理旧的待导入缓存。

## 当前功能 / TODO

- [x] 录音（AAC/m4a）并自动上传转写
- [x] 录音列表（状态实时刷新）、本地文件上传
- [x] 独立导入页、Android 系统分享导入
- [x] Android SAF 通话录音目录授权、手动扫描、启动/回前台自动导入与账号级去重
- [x] Android WorkManager 后台定期发现、私有待导入队列与前台安全上传
- [x] 详情页：转写稿 / AI 总结 / 文学化发芽报告 / 思维导图（WebView + markmap）
- [x] 录音库全文搜索（标题 / 转写 / 说话人 / AI 总结 / 灵感发芽）
- [x] 导出 Word / TXT / SRT / 发芽报告 Markdown，并可在浏览器导出导图
- [x] AI 总结、灵感发芽、思维导图、转写优化的按项重新生成
- [ ] 说话人/文字修正（Web 端已有，App 待移植）
- [ ] 后台录音、锁屏录音
- [ ] iOS Share Extension 通话录音导入（当前接收分享的 Dart 层已完成）
- [x] 微信登录、30 天会话与账号级数据隔离
- [ ] PostgreSQL 与云端对象存储
