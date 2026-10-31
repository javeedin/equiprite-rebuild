package com.equiprite.mobile;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Reads a code from a camera frame (ZXing). Plain Java, no Android: tested on its own (android/test/DecoderTest.java).
 *
 * A frame is the camera's preview, its first width × height bytes the brightness (NV21's Y plane), landscape as the
 * sensor sees it. A QR code reads at any angle. A bar code (a unit's tag) reads only across its bars, so a frame is
 * also tried turned a quarter, for a tag held upright while the phone is upright.
 */
public final class Decoder {
    private final MultiFormatReader reader = new MultiFormatReader();
    private final boolean barcodes;

    /** qrOnly: QR codes only (the PC's code); else the tags' bar codes too. */
    public Decoder(boolean qrOnly) {
        barcodes = !qrOnly;
        Map<DecodeHintType, Object> hints = new EnumMap<DecodeHintType, Object>(DecodeHintType.class);
        List<BarcodeFormat> formats = new ArrayList<BarcodeFormat>();
        formats.add(BarcodeFormat.QR_CODE);
        if (barcodes) {
            formats.add(BarcodeFormat.DATA_MATRIX);
            formats.add(BarcodeFormat.CODE_128);
            formats.add(BarcodeFormat.CODE_39);
            formats.add(BarcodeFormat.CODE_93);
            formats.add(BarcodeFormat.EAN_13);
            formats.add(BarcodeFormat.EAN_8);
            formats.add(BarcodeFormat.UPC_A);
            formats.add(BarcodeFormat.UPC_E);
            formats.add(BarcodeFormat.ITF);
        }
        hints.put(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        reader.setHints(hints);
    }

    /** The text of a code in the frame, or null. turned: also try it a quarter turned (bar codes only). */
    public String decode(byte[] frame, int width, int height, boolean turned) {
        String text = read(frame, width, height);
        if (text == null && turned && barcodes) text = read(rotate(frame, width, height), height, width);
        return text;
    }

    private String read(byte[] y, int width, int height) {
        try {
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(y, width, height, 0, 0, width, height, false);
            Result r = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)));
            return r == null ? null : r.getText();
        } catch (ReaderException e) {
            return null;
        } catch (RuntimeException e) {
            return null;
        } finally {
            reader.reset();
        }
    }

    /** The brightness plane turned a quarter clockwise: width × height becomes height × width. */
    static byte[] rotate(byte[] y, int width, int height) {
        byte[] out = new byte[width * height];
        int i = 0;
        for (int x = 0; x < width; x++) {
            for (int row = height - 1; row >= 0; row--) out[i++] = y[row * width + x];
        }
        return out;
    }
}
