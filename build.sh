#!/bin/bash
# ============================================================
# 无尽冬日 · 一键构建 macOS App（Objective-C 原生壳）
# 用法: ./build.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="EndlessWinter"
BUILD_DIR="build"
APP="$BUILD_DIR/$APP_NAME.app"
CLANG_CACHE="$BUILD_DIR/omcache"
mkdir -p "$CLANG_CACHE"

echo "❄️  无尽冬日 · 开始构建"
echo "─────────────────────────────────"

# 0. 无头回归测试（游戏逻辑层）
echo "▶ [0/4] 运行无头逻辑测试..."
if ! node tools/sim_test.js > "$BUILD_DIR/test.log" 2>&1; then
    echo "❌ 逻辑测试未通过，构建中止（详见 $BUILD_DIR/test.log）："
    grep -E '❌|结果' "$BUILD_DIR/test.log"
    exit 1
fi
grep '结果' "$BUILD_DIR/test.log"

# 1. 编译 Objective-C 原生壳
echo "▶ [1/4] 编译原生壳 (clang + Cocoa/WebKit)..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
clang -O2 -fobjc-arc \
    "-fmodules-cache-path=$CLANG_CACHE" \
    src/main.m \
    -o "$APP/Contents/MacOS/$APP_NAME" \
    -framework Cocoa -framework WebKit

# 2. 复制游戏资源
echo "▶ [2/4] 打包游戏资源（3D 引擎 + 游戏逻辑）..."
mkdir -p "$APP/Contents/Resources/game/js"
cp game/index.html game/style.css "$APP/Contents/Resources/game/"
cp game/js/*.js "$APP/Contents/Resources/game/js/"

# 3. 生成图标
echo "▶ [3/4] 生成应用图标..."
if [ ! -f "$BUILD_DIR/AppIcon.icns" ]; then
    mkdir -p "$BUILD_DIR/icon.iconset"
    python3 tools/make_icon.py "$BUILD_DIR/icon_1024.png"
    for s in 16 32 128 256 512; do
        sips -z $s $s "$BUILD_DIR/icon_1024.png" --out "$BUILD_DIR/icon.iconset/icon_${s}x${s}.png" >/dev/null
        d=$((s * 2))
        sips -z $d $d "$BUILD_DIR/icon_1024.png" --out "$BUILD_DIR/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$BUILD_DIR/icon.iconset" -o "$BUILD_DIR/AppIcon.icns"
fi
cp "$BUILD_DIR/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# 4. Info.plist + 签名
echo "▶ [4/4] 写入配置并签名..."
cp Info.plist "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo ""
echo "✅ 构建完成: $APP"
du -sh "$APP" | awk '{print "   大小: "$1}'
