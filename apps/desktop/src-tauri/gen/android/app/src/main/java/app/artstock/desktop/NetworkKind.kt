package app.artstock.desktop

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/** Transport kind for Pad original-download policy. Never logs secrets. */
object NetworkKind {
    @JvmStatic
    fun current(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "offline"
        val network = cm.activeNetwork ?: return "offline"
        val caps = cm.getNetworkCapabilities(network) ?: return "offline"
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        ) {
            return "wifi"
        }
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            return "cellular"
        }
        return "other"
    }
}
