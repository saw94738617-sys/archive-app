package com.archive.myclothes;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
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

    private boolean batteryFree() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private void answer(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", state());
        SharedPreferences sp = getContext().getSharedPreferences("archive_update", Context.MODE_PRIVATE);
        r.put("lastAt", sp.getLong("lastAt", 0));
        r.put("lastMsg", sp.getString("lastMsg", ""));
        r.put("battery", batteryFree());
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

    /** 알림 켠 위시 옷 목록을 받아 두기 (백그라운드 재입고 · 가격 확인용) */
    @PluginMethod
    public void setWatch(PluginCall call) {
        String json = call.getString("json", "[]");
        SharedPreferences sp = getContext().getSharedPreferences(AlertWorker.PREF, Context.MODE_PRIVATE);
        try {
            org.json.JSONArray incoming = new org.json.JSONArray(json);
            sp.edit().putString("items", incoming.toString()).apply();
        } catch (Exception e) { call.reject("bad json"); return; }
        int hours = Math.max(4, Math.min(24, call.getInt("hours", 8)));
        if (sp.getInt("hours", 0) != hours) {
            sp.edit().putInt("hours", hours).apply();
            androidx.work.Constraints c = new androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build();
            androidx.work.PeriodicWorkRequest a = new androidx.work.PeriodicWorkRequest.Builder(AlertWorker.class, hours, java.util.concurrent.TimeUnit.HOURS).setConstraints(c).build();
            WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork("archive-alert-check", androidx.work.ExistingPeriodicWorkPolicy.UPDATE, a);
        }
        call.resolve();
    }

    /** 백그라운드에서 확인한 결과(재고 · 가격)와 알림에서 누른 옷을 앱으로 가져오기 */
    @PluginMethod
    public void pullAlerts(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences(AlertWorker.PREF, Context.MODE_PRIVATE);
        JSObject r = new JSObject();
        r.put("updates", sp.getString("updates", "[]"));
        r.put("open", sp.getString("open", ""));
        r.put("lastAt", sp.getLong("lastAt", 0));
        r.put("lastMsg", sp.getString("lastMsg", ""));
        r.put("share", sp.getString("share", ""));
        r.put("shareSub", sp.getString("shareSub", ""));
        String ip = sp.getString("shareImg", "");
        if (!ip.isEmpty()) {
            try {
                java.io.File f = new java.io.File(ip);
                byte[] b = new byte[(int) f.length()];
                try (java.io.FileInputStream in = new java.io.FileInputStream(f)) { int o = 0, n; while (o < b.length && (n = in.read(b, o, b.length - o)) > 0) o += n; }
                r.put("shareImg", new String(b, "UTF-8"));
                f.delete();
            } catch (Exception e) { /* 사진을 못 읽으면 건너뛰어요 */ }
        }
        sp.edit().putString("updates", "[]").remove("open").remove("share").remove("shareSub").remove("shareImg").apply();
        call.resolve(r);
    }

    @PluginMethod
    public void alertsNow(PluginCall call) {
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(AlertWorker.class).build());
        call.resolve();
    }

    @PluginMethod
    public void test(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sent", UpdateWorker.test(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void askBattery(PluginCall call) {
        if (!batteryFree()) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception e) {
                try {
                    Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                } catch (Exception ignored) {}
            }
        }
        answer(call);
    }

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
