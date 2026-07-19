package com.soundmap.soundmap

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

internal const val CALL_RECORDING_PREFS = "soundmap_call_recordings"
internal const val CALL_RECORDING_URI_KEY = "tree_uri"
private const val BACKGROUND_ENABLED_KEY = "background_enabled"
private const val ACTIVE_CONTEXT_KEY = "active_context"
private const val LAST_SCAN_AT_KEY = "last_scan_at"
private const val LAST_DISCOVERED_KEY = "last_discovered"
private const val LAST_ERROR_KEY = "last_error"
private const val WORK_NAME = "soundmap_call_recording_scan"
private const val INTERVAL_MINUTES = 15L
private const val MAX_PENDING = 200

internal data class StoredCallRecording(
    val sourceId: String,
    val path: String,
    val name: String,
    val size: Long,
    val modifiedAt: Long,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "sourceId" to sourceId,
        "path" to path,
        "name" to name,
        "size" to size,
        "modifiedAt" to modifiedAt,
        "background" to true,
    )

    fun toJson(): JSONObject = JSONObject()
        .put("sourceId", sourceId)
        .put("path", path)
        .put("name", name)
        .put("size", size)
        .put("modifiedAt", modifiedAt)

    companion object {
        fun fromJson(value: JSONObject): StoredCallRecording? {
            val sourceId = value.optString("sourceId")
            val path = value.optString("path")
            if (sourceId.isBlank() || path.isBlank()) return null
            return StoredCallRecording(
                sourceId = sourceId,
                path = path,
                name = value.optString("name", "通话录音.m4a"),
                size = value.optLong("size"),
                modifiedAt = value.optLong("modifiedAt"),
            )
        }
    }
}

internal object CallRecordingQueue {
    private fun prefs(context: Context) =
        context.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)

    private fun contextHash(contextId: String) = sha256(contextId).take(24)

    private fun pendingKey(contextId: String) = "pending_${contextHash(contextId)}"

    private fun completedKey(contextId: String) = "completed_${contextHash(contextId)}"

    fun completed(context: Context, contextId: String): MutableSet<String> =
        prefs(context).getStringSet(completedKey(contextId), emptySet())?.toMutableSet()
            ?: mutableSetOf()

    fun pending(context: Context, contextId: String): MutableList<StoredCallRecording> {
        val raw = prefs(context).getString(pendingKey(contextId), null) ?: return mutableListOf()
        return try {
            val array = JSONArray(raw)
            MutableList(array.length()) { index -> StoredCallRecording.fromJson(array.getJSONObject(index)) }
                .filterNotNull()
                .filter { File(it.path).exists() }
                .toMutableList()
        } catch (_: Exception) {
            mutableListOf()
        }
    }

    @Synchronized
    fun syncSeen(context: Context, contextId: String, seen: Collection<String>) {
        if (contextId.isBlank()) return
        val completed = completed(context, contextId)
        completed.addAll(seen)
        saveCompleted(context, contextId, completed)
        val remaining = pending(context, contextId).filterNot { item ->
            if (!completed.contains(item.sourceId)) return@filterNot false
            File(item.path).delete()
            true
        }
        savePending(context, contextId, remaining)
    }

    @Synchronized
    fun acknowledge(context: Context, contextId: String, sourceId: String) {
        if (contextId.isBlank() || sourceId.isBlank()) return
        val completed = completed(context, contextId)
        completed.remove(sourceId)
        completed.add(sourceId)
        saveCompleted(context, contextId, completed)
        val remaining = pending(context, contextId).filterNot { item ->
            if (item.sourceId != sourceId) return@filterNot false
            File(item.path).delete()
            true
        }
        savePending(context, contextId, remaining)
    }

    @Synchronized
    fun discardOtherPending(context: Context, keepContextId: String) {
        val preferences = prefs(context)
        val keepKey = pendingKey(keepContextId)
        val staleKeys = preferences.all.keys.filter {
            it.startsWith("pending_") && it != keepKey
        }
        if (staleKeys.isEmpty()) return
        val editor = preferences.edit()
        staleKeys.forEach { key ->
            deleteFiles(preferences.getString(key, null))
            editor.remove(key)
        }
        editor.apply()
    }

    @Synchronized
    fun clearAllPending(context: Context) {
        val preferences = prefs(context)
        val keys = preferences.all.keys.filter { it.startsWith("pending_") }
        val editor = preferences.edit()
        keys.forEach { key ->
            deleteFiles(preferences.getString(key, null))
            editor.remove(key)
        }
        editor.apply()
        File(context.filesDir, "call_recordings_pending").listFiles()?.forEach { it.delete() }
    }

    @Synchronized
    fun appendPending(
        context: Context,
        contextId: String,
        candidates: Collection<Map<String, Any>>,
    ): Int {
        val values = pending(context, contextId)
        val existing = values.mapTo(mutableSetOf()) { it.sourceId }
        val completed = completed(context, contextId)
        var added = 0
        for (candidate in candidates) {
            val sourceId = candidate["sourceId"]?.toString() ?: continue
            val path = candidate["path"]?.toString() ?: continue
            if (completed.contains(sourceId)) {
                File(path).delete()
                continue
            }
            if (!existing.add(sourceId)) continue
            values += StoredCallRecording(
                sourceId = sourceId,
                path = path,
                name = candidate["name"]?.toString() ?: "通话录音.m4a",
                size = (candidate["size"] as? Number)?.toLong() ?: 0L,
                modifiedAt = (candidate["modifiedAt"] as? Number)?.toLong() ?: 0L,
            )
            added++
        }
        val bounded = values.sortedByDescending { it.modifiedAt }.take(MAX_PENDING)
        val retainedPaths = bounded.mapTo(mutableSetOf()) { it.path }
        values.filterNot { retainedPaths.contains(it.path) }.forEach { File(it.path).delete() }
        savePending(context, contextId, bounded)
        return added
    }

    private fun savePending(
        context: Context,
        contextId: String,
        values: Collection<StoredCallRecording>,
    ) {
        val array = JSONArray()
        values.forEach { array.put(it.toJson()) }
        prefs(context).edit().putString(pendingKey(contextId), array.toString()).apply()
    }

    private fun saveCompleted(context: Context, contextId: String, values: Collection<String>) {
        val bounded = values.toList().takeLast(3000).toSet()
        prefs(context).edit().putStringSet(completedKey(contextId), bounded).apply()
    }

    private fun deleteFiles(raw: String?) {
        if (raw == null) return
        try {
            val array = JSONArray(raw)
            for (index in 0 until array.length()) {
                val path = array.optJSONObject(index)?.optString("path") ?: continue
                File(path).delete()
            }
        } catch (_: Exception) {
            // A malformed queue should not prevent directory permission cleanup.
        }
    }
}

