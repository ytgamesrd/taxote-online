package com.taxote.driver;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class ApiClient {
    public static final String BASE_URL = "https://taxote.online";
    private static OkHttpClient client;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static SharedPreferences preferences;

    public interface ApiCallback {
        void onComplete(ApiResponse response);
    }

    public static final class ApiResponse {
        public final int status;
        public final JSONObject body;
        public final String error;

        ApiResponse(int status, JSONObject body, String error) {
            this.status = status;
            this.body = body;
            this.error = error;
        }

        public boolean isSuccessful() {
            return status >= 200 && status < 300;
        }

        public String message() {
            if (body != null) {
                String serverMessage = body.optString("error", body.optString("message", ""));
                if (!serverMessage.isEmpty()) return serverMessage;
            }
            return error == null ? "No se pudo procesar la solicitud." : error;
        }
    }

    private ApiClient() {}

    public static void initialize(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences("taxote_driver", Context.MODE_PRIVATE);
        client = new OkHttpClient.Builder()
                .cookieJar(new PersistentCookieJar(preferences))
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build();
    }

    public static void get(String path, ApiCallback callback) {
        request("GET", path, null, callback);
    }

    public static void post(String path, JSONObject body, ApiCallback callback) {
        request("POST", path, body, callback);
    }

    public static void clearSession() {
        if (preferences != null) {
            preferences.edit().remove("persistent_cookies").apply();
        }
        // Also recreate client to clear memory cache of cookies if needed
    }

    public static boolean hasSession() {
        if (preferences == null) return false;
        Set<String> cookies = preferences.getStringSet("persistent_cookies", null);
        if (cookies == null) return false;
        for (String c : cookies) {
            if (c.contains("taxote_driver_session")) return true;
        }
        return false;
    }

    public static String absoluteUrl(String path) {
        if (path == null || path.isEmpty()) return "";
        if (path.startsWith("http")) return path;
        return BASE_URL + (path.startsWith("/") ? "" : "/") + path;
    }

    private static void request(String method, String path, JSONObject payload, ApiCallback callback) {
        if (client == null) {
            MAIN.post(() -> callback.onComplete(new ApiResponse(0, null, "ApiClient no inicializado.")));
            return;
        }

        Request.Builder builder = new Request.Builder()
                .url(absoluteUrl(path))
                .addHeader("Accept", "application/json");

        if (payload != null) {
            RequestBody body = RequestBody.create(payload.toString(), MediaType.get("application/json; charset=utf-8"));
            builder.method(method, body);
        } else if (method.equals("POST")) {
            builder.post(RequestBody.create("", null));
        } else {
            builder.method(method, null);
        }

        client.newCall(builder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                MAIN.post(() -> callback.onComplete(new ApiResponse(0, null, "Error de conexión con TAXOTE.")));
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                int status = response.code();
                String text = response.body() != null ? response.body().string() : "";
                JSONObject json = null;
                try {
                    json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                } catch (Exception ignored) {}
                
                final JSONObject finalJson = json;
                MAIN.post(() -> callback.onComplete(new ApiResponse(status, finalJson, null)));
            }
        });
    }

    private static class PersistentCookieJar implements CookieJar {
        private final SharedPreferences prefs;

        PersistentCookieJar(SharedPreferences prefs) {
            this.prefs = prefs;
        }

        @Override
        public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
            if (cookies.isEmpty()) return;
            Set<String> saved = new HashSet<>(prefs.getStringSet("persistent_cookies", new HashSet<>()));
            for (Cookie cookie : cookies) {
                // Remove existing version of this cookie (by name and domain)
                saved.removeIf(s -> {
                    Cookie existing = Cookie.parse(url, s);
                    return existing != null && existing.name().equals(cookie.name());
                });
                if (!cookie.value().equals("deleted") && !cookie.value().isEmpty()) {
                    saved.add(cookie.toString());
                }
            }
            prefs.edit().putStringSet("persistent_cookies", saved).apply();
        }

        @Override
        public List<Cookie> loadForRequest(HttpUrl url) {
            Set<String> saved = prefs.getStringSet("persistent_cookies", null);
            if (saved == null || saved.isEmpty()) return Collections.emptyList();
            List<Cookie> cookies = new ArrayList<>();
            long now = System.currentTimeMillis();
            boolean changed = false;
            Set<String> toKeep = new HashSet<>();
            
            for (String s : saved) {
                Cookie cookie = Cookie.parse(url, s);
                if (cookie != null) {
                    if (cookie.expiresAt() > now) {
                        cookies.add(cookie);
                        toKeep.add(s);
                    } else {
                        changed = true;
                    }
                }
            }
            if (changed) {
                prefs.edit().putStringSet("persistent_cookies", toKeep).apply();
            }
            return cookies;
        }
    }
}
