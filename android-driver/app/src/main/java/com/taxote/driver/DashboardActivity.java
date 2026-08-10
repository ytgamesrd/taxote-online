package com.taxote.driver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.Gravity;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Base64;
import android.util.Log;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class DashboardActivity extends Activity {
    private static final int LOCATION_PERMISSION_REQUEST = 501;
    private static final int CHAT_PHOTO_REQUEST = 502;
    private static final int REPORT_PHOTO_REQUEST = 504;
    private static final int VEHICLE_PLATE_PHOTO_REQUEST = 510;
    private static final int VEHICLE_FRONT_PHOTO_REQUEST = 511;
    private static final int VEHICLE_BACK_PHOTO_REQUEST = 512;
    private static final int VEHICLE_LEFT_PHOTO_REQUEST = 513;
    private static final int VEHICLE_RIGHT_PHOTO_REQUEST = 514;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private JSONObject driverProfile;
    private JSONObject displayedRide;
    private JSONObject queuedRide;
    private boolean displayedRideIsOffer;
    private boolean wasRideActive;
    private boolean menuOpen;
    private boolean returningToLogin;
    private MapManager mapManager;

    private View homePanel;
    private View profilePanel;
    private View walletPanel;
    private View depositPanel;
    private View historyPanel;
    private View chatPanel;
    private View reportPanel;
    private ImageView imgProofPreview;
    private View sideMenu;
    private View menuScrim;
    private View rideCard;
    private ScrollView detailsScroll;
    private EditText chatInput;
    private Button chatPrivateButton;
    private Button chatPublicButton;
    private Button chatRideButton;
    private Button chatPhotoButton;
    private Button chatSendButton;
    private TextView chatPhotoName;
    private String chatMode = "private";
    private String pendingChatPhoto;
    private String pendingDepositPhoto;
    private String pendingReportPhoto;
    private Spinner reportCategory;
    private EditText reportDescription;
    private TextView reportPhotoName;
    private int lastIncomingChatId;
    private int lastDriverEventId;
    private SharedPreferences preferences;
    private BroadcastReceiver locationReceiver;

    private final Runnable workPoll = new Runnable() {
        @Override public void run() {
            loadWork();
            handler.postDelayed(this, 3000);
        }
    };

    private final Runnable locationMapPoll = new Runnable() {
        @Override public void run() {
            if (mapManager != null) mapManager.updateLocation();
            handler.postDelayed(this, 1500);
        }
    };

    private final Runnable chatPoll = new Runnable() {
        @Override public void run() {
            if (chatPanel != null && chatPanel.getVisibility() == View.VISIBLE) loadChatMessages();
            handler.postDelayed(this, 3000);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(R.layout.activity_dashboard);
        ApiClient.initialize(this);
        preferences = getSharedPreferences("taxote_driver", MODE_PRIVATE);
        bindViews();
        mapManager = new MapManager(findViewById(R.id.rideMap), null, preferences);
        mapManager.setActionListener(action -> {
            if ("reject".equals(action)) confirmRejectRide();
            else if ("primary".equals(action)) confirmRideAction();
            else if ("queued_release".equals(action)) confirmReleaseQueuedRide();
        });
        findViewById(R.id.btnDepositPoints).setOnClickListener(v -> showSection(depositPanel));
        findViewById(R.id.btnCancelDeposit).setOnClickListener(v -> showSection(walletPanel));
        findViewById(R.id.btnPickProof).setOnClickListener(v -> pickDepositPhoto());
        findViewById(R.id.btnSubmitDeposit).setOnClickListener(v -> submitDeposit());
        configureMenu();
        configureDepositUI();
        locationReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (LocationService.ACTION_LOCATION_UPDATED.equals(intent.getAction())) {
                    if (mapManager != null) mapManager.updateLocation();
                }
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(locationReceiver,
                new IntentFilter(LocationService.ACTION_LOCATION_UPDATED),
                null,
                null,
                Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(locationReceiver, new IntentFilter(LocationService.ACTION_LOCATION_UPDATED));
        }
        loadProfile();
        syncFcmToken();
    }

    private void syncFcmToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                Log.w("Dashboard", "Fetching FCM registration token failed", task.getException());
                return;
            }
            String token = task.getResult();
            JSONObject body = new JSONObject();
            try { body.put("token", token); } catch (Exception ignored) {}
            ApiClient.post("/api/driver/fcm-token", body, response -> {
                if (response.isSuccessful()) Log.d("Dashboard", "FCM Token sincronizado");
            });
        });
    }

    private void bindViews() {
        homePanel = findViewById(R.id.homePanel);
        profilePanel = findViewById(R.id.profilePanel);
        walletPanel = findViewById(R.id.walletPanel);
        depositPanel = findViewById(R.id.depositPanel);
        historyPanel = findViewById(R.id.historyPanel);
        imgProofPreview = findViewById(R.id.imgProofPreview);
        chatPanel = findViewById(R.id.chatPanel);
        reportPanel = findViewById(R.id.reportPanel);
        sideMenu = findViewById(R.id.sideMenu);
        menuScrim = findViewById(R.id.menuScrim);
        rideCard = findViewById(R.id.rideCard);
        detailsScroll = findViewById(R.id.detailsScroll);
        chatInput = findViewById(R.id.chatInput);
        chatPrivateButton = findViewById(R.id.chatPrivateButton);
        chatPublicButton = findViewById(R.id.chatPublicButton);
        chatRideButton = findViewById(R.id.chatRideButton);
        chatRideButton.setEnabled(false);
        chatPhotoButton = findViewById(R.id.chatPhotoButton);
        chatPhotoName = findViewById(R.id.chatPhotoName);
        chatSendButton = findViewById(R.id.chatSendButton);
        reportCategory = findViewById(R.id.reportCategory);
        reportDescription = findViewById(R.id.reportDescription);
        reportPhotoName = findViewById(R.id.reportPhotoName);
        String[] reportCategories = new String[]{"Problema con la app", "Problema con el vehículo", "Problema con un servicio", "Problema con un pasajero", "Seguridad o emergencia", "Otro motivo"};
        ArrayAdapter<String> reportAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, reportCategories);
        reportAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        reportCategory.setAdapter(reportAdapter);
        chatInput.setOnFocusChangeListener((view, focused) -> {
            if (focused) handler.postDelayed(() -> detailsScroll.fullScroll(View.FOCUS_DOWN), 320);
        });
        chatInput.setOnClickListener(view -> handler.postDelayed(() -> detailsScroll.fullScroll(View.FOCUS_DOWN), 220));
        findViewById(R.id.saveProfileButton).setOnClickListener(view -> saveDriverProfile());
        findViewById(R.id.updateVehicleButton).setOnClickListener(view -> showVehicleUpdateDialog());
    }

    private void configureMenu() {
        findViewById(R.id.menuButton).setOnClickListener(view -> openMenu());
        findViewById(R.id.closeSectionButton).setOnClickListener(view -> showSection(homePanel));
        menuScrim.setOnClickListener(view -> closeMenu());
        findViewById(R.id.menuHome).setOnClickListener(view -> showSection(homePanel));
        findViewById(R.id.menuProfile).setOnClickListener(view -> showSection(profilePanel));
        findViewById(R.id.menuWallet).setOnClickListener(view -> {
            showSection(walletPanel);
            loadWallet();
        });
        findViewById(R.id.menuHistory).setOnClickListener(view -> {
            showSection(historyPanel);
            loadHistory();
        });
        findViewById(R.id.menuChat).setOnClickListener(view -> {
            showSection(chatPanel);
            selectChat("private");
        });
        findViewById(R.id.menuReport).setOnClickListener(view -> showSection(reportPanel));
        chatPrivateButton.setOnClickListener(view -> selectChat("private"));
        chatPublicButton.setOnClickListener(view -> selectChat("public"));
        chatRideButton.setOnClickListener(view -> selectChat("ride"));
        chatPhotoButton.setOnClickListener(view -> pickChatPhoto());
        chatSendButton.setOnClickListener(view -> sendChatMessage());
        findViewById(R.id.reportPhotoButton).setOnClickListener(view -> pickReportPhoto());
        findViewById(R.id.reportSubmitButton).setOnClickListener(view -> submitReport());
        findViewById(R.id.logoutButton).setOnClickListener(view -> confirmCloseApplication());
        findViewById(R.id.closeSessionButtonApp).setOnClickListener(view -> confirmLogout());
    }

    private void openMenu() {
        if (menuOpen) return;
        menuOpen = true;
        findViewById(R.id.menuButton).animate().rotation(90).scaleX(0.8f).scaleY(0.8f).setDuration(300).start();
        menuScrim.setVisibility(View.VISIBLE);
        menuScrim.setAlpha(0f);
        menuScrim.animate().alpha(1f).setDuration(300).start();
        sideMenu.setVisibility(View.VISIBLE);
        sideMenu.setTranslationX(-sideMenu.getWidth());
        if (sideMenu.getWidth() == 0) sideMenu.setTranslationX(-800f);
        sideMenu.animate().translationX(0).setDuration(300).start();
    }

    private void closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        findViewById(R.id.menuButton).animate().rotation(0).scaleX(1.0f).scaleY(1.0f).setDuration(300).start();
        menuScrim.animate().alpha(0f).setDuration(300).withEndAction(() -> menuScrim.setVisibility(View.GONE)).start();
        sideMenu.animate().translationX(-sideMenu.getWidth()).setDuration(300).withEndAction(() -> sideMenu.setVisibility(View.GONE)).start();
    }

    private void showSection(View selected) {
        boolean home = selected == homePanel;
        homePanel.setVisibility(home ? View.VISIBLE : View.GONE);
        detailsScroll.setVisibility(home ? View.GONE : View.VISIBLE);
        profilePanel.setVisibility(selected == profilePanel ? View.VISIBLE : View.GONE);
        walletPanel.setVisibility(selected == walletPanel ? View.VISIBLE : View.GONE);
        depositPanel.setVisibility(selected == depositPanel ? View.VISIBLE : View.GONE);
        historyPanel.setVisibility(selected == historyPanel ? View.VISIBLE : View.GONE);
        chatPanel.setVisibility(selected == chatPanel ? View.VISIBLE : View.GONE);
        reportPanel.setVisibility(selected == reportPanel ? View.VISIBLE : View.GONE);
        closeMenu();
        if (!home) detailsScroll.post(() -> detailsScroll.fullScroll(View.FOCUS_UP));
        else if (mapManager != null) mapManager.triggerResize();
    }

    private void loadProfile() {
        ApiClient.get("/api/driver/me", response -> {
            if (!response.isSuccessful()) {
                // Si el servidor dice explícitamente que la sesión no vale, o si el usuario no existe (404)
                if (response.status == 401 || response.status == 403 || response.status == 404) {
                    ApiClient.clearSession();
                    returnToLogin();
                    return;
                }
                
                // Si es un error de red (status 0) o error de servidor (500), avisamos pero no cerramos de golpe
                // a menos que no tengamos datos previos.
                if (driverProfile == null) {
                    showMessage("Error de conexión", "No se pudo conectar con TAXOTE. Revisa tu internet.");
                    returnToLogin();
                } else {
                    showMessage("Sesión en espera", "La Central no respondió correctamente. Se intentará reconectar.");
                }
                return;
            }
            driverProfile = response.body.optJSONObject("driver");
            if (driverProfile == null) return;
            String name = driverProfile.optString("name", "Conductor TAXOTE");
            String vehicle = (driverProfile.optString("vehicleBrand") + " " + driverProfile.optString("vehicleModel")).trim();
            String vehicleLine = vehicle + " · " + driverProfile.optString("vehicleColor") + " · " + driverProfile.optString("vehiclePlate");
            ((TextView) findViewById(R.id.menuDriverName)).setText(name);
            ((TextView) findViewById(R.id.profileName)).setText(name);
            ((TextView) findViewById(R.id.profileContact)).setText(driverProfile.optString("phone") + "\n" + driverProfile.optString("email"));
            ((TextView) findViewById(R.id.profileVehicle)).setText("Vehículo\n" + vehicleLine);
            ensureLocationTracking();
            handler.removeCallbacks(workPoll);
            handler.removeCallbacks(locationMapPoll);
            handler.removeCallbacks(chatPoll);
            handler.post(workPoll);
            handler.post(locationMapPoll);
            handler.post(chatPoll);
        });
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureLocationTracking() {
        if (hasLocationPermission()) {
            LocationService.start(this);
            if (mapManager != null) mapManager.setStatus("● Ubicación en tiempo real");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS}, LOCATION_PERMISSION_REQUEST);
        } else {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION_REQUEST);
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST) return;
        if (hasLocationPermission()) {
            LocationService.start(this);
            if (mapManager != null) mapManager.setStatus("● Ubicación en tiempo real");
        } else {
            if (mapManager != null) mapManager.setStatus("Ubicación desactivada");
            new AlertDialog.Builder(this)
                .setTitle("TAXOTE necesita tu ubicación")
                .setMessage("Permite la ubicación para recibir servicios.")
                .setPositiveButton("Abrir ajustes", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }).show();
        }
    }

    private void loadWork() {
        ApiClient.get("/api/driver/work", response -> {
            if (!response.isSuccessful()) return;
            JSONObject activeRide = response.body.optJSONObject("activeRide");
            JSONArray offers = response.body.optJSONArray("offers");
            
            // Si el viaje activo desaparece, no mostramos error de cancelación genérico
            // ya que pudo haber terminado con éxito. La confirmación de éxito la da handleRideResponse.
            
            wasRideActive = activeRide != null;
            if (activeRide != null) showRide(activeRide, false);
            else if (offers != null && offers.length() > 0) showRide(offers.optJSONObject(0), true);
            else hideRide();
            JSONArray queued = response.body.optJSONArray("queuedOffers");
            if (queued != null && queued.length() > 0) {
                queuedRide = queued.optJSONObject(0);
                if (mapManager != null) mapManager.showQueuedRide(queuedRide);
            } else {
                hideQueuedRide();
            }
        });
    }

    private void hideQueuedRide() {
        queuedRide = null;
        if (mapManager != null) mapManager.hideQueuedRide();
    }

    private void showRide(JSONObject ride, boolean offer) {
        if (ride == null) return;
        String oldId = displayedRide == null ? "" : displayedRide.optString("id");
        String oldStatus = displayedRide == null ? "" : displayedRide.optString("status");
        displayedRide = ride;
        displayedRideIsOffer = offer;
        chatRideButton.setEnabled(!offer);
        chatRideButton.setAlpha(!offer && "ride".equals(chatMode) ? 1f : .58f);
        rideCard.setVisibility(View.VISIBLE);
        String status = ride.optString("status", "pending");
        if (!oldId.equals(ride.optString("id")) || !oldStatus.equals(status)) mapManager.renderRide(ride, offer);
        mapManager.updateLocation();
    }

    private void playCancelSound() {
        try {
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP, 200);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                tg.startTone(ToneGenerator.TONE_PROP_BEEP, 200);
                tg.release();
            }, 300);
        } catch (Exception ignored) {}
    }

    private void hideRide() {
        displayedRide = null;
        displayedRideIsOffer = false;
        chatRideButton.setEnabled(false);
        if ("ride".equals(chatMode)) selectChat("private");
        rideCard.setVisibility(View.GONE);
        if (mapManager != null) {
            mapManager.clearRoute();
            mapManager.updateLocation();
        }
    }

    private void confirmRejectRide() {
        if (displayedRide == null) return;
        if (displayedRideIsOffer) {
            new AlertDialog.Builder(this)
                .setTitle("¿Rechazar este servicio?")
                .setNegativeButton("Volver", null)
                .setPositiveButton("Rechazar", (dialog, which) -> rejectRide())
                .show();
            return;
        }
        String status = displayedRide.optString("status");
        if (!("accepted".equals(status) || "driver_arriving".equals(status) || "arrived".equals(status))) {
            showMessage("No se puede cancelar", "El viaje ya comenzó.");
            return;
        }
        String[] reasons = {"Problema mecánico", "Emergencia", "No puedo llegar", "Pasajero no se presentó", "Otro motivo"};
        new AlertDialog.Builder(this)
            .setTitle("Motivo de cancelación")
            .setItems(reasons, (dialog, which) -> confirmActiveCancellation(reasons[which]))
            .setNegativeButton("Volver", null)
            .show();
    }

    private void confirmActiveCancellation(String reason) {
        new AlertDialog.Builder(this)
            .setTitle("¿Cancelar el servicio?")
            .setMessage("Motivo: " + reason)
            .setNegativeButton("Volver", null)
            .setPositiveButton("Sí, cancelar", (dialog, which) -> cancelActiveRide(reason))
            .show();
    }

    private void cancelActiveRide(String reason) {
        if (displayedRide == null) return;
        JSONObject body = new JSONObject();
        try { body.put("reason", reason); } catch (Exception ignored) {}
        ApiClient.post("/api/driver/rides/" + displayedRide.optString("id") + "/cancel", body, response -> {
            if (!response.isSuccessful()) {
                showMessage("No se pudo cancelar", response.message());
                loadWork();
                return;
            }
            hideRide();
            playCancelSound();
            loadHistory();
            loadWork();
        });
    }

    private void rejectRide() {
        if (displayedRide == null) return;
        ApiClient.post("/api/driver/rides/" + displayedRide.optString("id") + "/reject", new JSONObject(), response -> {
            if (!response.isSuccessful()) {
                showMessage("No se pudo rechazar", response.message());
                return;
            }
            hideRide();
            playCancelSound();
            loadWork();
        });
    }

    private void confirmReleaseQueuedRide() {
        new AlertDialog.Builder(this)
            .setTitle("Liberar servicio pendiente")
            .setMessage("¿Deseas que TAXOTE busque otro conductor?")
            .setNegativeButton("Volver", null)
            .setPositiveButton("Liberar", (dialog, which) -> releaseQueuedRide())
            .show();
    }

    private void releaseQueuedRide() {
        if (queuedRide == null) return;
        ApiClient.post("/api/driver/rides/" + queuedRide.optString("id") + "/release", new JSONObject(), response -> {
            if (!response.isSuccessful()) {
                showMessage("No se pudo liberar", response.message());
                return;
            }
            hideQueuedRide();
            playCancelSound();
            loadWork();
        });
    }

    private void confirmRideAction() {
        if (displayedRide == null) return;
        String title, message, positive;
        if (displayedRideIsOffer) {
            title = "¿Seguro que deseas aceptar el servicio?";
            message = "El servicio quedará asignado a tu cuenta.";
            positive = "Sí, aceptar";
        } else {
            String status = displayedRide.optString("status");
            if ("accepted".equals(status) || "driver_arriving".equals(status)) {
                title = "¿Llegaste al punto A?";
                message = "La Central mostrará que llegaste.";
                positive = "Sí, llegué";
            } else if ("arrived".equals(status)) {
                title = "¿El cliente ya abordó?";
                message = "El viaje comenzará ahora.";
                positive = "Iniciar viaje";
            } else {
                title = "¿Finalizar el servicio?";
                message = "Confirma que completaste el viaje.";
                positive = "Finalizar";
            }
        }
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton("Volver", null).setPositiveButton(positive, (dialog, which) -> executeRideAction()).show();
    }

    private void executeRideAction() {
        if (displayedRide == null) return;
        String id = displayedRide.optString("id");
        if (displayedRideIsOffer) {
            ApiClient.post("/api/driver/rides/" + id + "/accept", new JSONObject(), response -> handleRideResponse(response, false));
            return;
        }
        String status = displayedRide.optString("status");
        String action = ("accepted".equals(status) || "driver_arriving".equals(status)) ? "arrived" : "arrived".equals(status) ? "start" : "complete";
        JSONObject body = new JSONObject();
        try { body.put("action", action); } catch (Exception ignored) {}
        ApiClient.post("/api/driver/rides/" + id + "/status", body, response -> handleRideResponse(response, "complete".equals(action)));
    }

    private void handleRideResponse(ApiClient.ApiResponse response, boolean completed) {
        if (!response.isSuccessful()) {
            showMessage("No se pudo actualizar el servicio", response.message());
            loadWork();
            return;
        }
        JSONObject ride = response.body.optJSONObject("ride");
        if (completed) {
            String name = ride != null ? ride.optString("passengerName", "Pasajero") : "Cliente";
            int price = ride != null ? ride.optInt("priceDop", 0) : 0;
            String earnings = "RD$ " + Math.round(price * 0.8);
            
            new AlertDialog.Builder(this)
                .setTitle("¡Viaje Terminado!")
                .setMessage("Resumen del servicio:\n\n" +
                           "Cliente: " + name + "\n" +
                           "Ganancia: " + earnings + "\n" +
                           "Fecha: " + new SimpleDateFormat("dd/MM/yy HH:mm", Locale.getDefault()).format(new Date()))
                .setPositiveButton("Aceptar", null)
                .show();
                
            hideRide();
            loadWallet();
            loadHistory();
        } else if (ride != null) {
            showRide(ride, false);
        }
    }

    private void selectChat(String mode) {
        if ("ride".equals(mode) && (displayedRide == null || displayedRideIsOffer)) {
            showMessage("Chat del cliente", "Este chat se activa después de aceptar un servicio.");
            return;
        }
        chatMode = mode;
        chatPrivateButton.setAlpha("private".equals(mode) ? 1f : .58f);
        chatPublicButton.setAlpha("public".equals(mode) ? 1f : .58f);
        chatRideButton.setAlpha("ride".equals(mode) ? 1f : .58f);
        lastIncomingChatId = 0;
        loadChatMessages();
    }

    private String chatEndpoint() {
        if ("public".equals(chatMode)) return "/api/driver/chat/public";
        if ("ride".equals(chatMode) && displayedRide != null) return "/api/driver/rides/" + displayedRide.optString("id") + "/chat";
        return "/api/driver/chat/private";
    }

    private void loadChatMessages() {
        String requestedMode = chatMode;
        ApiClient.get(chatEndpoint(), response -> {
            if (!requestedMode.equals(chatMode) || !response.isSuccessful() || chatPanel.getVisibility() != View.VISIBLE) return;
            LinearLayout list = findViewById(R.id.chatMessages);
            list.removeAllViews();
            JSONArray messages = response.body.optJSONArray("messages");
            if (messages == null || messages.length() == 0) return;
            String ownId = driverProfile == null ? "" : driverProfile.optString("id");
            for (int index = 0; index < messages.length(); index++) {
                JSONObject m = messages.optJSONObject(index);
                if (m == null) continue;
                boolean mine = "driver".equals(m.optString("sender")) && ("ride".equals(chatMode) || ownId.equals(m.optString("driverId")));
                TextView body = text(m.optString("message"), 13, mine);
                body.setGravity(mine ? Gravity.END : Gravity.START);
                list.addView(body);
            }
            detailsScroll.post(() -> detailsScroll.fullScroll(View.FOCUS_DOWN));
        });
    }

    private void pickChatPhoto() {
        Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
        picker.setType("image/*");
        startActivityForResult(Intent.createChooser(picker, "Seleccionar foto"), CHAT_PHOTO_REQUEST);
    }

    private void pickReportPhoto() {
        Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
        picker.setType("image/*");
        startActivityForResult(Intent.createChooser(picker, "Seleccionar foto del reporte"), REPORT_PHOTO_REQUEST);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            String base64 = "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            if (requestCode == CHAT_PHOTO_REQUEST) pendingChatPhoto = base64;
            else if (requestCode == 503) {
                pendingDepositPhoto = base64;
                if (imgProofPreview != null) { imgProofPreview.setImageURI(uri); imgProofPreview.setVisibility(View.VISIBLE); }
            } else if (requestCode == REPORT_PHOTO_REQUEST) pendingReportPhoto = base64;
        } catch (Exception ignored) {}
    }

    private void submitReport() {
        String description = reportDescription.getText().toString().trim();
        if (description.length() < 8) return;
        JSONObject body = new JSONObject();
        try {
            body.put("category", String.valueOf(reportCategory.getSelectedItem()));
            body.put("description", description);
            if (pendingReportPhoto != null) body.put("photo", pendingReportPhoto);
        } catch (Exception ignored) {}
        ApiClient.post("/api/driver/reports", body, response -> {
            if (response.isSuccessful()) showSection(homePanel);
        });
    }

    private void sendChatMessage() {
        String message = chatInput.getText().toString().trim();
        if (message.isEmpty() && pendingChatPhoto == null) return;
        JSONObject body = new JSONObject();
        try {
            if (!message.isEmpty()) body.put("message", message);
            if (pendingChatPhoto != null) body.put("photo", pendingChatPhoto);
        } catch (Exception ignored) {}
        ApiClient.post(chatEndpoint(), body, response -> {
            chatInput.setText("");
            pendingChatPhoto = null;
            loadChatMessages();
        });
    }

    private void loadChatPhoto(ImageView view, String path) {
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(ApiClient.absoluteUrl(path)).openConnection();
                conn.connect();
                android.graphics.Bitmap bitmap = BitmapFactory.decodeStream(conn.getInputStream());
                if (bitmap != null) runOnUiThread(() -> view.setImageBitmap(bitmap));
            } catch (Exception ignored) {}
        }).start();
    }

    private void pickDepositPhoto() {
        Intent intent = new Intent(Intent.ACTION_PICK);
        intent.setType("image/*");
        startActivityForResult(intent, 503);
    }

    private void submitDeposit() {
        Spinner pointsSpinner = findViewById(R.id.pointsSelector);
        if (pointsSpinner == null || pendingDepositPhoto == null) {
            showMessage("Falta información", "Selecciona puntos y adjunta la foto del comprobante.");
            return;
        }

        String selected = String.valueOf(pointsSpinner.getSelectedItem());
        int points = Integer.parseInt(selected.split(" ")[0]);
        int amount = points * 50; // 1 punto = 50 RD$ -> 4 puntos = 200 RD$

        JSONObject body = new JSONObject();
        try {
            body.put("points", points);
            body.put("amount", amount);
            body.put("photo", pendingDepositPhoto);
        } catch (Exception ignored) {}

        ApiClient.post("/api/driver/points/deposit", body, response -> {
            if (response.isSuccessful()) {
                pendingDepositPhoto = null;
                if (imgProofPreview != null) imgProofPreview.setVisibility(View.GONE);
                showMessage("Depósito enviado", "Tu comprobante fue enviado a revisión. Los puntos se acreditarán pronto.");
                showSection(walletPanel);
                loadWallet();
            } else {
                showMessage("Error", response.message());
            }
        });
    }

    private void configureDepositUI() {
        Spinner pointsSpinner = findViewById(R.id.pointsSelector);
        TextView priceIndicator = findViewById(R.id.depositPriceIndicator);
        if (pointsSpinner == null) return;

        String[] options = new String[]{"1 Punto (RD$ 50)", "2 Puntos (RD$ 100)", "3 Puntos (RD$ 150)", "4 Puntos (RD$ 200)", "5 Puntos (RD$ 250)", "10 Puntos (RD$ 500)", "20 Puntos (RD$ 1,000)"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, options);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        pointsSpinner.setAdapter(adapter);

        pointsSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                int points = Integer.parseInt(options[pos].split(" ")[0]);
                if (priceIndicator != null) priceIndicator.setText("Monto a depositar: RD$ " + (points * 50));
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
    }

    private void loadWallet() {
        ApiClient.get("/api/driver/wallet", response -> {
            if (!response.isSuccessful()) return;
            ((TextView) findViewById(R.id.walletBalance)).setText(dop(response.body.optInt("balance")));
            ((TextView) findViewById(R.id.walletPoints)).setText(String.valueOf(response.body.optInt("pointsBalance")));
        });
    }

    private void loadHistory() {
        ApiClient.get("/api/driver/history", response -> {
            if (!response.isSuccessful()) return;
            LinearLayout list = findViewById(R.id.historyList);
            list.removeAllViews();
            JSONArray rides = response.body.optJSONArray("rides");
            if (rides == null || rides.length() == 0) return;
            for (int i = 0; i < rides.length(); i++) {
                JSONObject r = rides.optJSONObject(i);
                list.addView(text(r.optString("id") + " · " + r.optString("status"), 13, false));
            }
        });
    }

    private TextView text(String value, int size, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(getColor(bold ? R.color.ink : R.color.muted));
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }

    private String dop(int amount) { return "RD$ " + String.format(Locale.US, "%,d", amount); }

    private String formatDate(String value) { return value == null ? "" : value.replace("T", " ").substring(0, 16); }

    private void showMessage(String title, String message) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("Aceptar", null).show();
    }

    private void confirmCloseApplication() {
        new AlertDialog.Builder(this).setTitle("¿Cerrar?").setPositiveButton("Sí", (d, w) -> closeApplication()).show();
    }

    private void closeApplication() {
        LocationService.stop(this);
        ApiClient.post("/api/driver/disconnect", new JSONObject(), r -> { finishAffinity(); });
    }

    private void confirmLogout() {
        new AlertDialog.Builder(this).setTitle("¿Cerrar sesión?").setPositiveButton("Sí", (d, w) -> logout()).show();
    }

    private void logout() {
        LocationService.stop(this);
        ApiClient.post("/api/driver/logout", new JSONObject(), r -> {
            ApiClient.clearSession();
            returnToLogin();
        });
    }

    private void returnToLogin() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    private void saveDriverProfile() {
        EditText emailEdit = findViewById(R.id.profileEmailEdit);
        if (emailEdit == null) return;
        String email = emailEdit.getText().toString().trim();
        if (email.isEmpty()) return;
        try {
            JSONObject body = new JSONObject();
            body.put("email", email);
            ApiClient.post("/api/driver/profile", body, response -> {
                if (response.isSuccessful()) {
                    showMessage("Perfil actualizado", "Tus datos se guardaron.");
                    loadProfile();
                }
            });
        } catch (Exception ignored) {}
    }

    private void showVehicleUpdateDialog() {
        Toast.makeText(this, "Actualización de vehículo en desarrollo", Toast.LENGTH_SHORT).show();
    }

    @Override public void onBackPressed() {
        if (menuOpen) closeMenu();
        else if (homePanel.getVisibility() != View.VISIBLE) showSection(homePanel);
        else moveTaskToBack(true);
    }

    @Override protected void onResume() {
        super.onResume();
        if (driverProfile != null && hasLocationPermission()) LocationService.start(this);
    }

    @Override protected void onDestroy() {
        if (locationReceiver != null) unregisterReceiver(locationReceiver);
        handler.removeCallbacksAndMessages(null);
        if (mapManager != null) mapManager.destroy();
        super.onDestroy();
    }
}
