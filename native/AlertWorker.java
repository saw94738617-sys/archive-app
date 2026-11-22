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
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 재입고 · 가격 알림을 앱이 꺼져 있어도 확인해요.
 * 앱이 넘겨준 '알림 켠 위시 옷'의 판매처 페이지만, 몇 시간에 한 번 읽어요.
 * (약관에서 자동 수집을 금지한 쇼핑몰은 앱이 처음부터 넘겨주지 않아요)
 */
public class AlertWorker extends Worker {
    static final String PREF = "archive_watch";
    static final String CHANNEL = "alerts";
    static final String UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

    public AlertWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "재입고 · 가격 알림", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("알림 켠 위시 옷의 내 사이즈 재입고와 가격 인하");
                nm.createNotificationChannel(ch);
            }
        }
    }

    @NonNull @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        try {
            JSONArray items = new JSONArray(sp.getString("items", "[]"));
            if (items.length() == 0) { mark(sp, "알림 켠 옷이 없어요"); return Result.success(); }
            JSONArray updates = new JSONArray(sp.getString("updates", "[]"));
            int checked = 0, sent = 0;
            for (int i = 0; i < items.length() && checked < 30; i++) {
                JSONObject it = items.getJSONObject(i);
                JSONArray sellers = it.optJSONArray("sellers");
                if (sellers == null) continue;
                String my = it.optString("my", "");
                for (int k = 0; k < sellers.length() && checked < 30; k++) {
                    JSONObject s = sellers.getJSONObject(k);
                    String url = s.optString("url", "");
                    if (!url.startsWith("http")) continue;
                    checked++;
                    Read r;
                    try { r = read(url, it.optString("color", "")); } catch (Exception e) { continue; }
                    JSONObject before = s.optJSONObject("stock");
                    String priceStr = r.price != null ? fmtPrice(r.price, r.currency) : "";
                    long np = priceNum(priceStr), bp = priceNum(s.optString("price", ""));
                    // 재입고: 내 사이즈가 전에는 없었는데 지금 있음
                    if (it.optBoolean("restock") && !my.isEmpty() && r.stock.containsKey(my) && "in".equals(r.stock.get(my))
                            && before != null && before.has(my) && !"in".equals(before.optString(my))) {
                        if (notify(ctx, it.optString("id"), my + " 재입고", it.optString("title") + " · " + s.optString("shop") + " " + priceStr)) sent++;
                    }
                    // 가격 인하
                    long target = it.optLong("target", 0);
                    if (it.optBoolean("price") && np > 0 && bp > 0 && np < bp && (target <= 0 || np <= target)) {
                        if (notify(ctx, it.optString("id"), "가격 내려감", it.optString("title") + " · " + s.optString("price") + " → " + priceStr)) sent++;
                    }
                    // 다음 비교를 위해 저장 + 앱이 열리면 반영할 수 있게 기록
                    JSONObject ns = new JSONObject();
                    for (Map.Entry<String, String> e : r.stock.entrySet()) ns.put(e.getKey(), e.getValue());
                    if (!r.stock.isEmpty()) s.put("stock", ns);
                    if (!priceStr.isEmpty()) s.put("price", priceStr);
                    JSONObject u = new JSONObject();
                    u.put("id", it.optString("id")); u.put("url", url);
                    if (!r.stock.isEmpty()) u.put("stock", ns);
                    if (!priceStr.isEmpty()) u.put("price", priceStr);
                    u.put("at", System.currentTimeMillis());
                    updates.put(u);
                }
            }
            while (updates.length() > 200) updates.remove(0);
            sp.edit().putString("items", items.toString()).putString("updates", updates.toString()).apply();
            mark(sp, "판매처 " + checked + "곳 확인 · 알림 " + sent + "개");
        } catch (Exception e) {
            mark(sp, "확인 실패: " + e.getClass().getSimpleName());
            return Result.retry();
        }
        return Result.success();
    }

    static void mark(SharedPreferences sp, String msg) {
        sp.edit().putLong("lastAt", System.currentTimeMillis()).putString("lastMsg", msg).apply();
    }

    boolean notify(Context ctx, String id, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("openItem", id);
        int nid = 8000 + Math.abs((id + title).hashCode() % 900);
        PendingIntent pi = PendingIntent.getActivity(ctx, nid, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationManagerCompat.from(ctx).notify(nid, new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_archive).setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setColor(0xFF1F2A44)
            .setContentIntent(pi).setAutoCancel(true).build());
        return true;
    }

    // ---------- 페이지 읽기 (앱의 JS 읽기와 같은 규칙) ----------
    static class Read { Map<String, String> stock = new LinkedHashMap<>(); Double price; String currency = ""; }

    static String get(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(20000);
        h.setRequestProperty("User-Agent", UA);
        h.setRequestProperty("Accept-Language", "ko-KR,ko;q=0.9,ja;q=0.7,en;q=0.6");
        try {
            if (h.getResponseCode() >= 400) throw new Exception("HTTP " + h.getResponseCode());
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"))) {
                char[] buf = new char[8192]; int n; while ((n = r.read(buf)) > 0 && sb.length() < 3_000_000) sb.append(buf, 0, n);
            }
            return sb.toString();
        } finally { h.disconnect(); }
    }

    static final Pattern SZ = Pattern.compile("(?:^|[\\s/·\\-_(])((?:XX?S|XX?L|XXXL|[SML]|FREE|F|ONE ?SIZE|\\d{2,3}(?:\\.\\d)?|\\d{1,2}(?:\\.5)?))(?=$|[\\s/·\\-_)])");
    static String sizeKey(String s) {
        s = s == null ? "" : s.replaceAll("\\s+", " ").trim().toUpperCase(Locale.ROOT).replaceAll("(\\d{1,2})\\s*1/2", "$1.5");
        Matcher m = SZ.matcher(s); return m.find() ? m.group(1) : s;
    }
    static String avail(String v) {
        v = v == null ? "" : v.toLowerCase(Locale.ROOT);
        if (v.matches(".*(instock|in_stock|limitedavailability|presale|preorder).*")) return "in";
        if (v.matches(".*(outofstock|out_of_stock|soldout|discontinued).*")) return "out";
        return "unk";
    }

    static String cn(String c) { return c == null ? "" : c.replaceAll("\\s+", " ").trim().toUpperCase(Locale.ROOT); }
    /** 고른 색상과 맞는지 (색 정보가 없으면 통과) */
    static boolean colorOk(String want, String cand) {
        if (want == null || want.isEmpty() || cand == null || cand.trim().isEmpty()) return true;
        String w = cn(want), c = cn(cand); return c.equals(w) || c.contains(w) || w.contains(c);
    }
    static Read read(String url, String color) throws Exception {
        Read r = read0(url, color);
        if (r.stock.isEmpty() && color != null && !color.isEmpty()) r = read0(url, ""); // 그 색을 못 찾으면 전체로
        return r;
    }
    static Read read(String url) throws Exception { return read0(url, ""); }
    static Read read0(String url, String color) throws Exception {
        String html = get(url);
        Read r = new Read();
        Map<String, String> ldStock = new LinkedHashMap<>();
        // JSON-LD
        Matcher m = Pattern.compile("<script[^>]*application/ld\\+json[^>]*>([\\s\\S]*?)</script>", Pattern.CASE_INSENSITIVE).matcher(html);
        while (m.find()) {
            try {
                Object j = new org.json.JSONTokener(m.group(1).trim()).nextValue();
                List<JSONObject> prods = new ArrayList<>(); collect(j, prods);
                for (JSONObject p : prods) {
                    List<JSONObject> offers = new ArrayList<>(); addOffers(p.opt("offers"), null, offers);
                    JSONArray vars = p.optJSONArray("hasVariant");
                    if (vars != null) for (int i = 0; i < vars.length(); i++) { JSONObject v = vars.optJSONObject(i); if (v != null && colorOk(color, v.optString("color", ""))) addOffers(v.opt("offers"), v, offers); }
                    for (JSONObject o : offers) {
                        if (r.price == null && (o.has("price") || o.has("lowPrice"))) {
                            String pr = o.has("price") ? o.optString("price") : o.optString("lowPrice");
                            try { r.price = Double.parseDouble(pr.replaceAll("[^\\d.]", "")); } catch (Exception ignored) {}
                            r.currency = o.optString("priceCurrency", r.currency);
                        }
                        String nm = o.optString("size", o.optString("name", o.optString("sku", "")));
                        if (!nm.isEmpty() && o.has("availability")) {
                            String k = sizeKey(nm), v = avail(o.optString("availability"));
                            ldStock.put(k, "in".equals(ldStock.get(k)) ? "in" : v);
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        if (r.price == null) {
            Matcher pm = Pattern.compile("property=[\"'](?:product|og):price:amount[\"'][^>]*content=[\"']([\\d.,]+)").matcher(html);
            if (pm.find()) try { r.price = Double.parseDouble(pm.group(1).replace(",", "")); } catch (Exception ignored) {}
            Matcher cm = Pattern.compile("property=[\"'](?:product|og):price:currency[\"'][^>]*content=[\"']([A-Z]{3})").matcher(html);
            if (cm.find() && r.currency.isEmpty()) r.currency = cm.group(1);
        }
        if (ldStock.size() > 1) r.stock = ldStock;
        // 카페24
        if (r.stock.isEmpty()) {
            Matcher c = Pattern.compile("option_stock_data\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'").matcher(html);
            if (c.find()) try {
                JSONObject j = new JSONObject(unescapeJs(c.group(1)));
                Iterator<String> keys = j.keys();
                while (keys.hasNext()) {
                    JSONObject o = j.getJSONObject(keys.next());
                    Object ovo = o.opt("option_value_orginal");
                    String val = ovo instanceof JSONArray ? ((JSONArray) ovo).optString(0, "") : o.optString("option_value", o.optString("option_name", ""));
                    if (val.isEmpty()) continue;
                    String[] parts = val.split("\\s*[-/,]\\s*"); String k = sizeKey(parts[parts.length - 1]);
                    if (parts.length > 1) { StringBuilder col = new StringBuilder(); for (int pi = 0; pi < parts.length - 1; pi++) col.append(pi > 0 ? " " : "").append(parts[pi].trim()); if (!colorOk(color, col.toString())) continue; }
                    boolean selling = !"F".equals(o.optString("is_selling", "T")) && !"F".equals(o.optString("is_display", "T"));
                    Object us = o.opt("use_stock"); boolean useSt = Boolean.TRUE.equals(us) || "T".equals(String.valueOf(us));
                    boolean noAuto = "F".equals(o.optString("is_auto_soldout")) || "F".equals(o.optString("use_soldout"));
                    boolean unknownN = o.isNull("stock_number") || !o.has("stock_number") || "".equals(o.optString("stock_number"));
                    double n = o.optDouble("stock_number", 0);
                    String v = !selling ? "out" : (!useSt || noAuto || unknownN) ? "in" : (n > 0 ? "in" : "out");
                    r.stock.put(k, "in".equals(r.stock.get(k)) ? "in" : v);
                }
            } catch (Exception ignored) {}
        }
        // Shopify
        if (r.stock.isEmpty() && Pattern.compile("cdn\\.shopify\\.com|Shopify\\.theme|shopify-section").matcher(html).find()) {
            Matcher pm = Pattern.compile("/products/[^/?#]+").matcher(new URL(url).getPath());
            if (pm.find()) try {
                URL u = new URL(url);
                JSONObject j = new JSONObject(get(u.getProtocol() + "://" + u.getHost() + pm.group() + ".js"));
                Matcher cur = Pattern.compile("Shopify\\.currency\\s*=\\s*\\{[^}]*\"active\"\\s*:\\s*\"([A-Z]{3})\"").matcher(html);
                if (cur.find()) r.currency = cur.group(1);
                double dec = ("JPY".equals(r.currency) || "KRW".equals(r.currency)) ? 1 : 100;
                if (j.has("price")) r.price = j.optDouble("price") / dec;
                JSONArray vs = j.optJSONArray("variants");
                if (vs != null) for (int i = 0; i < vs.length(); i++) {
                    JSONObject v = vs.getJSONObject(i); String sz = null;
                    for (String f : new String[]{"option1", "option2", "option3"}) { String o = v.optString(f, ""); if (o.trim().toUpperCase(Locale.ROOT).matches("XX?S|XX?L|XXXL|[SML]|FREE|F|\\d{1,3}(\\.\\d)?|US ?\\d+(\\.5)?")) { sz = o; break; } }
                    if (sz == null) sz = v.optString("option3", v.optString("option2", v.optString("option1", v.optString("title"))));
                    StringBuilder col = new StringBuilder(); for (String f : new String[]{"option1", "option2", "option3"}) { String o = v.optString(f, ""); if (!o.isEmpty() && !o.equals(sz)) col.append(col.length() > 0 ? " / " : "").append(o); }
                    if (!colorOk(color, col.toString())) continue;
                    String k = sizeKey(sz); r.stock.put(k, "in".equals(r.stock.get(k)) ? "in" : (v.optBoolean("available") ? "in" : "out"));
                }
            } catch (Exception ignored) {}
        }
        if (r.stock.size() < 2 && ldStock.size() == 1) r.stock = ldStock;
        if (r.stock.isEmpty()) {
            // 상품 페이지에 보이는 사이즈 옵션 '(품절)' 표시 (식스샵 등) — 앱의 optionStock과 같은 규칙
            Matcher om = Pattern.compile("<(option|li|button|label|span|a|div|p)\\b([^>]*)>\\s*((?:XX?S|XX?L|XXXL|[SML]|FREE|F|ONE ?SIZE|\\d{2,3}(?:\\.5)?|\\d{1,2}(?:\\s*1/2|\\.5)?|US ?\\d{1,2}(?:\\s*1/2|\\.5)?))\\s*(?:[\\[(]\\s*(품절|일시 ?품절|sold ?out|out of stock)\\s*[\\])])?\\s*</\\1>", Pattern.CASE_INSENSITIVE).matcher(html.replaceAll("(?is)<table.*?</table>", ""));
            Map<String, String> os = new LinkedHashMap<>(); boolean anyOut = false;
            while (om.find()) {
                boolean out = om.group(4) != null || om.group(2).matches("(?is).*(disabled|soldout|sold-out|품절).*");
                String k = sizeKey(om.group(3)); anyOut |= out;
                os.put(k, "in".equals(os.get(k)) ? "in" : (out ? "out" : "in"));
            }
            if (os.size() >= 2 && anyOut) r.stock = os;
        }
        if (r.currency.isEmpty()) { String host = new URL(url).getHost(); r.currency = host.endsWith(".jp") ? "JPY" : (host.endsWith(".kr") ? "KRW" : ""); }
        return r;
    }

    static void collect(Object j, List<JSONObject> out) {
        if (j instanceof JSONArray) { JSONArray a = (JSONArray) j; for (int i = 0; i < a.length(); i++) collect(a.opt(i), out); return; }
        if (!(j instanceof JSONObject)) return;
        JSONObject o = (JSONObject) j;
        if (o.has("@graph")) collect(o.opt("@graph"), out);
        String t = o.optString("@type", "");
        if (t.contains("Product")) out.add(o);
    }
    static void addOffers(Object o, JSONObject variant, List<JSONObject> out) {
        if (o == null) return;
        if (o instanceof JSONArray) { JSONArray a = (JSONArray) o; for (int i = 0; i < a.length(); i++) addOffers(a.opt(i), variant, out); return; }
        if (!(o instanceof JSONObject)) return;
        JSONObject x = (JSONObject) o;
        try {
            if (variant != null) {
                x = new JSONObject(x.toString());
                if (!x.has("name") && variant.has("name")) x.put("name", variant.optString("name"));
                if (variant.has("size")) x.put("size", variant.optString("size"));
            }
        } catch (Exception ignored) {}
        out.add(x);
    }
    static String unescapeJs(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { b.append(c); continue; }
            char n = s.charAt(++i);
            switch (n) {
                case 'n': b.append('\n'); break; case 't': b.append('\t'); break; case 'r': b.append('\r'); break;
                case 'u': if (i + 4 < s.length()) { b.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); i += 4; } break;
                default: b.append(n);
            }
        }
        return b.toString();
    }
    static String fmtPrice(double p, String c) {
        String sym = "KRW".equals(c) ? "₩" : "JPY".equals(c) ? "¥" : "USD".equals(c) ? "$" : "EUR".equals(c) ? "€" : "GBP".equals(c) ? "£" : (c.isEmpty() ? "₩" : c + " ");
        if ("USD".equals(c) || "EUR".equals(c) || "GBP".equals(c)) {
            NumberFormat nf = NumberFormat.getNumberInstance(Locale.US); nf.setMinimumFractionDigits(p % 1 != 0 ? 2 : 0); nf.setMaximumFractionDigits(2);
            return sym + nf.format(p);
        }
        return sym + NumberFormat.getNumberInstance(Locale.KOREA).format(Math.round(p));
    }
    static long priceNum(String p) { String n = p == null ? "" : p.replaceAll("[^\\d]", ""); try { return n.isEmpty() ? 0 : Long.parseLong(n); } catch (Exception e) { return 0; } }
}
