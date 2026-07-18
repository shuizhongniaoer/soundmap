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
import java.security.MessageDigest

private const val CHANNEL = "soundmap/call_recordings"
private const val PREFS = "soundmap_call_recordings"
private const val URI_KEY = "tree_uri"
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
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(URI_KEY, uri.toString()).apply()
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
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(URI_KEY).apply()
    }

    private fun scan(call: MethodCall, result: MethodChannel.Result) {
        val treeUri = savedTreeUri()
        if (treeUri == null) {
            result.error("NO_DIRECTORY", "请先选择通话录音目录", null)
            return
        }
        val seen = (call.argument<List<String>>("seen") ?: emptyList()).toHashSet()
        val limit = (call.argument<Int>("limit") ?: 50).coerceIn(1, 200)
        Thread {
            try {
                val files = SafAudioScanner(activity, treeUri).scan(seen, limit)
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

    private fun savedTreeUri(): Uri? = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(URI_KEY, null)?.let(Uri::parse)

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

private data class SafEntry(
    val documentId: String,
    val name: String,
    val size: Long,
    val modifiedAt: Long,
)

private class SafAudioScanner(
    private val context: Context,
    private val treeUri: Uri,
) {
    private val resolver = context.contentResolver
    private val visitedDirectories = mutableSetOf<String>()
    private val entries = mutableListOf<SafEntry>()
    private val extensions = setOf(
        "mp3", "m4a", "wav", "aac", "ogg", "opus", "flac", "mp4", "webm", "amr", "3gp",
    )

    fun scan(seen: Set<String>, limit: Int): List<Map<String, Any>> {
        val rootId = DocumentsContract.getTreeDocumentId(treeUri)
        walk(rootId, 0)
        val cacheDirectory = File(context.cacheDir, "call_recordings").apply { mkdirs() }
        return entries
            .sortedByDescending { it.modifiedAt }
            .map { entry -> entry to sourceId(entry) }
            .filterNot { (_, id) -> seen.contains(id) }
            .take(limit)
            .mapNotNull { (entry, id) -> copyToCache(entry, id, cacheDirectory) }
    }

    private fun walk(parentDocumentId: String, depth: Int) {
        if (depth > 8 || entries.size >= 5000 || !visitedDirectories.add(parentDocumentId)) return
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )
        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext() && entries.size < 5000) {
                val documentId = cursor.getString(0) ?: continue
                val name = cursor.getString(1) ?: continue
                val mime = cursor.getString(2) ?: ""
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    walk(documentId, depth + 1)
                    continue
                }
                val extension = name.substringAfterLast('.', "").lowercase()
                if (extension !in extensions && !mime.startsWith("audio/") && !mime.startsWith("video/")) continue
                val size = if (cursor.isNull(3)) 0L else cursor.getLong(3)
                if (size <= 0L) continue
                val modifiedAt = if (cursor.isNull(4)) 0L else cursor.getLong(4)
                entries += SafEntry(documentId, name, size, modifiedAt)
            }
        }
    }

    private fun sourceId(entry: SafEntry): String =
        "${entry.documentId}:${entry.size}:${entry.modifiedAt}"

    private fun copyToCache(
        entry: SafEntry,
        sourceId: String,
        cacheDirectory: File,
    ): Map<String, Any>? {
        val extension = entry.name.substringAfterLast('.', "bin").lowercase()
        val target = File(cacheDirectory, "${sha256(sourceId)}.$extension")
        if (!target.exists() || target.length() != entry.size) {
            val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, entry.documentId)
            val input = resolver.openInputStream(documentUri) ?: return null
            input.use { source -> target.outputStream().use(source::copyTo) }
        }
        return mapOf(
            "sourceId" to sourceId,
            "path" to target.absolutePath,
            "name" to entry.name,
            "size" to entry.size,
            "modifiedAt" to entry.modifiedAt,
        )
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
