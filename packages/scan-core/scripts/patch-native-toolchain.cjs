// Temporary RN 0.83 / Gradle 9 compatibility patch. Remove after the upstream backport.
// https://github.com/reactwg/react-native-releases/issues/1349
//
// This runs as apps/mobile's own postinstall (see apps/mobile/package.json), so a
// web-only `npm ci` at the repo root that skips workspace installs never reaches
// it. But an unqualified `require.resolve` still throws if @react-native/gradle-plugin
// somehow isn't there (e.g. a partial or pruned install), and that exception would
// propagate up and fail the whole install — including the web app's — for a patch
// that only matters to the Android native build. So a missing package is a no-op,
// not a crash.
const fs = require('node:fs');
const path = require('node:path');
let pluginPackage;
try { pluginPackage = require.resolve('@react-native/gradle-plugin/package.json'); }
catch { console.warn('@react-native/gradle-plugin not installed; skipping RN Gradle 9 Foojay compatibility patch.'); return; }
const file = path.join(path.dirname(pluginPackage), 'settings.gradle.kts');
const old = 'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const next = 'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';
const source = fs.readFileSync(file, 'utf8');
if (source.includes(old)) { fs.writeFileSync(file, source.replace(old, next)); console.log('Applied RN Gradle 9 Foojay compatibility patch.'); }
else if (!source.includes(next)) console.warn('Foojay declaration changed upstream: review/remove scripts/patch-native-toolchain.cjs.');
