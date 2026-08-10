package com.taxote.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

public class LocationService extends Service implements LocationListener {
    public static final String ACTION_STOP = "com.taxote.driver.STOP_LOCATION";
    public static final String ACTION_LOCATION_UPDATED = "com.taxote.driver.LOCATION_UPDATED";
    public static final String EXTRA_LAT = "extra_lat";
    public static final String EXTRA_LON = "extra_lon";
    public static final String EXTRA_BEARING = "extra_bearing";
    public static final String EXTRA_STATE = "extra_state";
    private static final String CHANNEL_ID = "taxote_driver_location";
    private static final String CHAT_CHANNEL_ID = "taxote_driver_chat";
    private static final int NOTIFICATION_ID = 2407;
    private static final int CHAT_NOTIFICATION_ID = 2408;
    private static final long LOCATION_INTERVAL_MS = 4000L;
    private static final long HEARTBEAT_INTERVAL_MS = 15000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private SharedPreferences preferences;
    private Location lastLocation;
    private long lastPostedAt;
    private int lastUnreadCount = -1;

    private final Runnable locationHeartbeat = new Runnable() {
        @Override public void run() {
            if (lastLocation != null) postLocation(lastLocation, true);
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
        }
    };

    private final Runnable chatHeartbeat = new Runnable() {
        @Override public void run() {
            ApiClient.get("/api/driver/chat/unread", response -> {
                if (response.isSuccessful()) {
                    int unread = response.body.optInt("unreadCount");
                    if (lastUnreadCount >= 0 && unread > lastUnreadCount) playChatAlert(LocationService.this, "La Central o un cliente te escribió");
                    lastUnreadCount = unread;
                }
            });
            handler.postDelayed(this, 5000L);
        }
    };

    public static void start(Context context) {
        Intent intent = new Intent(context, LocationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, LocationService.class).setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override public void onCreate() {
        super.onCreate();
        ApiClient.initialize(this);
        preferences = getSharedPreferences("taxote_driver", MODE_PRIVATE);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        startLocationUpdates();
        handler.removeCallbacks(locationHeartbeat);
        handler.postDelayed(locationHeartbeat, HEARTBEAT_INTERVAL_MS);
        handler.removeCallbacks(chatHeartbeat);
        handler.post(chatHeartbeat);
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Ubicación TAXOTE Driver", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantiene tu ubicación conectada con la Central TAXOTE durante el servicio.");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
        NotificationChannel chat = new NotificationChannel(CHAT_CHANNEL_ID, "Mensajes TAXOTE", NotificationManager.IMPORTANCE_HIGH);
        chat.setDescription("Avisos de nuevos mensajes de la Central y de clientes.");
        manager.createNotificationChannel(chat);
    }

    private Notification buildNotification() {
        Intent openApp = new Intent(this, DashboardActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(R.drawable.app_icon)
            .setContentTitle("TAXOTE Driver conectado")
            .setContentText("Compartiendo tu ubicación con la Central TAXOTE")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    public static void playChatAlert(Context context, String message) {
        Context appContext = context.getApplicationContext();
        ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 86);
        tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 3000);
        new Handler(Looper.getMainLooper()).postDelayed(tone::release, 3100L);
        Intent openApp = new Intent(appContext, DashboardActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(appContext, 11, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(appContext, CHAT_CHANNEL_ID)
            : new Notification.Builder(appContext);
        Notification notification = builder
            .setSmallIcon(R.drawable.app_icon)
            .setContentTitle("Nuevo mensaje TAXOTE")
            .setContentText(message)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .build();
        ((NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE)).notify(CHAT_NOTIFICATION_ID, notification);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocationUpdates() {
        if (!hasLocationPermission() || locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, LOCATION_INTERVAL_MS, 3f, this, Looper.getMainLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, LOCATION_INTERVAL_MS, 5f, this, Looper.getMainLooper());
            }
            Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location network = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            Location newest = gps == null ? network : network == null || gps.getTime() >= network.getTime() ? gps : network;
            if (newest != null) onLocationChanged(newest);
        } catch (SecurityException ignored) {
            stopSelf();
        }
    }

    @Override public void onLocationChanged(Location location) {
        if (location == null) return;
        if (lastLocation == null || location.getAccuracy() <= lastLocation.getAccuracy() + 40 || location.getTime() > lastLocation.getTime() + 15000) {
            lastLocation = location;
        }
        saveLocation(lastLocation);
        postLocation(lastLocation, false);
    }

    private void saveLocation(Location location) {
        preferences.edit()
            .putLong("last_lat_bits", Double.doubleToRawLongBits(location.getLatitude()))
            .putLong("last_lon_bits", Double.doubleToRawLongBits(location.getLongitude()))
            .putFloat("last_bearing", location.hasBearing() ? location.getBearing() : 0f)
            .putLong("last_location_at", System.currentTimeMillis())
            .apply();
        Intent updateIntent = new Intent(ACTION_LOCATION_UPDATED);
        updateIntent.putExtra(EXTRA_LAT, location.getLatitude());
        updateIntent.putExtra(EXTRA_LON, location.getLongitude());
        updateIntent.putExtra(EXTRA_BEARING, location.hasBearing() ? location.getBearing() : 0f);
        updateIntent.putExtra(EXTRA_STATE, "busy");
        sendBroadcast(updateIntent);
    }

    private void postLocation(Location location, boolean heartbeat) {
        long now = System.currentTimeMillis();
        if (!heartbeat && now - lastPostedAt < LOCATION_INTERVAL_MS) return;
        lastPostedAt = now;
        JSONObject body = new JSONObject();
        try {
            body.put("lat", location.getLatitude());
            body.put("lon", location.getLongitude());
            body.put("accuracyM", location.hasAccuracy() ? location.getAccuracy() : 0);
            body.put("bearing", location.hasBearing() ? location.getBearing() : 0);
            body.put("speedKph", location.hasSpeed() ? Math.max(0, location.getSpeed() * 3.6) : 0);
        } catch (Exception ignored) {}
        ApiClient.post("/api/driver/location", body, response -> {
            if (response.status == 401 || response.status == 403) stopSelf();
        });
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (locationManager != null) {
            try { locationManager.removeUpdates(this); } catch (SecurityException ignored) {}
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
