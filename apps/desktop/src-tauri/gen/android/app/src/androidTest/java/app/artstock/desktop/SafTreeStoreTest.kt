package app.artstock.desktop

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class SafTreeStoreTest {
    @Test
    fun grantScanThenRevokeStopsCopy() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        InboxStore.inboxDir(ctx).listFiles()?.forEach { it.delete() }
        SafTreeStore.revoke(ctx)
        val status = SafTreeStore.grantLocalDirForE2e(ctx)
        assertTrue(status.contains("\"authorized\":true") || status.contains("\"authorized\": true"))
        assertFalse(status.contains("secretAccessKey", ignoreCase = true))
        val scanned = SafTreeStore.scanJson(ctx)
        assertTrue(scanned.contains("\"copied\":1") || scanned.contains("\"copied\": 1"))
        val dest = File(InboxStore.inboxDir(ctx), "saf-sketch.png")
        assertTrue(dest.exists())
        SafTreeStore.revoke(ctx)
        dest.delete()
        val after = SafTreeStore.scanJson(ctx)
        assertTrue(after.contains("\"authorized\":false") || after.contains("\"authorized\": false"))
        assertTrue(after.contains("\"copied\":0") || after.contains("\"copied\": 0"))
        assertFalse(File(InboxStore.inboxDir(ctx), "saf-sketch.png").exists())
    }

    @Test
    fun reclaimCacheLeavesPinned() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val pin = File(SandboxStore.pinnedDir(ctx), "keep.bin")
        pin.writeBytes(byteArrayOf(1, 2, 3))
        SandboxStore.reclaimCache(ctx)
        assertTrue(pin.exists())
        pin.delete()
    }

    @Test
    fun backgroundWorkerDoesNotHoldLock() {
        val json = SafSyncWorker.constraintsJson()
        assertTrue(json.contains("\"writesRemote\":false"))
        assertTrue(json.contains("\"holdsLock\":false"))
        assertTrue(json.contains("\"charging\":true"))
        assertFalse(json.contains("secretAccessKey", ignoreCase = true))
        assertEquals("artstock-saf-sync", SafSyncWorker.UNIQUE)
    }
}
