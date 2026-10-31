import com.equiprite.mobile.Decoder;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.oned.Code128Writer;
import com.google.zxing.qrcode.QRCodeWriter;

import java.util.Random;

/**
 * The app's decoder on camera-like frames, on the JVM (no phone needed): run by android/test.sh.
 * A frame is 1280 × 720 brightness, landscape as a phone's sensor sees it, with noise, the code drawn into it.
 */
public class DecoderTest {
    static int pass = 0, fail = 0;

    static void check(String name, boolean ok) {
        System.out.println((ok ? "  ok   " : "  FAIL ") + name);
        if (ok) pass++; else fail++;
    }

    /** A grey, noisy frame with the matrix drawn at (x, y), each module scale pixels; turned: the code drawn a quarter turned. */
    static byte[] frame(BitMatrix m, int w, int h, int x, int y, int scale, boolean turned, int seed) {
        byte[] f = new byte[w * h * 3 / 2];
        Random r = new Random(seed);
        for (int i = 0; i < w * h; i++) f[i] = (byte) (150 + r.nextInt(40));
        int mw = turned ? m.getHeight() : m.getWidth();
        int mh = turned ? m.getWidth() : m.getHeight();
        for (int j = 0; j < mh * scale; j++) {
            for (int i = 0; i < mw * scale; i++) {
                int mx = i / scale, my = j / scale;
                boolean dark = turned ? m.get(my, mw - 1 - mx) : m.get(mx, my);
                int px = x + i, py = y + j;
                if (px < w && py < h) f[py * w + px] = (byte) (dark ? 20 + r.nextInt(20) : 225 + r.nextInt(25));
            }
        }
        return f;
    }

    public static void main(String[] args) throws Exception {
        String pair = "http://192.168.1.23:18898/?pair=vaIwuttSuJ97dzWoGR1_MKoQ&from=qr";
        BitMatrix qr = new QRCodeWriter().encode(pair, BarcodeFormat.QR_CODE, 0, 0);
        Decoder setup = new Decoder(true);
        check("the PC's QR code, as the camera sees it", pair.equals(setup.decode(frame(qr, 1280, 720, 400, 120, 9, false, 1), 1280, 720, false)));
        check("…small in the frame (4 pixels a module)", pair.equals(setup.decode(frame(qr, 1280, 720, 60, 60, 4, false, 2), 1280, 720, false)));
        check("…turned (a QR code reads at any angle)", pair.equals(setup.decode(frame(qr, 1280, 720, 300, 100, 8, true, 3), 1280, 720, false)));
        check("nothing in the frame: nothing read", setup.decode(frame(new BitMatrix(1, 1), 1280, 720, 0, 0, 1, false, 4), 1280, 720, true) == null);

        BitMatrix tag = new Code128Writer().encode("RL-1002", BarcodeFormat.CODE_128, 0, 1);
        BitMatrix tall = new BitMatrix(tag.getWidth(), 60);
        for (int x = 0; x < tag.getWidth(); x++) if (tag.get(x, 0)) tall.setRegion(x, 0, 1, 60);
        Decoder units = new Decoder(false);
        check("a unit's bar code across the frame", "RL-1002".equals(units.decode(frame(tall, 1280, 720, 200, 300, 6, false, 5), 1280, 720, false)));
        byte[] upright = frame(tall, 1280, 720, 500, 20, 4, true, 6);
        check("…held upright: read once the frame is turned", "RL-1002".equals(units.decode(upright, 1280, 720, true)));
        check("…not without turning it", units.decode(upright, 1280, 720, false) == null);
        check("the PC's code reads in the tags' scanner too", pair.equals(units.decode(frame(qr, 1280, 720, 400, 120, 9, false, 7), 1280, 720, false)));
        check("a bar code is not read when only the PC's QR code is wanted", setup.decode(frame(tall, 1280, 720, 200, 300, 6, false, 8), 1280, 720, true) == null);

        System.out.println("\npassed: " + pass + "   failed: " + fail);
        System.exit(fail == 0 ? 0 : 1);
    }
}
