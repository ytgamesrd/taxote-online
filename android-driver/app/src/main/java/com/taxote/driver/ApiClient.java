package com.taxote.driver;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ApiClient {
    private static final String BASE_URL = "https://taxote.online";
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(4);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static SharedPreferences preferences;
    private static final String COOKIE_KEY = "taxote_driver_session";

    public interface Callback {
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
    }

    public static void get(String path, Callback callback) {
        request("GET", path, null, callback);
    }

    public static void post(String path, JSONObject body, Callback callback) {
        request("POST", path, body, callback);
    }

    public static void clearSession() {
        if (preferences != null) preferences.edit().remove(COOKIE_KEY).apply();
    }

    public static boolean hasSession() {
        return preferences != null && !preferences.getString(COOKIE_KEY, "").isEmpty();
    }

    public static String sessionCookieHeader() {
        String cookie = preferences == null ? "" : preferences.getString(COOKIE_KEY, "");
        return cookie.isEmpty() ? "" : COOKIE_KEY + "=" + cookie;
    }

    public static String absoluteUrl(String path) {
        return path == null || path.isEmpty() ? "" : path.startsWith("http") ? path : BASE_URL + path;
    }

    private static void request(String method, String path, JSONObject payload, Callback callback) {
        EXECUTOR.execute(() -> {
            ApiResponse result;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(BASE_URL + path).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(45000);
                connection.setRequestProperty("Accept", "application/json");
                String cookie = sessionCookieHeader();
                if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);

                if (payload != null) {
                    byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }
                }

                int status = connection.getResponseCode();
                String setCookie = connection.getHeaderField("Set-Cookie");
                if (setCookie != null && preferences != null) {
                    // Search for taxote_driver_session cookie
                    String[] parts = setCookie.split(";");
                    for (String part : parts) {
                        String clean = part.trim();
                        if (clean.startsWith(COOKIE_KEY + "=")) {
                            String value = clean.substring(COOKIE_KEY.length() + 1);
                            if (value.isEmpty() || value.equals("deleted")) clearSession();
                            else preferences.edit().putString(COOKIE_KEY, value).apply();
                            break;
                        }
                    }
                }
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String text = read(stream);
                JSONObject json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                result = new ApiResponse(status, json, null);
            } catch (Exception error) {
                result = new ApiResponse(0, null, "No se pudo conectar con el servidor de TAXOTE. Verifica tu conexión a internet.");
            } finally {
                if (connection != null) connection.disconnect();
            }
            ApiResponse finalResult = result;
            MAIN.post(() -> callback.onComplete(finalResult));
        });
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder content = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) content.append(line);
        }
        return content.toString();
    }
}
