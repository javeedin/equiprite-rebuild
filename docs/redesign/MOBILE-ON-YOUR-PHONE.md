# EquipRite Mobile on your phone

EquipRite Mobile is a web app that installs on the phone's home screen (a PWA): no app store. Each person gets the
tabs their access allows: **Approve** (decide requests), **Pick** (the yard), **Request** (raise one), **My requests**
and **Me**.

## The quick way: the QR code in the desktop app

1. On the PC, in EquipRite: **File → EquipRite on your phone (QR code)…** (Ctrl+Shift+5).
2. Pick a code:
   - **From VBCS** (recommended, any phone, anywhere): paste the address of EquipRite on VBCS once. Open EquipRite
     Next in a browser and copy the address bar, e.g. `https://…/ic/builder/rt/<app>/live/webApps/equiprite-next/`.
     The code is for `…/webApps/equiprite-mobile/`.
   - **From this PC, over Wi-Fi** (to try it now, nothing deployed): switch on *Let my phone connect*. The phone must
     be on the same Wi-Fi, and EquipRite must stay open on the PC.
3. On the phone, open the camera and point it at the code. Tap the link that appears.
4. EquipRite opens and offers to go on the home screen:
   - **iPhone (Safari):** Share (the square with an arrow) → **Add to Home Screen** → Add.
   - **Android (Chrome):** **Install** in the offer, or ⋮ → **Install app**.
5. From then on, open EquipRite from its icon. It opens full screen on your work.

| | From VBCS | From this PC over Wi-Fi |
|---|---|---|
| Where the phone can be | anywhere with internet | same Wi-Fi as the PC |
| Needs | the app deployed to VBCS | EquipRite open on the PC |
| Install on the home screen | yes | iPhone: as a shortcut; Android: as a shortcut |
| Camera (scan tags), location | yes | no (needs https) |
| Signs in as | the phone's own sign-in | the person signed in on the PC |

## Deploying to VBCS

The mobile app is part of the same visual application (`webApps/equiprite-mobile`), so it deploys with the others
from VB Studio. Optionally switch on VB's own PWA support (the web app's Settings → PWA) for VB's offline caching;
EquipRite then uses VB's manifest instead of its own.

## Why not a download from GitHub?

The app calls EquipRite's backends and Fusion through a server that adds the stored Fusion login (VBCS, or the
desktop app locally). That login cannot be put in a public download, so the app is opened from VBCS, or from this PC,
and installed from there.
