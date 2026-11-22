package com.archive.myclothes;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

/** 사이즈표 사진에서 글자 읽기. 폰 안에서만 처리하고 사진을 밖으로 보내지 않아요. */
@CapacitorPlugin(name = "ArchiveOcr")
public class ArchiveOcrPlugin extends Plugin {
    @PluginMethod
    public void read(PluginCall call) {
        String data = call.getString("data", "");
        if (data.contains(",")) data = data.substring(data.indexOf(',') + 1);
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) { call.reject("사진을 열지 못했어요"); return; }
        if (bmp == null) { call.reject("사진을 열지 못했어요"); return; }
        TextRecognizer rec = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        final int W = bmp.getWidth(), H = bmp.getHeight();
        rec.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(text -> {
                JSArray words = new JSArray();
                for (Text.TextBlock b : text.getTextBlocks())
                    for (Text.Line l : b.getLines())
                        for (Text.Element el : l.getElements()) {
                            Rect r = el.getBoundingBox(); if (r == null) continue;
                            JSObject w = new JSObject();
                            w.put("t", el.getText()); w.put("x", r.left); w.put("y", r.top); w.put("w", r.width()); w.put("h", r.height());
                            words.put(w);
                        }
                JSObject o = new JSObject(); o.put("words", words); o.put("text", text.getText()); o.put("w", W); o.put("h", H);
                call.resolve(o);
                rec.close();
            })
            .addOnFailureListener(e -> { call.reject("글자를 읽지 못했어요: " + e.getMessage()); rec.close(); });
    }
}
