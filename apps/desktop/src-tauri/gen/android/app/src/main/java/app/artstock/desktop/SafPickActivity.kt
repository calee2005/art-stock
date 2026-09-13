package app.artstock.desktop

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/** Thin activity so the Pad WebView can open ACTION_OPEN_DOCUMENT_TREE. */
class SafPickActivity : ComponentActivity() {
    private val picker =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
            if (uri != null) {
                SafTreeStore.persist(this, uri)
            }
            finish()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        picker.launch(null)
    }
}
