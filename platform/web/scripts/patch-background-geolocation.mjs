/**
 * @capacitor-community/background-geolocation 1.3.1 starts its location
 * foreground service with the two-argument startForeground() call. On
 * targetSdk 34+ that throws MissingForegroundServiceTypeException.
 * The same manifest exports the service. Re-apply both fixes after install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(root, 'node_modules/@capacitor-community/background-geolocation');
const servicePath = path.join(
  pluginRoot,
  'android/src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocationService.java'
);
const manifestPath = path.join(pluginRoot, 'android/src/main/AndroidManifest.xml');

if (!fs.existsSync(servicePath) || !fs.existsSync(manifestPath)) {
  console.log('background-geolocation plugin not installed; skip Android patch');
  process.exit(0);
}

const typedCall = `if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }`;

let service = fs.readFileSync(servicePath, 'utf8');
if (!service.includes('FOREGROUND_SERVICE_TYPE_LOCATION')) {
  const needle = 'startForeground(NOTIFICATION_ID, notification);';
  if (!service.includes(needle)) {
    console.error('background-geolocation patch could not find startForeground');
    process.exit(1);
  }
  service = service.replace(needle, typedCall);
  fs.writeFileSync(servicePath, service);
  console.log('Patched background geolocation startForeground service type');
} else {
  console.log('Background geolocation service type already patched');
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
if (manifest.includes('android:exported="true"')) {
  manifest = manifest.replace('android:exported="true"', 'android:exported="false"');
  fs.writeFileSync(manifestPath, manifest);
  console.log('Patched background geolocation service exported=false');
} else {
  console.log('Background geolocation service export already false');
}
