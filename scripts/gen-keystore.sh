#!/usr/bin/env bash
# Creates the Google Play *upload* keystore for this app. Run once, on your own machine.
# Keep the .jks and passwords in a password manager. With Play App Signing (default for
# new apps), Google holds the final app-signing key and this upload key can be reset
# by Google support if it is ever lost.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p release
if [ -f release/oti-upload.jks ]; then echo "release/oti-upload.jks already exists; not overwriting."; exit 1; fi
read -rsp "Keystore password (min 6 chars): " PW; echo
keytool -genkeypair -v \
  -keystore release/oti-upload.jks -storetype PKCS12 \
  -alias oti-upload -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=Over the Influence Recovery, O=Over the Influence Recovery, L=San Diego, ST=California, C=US"
cat > android/keystore.properties <<EOF
storeFile=../release/oti-upload.jks
storePassword=$PW
keyAlias=oti-upload
keyPassword=$PW
EOF
echo "Created release/oti-upload.jks and android/keystore.properties (both git-ignored)."
echo "Base64 for the GitHub secret ANDROID_KEYSTORE_BASE64:"
base64 -w0 release/oti-upload.jks 2>/dev/null || base64 -i release/oti-upload.jks
echo
