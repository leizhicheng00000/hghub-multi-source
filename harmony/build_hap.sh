#!/usr/bin/env bash
# ============================================================================
# HGhub 0.0.5 · HarmonyOS NEXT 一键构建（Rust 交叉编译 → hvigor 打包 HAP）
# ----------------------------------------------------------------------------
# 本脚本把 2026-11-28 实测通过的完整流程固化下来。每一步都有原因注释，
# 改动前请先读对应注释，尤其是"为什么不能直接用 cargo tauri 打 HAP"。
#
# 用法：
#   bash "E:/HGhub-v005/鸿蒙移植/build_hap.sh"
# 产物：
#   src-tauri/gen/ohos/entry/build/default/outputs/default/entry-default-unsigned.hap
# ============================================================================
set -uo pipefail

PROJ="E:/HGhub-v005/HGhub-0.0.5/src-tauri"
DEVECO="E:/huawei/DevEco Studio"
HAP_OUT="$PROJ/gen/ohos/entry/build/default/outputs/default"

echo "==> [1/4] 加载构建环境（ASCII 路径重定向 + mingw + cargo）"
source "E:/HGhub-v005/env.sh"
export PATH="/e/rustup/bin:$PATH"

# --- OHOS 交叉编译用的 NDK：必须是纯 ASCII 且无空格路径 ---
# Windows 下 binutils 按 GBK 解析参数，路径含中文会炸；含空格会把 -I 拆成两段。
export OHOS_HOME="E:/ohsdk3/sdk/default/openharmony"
export OHOS_NDK_HOME="$OHOS_HOME"

# --- hvigor 用的 SDK：指向 DevEco 自带的完整 SDK（含 hms 与 default/sdk-pkg.json）---
# 不能指向 E:/ohsdk3/sdk：那份是从 DevEco 裁剪复制来的，缺 sdk-pkg.json，
# hvigor 会报 00303312 "Cannot find the corresponding SDK version"。
export DEVECO_SDK_HOME="$DEVECO/sdk"
export DEV_ECO_STUDIO_INSTALL_PATH="$DEVECO"

echo "==> [2/4] Rust 交叉编译（产出 libhuangguo_client_lib.so 并同步到 entry/libs）"
cd "$PROJ"
# 注意：这一步末尾的 HAP 组装会失败，原因是 cargo-mobile2 的 DEVECO_SDK_HOME 推导
# 少算一级（它假设 OHOS_HOME 形如 sdk/default/openharmony/<版本号>，而新版 DevEco
# 是三级布局），导致 hvigor 拿到 E:/ohsdk3 这个非法 SDK 根。
# 但此时 .so / index.d.ts 已经生成完毕，所以这里忽略退出码，改由下一步单独打包。
cargo tauri ohos build --ci --ignore-version-mismatches > "E:/hgport/build_last.log" 2>&1
BUILD_RC=$?

SO="$PROJ/target/aarch64-unknown-linux-ohos/release/libhuangguo_client_lib.so"
if [ ! -f "$SO" ]; then
  echo "!! Rust 产物缺失，编译真的失败了，请看 E:/hgport/build_last.log"
  tail -40 "E:/hgport/build_last.log"
  exit 1
fi
echo "    .so 就绪：$(ls -lh "$SO" | awk '{print $5}')  (cargo tauri 退出码 $BUILD_RC，HAP 阶段预期失败)"

echo "==> [3/4] hvigor 打包 HAP"
cd "$PROJ/gen/ohos"
"$DEVECO/tools/node/node.exe" "$DEVECO/tools/hvigor/bin/hvigorw.js" \
  --mode module assembleHap --parallel --incremental \
  -p buildMode=release --info > "E:/hgport/hvigor_last.log" 2>&1
HV_RC=$?

if [ $HV_RC -ne 0 ]; then
  echo "!! hvigor 打包失败，日志 E:/hgport/hvigor_last.log"
  tail -30 "E:/hgport/hvigor_last.log"
  exit $HV_RC
fi

echo "==> [4/4] 归档产物"
HAP="$HAP_OUT/entry-default-unsigned.hap"
if [ ! -f "$HAP" ]; then
  echo "!! 未找到 HAP：$HAP"
  exit 1
fi
mkdir -p "E:/HGhub-v005/交付"
cp "$HAP" "E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_unsigned.hap"
echo "    完成：E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_unsigned.hap"
ls -lh "E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_unsigned.hap"
echo "    下一步签名：bash \"E:/HGhub-v005/鸿蒙移植/sign_hap.sh\""
