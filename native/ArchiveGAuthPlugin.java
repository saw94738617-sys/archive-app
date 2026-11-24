package com.archive.myclothes;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;

/**
 * Google 드라이브 출입증(접근 토큰)을 화면 없이 다시 받기.
 * 이미 허락한 계정이면 창을 띄우지 않고 새 토큰을 받아요. 허락이 필요하면 needUi=true만 알려 줘요.
 */
@CapacitorPlugin(name = "ArchiveGAuth")
public class ArchiveGAuthPlugin extends Plugin {
    @PluginMethod
    public void silent(PluginCall call) {
        try {
            AuthorizationRequest req = AuthorizationRequest.builder()
                .setRequestedScopes(Arrays.asList(new Scope("https://www.googleapis.com/auth/drive.appdata"), new Scope("https://www.googleapis.com/auth/drive.file"), new Scope("email"), new Scope("profile")))
                .build();
            Identity.getAuthorizationClient(getActivity()).authorize(req)
                .addOnSuccessListener(res -> {
                    JSObject o = new JSObject();
                    if (res.hasResolution()) { o.put("needUi", true); }
                    else { o.put("token", res.getAccessToken()); o.put("needUi", false); }
                    call.resolve(o);
                })
                .addOnFailureListener(e -> { JSObject o = new JSObject(); o.put("needUi", true); o.put("err", String.valueOf(e.getMessage())); call.resolve(o); });
        } catch (Exception e) {
            JSObject o = new JSObject(); o.put("needUi", true); o.put("err", String.valueOf(e.getMessage())); call.resolve(o);
        }
    }
}
