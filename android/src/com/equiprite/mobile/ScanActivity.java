package com.equiprite.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Vibrator;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/**
 * The app's own scanner: the camera full screen, a frame to aim with, a light for a dark yard. It reads the PC's QR
 * code (first start), or a unit's tag for a screen (Pick), and hands the text back. The page's own camera is not
 * available over the PC's Wi-Fi (plain http), so the app scans for it.
 *   extras: prompt (the words at the top), qrOnly (the PC's code only)  result: text
 */
@SuppressWarnings("deprecation") // android.hardware.Camera: simple, and on every phone the app runs on
public class ScanActivity extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {
    static final String EXTRA_PROMPT = "prompt";
    static final String EXTRA_QR_ONLY = "qrOnly";
    static final String EXTRA_TEXT = "text";
    static final int REQ_CAMERA = 1;
    static final int BAND = Color.rgb(46, 84, 104);

    FrameLayout root;
    SurfaceView surface;
    TextView status;
    Button light;
    Camera camera;
    boolean surfaceReady;
    boolean torch;
    int previewW, previewH;
    Decoder decoder;
    HandlerThread thread;
    Handler worker;
    volatile boolean decoding;
    volatile boolean done;
    int frames;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.BLACK);
        decoder = new Decoder(getIntent().getBooleanExtra(EXTRA_QR_ONLY, false));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        surface = new SurfaceView(this);
        surface.getHolder().addCallback(this);
        root.addView(surface, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        root.addView(new Aim(this), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView prompt = text(getIntent().getStringExtra(EXTRA_PROMPT), 18, true);
        if (prompt.getText().length() == 0) prompt.setText("Point the camera at the code");
        prompt.setPadding(dp(24), dp(48), dp(24), dp(12));
        prompt.setGravity(Gravity.CENTER);
        root.addView(prompt, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(24), dp(12), dp(24), dp(32));
        status = text("Starting the camera…", 15, false);
        status.setGravity(Gravity.CENTER);
        bottom.addView(status);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        light = button("Light", false);
        light.setVisibility(View.GONE);
        light.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { setTorch(!torch); }
        });
        Button cancel = button("Cancel", true);
        cancel.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { setResult(RESULT_CANCELED); finish(); }
        });
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, dp(52), 1f);
        half.setMargins(dp(6), dp(12), dp(6), 0);
        row.addView(light, half);
        row.addView(cancel, new LinearLayout.LayoutParams(half));
        bottom.addView(row);
        root.addView(bottom, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(root);

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != REQ_CAMERA) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            if (surfaceReady) startCamera();
        } else {
            status.setText("EquipRite needs the camera to scan. Allow it in the phone's Settings (Apps, EquipRite, Permissions), or Cancel.");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        thread = new HandlerThread("equiprite-scan");
        thread.start();
        worker = new Handler(thread.getLooper());
        if (surfaceReady) startCamera();
    }

    @Override
    protected void onPause() {
        stopCamera();
        if (thread != null) thread.quitSafely();
        thread = null;
        worker = null;
        super.onPause();
    }

    public void surfaceCreated(SurfaceHolder holder) {
        surfaceReady = true;
        startCamera();
    }

    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { }

    public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        stopCamera();
    }

    void startCamera() {
        if (camera != null || !surfaceReady || worker == null) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            int id = backCamera();
            camera = Camera.open(id);
            Camera.Parameters p = camera.getParameters();
            Camera.Size size = previewSize(p.getSupportedPreviewSizes());
            p.setPreviewSize(size.width, size.height);
            previewW = size.width;
            previewH = size.height;
            List<String> focus = p.getSupportedFocusModes();
            if (focus != null && focus.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (focus != null && focus.contains(Camera.Parameters.FOCUS_MODE_AUTO)) {
                p.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            }
            camera.setParameters(p);
            camera.setDisplayOrientation(orientation(id));
            fitPreview();
            camera.setPreviewDisplay(surface.getHolder());
            camera.setPreviewCallback(this);
            camera.startPreview();
            List<String> flash = p.getSupportedFlashModes();
            light.setVisibility(flash != null && flash.contains(Camera.Parameters.FLASH_MODE_TORCH) ? View.VISIBLE : View.GONE);
            status.setText(getIntent().getBooleanExtra(EXTRA_QR_ONLY, false) ? "Hold it steady: it reads by itself." : "Hold the tag in the frame: it reads by itself.");
        } catch (Exception e) {
            stopCamera();
            status.setText("Could not start the camera: " + e.getMessage());
        }
    }

    void stopCamera() {
        if (camera == null) return;
        try {
            camera.setPreviewCallback(null);
            camera.stopPreview();
        } catch (Exception e) {
            // already stopped
        }
        camera.release();
        camera = null;
        torch = false;
    }

    void setTorch(boolean on) {
        if (camera == null) return;
        try {
            Camera.Parameters p = camera.getParameters();
            p.setFlashMode(on ? Camera.Parameters.FLASH_MODE_TORCH : Camera.Parameters.FLASH_MODE_OFF);
            camera.setParameters(p);
            torch = on;
            light.setText(on ? "Light off" : "Light");
        } catch (Exception e) {
            // no light on this camera
        }
    }

    /** Each preview frame: read on the worker thread, one at a time; the first text read is the answer. */
    public void onPreviewFrame(final byte[] data, Camera c) {
        if (decoding || done || worker == null || data == null) return;
        decoding = true;
        final int w = previewW, h = previewH;
        final boolean turned = (frames++ % 2) == 1;
        worker.post(new Runnable() {
            public void run() {
                String text = decoder.decode(data, w, h, turned);
                decoding = false;
                if (text != null && !done) {
                    done = true;
                    final String found = text;
                    runOnUiThread(new Runnable() {
                        public void run() { deliver(found); }
                    });
                }
            }
        });
    }

    void deliver(String text) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(60);
        } catch (Exception e) {
            // no vibrator
        }
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_TEXT, text));
        finish();
    }

    int backCamera() {
        Camera.CameraInfo info = new Camera.CameraInfo();
        for (int i = 0; i < Camera.getNumberOfCameras(); i++) {
            Camera.getCameraInfo(i, info);
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) return i;
        }
        return 0;
    }

    /** The turn that shows the sensor's picture upright on the screen. */
    int orientation(int id) {
        Camera.CameraInfo info = new Camera.CameraInfo();
        Camera.getCameraInfo(id, info);
        int degrees = 0;
        switch (getWindowManager().getDefaultDisplay().getRotation()) {
            case Surface.ROTATION_90: degrees = 90; break;
            case Surface.ROTATION_180: degrees = 180; break;
            case Surface.ROTATION_270: degrees = 270; break;
            default: degrees = 0;
        }
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) return (360 - (info.orientation + degrees) % 360) % 360;
        return (info.orientation - degrees + 360) % 360;
    }

    /** Near 1280 × 720: sharp enough for a code across a room, light enough to read every other frame. */
    static Camera.Size previewSize(List<Camera.Size> sizes) {
        Camera.Size best = sizes.get(0);
        long target = 1280L * 720L;
        for (Camera.Size s : sizes) {
            long d = Math.abs((long) s.width * s.height - target);
            long bd = Math.abs((long) best.width * best.height - target);
            if (d < bd) best = s;
        }
        return best;
    }

    /** The preview fills the screen without being squashed (the sensor is landscape, the screen upright). */
    void fitPreview() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int sw = dm.widthPixels, sh = dm.heightPixels;
        int pw = previewH, ph = previewW;
        float scale = Math.max((float) sw / pw, (float) sh / ph);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(pw * scale), Math.round(ph * scale), Gravity.CENTER);
        surface.setLayoutParams(lp);
    }

    /** The frame to aim with: the screen dimmed around a square, its corners marked. */
    static class Aim extends View {
        final Paint dim = new Paint();
        final Paint corner = new Paint(Paint.ANTI_ALIAS_FLAG);

        Aim(Context c) {
            super(c);
            dim.setColor(Color.argb(140, 0, 0, 0));
            corner.setColor(Color.WHITE);
            corner.setStyle(Paint.Style.STROKE);
            corner.setStrokeCap(Paint.Cap.ROUND);
            corner.setStrokeWidth(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 4, c.getResources().getDisplayMetrics()));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            int w = getWidth(), h = getHeight();
            int side = (int) (Math.min(w, h) * 0.72f);
            int l = (w - side) / 2, t = (h - side) / 2, r = l + side, b = t + side;
            canvas.drawRect(0, 0, w, t, dim);
            canvas.drawRect(0, b, w, h, dim);
            canvas.drawRect(0, t, l, b, dim);
            canvas.drawRect(r, t, w, b, dim);
            int k = side / 7;
            Path p = new Path();
            p.moveTo(l, t + k); p.lineTo(l, t); p.lineTo(l + k, t);
            p.moveTo(r - k, t); p.lineTo(r, t); p.lineTo(r, t + k);
            p.moveTo(r, b - k); p.lineTo(r, b); p.lineTo(r - k, b);
            p.moveTo(l + k, b); p.lineTo(l, b); p.lineTo(l, b - k);
            canvas.drawPath(p, corner);
        }
    }

    int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s == null ? "" : s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setShadowLayer(6, 0, 1, Color.BLACK);
        return t;
    }

    Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(primary ? BAND : Color.argb(90, 255, 255, 255));
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        return b;
    }
}
