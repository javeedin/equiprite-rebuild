# EquipRite for Android

A small Android app that opens **EquipRite Mobile from your PC** (the desktop app's Wi-Fi link) full screen, from its
own icon: no browser bars, and it remembers the PC. It is a frame around the same EquipRite Mobile pages; it has no
data or screens of its own.

## Connecting it to the PC

Open the app: **Scan the QR code**, and point the phone at the code on the PC (the QR code button in EquipRite's
toolbar, **This PC over Wi-Fi**, with **Let my phone connect** on). The app opens on the PC's EquipRite and
remembers it. Typing the address shown under the code works too.

## Getting it on a phone

1. On the PC, in EquipRite: the **QR code** button in the toolbar (or File → EquipRite on your phone), **This PC over
   Wi-Fi**, switch on **Let my phone connect**.
2. Scan the code with the phone's camera; EquipRite opens in the browser and offers **Open in the EquipRite app**.
3. The first time, that downloads the app from the PC (`EquipRite.apk`, about 60 KB). Open it; Android asks to allow
   installing from the browser once ("Install unknown apps"); install.
4. Tap **Open in the EquipRite app** again: the app opens on the PC's EquipRite and remembers it. From then on, open
   EquipRite from its icon.

The PC keeps the Wi-Fi link on, with the same key, each time EquipRite starts, until it is switched off (or someone
signs out). If the app says to pair again, scan the code again and tap **Open in the EquipRite app**. Me → **Connect
to another PC** starts over.

The app has its own scanner (the camera full screen, a frame, a light): for the PC's code, and for Pick, where a
unit's tag (QR or bar code) is read by the app, since a page served over the PC's plain-http Wi-Fi cannot use the
camera itself. The phone's location is still not available over the Wi-Fi link (it needs https): for that, and to
use EquipRite away from the PC, use EquipRite Mobile from VBCS.

## Updates

When the PC has a newer app (after the desktop app is updated), Me shows it: **Update the app** downloads it from the
PC through the phone's browser; open it and install it over the old one. Version 1.0 had no such button: scan the
PC's code with the phone's camera and tap **Download the app** on the page that opens.

## How it works

- `src/com/equiprite/mobile/MainActivity.java`: a WebView, full screen. Only the PC's own pages open in it; any other
  link opens in the browser. It tells the page it is the app (user agent `EquipRiteApp/1.0`, `window.EquipRiteApp`), so
  the page does not offer to install, and Me shows the PC it is connected to.
- Pairing: the page's button goes to the PC's `/__app/open`, which answers with an Android intent link,
  `equiprite://open?url=<the PC's address with its pairing key>`, or, without the app, the download
  (`/__app/EquipRite.apk`). See `desktop/lib/phone.js` (`appIntent`) and `desktop/lib/devserver.js` (`/__app/…`).
- The scanner: `ScanActivity.java` (the camera, the frame, the light) and `Decoder.java` (ZXing's core reading a
  frame, also a quarter turned for a bar code held upright). `android/test.sh` runs the decoder on camera-like frames
  on a PC (no phone needed).
- Android 7 or later; built for Android 14.
- ZXing core 3.5.3 (`libs/`, Apache License 2.0, `libs/LICENSE-zxing.txt`), checked against Maven Central's SHA-1.

## Building

`android/build.sh` builds `desktop/phone-app/EquipRite.apk` (and `version.json` beside it), which the desktop app
serves. Plain framework code and ZXing's core: no Gradle, so Ubuntu's packages are enough:

```bash
sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner openjdk-21-jdk-headless
```

```bash
android/build.sh
```

Signing: the key in `$EQP_ANDROID_KEYSTORE` (PKCS#12, password in `$EQP_ANDROID_KEYPASS`), else one made once in
`~/.equiprite/android-signing.p12`. An update installs over the app only when it is signed with the same key, so keep
it; a build signed with another key needs the app uninstalled first. The key is never put in the project.
