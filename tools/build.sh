#!/usr/bin/env bash
# HGhub v0.0.5 —— Android（arm64）构建脚本
#
# 本机两个特殊约束（换机器可删）：
#   1. 没有完整 mingw-w64：E:\HGhub-build\tools 只有 gcc.exe/ld.exe/as.exe/ar.exe，
#      缺 cc1、crt2.o、libkernel32.a，宿主编译（proc-macro / build script）链不起来。
#   2. 用户名含中文（C:\Users\雷志程）。GNU ld 按 ANSI 解析路径，实测把
#      C:/Users/雷志程/ 读成 C:/Users/À×Ö¾³Ì/，导致 sysroot 里真实存在的 .rlib
#      被报成 "No such file or directory"。同一文件放 ASCII 路径则 exit=0。
#
# 解法：宿主编译改走 rustc 自带的 rust-lld + rust-mingw 的 self-contained 运行时，
# 具体配置在 .cargo/config.toml 的 [target."x86_64-pc-windows-gnu"] 里。
#
# 两个踩过的坑，别再改回去：
#   · TOML 的 `.` 是嵌套分隔符，triple 必须加引号，否则配置静默失效。
#   · 这份 cargo 1.99.1 实测不认 CARGO_BUILD_RUSTFLAGS；RUSTFLAGS 虽有效但会
#     污染 Android 目标（把 NDK clang 顶掉），所以两者都不要设。
set -e
cd "$(dirname "$0")/HGhub-0.0.5"
source ../env.sh
unset RUSTC RUSTFLAGS CARGO_BUILD_RUSTFLAGS
exec pnpm tauri android build --debug --target aarch64 --apk --ci "$@"
