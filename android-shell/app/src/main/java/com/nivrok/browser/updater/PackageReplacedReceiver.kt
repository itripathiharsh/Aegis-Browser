package com.nivrok.browser.updater

import android.Manifest
import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.nivrok.browser.BuildConfig
import com.nivrok.browser.R
import com.nivrok.browser.ui.MainActivity

/**
 * Triggered immediately by Android when an updated APK replaces the running package.
 * Posts an interactive high-importance banner with MODE_BACKGROUND_ACTIVITY_START_ALLOWED so the user
 * can reopen Nivrok in one tap right over the installer/Files screen without hunting for the icon.
 */
class PackageReplacedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val appContext = context.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "App Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Quick reopen prompt when Nivrok finishes updating"
            }
            manager.createNotificationChannel(channel)
        }

        val launchIntent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_JUST_UPDATED, true)
        }

        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val opts = ActivityOptions.makeBasic()
                .setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                )
                .toBundle()
            PendingIntent.getActivity(appContext, NOTIFICATION_ID, launchIntent, piFlags, opts)
        } else {
            PendingIntent.getActivity(appContext, NOTIFICATION_ID, launchIntent, piFlags)
        }

        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(appContext, CHANNEL_ID)
        } else {
            Notification.Builder(appContext).setPriority(Notification.PRIORITY_HIGH)
        }

        val notification = builder
            .setSmallIcon(R.drawable.ic_nivrok_notification)
            .setContentTitle("Nivrok updated to v${BuildConfig.VERSION_NAME}")
            .setContentText("Tap to jump right back into your tabs.")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        runCatching {
            manager.notify(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "nivrok_app_updates"
        const val NOTIFICATION_ID = 1007
        const val EXTRA_JUST_UPDATED = "com.nivrok.browser.JUST_UPDATED"
    }
}