internal object CallRecordingWorkScheduler {
    fun configure(
        context: Context,
        enabled: Boolean,
        contextId: String?,
        seen: Collection<String>,
    ): Map<String, Any?> {
        val prefs = context.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
        if (!contextId.isNullOrBlank()) {
            val previousContext = prefs.getString(ACTIVE_CONTEXT_KEY, null)
            if (previousContext != null && previousContext != contextId) {
                CallRecordingQueue.discardOtherPending(context, contextId)
                prefs.edit()
                    .remove(LAST_SCAN_AT_KEY)
                    .remove(LAST_DISCOVERED_KEY)
                    .remove(LAST_ERROR_KEY)
                    .apply()
            }
            prefs.edit().putString(ACTIVE_CONTEXT_KEY, contextId).apply()
            CallRecordingQueue.syncSeen(context, contextId, seen)
        }
        prefs.edit().putBoolean(BACKGROUND_ENABLED_KEY, enabled).apply()
        if (enabled && prefs.contains(CALL_RECORDING_URI_KEY) && !contextId.isNullOrBlank()) {
            enqueue(context)
        } else {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
        return status(context, contextId)
    }

    fun refresh(context: Context) {
        val prefs = context.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(BACKGROUND_ENABLED_KEY, false)
        val contextId = prefs.getString(ACTIVE_CONTEXT_KEY, null)
        if (enabled && prefs.contains(CALL_RECORDING_URI_KEY) && !contextId.isNullOrBlank()) {
            enqueue(context)
        }
    }

    fun disable(context: Context) {
        context.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(BACKGROUND_ENABLED_KEY, false).apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    fun status(context: Context, requestedContextId: String?): Map<String, Any?> {
        val prefs = context.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
        val contextId = requestedContextId?.takeIf { it.isNotBlank() }
            ?: prefs.getString(ACTIVE_CONTEXT_KEY, null)
        val enabled = prefs.getBoolean(BACKGROUND_ENABLED_KEY, false)
        val hasDirectory = prefs.contains(CALL_RECORDING_URI_KEY)
        return mapOf(
            "enabled" to enabled,
            "scheduled" to (enabled && hasDirectory && !contextId.isNullOrBlank()),
            "pendingCount" to if (contextId == null) 0 else CallRecordingQueue.pending(context, contextId).size,
            "intervalMinutes" to INTERVAL_MINUTES,
            "lastScanAt" to prefs.getLong(LAST_SCAN_AT_KEY, 0L),
            "lastDiscovered" to prefs.getInt(LAST_DISCOVERED_KEY, 0),
            "lastError" to prefs.getString(LAST_ERROR_KEY, null),
        )
    }

    private fun enqueue(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(true)
            .setRequiresStorageNotLow(true)
            .build()
        val request = PeriodicWorkRequest.Builder(
            CallRecordingScanWorker::class.java,
            INTERVAL_MINUTES,
            TimeUnit.MINUTES,
        ).setConstraints(constraints).addTag(WORK_NAME).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}

class CallRecordingScanWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {
    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(CALL_RECORDING_PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(BACKGROUND_ENABLED_KEY, false)) return Result.success()
        val contextId = prefs.getString(ACTIVE_CONTEXT_KEY, null) ?: return Result.success()
        val treeUri = prefs.getString(CALL_RECORDING_URI_KEY, null)?.let(Uri::parse)
            ?: return Result.success()
        return try {
            val completed = CallRecordingQueue.completed(applicationContext, contextId)
            val pending = CallRecordingQueue.pending(applicationContext, contextId)
            val blocked = completed + pending.map { it.sourceId }
            val target = File(applicationContext.filesDir, "call_recordings_pending").apply { mkdirs() }
            val available = (MAX_PENDING - pending.size).coerceAtLeast(0)
            val candidates = if (available == 0) {
                emptyList()
            } else {
                SafAudioScanner(applicationContext, treeUri).scan(blocked, minOf(25, available), target)
            }
            val stillCurrent = prefs.getBoolean(BACKGROUND_ENABLED_KEY, false) &&
                prefs.getString(ACTIVE_CONTEXT_KEY, null) == contextId &&
                prefs.getString(CALL_RECORDING_URI_KEY, null) == treeUri.toString()
            if (!stillCurrent) {
                candidates.mapNotNull { it["path"]?.toString()?.takeIf(String::isNotBlank) }
                    .forEach { File(it).delete() }
                return Result.success()
            }
            val added = CallRecordingQueue.appendPending(applicationContext, contextId, candidates)
            prefs.edit()
                .putLong(LAST_SCAN_AT_KEY, System.currentTimeMillis())
                .putInt(LAST_DISCOVERED_KEY, added)
                .remove(LAST_ERROR_KEY)
                .apply()
            Result.success()
        } catch (error: SecurityException) {
            prefs.edit()
                .putLong(LAST_SCAN_AT_KEY, System.currentTimeMillis())
                .putString(LAST_ERROR_KEY, "目录权限已失效，请重新授权")
                .apply()
            Result.failure()
        } catch (error: Exception) {
            prefs.edit()
                .putLong(LAST_SCAN_AT_KEY, System.currentTimeMillis())
                .putString(LAST_ERROR_KEY, error.message ?: "后台扫描失败")
                .apply()
            Result.retry()
        }
    }
}

private data class SafEntry(
    val documentId: String,
    val name: String,
    val size: Long,
    val modifiedAt: Long,
)

internal class SafAudioScanner(
    private val context: Context,
    private val treeUri: Uri,
) {
    private val resolver = context.contentResolver
    private val visitedDirectories = mutableSetOf<String>()
    private val entries = mutableListOf<SafEntry>()
    private val extensions = setOf(
        "mp3", "m4a", "wav", "aac", "ogg", "opus", "flac", "mp4", "webm", "amr", "3gp",
    )

    fun scan(seen: Set<String>, limit: Int, targetDirectory: File): List<Map<String, Any>> {
        val rootId = DocumentsContract.getTreeDocumentId(treeUri)
        walk(rootId, 0)
        targetDirectory.mkdirs()
        return entries
            .sortedByDescending { it.modifiedAt }
            .map { entry -> entry to sourceId(entry) }
            .filterNot { (_, id) -> seen.contains(id) }
            .take(limit)
            .mapNotNull { (entry, id) -> copyToDirectory(entry, id, targetDirectory) }
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

    private fun copyToDirectory(
        entry: SafEntry,
        sourceId: String,
        targetDirectory: File,
    ): Map<String, Any>? {
        val extension = entry.name.substringAfterLast('.', "bin").lowercase()
        val target = File(targetDirectory, "${sha256(sourceId)}.$extension")
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
}

internal fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray())
    .joinToString("") { "%02x".format(it) }
