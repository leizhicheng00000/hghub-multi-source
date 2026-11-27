#!/usr/bin/env bash
# ============================================================================
# HGhub v0.0.5 Android 构建环境
# ----------------------------------------------------------------------------
# 本机有两处硬约束，全部通过"把路径搬到纯 ASCII 位置"解决，不需要任何 rustflags：
#   1) GNU binutils（ld / ar / dlltool）在 Windows 上按 ANSI(GBK) 解码命令行参数，
#      C:\Users\雷志程\ 会被读成 C:\Users\À×Ö¾³Ì\  —— 于是"文件明明存在"却报
#      No such file / Cannot create temporary file / undefined symbol。
#   2) rustc / cargo 对 .cmd 包装器无法 spawn，必须用真 .exe。
#
# 因此：
#   RUSTUP_HOME=E:/rustup  -> sysroot 纯 ASCII（修 ld 找不到 .rlib）
#   CARGO_HOME=E:/cargo    -> registry 源码纯 ASCII（修 ar 找不到 .o）
#   TMP/TEMP=E:/tmp        -> 临时目录纯 ASCII（修 dlltool 无法写临时文件）
#   NDK clang 用 aarch64-linux-android24-clang.exe（clang 从自身文件名推断 triple）
# ============================================================================

export ANDROID_HOME="/c/Android/Sdk"
export ANDROID_NDK_ROOT="/c/Android/Sdk/ndk/r27b"
export NDK_HOME="/c/Android/Sdk/ndk/r27b"
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export LIBCLANG_PATH="/c/Program Files/LLVM/bin"
export GRADLE_USER_HOME="/e/HGhub-build/gradle-home"

# --- 三处 ASCII 重定向（核心）---
export RUSTUP_HOME="E:/rustup"
export CARGO_HOME="E:/cargo"
export TMP="E:/tmp"
export TEMP="E:/tmp"
export TMPDIR="E:/tmp"

# --- mingw 提供 gcc / cc-rs 需要的 C 编译器；必须排在 PATH 前部 ---
export PATH="/e/mingw/mingw64/bin:/e/cargo/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# --- Android 交叉编译工具 ---
NDK_BIN="/c/Android/Sdk/ndk/r27b/toolchains/llvm/prebuilt/windows-x86_64/bin"
export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang.exe"
export CXX_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang++.exe"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar.exe"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android24-clang.exe"

# --- 关键：固定编译器，杜绝两个 rustup home 混用 ---
# 本机同时存在 E:/rustup（本脚本启用）与 C:/Users/<中文名>/.rustup（旧）。
# 若不固定，Gradle 侧的子进程可能解析到旧 home 的 rustc，
# 用旧 rustc 编的 rlib 与新 rustc 的 core 元数据哈希不匹配，就报
#   "only metadata stub found for rlib dependency core"
# 固定绝对路径后只剩一套编译器。
export RUSTC="E:/rustup/toolchains/stable-x86_64-pc-windows-gnu/bin/rustc.exe"

# --- 关键：与 Tauri CLI 内部构建保持同一组 rustflags ---
# Tauri 在 gradle 流程里会给目标注入下面这组 link-arg。若外层构建不带这组参数，
# Gradle 侧就会认为指纹变化、把所有 crate 重编一遍（很慢且易触发上面的元数据错误）。
# 两边一致后，Gradle 直接复用外层产物。
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES"

# --- 内存约束：本机 16G，且 explorer 存在内存泄漏（实测可占 8G+）---
# rustc 在内存不足时会以 0xc0000409 STATUS_STACK_BUFFER_OVERRUN 或
# "only metadata stub found for rlib dependency core" 的形式崩溃 ——
# 这两个看似无关的报错，实际都是被系统强行终止的结果。
# 因此限制并行度，并关闭 debuginfo（debug=2 时 tauri/wry 单进程可达数 GB）。
export CARGO_BUILD_JOBS=4
export CARGO_PROFILE_DEV_DEBUG=0

# --- 确保没有残留 rustflags 覆盖上述设置 ---
unset RUSTFLAGS CARGO_BUILD_RUSTFLAGS
