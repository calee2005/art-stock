package app.artstock.desktop

import android.content.Intent
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Keep the WebView above the system taskbar so TabletShell nav stays tappable.
    KeystoreSecrets.nativeAttach(applicationContext)
    super.onCreate(savedInstanceState)
    SafSyncWorker.enqueue(applicationContext)
    handleShare(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleShare(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    // Pad talks to S3-compatible HTTP endpoints (emulator 10.0.2.2 / adb reverse).
    webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    webView.settings.domStorageEnabled = true
  }

  private fun handleShare(intent: Intent?) {
    if (intent == null) {
      return
    }
    try {
      InboxStore.ingestIntent(this, intent)
    } catch (_: Exception) {
      // Share failures stay local; WebView lists whatever landed in inbox.
    }
  }
}
