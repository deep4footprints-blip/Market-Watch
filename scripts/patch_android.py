#!/usr/bin/env python3
"""Patch the generated Capacitor android/app/build.gradle so every APK is an in-place UPDATE:
  1. versionCode = CI run number (strictly increasing; Android refuses same/lower versions)
  2. an explicit signing config using the committed keystore (same signature on every build)
Fails loudly if the template changes shape, instead of silently producing an un-updatable APK."""
import re
import sys

gradle, keystore, version = sys.argv[1], sys.argv[2], int(sys.argv[3])
s = open(gradle, encoding="utf-8").read()

s, n1 = re.subn(r"versionCode\s+\d+", f"versionCode {version}", s, count=1)
s, n2 = re.subn(r'versionName\s+"[^"]*"', f'versionName "1.{version}"', s, count=1)
signing = f'''android {{
    signingConfigs {{
        fixed {{
            storeFile file("{keystore}")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }}
    }}'''
s, n3 = re.subn(r"^android \{", lambda m: signing, s, count=1, flags=re.M)
s, n4 = re.subn(r"buildTypes \{", "buildTypes {\n        debug {\n            signingConfig signingConfigs.fixed\n        }", s, count=1)
if not (n1 and n2 and n3 and n4):
    sys.exit(f"patch_android: template changed (versionCode={n1} versionName={n2} signing={n3} buildTypes={n4})")
open(gradle, "w", encoding="utf-8").write(s)
print(f"patched {gradle}: versionCode={version}, signing=fixed keystore")
