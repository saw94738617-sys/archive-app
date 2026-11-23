package com.archive.myclothes;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.util.Base64;
import androidx.core.content.FileProvider;
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
        r.put("openUpdate", sp.getBoolean("openUpdate", false));
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
        sp.edit().putString("updates", "[]").remove("open").remove("openUpdate").remove("share").remove("shareSub").remove("shareImg").apply();
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

    /** 캡처에서 자른 상품 사진을 Google 렌즈(구글 앱)로 넘겨요. 결과에서 공식몰을 고르는 건 사용자가 해요. */
    @PluginMethod
    public void lens(PluginCall call) {
        try {
            String data = call.getString("data", "");
            int comma = data.indexOf(',');
            byte[] bytes = Base64.decode(comma >= 0 ? data.substring(comma + 1) : data, Base64.DEFAULT);
            java.io.File f = new java.io.File(getContext().getCacheDir(), "lens.jpg");
            try (java.io.FileOutputStream fo = new java.io.FileOutputStream(f)) { fo.write(bytes); }
            Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("image/jpeg");
            i.putExtra(Intent.EXTRA_STREAM, u);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            JSObject r = new JSObject();
            try {
                Intent g = new Intent(i); g.setPackage("com.google.android.googlequicksearchbox");
                getContext().startActivity(g); r.put("via", "google");
            } catch (ActivityNotFoundException e) {
                Intent ch = Intent.createChooser(i, "사진으로 검색할 앱 고르기"); ch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(ch); r.put("via", "chooser");
            }
            call.resolve(r);
        } catch (Exception e) { call.reject("렌즈로 넘기지 못했어요: " + e.getMessage()); }
    }

    /** 링크 열기: 그 링크를 받는 앱(무신사 등)이 깔려 있으면 앱으로, 없으면 브라우저로 */
    @PluginMethod
    public void openLink(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("http")) { call.reject("링크가 아니에요"); return; }
        Uri u = Uri.parse(url);
        JSObject r = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                Intent app = new Intent(Intent.ACTION_VIEW, u);
                app.addCategory(Intent.CATEGORY_BROWSABLE);
                app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER);
                getContext().startActivity(app);
                r.put("via", "app"); call.resolve(r); return;
            }
        } catch (ActivityNotFoundException e) { /* 앱 없음 → 브라우저 */ }
        try {
            Intent b = new Intent(Intent.ACTION_VIEW, u);
            b.addCategory(Intent.CATEGORY_BROWSABLE);
            b.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(b);
            r.put("via", "browser"); call.resolve(r);
        } catch (Exception e) { call.reject("링크를 열지 못했어요"); }
    }
}
