/**
 * @capacitor-community/background-geolocation 1.3.1 needs three Android fixes
 * before it configures on this repo (AGP 9.3 / Gradle 9.7, compileSdk 36):
 *
 * - startForeground must pass the location service type on API 29+ or
 *   targetSdk 34+ throws MissingForegroundServiceTypeException.
 * - The service is exported. Nothing else should bind to it.
 * - getDefaultProguardFile('proguard-android.txt') was removed in AGP 9.
 *   Use proguard-android-optimize.txt.
 *
 * Checked and left unchanged, because they already match the Capacitor 8
 * plugins in this repo (android.newDsl=false):
 * - namespace is set
 * - no jcenter repository
 * - compileSdkVersion / minSdkVersion / targetSdkVersion still configure
 * - lintOptions { abortOnError false } is the same deprecated block those
 *   plugins use; AGP 9 still accepts it
 * - the plugin's own buildscript classpath is not what the app build applies
 *
 * Reads and writes keep the file's newline style, including Windows CRLF.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const typedCall = `if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }`;

const startForegroundNeedle = 'startForeground(NOTIFICATION_ID, notification);';

export function newlineStyle(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

export function withNewlineStyle(text, eol) {
  const lf = toLf(text);
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

export function patchServiceSource(text) {
  const lf = toLf(text);
  if (lf.includes('FOREGROUND_SERVICE_TYPE_LOCATION')) return lf;
  if (!lf.includes(startForegroundNeedle)) {
    throw new Error('background-geolocation patch could not find startForeground');
  }
  return lf.replace(startForegroundNeedle, typedCall);
}

export function patchManifestSource(text) {
  return toLf(text).replace('android:exported="true"', 'android:exported="false"');
}

/**
 * AGP 9 rejects the non-optimizing default ProGuard file by name.
 * Replacing the filename is idempotent: proguard-android-optimize.txt
 * does not contain the old filename.
 */
export function patchGradleSource(text) {
  return toLf(text).replaceAll('proguard-android.txt', 'proguard-android-optimize.txt');
}

export function patchTextFile(filePath, patch) {
  const original = fs.readFileSync(filePath, 'utf8');
  const eol = newlineStyle(original);
  const next = patch(original);
  if (next !== toLf(original)) {
    fs.writeFileSync(filePath, withNewlineStyle(next, eol));
  }
  return next !== toLf(original);
}

export function patchPluginAndroid(androidDir) {
  const servicePath = path.join(
    androidDir,
    'src',
    'main',
    'java',
    'com',
    'equimaps',
    'capacitor_background_geolocation',
    'BackgroundGeolocationService.java'
  );
  const manifestPath = path.join(androidDir, 'src', 'main', 'AndroidManifest.xml');
  const gradlePath = path.join(androidDir, 'build.gradle');
  const changed = {
    service: patchTextFile(servicePath, patchServiceSource),
    manifest: patchTextFile(manifestPath, patchManifestSource),
    gradle: patchTextFile(gradlePath, patchGradleSource),
  };
  return changed;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const androidDir = path.join(root, 'node_modules', '@capacitor-community', 'background-geolocation', 'android');
  const marker = path.join(androidDir, 'build.gradle');
  if (!fs.existsSync(marker)) {
    console.log('background-geolocation plugin not installed; skip Android patch');
    process.exit(0);
  }
  try {
    const changed = patchPluginAndroid(androidDir);
    console.log(
      changed.service
        ? 'Patched background geolocation startForeground service type'
        : 'Background geolocation service type already patched'
    );
    console.log(
      changed.manifest
        ? 'Patched background geolocation service exported=false'
        : 'Background geolocation service export already false'
    );
    console.log(
      changed.gradle
        ? 'Patched background geolocation ProGuard file to proguard-android-optimize.txt'
        : 'Background geolocation ProGuard file already compatible'
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
