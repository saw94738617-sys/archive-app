package com.archive.myclothes;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 지문(생체 인증)으로 앱 잠금 풀기. 지문 정보는 폰 안에만 있고 앱은 '맞다/아니다' 결과만 받아요. */
@CapacitorPlugin(name = "ArchiveBio")
public class ArchiveBioPlugin extends Plugin {
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void available(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(AUTH);
        JSObject o = new JSObject();
        o.put("ok", r == BiometricManager.BIOMETRIC_SUCCESS);
        o.put("enrolled", r != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        o.put("code", r);
        call.resolve(o);
    }

    @PluginMethod
    public void verify(PluginCall call) {
        final String title = call.getString("title", "아카이브 잠금 해제");
        final String sub = call.getString("subtitle", "지문으로 열어요");
        getActivity().runOnUiThread(() -> {
            try {
                FragmentActivity act = (FragmentActivity) getActivity();
                BiometricPrompt p = new BiometricPrompt(act, ContextCompat.getMainExecutor(act), new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
                    }
                    @Override public void onAuthenticationError(int code, CharSequence msg) {
                        JSObject o = new JSObject(); o.put("ok", false); o.put("code", code); o.put("msg", String.valueOf(msg)); call.resolve(o);
                    }
                    // 지문이 한 번 틀린 것(onAuthenticationFailed)은 창이 그대로 남아서 다시 시도해요
                });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title).setSubtitle(sub)
                    .setNegativeButtonText("비밀번호로 열기")
                    .setAllowedAuthenticators(AUTH)
                    .build();
                p.authenticate(info);
            } catch (Exception e) {
                JSObject o = new JSObject(); o.put("ok", false); o.put("msg", e.getMessage()); call.resolve(o);
            }
        });
    }
}
