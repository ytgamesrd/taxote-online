package com.taxote.driver;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private View loginPanel;
    private View registerPanel;
    private Button tabLogin;
    private Button tabRegister;
    private Button loginButton;
    private ProgressBar progress;

    private EditText loginPhone;
    private EditText loginPassword;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // CHECK PENDING REGISTRATION
        if (getSharedPreferences("taxote_driver", MODE_PRIVATE).getBoolean("registration_pending", false)) {
            startActivity(new Intent(this, RegisterActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        applySystemInsets();
        ApiClient.initialize(this);
        bindViews();
        configureActions();
        restoreActiveSession();
    }

    private void applySystemInsets() {
        View root = findViewById(R.id.mainRoot);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || root == null) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                top = insets.getInsets(WindowInsets.Type.statusBars()).top;
                bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(0, top, 0, bottom);
            return insets;
        });
        root.requestApplyInsets();
    }

    private void bindViews() {
        loginPanel = findViewById(R.id.loginPanel);
        registerPanel = findViewById(R.id.registerPanel);
        tabLogin = findViewById(R.id.tabLogin);
        tabRegister = findViewById(R.id.tabRegister);
        loginButton = findViewById(R.id.loginButton);
        progress = findViewById(R.id.progress);
        loginPhone = findViewById(R.id.loginPhone);
        loginPassword = findViewById(R.id.loginPassword);
    }

    private void configureActions() {
        if (tabLogin != null) tabLogin.setOnClickListener(view -> showPanel(true));
        if (tabRegister != null) tabRegister.setOnClickListener(view -> showPanel(false));
        if (loginButton != null) loginButton.setOnClickListener(view -> login());
        
        View btnGoReg = findViewById(R.id.btnGoToRegister);
        if (btnGoReg != null) {
            btnGoReg.setOnClickListener(view -> {
                startActivity(new Intent(this, RegisterActivity.class));
            });
        }
    }

    private void showPanel(boolean login) {
        if (loginPanel != null) loginPanel.setVisibility(login ? View.VISIBLE : View.GONE);
        if (registerPanel != null) registerPanel.setVisibility(login ? View.GONE : View.VISIBLE);
        if (tabLogin != null) tabLogin.setBackgroundResource(login ? R.drawable.bg_tab_selected : R.drawable.bg_tab_unselected);
        if (tabRegister != null) tabRegister.setBackgroundResource(login ? R.drawable.bg_tab_unselected : R.drawable.bg_tab_selected);
        
        int colorNavy = getColor(R.color.navy);
        int colorSurface = getColor(R.color.surface);
        if (tabLogin != null) tabLogin.setTextColor(login ? colorSurface : colorNavy);
        if (tabRegister != null) tabRegister.setTextColor(login ? colorNavy : colorSurface);
        
        View scroll = findViewById(R.id.mainScroll);
        if (scroll != null) scroll.scrollTo(0, 0);
    }

    private void restoreActiveSession() {
        if (!ApiClient.hasSession()) return;
        ApiClient.get("/api/driver/status", response -> {
            if (response.isSuccessful()) openDashboard();
            else ApiClient.clearSession();
        });
    }

    private void login() {
        String phoneValue = value(loginPhone);
        String passwordValue = value(loginPassword);
        if (!validPhone(phoneValue)) {
            if (loginPhone != null) {
                loginPhone.setError("Escribe un número dominicano completo.");
                loginPhone.requestFocus();
            }
            return;
        }
        if (passwordValue.isEmpty()) {
            if (loginPassword != null) {
                loginPassword.setError("Escribe tu contraseña.");
                loginPassword.requestFocus();
            }
            return;
        }
        setBusy(true);
        try {
            JSONObject body = new JSONObject();
            body.put("phone", phoneValue);
            body.put("password", passwordValue);
            ApiClient.post("/api/driver/login", body, response -> {
                setBusy(false);
                if (response.isSuccessful()) openDashboard();
                else showMessage("No se pudo iniciar sesión", response.message());
            });
        } catch (Exception error) {
            setBusy(false);
            showMessage("Error", "No se pudo preparar el inicio de sesión.");
        }
    }

    private boolean validPhone(String raw) {
        String digits = raw.replaceAll("\\D", "");
        if (digits.length() == 11 && digits.startsWith("1")) digits = digits.substring(1);
        return digits.matches("(809|829|849)\\d{7}");
    }

    private String value(EditText field) {
        return field == null ? "" : field.getText().toString().trim();
    }

    private void setBusy(boolean busy) {
        if (progress != null) progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        if (loginButton != null) loginButton.setEnabled(!busy);
        if (tabLogin != null) tabLogin.setEnabled(!busy);
        if (tabRegister != null) tabRegister.setEnabled(!busy);
    }

    private void showMessage(String title, String message) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("Aceptar", null).show();
    }

    private void openDashboard() {
        startActivity(new Intent(this, DashboardActivity.class));
        finish();
    }
}
