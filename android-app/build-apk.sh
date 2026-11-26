#!/usr/bin/env bash
# Builds a signed APK with the Android SDK tools (no Gradle, no downloads). Run in Git Bash:
#   bash android-app/build-apk.sh
# The signing key lives OUTSIDE the project (the repository is public). Back that folder up:
# updates to an installed app must be signed with the same key.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
SDK="${ANDROID_HOME:-${LOCALAPPDATA//\\//}/Android/Sdk}"
TOOLS="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
KEYS="${INVENZA_KEYS:-${USERPROFILE//\\//}/.invenza-android}"
OUT="$HERE/build"
# keytool is often not on the PATH even when javac is: take it from the JDK that is running
JDK="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java\.home = //p' | tr -d '\r')"
KEYTOOL="${JDK//\\//}/bin/keytool"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

"$TOOLS/aapt2.exe" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$TOOLS/aapt2.exe" link -I "$PLATFORM" --manifest "$HERE/AndroidManifest.xml" --java "$OUT/gen" -o "$OUT/unaligned.apk" "$OUT/res.zip"

javac -Xlint:-options -source 11 -target 11 -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$HERE/java" "$OUT/gen" -name '*.java')
"$TOOLS/d8.bat" --release --min-api 29 --lib "$PLATFORM" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && "$TOOLS/aapt.exe" add "$OUT/unaligned.apk" classes.dex >/dev/null)
"$TOOLS/zipalign.exe" -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYS/release.jks" ]; then
  mkdir -p "$KEYS"
  node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))" > "$KEYS/password.txt"
  "$KEYTOOL" -genkeypair -keystore "$KEYS/release.jks" -storepass:file "$KEYS/password.txt" -keypass:file "$KEYS/password.txt" \
    -alias invenza -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Invenza"
  echo "New signing key created in $KEYS"
fi

"$TOOLS/apksigner.bat" sign --ks "$KEYS/release.jks" --ks-key-alias invenza \
  --ks-pass "file:$KEYS/password.txt" --out "$OUT/SiddheshwarInventry.apk" "$OUT/aligned.apk"
"$TOOLS/apksigner.bat" verify "$OUT/SiddheshwarInventry.apk"
# every build is kept, named by version, build number and time, in the apk folder beside the project
APKS="${APK_OUTPUT_DIR:-$HERE/../../apk}"
VERSION="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$HERE/AndroidManifest.xml")"
BUILD="$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' "$HERE/AndroidManifest.xml")"
NAME="SiddheshwarInventry-v$VERSION-build$BUILD-$(date +%Y-%m-%d_%H-%M).apk"
mkdir -p "$APKS"
cp "$OUT/SiddheshwarInventry.apk" "$APKS/$NAME"
echo "APK saved: $(cd "$APKS" && (pwd -W 2>/dev/null || pwd))/$NAME"
