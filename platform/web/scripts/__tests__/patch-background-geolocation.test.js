import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  patchGradleSource,
  patchManifestSource,
  patchPluginAndroid,
  patchServiceSource,
} from '../patch-background-geolocation.mjs';

const SERVICE = [
  '    private void promote(Notification notification) {',
  '        try {',
  '            startForeground(NOTIFICATION_ID, notification);',
  '        } catch (Exception exception) {',
  '        }',
  '    }',
  '',
].join('\n');

const GRADLE = [
  'android {',
  '    namespace "com.equimaps.capacitor_background_geolocation"',
  '    compileSdkVersion 33',
  '    buildTypes {',
  "        release {",
  '            minifyEnabled false',
  "            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'",
  '        }',
  '    }',
  '    lintOptions {',
  '        abortOnError false',
  '    }',
  '}',
  '',
].join('\n');

function writeCrlf(filePath, text) {
  fs.writeFileSync(filePath, text.replace(/\n/g, '\r\n'));
}

test('ProGuard filename rewrite is idempotent and does not touch the optimize file', () => {
  const once = patchGradleSource(GRADLE);
  assert.match(once, /proguard-android-optimize\.txt/);
  assert.equal(once.includes("proguard-android.txt'"), false);
  assert.equal(patchGradleSource(once), once);
  assert.equal(
    patchGradleSource('proguardFiles getDefaultProguardFile("proguard-android.txt")\n'),
    'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt")\n'
  );
});

test('service and manifest patches survive a second run', () => {
  const once = patchServiceSource(SERVICE);
  assert.match(once, /FOREGROUND_SERVICE_TYPE_LOCATION/);
  assert.equal(patchServiceSource(once), once);
  const manifest = patchManifestSource('<service android:exported="true" />\n');
  assert.equal(manifest, '<service android:exported="false" />\n');
  assert.equal(patchManifestSource(manifest), manifest);
});

test('patch writes Windows CRLF paths and stays idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchman bg patch '));
  const javaDir = path.join(
    dir,
    'src',
    'main',
    'java',
    'com',
    'equimaps',
    'capacitor_background_geolocation'
  );
  fs.mkdirSync(javaDir, { recursive: true });
  const servicePath = path.join(javaDir, 'BackgroundGeolocationService.java');
  const manifestPath = path.join(dir, 'src', 'main', 'AndroidManifest.xml');
  const gradlePath = path.join(dir, 'build.gradle');
  writeCrlf(servicePath, SERVICE);
  writeCrlf(manifestPath, '<service android:exported="true" />\n');
  writeCrlf(gradlePath, GRADLE);

  const first = patchPluginAndroid(dir);
  assert.deepEqual(first, { service: true, manifest: true, gradle: true });
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  assert.match(gradle, /proguard-android-optimize\.txt/);
  assert.equal(gradle.includes('\r\n'), true);
  assert.equal(gradle.includes('proguard-android.txt'), false);
  assert.equal(fs.readFileSync(servicePath, 'utf8').includes('\r\n'), true);

  const second = patchPluginAndroid(dir);
  assert.deepEqual(second, { service: false, manifest: false, gradle: false });
  assert.equal(fs.readFileSync(gradlePath, 'utf8'), gradle);
});
