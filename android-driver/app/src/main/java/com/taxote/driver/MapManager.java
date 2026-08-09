package com.taxote.driver;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public class MapManager {
    private final WebView webView;
    private final TextView statusView;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler();
    
    private boolean mapReady = false;
    private boolean locationCentered = false;
    private int routeRequestSerial = 0;
    private JSONObject currentRide = null;
    private boolean isOffer = false;

    public interface MapListener {
        void onMapReady();
    }

    private MapListener listener;

    public MapManager(WebView webView, TextView statusView, SharedPreferences preferences) {
        this.webView = webView;
        this.statusView = statusView;
        this.preferences = preferences;
        configureWebView();
    }

    public void setListener(MapListener listener) {
        this.listener = listener;
    }

    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                mapReady = true;
                if (listener != null) listener.onMapReady();
                if (currentRide != null) renderRide(currentRide, isOffer);
            }
        });
        
        webView.loadUrl("file:///android_asset/driver_map.html");
    }

    public void updateLocation() {
        if (!mapReady || preferences == null) return;

        long updatedAt = preferences.getLong("last_location_at", 0);
        if (updatedAt <= 0) return;

        double lat = Double.longBitsToDouble(preferences.getLong("last_lat_bits", Double.doubleToRawLongBits(Double.NaN)));
        double lon = Double.longBitsToDouble(preferences.getLong("last_lon_bits", Double.doubleToRawLongBits(Double.NaN)));

        if (!Double.isFinite(lat) || !Double.isFinite(lon)) return;

        float bearing = preferences.getFloat("last_bearing", 0f);
        boolean busy = currentRide != null && !isOffer;
        
        // Auto-center logic
        boolean center = currentRide == null ? !locationCentered : true;
        if (center) locationCentered = true;

        String script = String.format("window.updateDriverLocation(%f, %f, %f, '%s', %b)", 
                lat, lon, bearing, (busy ? "busy" : "available"), center);
        
        webView.post(() -> webView.evaluateJavascript(script, null));
        
        if (statusView != null) {
            statusView.setText("● Ubicación en tiempo real");
        }
        
        if (currentRide != null && !isOffer) {
            renderRide(currentRide, false);
        }
    }

    public void renderRide(JSONObject ride, boolean isOffer) {
        this.currentRide = ride;
        this.isOffer = isOffer;
        
        if (!mapReady || ride == null) return;
        
        final int requestSerial = ++routeRequestSerial;
        JSONObject pickup = ride.optJSONObject("pickup");
        JSONObject destination = ride.optJSONObject("destination");
        JSONArray stops = ride.optJSONArray("stops");
        
        if (pickup == null || destination == null) return;

        StringBuilder coordinates = new StringBuilder();
        String status = ride.optString("status", "pending");

        // Add current location if active
        Double currentLat = null;
        Double currentLon = null;
        if (preferences != null) {
            double lat = Double.longBitsToDouble(preferences.getLong("last_lat_bits", Double.doubleToRawLongBits(Double.NaN)));
            double lon = Double.longBitsToDouble(preferences.getLong("last_lon_bits", Double.doubleToRawLongBits(Double.NaN)));
            if (Double.isFinite(lat) && Double.isFinite(lon)) {
                currentLat = lat;
                currentLon = lon;
            }
        }

        if (("accepted".equals(status) || "driver_arriving".equals(status) || "arrived".equals(status) || "in_progress".equals(status)) 
                && currentLat != null && currentLon != null) {
            coordinates.append(currentLon).append(',').append(currentLat).append(';');
        }

        coordinates.append(pickup.optDouble("lon")).append(',').append(pickup.optDouble("lat"));
        
        if (stops != null) {
            for (int i = 0; i < stops.length(); i++) {
                JSONObject stop = stops.optJSONObject(i);
                if (stop != null) coordinates.append(';').append(stop.optDouble("lon")).append(',').append(stop.optDouble("lat"));
            }
        }
        
        coordinates.append(';').append(destination.optDouble("lon")).append(',').append(destination.optDouble("lat"));

        String encodedCoordinates = Uri.encode(coordinates.toString());
        
        ApiClient.get("/api/route?coordinates=" + encodedCoordinates, response -> {
            if (requestSerial != routeRequestSerial || currentRide == null) return;
            
            StringBuilder routePoints = new StringBuilder("[");
            if (response.isSuccessful()) {
                JSONArray routes = response.body.optJSONArray("routes");
                JSONArray points = (routes == null || routes.length() == 0) ? null 
                        : routes.optJSONObject(0).optJSONObject("geometry").optJSONArray("coordinates");
                
                if (points != null) {
                    for (int i = 0; i < points.length(); i++) {
                        JSONArray point = points.optJSONArray(i);
                        if (point == null) continue;
                        if (routePoints.length() > 1) routePoints.append(',');
                        routePoints.append('[').append(point.optDouble(1)).append(',').append(point.optDouble(0)).append(']');
                    }
                }
            }
            routePoints.append(']');
            
            int guideIndex = resolveGuideWaypointIndex(ride);
            String script = String.format("window.showTaxoteRoute(%s, %s, %s, %s, %d);", 
                    pickup.toString(), (stops == null ? "[]" : stops.toString()), 
                    destination.toString(), routePoints.toString(), guideIndex);
            
            webView.post(() -> webView.evaluateJavascript(script, null));
        });
    }

    private int resolveGuideWaypointIndex(JSONObject ride) {
        if (ride == null) return 0;
        JSONArray stops = ride.optJSONArray("stops");
        int stopCount = stops == null ? 0 : stops.length();
        String status = ride.optString("status", "pending");
        
        if ("accepted".equals(status) || "driver_arriving".equals(status)) return 0;
        if ("arrived".equals(status) && stopCount > 0) return 1;
        return stopCount + 1; // Destination
    }

    public void clearRoute() {
        this.currentRide = null;
        if (mapReady) {
            webView.post(() -> webView.evaluateJavascript("window.clearTaxoteRoute()", null));
        }
    }
    
    public void resetLocationCentering() {
        this.locationCentered = false;
    }

    public void destroy() {
        webView.destroy();
    }
}
