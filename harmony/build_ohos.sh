#!/usr/bin/env bash
# HGhub 0.0.5 → HarmonyOS NEXT HAP 一键构建
#
# 前置（缺一不可）：
#   1. DevEco Studio 5.0+，安装时勾选 HarmonyOS NEXT SDK
#   2. 华为开发者账号，已在 AGC 创建应用（bundleName: com.hghub.player）
#   3. 调试证书 + 调试 profile（绑设备 UDID）
#   4. Rust 1.90+（项目 rust-version 要求）
#   5. 网络可访问 github.com（要拉 4 个官方分支）
#
# 用法：
#   bash E:/HGhub-v005/鸿蒙移植/build_ohos.sh
#
# 产物：
#   HGhub-0.0.5/src-tauri/gen/ohos/entry/build/default/outputs/default/entry-default-signed.hap

set -euo pipefail

BASE="E:/HGhub-v005"
APP="$BASE/HGhub-0.0.5"
PATCH="$BASE/鸿蒙移植"
TAURI="$APP/src-tauri"

echo "== [0/7] 环境检查 =="
[ -d "$APP" ] || { echo "缺源码目录 $APP"; exit 1; }
command -v rustup >/dev/null || { echo "缺 rustup"; exit 1; }
command -v node >/dev/null || { echo "缺 node"; exit 1; }
rustc --version
node --version

# 本机实测路径（2026-11-27）
: "${OHOS_NDK_HOME:=E:/huawei/DevEco Studio/sdk/default/openharmony/native}"
if [ ! -d "$OHOS_NDK_HOME" ]; then
  echo "OHOS_NDK_HOME 不存在：$OHOS_NDK_HOME"
  echo "请改成 DevEco 实际安装路径（sdk/*/openharmony/native）"
  exit 1
fi
export OHOS_NDK_HOME
# MinGW 的 dlltool / gcc 必须在 PATH 里，否则 Windows 宿主编译时报
# "error calling dlltool 'dlltool.exe': program not found"
export PATH="/e/rustup/bin:/e/mingw/mingw64/bin:$OHOS_NDK_HOME/bin:$PATH"
# 避开中文用户名路径被 GNU binutils 按 GBK 误解码（原项目 env.sh 的既有约定）
export RUSTUP_HOME="${RUSTUP_HOME:-E:/rustup}"
export CARGO_HOME="${CARGO_HOME:-E:/cargo}"
export TMP="${TMP:-E:/tmp}"
mkdir -p "$RUSTUP_HOME" "$CARGO_HOME" "$TMP"

echo "== [1/7] 检查 OHOS Rust target =="
# 本机 rustup 被镜像源覆盖，rust-std-aarch64-unknown-linux-ohos 在镜像上是 404。
# 已改为从 static.rust-lang.org 手动下载并用 install.sh 安装。
if ! rustc --print target-libdir --target aarch64-unknown-linux-ohos 2>/dev/null | grep -q "aarch64-unknown-linux-ohos"; then
  echo "缺 OHOS std。安装方法见 toolchain.md 的「手动安装 OHOS std」一节"
  exit 1
fi
echo "OHOS std 已就绪"

echo "== [2/7] 检查 tauri-cli（官方 OHOS 分支）=="
# crates.io 的 tauri-cli 没有 ohos 子命令，必须从分支装。
# 本机 GitHub 的 libgit2 / git CLI 都握手失败，所以四个仓库源码已用 API 拉到
# 鸿蒙移植/gitdeps/ 下（tauri / wry / tao / cargo-mobile2），改成本地路径 patch。
export PATH="E:/rustup/bin:$PATH"
if ! cargo tauri ohos --help >/dev/null 2>&1; then
  echo "缺官方 OHOS 分支的 tauri-cli。已从本地源码安装，若需重装："
  echo "  cargo install --path $PATCH/gitdeps/tauri/crates/tauri-cli --locked --root E:/rustup"
  exit 1
fi
echo "tauri-cli OHOS 分支已就绪"

echo "== [3/7] 应用配置补丁 =="
cp "$TAURI/Cargo.toml" "$TAURI/Cargo.toml.android.bak" 2>/dev/null || true
cp "$PATCH/Cargo.toml.ohos.patch" "$TAURI/Cargo.toml"
cp "$PATCH/config.toml.ohos" "$TAURI/.cargo/config.toml"
cp "$PATCH/tauri.ohos.conf.json" "$TAURI/tauri.ohos.conf.json"
echo "原 Cargo.toml 已备份为 Cargo.toml.android.bak"

echo "== [4/7] 处理版本锁 =="
# Cargo.lock 锁的是 2.12.5，鸿蒙分支是 2.11.5，必须重新解析
rm -f "$TAURI/Cargo.lock"
echo "已删除 Cargo.lock，稍后由 cargo 重新生成（对齐到 2.11.5）"

echo "== [5/7] 前端构建（dist 已存在，仍然重建确保一致）=="
cd "$APP"
node --version
corepack enable 2>/dev/null || true
pnpm install --frozen-lockfile
pnpm build

echo "== [6/7] 生成 OHOS 工程 + 交叉编译 =="
cd "$TAURI"
cargo tauri ohos init --ci
cargo tauri ohos build --ci

echo "== [7/7] 签名提示 =="
HAP_DIR="$TAURI/gen/ohos/entry/build/default/outputs/default"
echo "未签名 HAP 目录：$HAP_DIR"
echo ""
echo "接下来在 DevEco Studio 里打开 $TAURI/gen/ohos"
echo "  File → Project Structure → Signing Configs"
echo "  勾选 Automatically generate signature，登录华为账号"
echo "  然后 Build → Build Hap(s) 生成签名包"
echo ""
echo "或命令行签名："
echo "  java -jar <DevEco>/sdk/*/toolchains/lib/hap-sign-tool.jar sign-app \\"
echo "    -mode localSign -keyAlias <别名> -signAlg SHA256withECDSA \\"
echo "    -appCertFile <证书>.cer -profileFile <profile>.p7b \\"
echo "    -inFile entry-default-unsigned.hap -keystoreFile <密钥库>.p12 \\"
echo "    -outFile HGhub-0.0.5-ohos-signed.hap \\"
echo "    -keyPwd <密码> -keystorePwd <密码>"
echo ""
echo "完成。安装：hdc install HGhub-0.0.5-ohos-signed.hap"
