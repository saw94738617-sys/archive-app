package com.archive.myclothes;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** 앱 화면에서 폰 알림 허용 상태를 보고, 허용을 요청하는 연결고리예요. */
@CapacitorPlugin(name = "ArchiveNotify", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class ArchiveNotifyPlugin extends Plugin {

    private String state() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "granted";
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) return "prompt";
        return "denied";
    }

    private void answer(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", state());
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) { answer(call); }

    @PluginMethod
    public void ask(PluginCall call) {
        if ("granted".equals(state())) { answer(call); return; }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "askDone");
        } else {
            openSettings();
            answer(call);
        }
    }

    @PermissionCallback
    private void askDone(PluginCall call) {
        if (!"granted".equals(state()) && call.getBoolean("openSettings", false)) openSettings();
        if ("granted".equals(state())) checkSoon();
        answer(call);
    }

    @PluginMethod
    public void checkNow(PluginCall call) { checkSoon(); call.resolve(); }

    private void checkSoon() {
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(UpdateWorker.class).build());
    }

    private void openSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception ignored) {}
    }
}
