package com.archive.myclothes;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** 새 버전을 올리는 순간 서버(GitHub)가 보내는 푸시를 받아서 바로 알림바에 띄워요. */
public class UpdatePushService extends FirebaseMessagingService {
    static final String TOPIC = "updates";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String b = d.get("build");
        if (b == null) return;
        long n;
        try { n = Long.parseLong(b.trim()); } catch (NumberFormatException e) { return; }
        UpdateWorker.notifyUpdate(getApplicationContext(), n, d.get("ver"), d.get("body"), "푸시");
    }

    @Override
    public void onNewToken(@NonNull String token) {
        try { FirebaseMessaging.getInstance().subscribeToTopic(TOPIC); } catch (Exception ignored) {}
    }
}
