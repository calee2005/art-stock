package app.artstock.desktop

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Best-effort background copy of the SAF export folder into the local inbox.
 * Does not hold the remote lock or talk to OSS.
 */
class SafSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        SafTreeStore.scanJson(applicationContext)
        return Result.success()
    }

    companion object {
        const val UNIQUE = "artstock-saf-sync"

        @JvmStatic
        fun enqueue(context: Context) {
            val constraints =
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.UNMETERED)
                    .setRequiresCharging(true)
                    .build()
            val request =
                PeriodicWorkRequestBuilder<SafSyncWorker>(15, TimeUnit.MINUTES)
                    .setConstraints(constraints)
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        @JvmStatic
        fun constraintsJson(): String =
            """{"charging":true,"unmeteredWifi":true,"minIntervalMinutes":15,"writesRemote":false,"holdsLock":false}"""
    }
}
