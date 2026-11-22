package com.archive.myclothes;

import android.content.Intent;
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
    }
}
