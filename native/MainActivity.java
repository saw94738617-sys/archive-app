package com.archive.myclothes;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import android.os.Bundle;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ArchiveNotifyPlugin.class);
        registerPlugin(ArchiveBioPlugin.class);
        registerPlugin(ArchiveOcrPlugin.class);
        registerPlugin(ArchiveGAuthPlugin.class);
        super.onCreate(savedInstanceState);
        rememberOpen(getIntent());
        addOnNewIntentListener(this::rememberOpen);
        try {
            UpdateWorker.ensureChannel(this);
            WorkManager wm = WorkManager.getInstance(this);
            wm.cancelUniqueWork("com.archive.myclothes.check"); // 예전 방식(백그라운드 러너) 정리
            Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
            PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(UpdateWorker.class, 1, TimeUnit.HOURS)
                .setConstraints(c).build();
            wm.enqueueUniquePeriodicWork("archive-update-check", ExistingPeriodicWorkPolicy.KEEP, r);
            // 재입고 · 가격 알림: 6시간마다 (알림 켠 옷이 없으면 바로 끝나요)
            PeriodicWorkRequest a = new PeriodicWorkRequest.Builder(AlertWorker.class, 6, TimeUnit.HOURS).setConstraints(c).build();
            wm.enqueueUniquePeriodicWork("archive-alert-check", ExistingPeriodicWorkPolicy.KEEP, a);
        } catch (Exception e) {
            Log.w("Archive", "update check schedule failed", e);
        }
        try {
            // 새 버전 푸시 받기 (Firebase 설정이 들어간 빌드에서만 동작)
            com.google.firebase.messaging.FirebaseMessaging.getInstance().subscribeToTopic(UpdatePushService.TOPIC);
        } catch (Throwable t) {
            Log.w("Archive", "push subscribe skipped", t);
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                Log.i("Google Activity Result", "SocialLogin login handle is null");
                return;
            }
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                Log.i("Google Activity Result", "SocialLogin plugin instance is not SocialLoginPlugin");
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    // 플러그인이 MainActivity 수정 여부를 확인하는 용도. 비워둬야 해요.
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    /** 재입고 알림을 눌러서 열면, 앱이 그 옷을 바로 보여줄 수 있게 기억해요 */
    private void rememberOpen(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("openItem");
        if (id != null && !id.isEmpty())
            getSharedPreferences(AlertWorker.PREF, MODE_PRIVATE).edit().putString("open", id).apply();
        // 업데이트 알림을 눌러서 열었으면: 앱이 켜져 있던 중이어도 바로 업데이트 창을 띄우게 표시해 둬요
        if (intent.getBooleanExtra("archiveUpdate", false)) {
            getSharedPreferences(AlertWorker.PREF, MODE_PRIVATE).edit().putBoolean("openUpdate", true).apply();
            intent.removeExtra("archiveUpdate");
        }
        // 다른 앱에서 '공유 → 아카이브': 넘겨받은 글(제목 · 링크)만 저장해 두고 앱에서 위시 기록 화면으로 열어요
        if (Intent.ACTION_SEND.equals(intent.getAction()) && intent.getType() != null && intent.getType().startsWith("image/")) {
            // 캡처(사진) 공유: 폰 안에서 글자를 읽으려고 사진만 앱으로 넘겨요
            try {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) {
                    Bitmap bmp;
                    try (InputStream in = getContentResolver().openInputStream(u)) { bmp = BitmapFactory.decodeStream(in); }
                    if (bmp != null) {
                        int mx = Math.max(bmp.getWidth(), bmp.getHeight());
                        if (mx > 2600) { float k = 2600f / mx; bmp = Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * k), Math.round(bmp.getHeight() * k), true); }
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.JPEG, 90, bo);
                        File f = new File(getCacheDir(), "share_img.txt");
                        try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(("data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP)).getBytes("UTF-8")); }
                        getSharedPreferences(AlertWorker.PREF, MODE_PRIVATE).edit().putString("shareImg", f.getAbsolutePath()).apply();
                    }
                }
            } catch (Exception e) { Log.w("Archive", "share image", e); }
            intent.setAction(Intent.ACTION_MAIN);
        }
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String sub = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (sub == null || sub.isEmpty()) { CharSequence ti = intent.getCharSequenceExtra(Intent.EXTRA_TITLE); if (ti != null) sub = ti.toString(); }
            if (t != null && t.length() > 0) {
                getSharedPreferences(AlertWorker.PREF, MODE_PRIVATE).edit()
                    .putString("share", t.toString()).putString("shareSub", sub == null ? "" : sub).apply();
            }
            intent.setAction(Intent.ACTION_MAIN); // 다시 열 때 같은 공유가 또 들어오지 않게
        }
    }
}
