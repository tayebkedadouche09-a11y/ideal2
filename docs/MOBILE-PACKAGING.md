# Mobile & Desktop Packaging (Phase 2)

The same React/Vite web build (`apps/web`) is the single source of truth for every
platform. Backend, database and business logic are unchanged — packaging only wraps
the compiled web assets.

## Platform matrix

| Target | Mechanism | Build host requirement | Verified here |
|---|---|---|---|
| Responsive web | Vite SPA (MUI, breakpoints, temporary nav drawer) | none | yes (browser) |
| Installable PWA (desktop + mobile) | `public/manifest.webmanifest` + `public/sw.js` | none | yes (assets served, build emits them) |
| Android app | Capacitor (`@capacitor/android`) | Android SDK + JDK 17 | platform generation verified; APK build needs SDK |
| iOS / iPadOS app | Capacitor (`@capacitor/ios`) | macOS + Xcode | platform generation verified; IPA build needs Xcode |
| Desktop installers (.exe/.dmg/.AppImage) | Electron or Tauri wrapper (see below) | Electron/Tauri toolchain | documented, not CI-wired |

## Configure the API origin for packaged builds

In dev, Vite proxies `/api/v1` to `http://localhost:4000`. A packaged app (Capacitor
or PWA served from a static host) has **no proxy**, so the API base must be absolute.
Set `VITE_API_URL` at build time:

```bash
# apps/web
VITE_API_URL="https://api.your-domain.tld" npm run build
```

`apps/web/src/api.ts` reads `import.meta.env.VITE_API_URL` and falls back to `/api/v1`.

## Capacitor — Android

```bash
cd apps/web
npm run build                 # produces dist/
npx cap add android           # once; android/ is gitignored
npm run cap:sync              # copy web assets + update plugins
npm run cap:open:android      # opens Android Studio -> Build APK/AAB
# or CLI (requires ANDROID_HOME + a device/emulator):
npm run cap:run:android
```

## Capacitor — iOS / iPadOS (macOS only)

```bash
cd apps/web
npm run build
npx cap add ios               # once; ios/ is gitignored
npm run cap:sync
npm run cap:open:ios          # opens Xcode -> Product > Archive (IPA)
```

iPadOS uses the same iOS project; set the device family to "Universal" in Xcode
(Target > General > Deployment) to target iPhone + iPad.

### Native capabilities already wired

`apps/web/src/mobile/native.ts` initialises, **only when running natively**:

- Splash screen hide
- Status bar style
- Android hardware **back button** (history back, else exit)
- Network status -> mirrors native connectivity onto `online`/`offline` window events
  so the existing outbox auto-sync keeps working

Capture features need **no** Capacitor plugins: `apps/web/src/pages/FieldOps.tsx` uses
standard web APIs that the Capacitor webview supports natively —
`<input type="file" accept="image/*" capture="environment">` (camera),
file upload (documents), `MediaRecorder` (Voice-to-Work) and `navigator.geolocation`.
The installed Capacitor plugins (camera, filesystem, geolocation, push-notifications,
preferences, network) are available if you later prefer native APIs.

### Push notifications

`@capacitor/push-notifications` is installed and configured in `capacitor.config.ts`.
To activate real push you must add platform credentials (FCM `google-services.json` for
Android, APNs key/capability for iOS) and a server-side send path. In-app notifications
(the bell + `/notifications`) already work over the API without push credentials.

## Desktop installers

The PWA is already installable on Windows/macOS/Linux (browser "Install app"), giving a
native-like standalone window with offline shell caching — no extra toolchain.

For true `.exe` / `.dmg` / `.AppImage` installers, wrap the built `apps/web/dist` with
Electron or Tauri. This is intentionally **not** added to the npm workspaces so CI's
`npm ci` stays fast and green (Electron downloads a large binary at install; Tauri needs
Rust). To add it, create a separate top-level `desktop/` package (outside `apps/*`):

- **Electron**: `main.js` opens a `BrowserWindow` loading `dist/index.html`;
  package with `electron-builder`.
- **Tauri**: `npm create tauri-app`, point `frontendDist` at `../apps/web/dist`.

Both reuse the exact same web build and backend.
