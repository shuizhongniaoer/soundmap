package com.soundmap.soundmap

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

private const val CHANNEL = "soundmap/call_recordings"
private const val DIRECTORY_REQUEST = 4217

class CallRecordingBridge(
    private val activity: FlutterActivity,
    messenger: BinaryMessenger,
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, CHANNEL)
    private var pickerResult: MethodChannel.Result? = null

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getDirectory" -> result.success(directoryConfig())
            "pickDirectory" -> pickDirectory(result)
            "clearDirectory" -> {
                clearDirectory()
                result.success(null)
            }
            "scan" -> scan(call, result)
            "configureBackground" -> configureBackground(call, result)
            "backgroundStatus" -> result.success(
                CallRecordingWorkScheduler.status(
                    activity,
                    call.argument<String>("contextId"),
                ),
            )
            "acknowledge" -> {
                CallRecordingQueue.acknowledge(
                    activity,
                    call.argument<String>("contextId") ?: "",
                    call.argument<String>("sourceId") ?: "",
                )
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun pickDirectory(result: MethodChannel.Result) {
        if (pickerResult != null) {
            result.error("PICK_IN_PROGRESS", "目录选择窗口已经打开", null)
            return
        }
        pickerResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
            savedTreeUri()?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, it) }
        }
        activity.startActivityForResult(intent, DIRECTORY_REQUEST)
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != DIRECTORY_REQUEST) return false
        finishDirectoryPick(if (resultCode == Activity.RESULT_OK) data?.data else null)
        return true
    }

    private fun finishDirectoryPick(uri: Uri?) {
        val result = pickerResult ?: return
        pickerResult = null
        if (uri == null) {
            result.success(null)
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
            activity.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
                .edit().putString(CALL_RECORDING_URI_KEY, uri.toString()).apply()
            CallRecordingWorkScheduler.refresh(activity)
            result.success(directoryConfig(uri))
        } catch (error: Exception) {
            result.error("DIRECTORY_PERMISSION", "无法保存目录权限：${error.message}", null)
        }
    }

    private fun clearDirectory() {
        savedTreeUri()?.let { uri ->
            try {
                activity.contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            } catch (_: Exception) {
                // Permission may already have been revoked in Android settings.
            }
        }
        activity.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
            .edit().remove(CALL_RECORDING_URI_KEY).apply()
        CallRecordingQueue.clearAllPending(activity)
        CallRecordingWorkScheduler.disable(activity)
    }

    private fun configureBackground(call: MethodCall, result: MethodChannel.Result) {
        val enabled = call.argument<Boolean>("enabled") ?: false
        val contextId = call.argument<String>("contextId")
        val seen = call.argument<List<String>>("seen") ?: emptyList()
        result.success(CallRecordingWorkScheduler.configure(activity, enabled, contextId, seen))
    }

    private fun scan(call: MethodCall, result: MethodChannel.Result) {
        val treeUri = savedTreeUri()
        if (treeUri == null) {
            result.error("NO_DIRECTORY", "请先选择通话录音目录", null)
            return
        }
        val contextId = call.argument<String>("contextId") ?: "legacy"
        val seen = (call.argument<List<String>>("seen") ?: emptyList()).toHashSet()
        val limit = (call.argument<Int>("limit") ?: 50).coerceIn(1, 200)
        Thread {
            try {
                CallRecordingQueue.syncSeen(activity, contextId, seen)
                val pending = CallRecordingQueue.pending(activity, contextId)
                    .sortedByDescending { it.modifiedAt }
                    .take(limit)
                val blocked = seen + pending.map { it.sourceId }
                val remaining = (limit - pending.size).coerceAtLeast(0)
                val discovered = if (remaining == 0) {
                    emptyList()
                } else {
                    val cacheDirectory = File(activity.cacheDir, "call_recordings")
                    SafAudioScanner(activity, treeUri).scan(blocked, remaining, cacheDirectory)
                }
                val files = pending.map { it.toMap() } + discovered
                activity.runOnUiThread { result.success(files) }
            } catch (error: SecurityException) {
                activity.runOnUiThread {
                    result.error("DIRECTORY_REVOKED", "目录权限已失效，请重新选择：${error.message}", null)
                }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    result.error("SCAN_FAILED", "扫描通话录音失败：${error.message}", null)
                }
            }
        }.start()
    }

    private fun savedTreeUri(): Uri? =
        activity.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
            .getString(CALL_RECORDING_URI_KEY, null)?.let(Uri::parse)

    private fun directoryConfig(uri: Uri? = savedTreeUri()): Map<String, Any?>? {
        if (uri == null) return null
        val label = try {
            val rootId = DocumentsContract.getTreeDocumentId(uri)
            val rootUri = DocumentsContract.buildDocumentUriUsingTree(uri, rootId)
            activity.contentResolver.query(
                rootUri,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        } catch (_: Exception) {
            null
        }
        return mapOf("uri" to uri.toString(), "label" to (label ?: "已授权目录"))
    }
}
