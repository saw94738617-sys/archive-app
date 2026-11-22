package com.archive.myclothes;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** 앱이 꺼져 있어도 주기적으로 새 버전을 확인해서 폰 알림바로 알려줘요. */
public class UpdateWorker extends Worker {
    static final String CHANNEL = "updates";
    static final String REPO = "saw94738617-sys/archive-app";

    public UpdateWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "업데이트 알림", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("아카이브 새 버전이 나오면 알려줘요");
                nm.createNotificationChannel(ch);
            }
        }
    }

    static boolean test(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 7001, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationManagerCompat.from(ctx).notify(7001, new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_archive).setContentTitle("아카이브 테스트 알림")
            .setContentText("새 버전이 나오면 이렇게 알림바로 와요").setPriority(NotificationCompat.PRIORITY_HIGH)
            .setColor(0xFF1F2A44).setContentIntent(pi).setAutoCancel(true).build());
        return true;
    }

    static void mark(Context ctx, String msg) {
        ctx.getSharedPreferences("archive_update", Context.MODE_PRIVATE).edit()
            .putLong("lastAt", System.currentTimeMillis()).putString("lastMsg", msg).apply();
    }

    @NonNull @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(15000);
            h.setRequestProperty("Accept", "application/vnd.github+json");
            h.setRequestProperty("User-Agent", "archive-app");
            int code = h.getResponseCode();
            if (code != 200) { mark(ctx, "서버 응답 " + code); return Result.success(); }
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"))) {
                String line; while ((line = r.readLine()) != null) sb.append(line).append('\n');
            }
            JSONObject j = new JSONObject(sb.toString());
            String tag = j.optString("tag_name", "");
            Matcher m = Pattern.compile("(\\d+)$").matcher(tag);
            if (!m.find()) { mark(ctx, "버전 번호를 못 읽었어요"); return Result.success(); }
            long n = Long.parseLong(m.group(1));
            long cur = PackageInfoCompat.getLongVersionCode(ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0));
            SharedPreferences sp = ctx.getSharedPreferences("archive_update", Context.MODE_PRIVATE);
            long told = sp.getLong("notified", 0);
            if (n <= cur) { mark(ctx, "최신 버전이에요"); return Result.success(); }
            if (n <= told) { mark(ctx, "0.1." + n + " 알림은 이미 보냈어요"); return Result.success(); }

            String body = "눌러서 업데이트하세요";
            for (String s : j.optString("body", "").split("\n")) {
                s = s.trim();
                if (s.isEmpty() || s.contains("APK") || s.contains("archive-") || s.startsWith("폰에서")) continue;
                body = s.replaceFirst("^[-*]\\s*", ""); break;
            }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                mark(ctx, "새 버전이 있지만 알림 권한이 꺼져 있어요");
                return Result.success(); // 허용 전에는 보내지 않고, 허용 후 다음 확인 때 보내요
            }
            ensureChannel(ctx);
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("archiveUpdate", true);
            PendingIntent pi = PendingIntent.getActivity(ctx, 7000, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String ver = tag.replaceFirst("^v", "");
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_archive)
                .setContentTitle("아카이브 새 버전 " + ver)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body + "\n눌러서 업데이트하세요"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setColor(0xFF1F2A44)
                .setContentIntent(pi)
                .setAutoCancel(true);
            NotificationManagerCompat.from(ctx).notify(7000, b.build());
            sp.edit().putLong("notified", n).apply();
            mark(ctx, ver + " 알림을 보냈어요");
        } catch (Exception e) {
            mark(ctx, "확인 실패: " + e.getClass().getSimpleName());
            return Result.retry();
        } finally {
            if (h != null) h.disconnect();
        }
        return Result.success();
    }
}
