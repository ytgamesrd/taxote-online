package com.taxote.driver;

import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class MapManager {
    private final WebView webView;
    private final TextView statusView;
    private final SharedPreferences preferences;
    
    private boolean mapReady = false;
    private boolean locationCentered = false;
    private int routeRequestSerial = 0;
    private JSONObject currentRide = null;
    private boolean isOffer = false;

    public interface MapListener {
        void onMapReady();
    }

    public interface MapActionListener {
        void onMapAction(String action);
    }

    private MapListener listener;
    private MapActionListener actionListener;

    public MapManager(WebView webView, TextView statusView, SharedPreferences preferences) {
        this.webView = webView;
        this.statusView = statusView;
        this.preferences = preferences;
        configureWebView();
    }

    public void setListener(MapListener listener) {
        this.listener = listener;
    }

    public void setActionListener(MapActionListener actionListener) {
        this.actionListener = actionListener;
    }

    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void onAction(String action) {
                if (actionListener != null) {
                    webView.post(() -> actionListener.onMapAction(action));
                }
            }
        }, "TaxoteAPI");

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
        boolean center = currentRide != null || !locationCentered;
        if (center) locationCentered = true;

        String script = String.format(Locale.US, "window.updateDriverLocation(%f, %f, %f, '%s', %b)", 
                lat, lon, bearing, (busy ? "busy" : "available"), center);
        
        webView.post(() -> webView.evaluateJavascript(script, null));
        
        if (statusView != null) {
            statusView.setText("● Ubicación en tiempo real");
        }
    }

    public void setStatus(String text) {
        if (statusView != null) statusView.setText(text);
    }

    public void triggerResize() {
        if (mapReady) {
            webView.post(() -> webView.evaluateJavascript("window.dispatchEvent(new Event('resize'))", null));
        }
    }

    public void renderRide(final JSONObject ride, final boolean isOffer) {
        this.currentRide = ride;
        this.isOffer = isOffer;
        
        if (!mapReady || ride == null) return;
        
        final int requestSerial = ++routeRequestSerial;
        final JSONObject pickup = ride.optJSONObject("pickup");
        final JSONObject destination = ride.optJSONObject("destination");
        final JSONArray stops = ride.optJSONArray("stops");
        
        if (pickup == null || destination == null) return;

        StringBuilder coordinates = new StringBuilder();
        String status = ride.optString("status", "pending");

        // Add current location if active
        Double latVal = null;
        Double lonVal = null;
        if (preferences != null) {
            double lat = Double.longBitsToDouble(preferences.getLong("last_lat_bits", Double.doubleToRawLongBits(Double.NaN)));
            double lon = Double.longBitsToDouble(preferences.getLong("last_lon_bits", Double.doubleToRawLongBits(Double.NaN)));
            if (Double.isFinite(lat) && Double.isFinite(lon)) {
                latVal = lat;
                lonVal = lon;
            }
        }

        if (isOffer) {
            // Offer mode: Show the WHOLE path A -> C -> B
            coordinates.append(pickup.optDouble("lon")).append(',').append(pickup.optDouble("lat"));
            if (stops != null) {
                for (int i = 0; i < stops.length(); i++) {
                    JSONObject stop = stops.optJSONObject(i);
                    if (stop != null) coordinates.append(';').append(stop.optDouble("lon")).append(',').append(stop.optDouble("lat"));
                }
            }
            coordinates.append(';').append(destination.optDouble("lon")).append(',').append(destination.optDouble("lat"));
        } else {
            // Navigation mode: From current location to NEXT point only
            if (latVal != null && lonVal != null) {
                coordinates.append(lonVal).append(',').append(latVal).append(';');
            }

            int guideIndex = resolveGuideWaypointIndex(ride);
            if (guideIndex == 0) {
                // Guide only to Pickup (A)
                coordinates.append(pickup.optDouble("lon")).append(',').append(pickup.optDouble("lat"));
            } else if (stops != null && guideIndex <= stops.length()) {
                // Guide to current stop (C)
                JSONObject targetStop = stops.optJSONObject(guideIndex - 1);
                if (targetStop != null) coordinates.append(targetStop.optDouble("lon")).append(',').append(targetStop.optDouble("lat"));
            } else {
                // Guide to Destination (B)
                coordinates.append(destination.optDouble("lon")).append(',').append(destination.optDouble("lat"));
            }
        }

        String encodedCoordinates = Uri.encode(coordinates.toString());
        
        final Double finalLat = latVal;
        final Double finalLon = lonVal;

        // DATOS PARA RENDER INICIAL (MARCADORES A, B, C AL INSTANTE)
        String actionLabel = "LLEGUÉ";
        int guideIndex = resolveGuideWaypointIndex(ride);
        if (guideIndex == 0) actionLabel = "LLEGUÉ";
        else if (guideIndex > 0 && (stops == null || guideIndex <= stops.length())) actionLabel = "LLEGUÉ";
        else if ("arrived".equals(status)) actionLabel = "Iniciar Viaje";
        else if ("in_progress".equals(status)) actionLabel = "Terminar";

        String note = ride.optString("note", "");
        String payment = ride.optString("paymentMethod", "Efectivo");
        int passengers = ride.optInt("passengerCount", 1);
        String passengerName = ride.optString("passengerName", "Pasajero");
        String scheduledAt = ride.optString("createdAt", ""); 
        if (ride.has("scheduledAt") && !ride.isNull("scheduledAt")) {
            scheduledAt = ride.optString("scheduledAt");
        }

        final String initialScript = String.format(Locale.US, 
            "window.showTaxoteRoute(%s, %s, %s, [], %d, '%s', %d, %d, %.1f, %d, '%s', '%s', '%s', '%s');",
            pickup.toString(), (stops == null ? "[]" : stops.toString()), 
            destination.toString(), guideIndex, actionLabel,
            ride.optInt("priceDop"), ride.optInt("durationMin"), ride.optDouble("distanceKm"),
            passengers, payment, note.replace("'", "\\'"),
            passengerName.replace("'", "\\'"), scheduledAt);
        
        webView.post(() -> webView.evaluateJavascript(initialScript, null));

        // PEDIR RUTA A OSRM PARA DIBUJAR LA LÍNEA AZUL
        ApiClient.get("/api/route?coordinates=" + encodedCoordinates, response -> {
            if (requestSerial != routeRequestSerial || currentRide == null) return;
            
            StringBuilder routePoints = new StringBuilder("[");
            if (response.isSuccessful() && response.body != null) {
                JSONArray routes = response.body.optJSONArray("routes");
                if (routes != null && routes.length() > 0) {
                    JSONObject routeObj = routes.optJSONObject(0);
                    if (routeObj != null) {
                        JSONObject geometry = routeObj.optJSONObject("geometry");
                        if (geometry != null) {
                            JSONArray points = geometry.optJSONArray("coordinates");
                            if (points != null) {
                                for (int i = 0; i < points.length(); i++) {
                                    JSONArray point = points.optJSONArray(i);
                                    if (point == null) continue;
                                    if (routePoints.length() > 1) routePoints.append(',');
                                    routePoints.append('[').append(point.optDouble(1)).append(',').append(point.optDouble(0)).append(']');
                                }
                            }
                        }
                    }
                }
            }
            routePoints.append(']');
            
            // Extract trip summary for the new UI
            double displayKm = ride.optDouble("distanceKm", 0.0);
            int displayMin = ride.optInt("durationMin", 0);
            
            // If we are in guidance mode (accepted, arrived, etc.), calculate relative to next waypoint
            if (guideIndex >= 0 && finalLat != null && finalLon != null) {
                JSONObject target = null;
                if (guideIndex == 0) target = pickup;
                else if (stops != null && guideIndex <= stops.length()) target = stops.optJSONObject(guideIndex - 1);
                else target = destination;
                
                if (target != null) {
                    double targetLat = target.optDouble("lat");
                    double targetLon = target.optDouble("lon");
                    double dist = haversine(finalLat, finalLon, targetLat, targetLon);
                    displayKm = dist;
                    displayMin = Math.max(1, (int)(dist / 25.0 * 60.0)); // Estimate 25km/h avg
                }
            }
            
            // Calculate ETA
            java.util.Calendar eta = java.util.Calendar.getInstance();
            eta.add(java.util.Calendar.MINUTE, displayMin);
            String etaStr = new java.text.SimpleDateFormat("HH:mm", Locale.US).format(eta.getTime());
            
            String targetAddress = "Destino";
            if (guideIndex == 0) targetAddress = pickup.optString("address", "Punto A");
            else if (guideIndex > 0 && stops != null && guideIndex <= stops.length()) targetAddress = "Parada C" + guideIndex;
            else targetAddress = destination.optString("address", "Punto B");

            String script = String.format(Locale.US, 
                "window.updateRouteLine(%s); " +
                "document.getElementById('tripTime').innerHTML = '%d<span>min</span>'; " +
                "document.getElementById('tripStats').textContent = '%.1f km • %s'; " +
                "document.getElementById('navStreet').textContent = '%s';", 
                routePoints.toString(),
                displayMin, displayKm, etaStr, targetAddress);
            
            webView.post(() -> webView.evaluateJavascript(script, null));
        });
    }

    private int resolveGuideWaypointIndex(JSONObject ride) {
        if (ride == null) return 0;
        JSONArray stops = ride.optJSONArray("stops");
        int stopCount = stops == null ? 0 : stops.length();
        String status = ride.optString("status", "pending");
        
        // 0: Pickup (A), 1..stopCount: Stops (C), stopCount+1: Destination (B)
        if ("pending".equals(status)) return -1; // Special value for offers to show all points
        if ("accepted".equals(status) || "driver_arriving".equals(status)) return 0; // Guide to Pickup
        if ("arrived".equals(status)) return (stopCount > 0) ? 1 : stopCount + 1; // Guide to first stop or B
        if ("in_progress".equals(status)) return stopCount + 1; // Simplify to B for now
        
        return 0;
    }

    private double haversine(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371; // Earth radius in km
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                   Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                   Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    public void clearRoute() {
        this.currentRide = null;
        if (mapReady) {
            webView.post(() -> webView.evaluateJavascript("window.clearTaxoteRoute()", null));
        }
    }

    public void showQueuedRide(JSONObject ride) {
        if (!mapReady || ride == null) return;
        String script = "window.showQueuedRide(" + ride.toString() + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    public void hideQueuedRide() {
        if (!mapReady) return;
        webView.post(() -> webView.evaluateJavascript("window.hideQueuedRide()", null));
    }
    
    public void resetLocationCentering() {
        this.locationCentered = false;
    }

    public void destroy() {
        webView.destroy();
    }
}
