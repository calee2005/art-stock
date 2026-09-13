package app.artstock.desktop

import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // wry does not initialize ndk-context; attach before WebView IPC starts.
    KeystoreSecrets.nativeAttach(applicationContext)
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    // Pad talks to S3-compatible HTTP endpoints (emulator 10.0.2.2 / adb reverse).
    webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    webView.settings.domStorageEnabled = true
  }
}
