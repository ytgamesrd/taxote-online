package com.taxote.driver;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ViewFlipper;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RegisterActivity extends Activity {
    private static final int PICK_PROFILE = 200;
    private static final int PICK_ID_FRONT = 201;
    private static final int PICK_ID_BACK = 202;
    private static final int PICK_V_FRONT = 203;
    private static final int PICK_V_BACK = 204;
    private static final int PICK_V_RIGHT = 205;

    private ViewFlipper viewFlipper;
    private TextView stepTitle;
    private ProgressBar stepProgress;
    private Button btnNext;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    // Campos del formulario
    private EditText regFirstName, regLastName, regCedula, regPlate, regYear, regEmail, regPhone, regPass;
    private Spinner regColor, regBrand, regModel, regVType, regPayment;
    private DatePicker regDob;
    private ImageView imgProfilePreview, imgIdFrontPreview, imgIdBackPreview, imgVFrontPreview, imgVBackPreview, imgVRightPreview;

    // Datos codificados
    private String dataProfile, dataIdFront, dataIdBack, dataVFront, dataVBack, dataVRight;

    private final Runnable statusCheckTask = new Runnable() {
        @Override public void run() {
            if (viewFlipper.getDisplayedChild() == 7) {
                checkActivationStatus();
                handler.postDelayed(this, 10000); 
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);
        bindViews();
        
        boolean isPending = getSharedPreferences("taxote_driver", MODE_PRIVATE).getBoolean("registration_pending", false);
        if (isPending) {
            viewFlipper.setDisplayedChild(7);
            configureStep(7);
            handler.post(statusCheckTask);
        } else {
            configureStep(0);
        }
        
        configureActions();
        configureSpinners();
    }

    private void bindViews() {
        viewFlipper = findViewById(R.id.viewFlipper);
        stepTitle = findViewById(R.id.stepTitle);
        stepProgress = findViewById(R.id.stepProgress);
        btnNext = findViewById(R.id.btnNext);

        regFirstName = findViewById(R.id.regFirstName);
        regLastName = findViewById(R.id.regLastName);
        regCedula = findViewById(R.id.regCedula);
        regPlate = findViewById(R.id.regPlate);
        regYear = findViewById(R.id.regYear);
        regEmail = findViewById(R.id.regEmail);
        regPhone = findViewById(R.id.regPhone);
        regPass = findViewById(R.id.regPass);

        regColor = findViewById(R.id.regColor);
        regBrand = findViewById(R.id.regBrand);
        regModel = findViewById(R.id.regModel);
        regVType = findViewById(R.id.regVType);
        regPayment = findViewById(R.id.regPayment);
        regDob = findViewById(R.id.regDob);

        imgProfilePreview = findViewById(R.id.imgProfilePreview);
        imgIdFrontPreview = findViewById(R.id.imgIdFrontPreview);
        imgIdBackPreview = findViewById(R.id.imgIdBackPreview);
        imgVFrontPreview = findViewById(R.id.imgVFrontPreview);
        imgVBackPreview = findViewById(R.id.imgVBackPreview);
        imgVRightPreview = findViewById(R.id.imgVRightPreview);
    }

    private void configureActions() {
        findViewById(R.id.btnBack).setOnClickListener(v -> goBack());
        btnNext.setOnClickListener(v -> nextStep());
        findViewById(R.id.btnPickProfile).setOnClickListener(v -> pickImage(PICK_PROFILE));
        findViewById(R.id.btnPickIdFront).setOnClickListener(v -> pickImage(PICK_ID_FRONT));
        findViewById(R.id.btnPickIdBack).setOnClickListener(v -> pickImage(PICK_ID_BACK));
        findViewById(R.id.btnPickVFront).setOnClickListener(v -> pickImage(PICK_V_FRONT));
        findViewById(R.id.btnPickVBack).setOnClickListener(v -> pickImage(PICK_V_BACK));
        findViewById(R.id.btnPickVRight).setOnClickListener(v -> pickImage(PICK_V_RIGHT));
        findViewById(R.id.btnAcceptReg).setOnClickListener(v -> submitRegistration());
        findViewById(R.id.btnCancelReg).setOnClickListener(v -> {
            viewFlipper.setDisplayedChild(5);
            configureStep(5);
        });
        findViewById(R.id.btnGoHome).setOnClickListener(v -> finish());
    }

    private void configureSpinners() {
        setSpinner(regVType, VehicleCatalog.TYPES);
        setSpinner(regBrand, VehicleCatalog.brands());
        setSpinner(regColor, VehicleCatalog.COLORS);
        setSpinner(regModel, VehicleCatalog.modelsFor(""));
        setSpinner(regPayment, new String[]{"Selecciona pago", "Efectivo", "Transferencia", "Tarjeta"});
        
        regBrand.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onNothingSelected(AdapterView<?> p) {}
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                String brand = pos == 0 ? "" : String.valueOf(p.getItemAtPosition(pos));
                setSpinner(regModel, VehicleCatalog.modelsFor(brand));
            }
        });
    }

    private void setSpinner(Spinner spinner, String[] values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
    }

    private void nextStep() {
        int current = viewFlipper.getDisplayedChild();
        if (!validateStep(current)) return;
        
        if (current < viewFlipper.getChildCount() - 1) {
            viewFlipper.showNext();
            configureStep(viewFlipper.getDisplayedChild());
        }
    }

    private void goBack() {
        int current = viewFlipper.getDisplayedChild();
        if (current == 0 || current == 7) {
            finish();
        } else {
            viewFlipper.showPrevious();
            configureStep(viewFlipper.getDisplayedChild());
        }
    }

    private void configureStep(int step) {
        stepProgress.setProgress(step + 1);
        String title = "Paso " + (step + 1);
        switch (step) {
            case 0: title = "Datos personales"; break;
            case 1: title = "Identidad (ID)"; break;
            case 2: title = "Fecha de nacimiento"; break;
            case 3: title = "Fotos del vehículo"; break;
            case 4: title = "Detalles del vehículo"; break;
            case 5: title = "Tipo y Contacto"; break;
            case 6: title = "Términos y Condiciones"; break;
            case 7: title = "En revisión"; break;
        }
        stepTitle.setText(title);
        findViewById(R.id.footerActions).setVisibility(step >= 6 ? View.GONE : View.VISIBLE);
    }

    private boolean validateStep(int step) {
        switch (step) {
            case 0:
                if (value(regFirstName).isEmpty()) return error(regFirstName, "Escribe tu nombre.");
                if (value(regLastName).isEmpty()) return error(regLastName, "Escribe tu apellido.");
                if (dataProfile == null) return toast("Sube tu foto de perfil.");
                break;
            case 1:
                if (!value(regCedula).matches("\\d{11}")) return error(regCedula, "11 dígitos.");
                if (dataIdFront == null) return toast("Sube el frente de tu cédula.");
                break;
            case 3:
                if (dataVFront == null) return toast("Sube la foto frontal del vehículo.");
                if (dataVBack == null) return toast("Sube la foto trasera.");
                if (dataVRight == null) return toast("Sube la foto del lado derecho.");
                break;
            case 4:
                if (value(regPlate).isEmpty()) return error(regPlate, "Escribe la placa.");
                if (regBrand.getSelectedItemPosition() == 0) return toast("Elige la marca.");
                if (value(regYear).isEmpty()) return error(regYear, "Escribe el año.");
                break;
            case 5:
                if (regVType.getSelectedItemPosition() == 0) return toast("Elige tipo de vehículo.");
                if (regPayment.getSelectedItemPosition() == 0) return toast("Elige método de pago.");
                if (value(regPhone).length() < 10) return error(regPhone, "Teléfono inválido.");
                if (value(regPass).length() < 8) return error(regPass, "Mínimo 8 caracteres.");
                break;
        }
        return true;
    }

    private void checkActivationStatus() {
        String phone = getSharedPreferences("taxote_driver", MODE_PRIVATE).getString("pending_phone", "");
        String pass = getSharedPreferences("taxote_driver", MODE_PRIVATE).getString("pending_password", "");
        if (phone.isEmpty() || pass.isEmpty()) return;

        try {
            JSONObject body = new JSONObject();
            body.put("phone", phone);
            body.put("password", pass);
            ApiClient.post("/api/driver/login", body, r -> {
                if (r.isSuccessful()) {
                    getSharedPreferences("taxote_driver", MODE_PRIVATE).edit()
                        .remove("registration_pending")
                        .apply();
                    startActivity(new Intent(this, DashboardActivity.class));
                    finish();
                }
            });
        } catch (Exception ignored) {}
    }

    private void submitRegistration() {
        btnNext.setEnabled(false);
        try {
            JSONObject b = new JSONObject();
            final String phoneVal = value(regPhone);
            final String passVal = value(regPass);
            b.put("firstName", value(regFirstName));
            b.put("lastName", value(regLastName));
            b.put("cedula", value(regCedula));
            b.put("dob", getDobString());
            b.put("email", value(regEmail));
            b.put("phone", phoneVal);
            b.put("password", passVal);
            b.put("passwordConfirm", passVal);
            b.put("vehicleBrand", regBrand.getSelectedItem());
            b.put("vehicleModel", regModel.getSelectedItem());
            b.put("vehicleYear", value(regYear));
            b.put("vehicleColor", regColor.getSelectedItem());
            b.put("vehiclePlate", value(regPlate));
            b.put("vehicleType", regVType.getSelectedItem());
            b.put("paymentMethod", regPayment.getSelectedItem());
            
            // Fotos
            b.put("selfiePhoto", dataProfile);
            b.put("idFront", dataIdFront);
            b.put("idBack", dataIdBack != null ? dataIdBack : JSONObject.NULL);
            b.put("vehiclePhoto", dataVFront);
            b.put("vehicleBackPhoto", dataVBack);
            b.put("vehicleRightPhoto", dataVRight);
            b.put("platePhoto", dataVBack); 

            ApiClient.post("/api/driver/register", b, r -> {
                if (r.isSuccessful()) {
                    getSharedPreferences("taxote_driver", MODE_PRIVATE).edit()
                        .putString("pending_phone", phoneVal)
                        .putString("pending_password", passVal)
                        .putBoolean("registration_pending", true)
                        .apply();
                    viewFlipper.setDisplayedChild(7);
                    configureStep(7);
                    handler.post(statusCheckTask);
                } else {
                    btnNext.setEnabled(true);
                    toast(r.message());
                }
            });
        } catch (Exception e) {
            btnNext.setEnabled(true);
            toast("Error al preparar datos.");
        }
    }

    private String getDobString() {
        return regDob.getYear() + "-" + (regDob.getMonth() + 1) + "-" + regDob.getDayOfMonth();
    }

    private String value(EditText f) { return f.getText().toString().trim(); }
    private boolean error(EditText f, String m) { f.setError(m); f.requestFocus(); return false; }
    private boolean toast(String m) { Toast.makeText(this, m, Toast.LENGTH_SHORT).show(); return false; }

    private void pickImage(int code) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/*");
        startActivityForResult(i, code);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent d) {
        if (res != RESULT_OK || d == null || d.getData() == null) return;
        Uri uri = d.getData();
        imageExecutor.execute(() -> {
            try {
                String encoded = ImageUtils.toDataUrl(this, uri);
                runOnUiThread(() -> {
                    try {
                        Bitmap bmp = ImageUtils.decodeBitmap(this, uri, 600);
                        if (req == PICK_PROFILE) { dataProfile = encoded; imgProfilePreview.setImageBitmap(bmp); imgProfilePreview.setVisibility(View.VISIBLE); }
                        else if (req == PICK_ID_FRONT) { dataIdFront = encoded; imgIdFrontPreview.setImageBitmap(bmp); imgIdFrontPreview.setVisibility(View.VISIBLE); }
                        else if (req == PICK_ID_BACK) { dataIdBack = encoded; imgIdBackPreview.setImageBitmap(bmp); imgIdBackPreview.setVisibility(View.VISIBLE); }
                        else if (req == PICK_V_FRONT) { dataVFront = encoded; imgVFrontPreview.setImageBitmap(bmp); imgVFrontPreview.setVisibility(View.VISIBLE); }
                        else if (req == PICK_V_BACK) { dataVBack = encoded; imgVBackPreview.setImageBitmap(bmp); imgVBackPreview.setVisibility(View.VISIBLE); }
                        else if (req == PICK_V_RIGHT) { dataVRight = encoded; imgVRightPreview.setImageBitmap(bmp); imgVRightPreview.setVisibility(View.VISIBLE); }
                    } catch (Exception e) { toast("Error al procesar vista previa."); }
                });
            } catch (Exception e) { runOnUiThread(() -> toast("Error en foto.")); }
        });
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(statusCheckTask);
        imageExecutor.shutdown();
        super.onDestroy();
    }
}
