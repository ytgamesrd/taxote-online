package com.taxote.driver;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.graphics.Bitmap;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public final class ImageUtils {
    private ImageUtils() {}

    public static String toDataUrl(Context context, Uri uri) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream stream = resolver.openInputStream(uri)) {
            BitmapFactory.decodeStream(stream, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IllegalArgumentException("La imagen seleccionada no es válida.");

        int sample = 1;
        int largest = Math.max(bounds.outWidth, bounds.outHeight);
        while (largest / sample > 1800) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream stream = resolver.openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(stream, null, options);
        }
        if (bitmap == null) throw new IllegalArgumentException("No se pudo leer la imagen seleccionada.");

        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int max = Math.max(width, height);
        Bitmap prepared = bitmap;
        if (max > 1600) {
            float ratio = 1600f / max;
            prepared = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio), Math.round(height * ratio), true);
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        prepared.compress(Bitmap.CompressFormat.JPEG, 84, output);
        if (prepared != bitmap) prepared.recycle();
        bitmap.recycle();
        byte[] bytes = output.toByteArray();
        if (bytes.length > 4 * 1024 * 1024) throw new IllegalArgumentException("La fotografía es demasiado grande.");
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    public static String toDataUrl(Bitmap bitmap) throws Exception {
        if (bitmap == null) throw new IllegalArgumentException("No se pudo leer la imagen seleccionada.");
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int max = Math.max(width, height);
        Bitmap prepared = bitmap;
        if (max > 1600) {
            float ratio = 1600f / max;
            prepared = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio), Math.round(height * ratio), true);
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        prepared.compress(Bitmap.CompressFormat.JPEG, 84, output);
        if (prepared != bitmap) bitmap.recycle();
        byte[] bytes = output.toByteArray();
        if (bytes.length > 4 * 1024 * 1024) throw new IllegalArgumentException("La fotografía es demasiado grande.");
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    public static Bitmap decodeDataUrl(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:image/")) {
            throw new IllegalArgumentException("Formato de imagen no válido.");
        }
        int commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) throw new IllegalArgumentException("Formato de imagen no válido.");
        byte[] bytes = Base64.decode(dataUrl.substring(commaIndex + 1), Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    public static Bitmap decodeBitmap(Context context, Uri uri, int maxSide) throws Exception {
        if (context == null || uri == null) throw new IllegalArgumentException("URI de imagen no válido.");
        ContentResolver resolver = context.getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream stream = resolver.openInputStream(uri)) {
            BitmapFactory.decodeStream(stream, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IllegalArgumentException("La imagen seleccionada no es válida.");
        int sample = 1;
        int largest = Math.max(bounds.outWidth, bounds.outHeight);
        while (largest / sample > maxSide) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        try (InputStream stream = resolver.openInputStream(uri)) {
            Bitmap bitmap = BitmapFactory.decodeStream(stream, null, options);
            if (bitmap == null) throw new IllegalArgumentException("No se pudo leer la imagen seleccionada.");
            return bitmap;
        }
    }
}
