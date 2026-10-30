# EquipRite for Android

A small Android app that opens **EquipRite Mobile from your PC** (the desktop app's Wi-Fi link) full screen, from its
own icon: no browser bars, and it remembers the PC. It is a frame around the same EquipRite Mobile pages; it has no
data or screens of its own.

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

Over the Wi-Fi link the phone's camera and location are not available to the page (they need https). For those,
and to use EquipRite away from the PC, use EquipRite Mobile from VBCS (installed from the browser).

## How it works

- `src/com/equiprite/mobile/MainActivity.java`: a WebView, full screen. Only the PC's own pages open in it; any other
  link opens in the browser. It tells the page it is the app (user agent `EquipRiteApp/1.0`, `window.EquipRiteApp`), so
  the page does not offer to install, and Me shows the PC it is connected to.
- Pairing: the page's button goes to the PC's `/__app/open`, which answers with an Android intent link,
  `equiprite://open?url=<the PC's address with its pairing key>`, or, without the app, the download
  (`/__app/EquipRite.apk`). See `desktop/lib/phone.js` (`appIntent`) and `desktop/lib/devserver.js` (`/__app/…`).
- Android 7 or later; built for Android 14.

## Building

`android/build.sh` builds `desktop/phone-app/EquipRite.apk`, which the desktop app serves. Plain framework code: no
Gradle, no libraries, so Ubuntu's packages are enough:

```bash
sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner openjdk-21-jdk-headless
```

```bash
android/build.sh
```

Signing: the key in `$EQP_ANDROID_KEYSTORE` (PKCS#12, password in `$EQP_ANDROID_KEYPASS`), else one made once in
`~/.equiprite/android-signing.p12`. An update installs over the app only when it is signed with the same key, so keep
it; a build signed with another key needs the app uninstalled first. The key is never put in the project.
