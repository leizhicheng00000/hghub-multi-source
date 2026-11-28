# HGhub → HarmonyOS NEXT 移植工程

针对 `HGhub_0.0.5_arm64_黄果v4.1(1).apk`（以及同壳的「全源64」版）的鸿蒙原生化方案。
两个包是同一个 Tauri 2 壳，`tauri.conf.json` / `AndroidManifest.xml` / `classes.dex` / `resources.arsc` 逐字节相同，
只有 `libhuangguo_client_lib.so` 里内置的插件数量不同（v4.1 = 1 个源，全源64 = 64 个源）。
所以这套补丁对两个包都适用。

## 先分清两种「华为手机系统」

| 系统 | 结论 | 做法 |
|---|---|---|
| HarmonyOS 4.x 及以下 | **直接用原 APK，无需移植** | 系统兼容安卓应用，装 `HGhub_0.0.5_arm64_全源64_修复版.apk` 即可 |
| HarmonyOS NEXT / 纯血鸿蒙 5.0+ | 需要移植成 HAP | 用本目录的方案 |

本目录只解决第二种。

## 技术判断（实测，不是推测）

拆包结果：

```
HGhub_0.0.5_arm64_黄果v4.1(1).apk   61,817,408 B
sha256  21a96d0149cd5864e12270cee25785c258a903621df16b14db791d2d10d8ef13
970 条目 / 10 个 dex / 单 arm64 库
lib/arm64-v8a/libhuangguo_client_lib.so  53,950,056 B   ELF aarch64
assets/tauri.conf.json                        3,433 B   productName HGhub
                                                        identifier com.hghub.player
```

技术栈：**Tauri v2 + React 19 + TypeScript + Vite 7**，Rust 侧 `tauri 2.12.5` + `hghub-hpp`。

好消息是，Tauri 官方已有 `feat/open-harmony` 分支（2026 年实测可用）：

- ArkWeb 渲染原版前端，`RustAbility` + `mode: 'webview'` 自动挂桥
- 前端 `invoke()` 零改动（你的前端只有 5 处 `invoke`，都能照常工作）
- `wry` / `tao` / `cargo-mobile2` 都有对应的 OHOS 分支

分支与固定提交（已核实）：

| 仓库 | 分支 | commit |
|---|---|---|
| `tauri-apps/tauri` | `feat/open-harmony` | `e3bf6eb168bacc7bb5c8c32d923bb8beaf77c92b` |
| `tauri-apps/wry` | `feat/open-harmony` | `6aaf4b84b6e420015c6a14f264f1c7399f150392` |
| `tauri-apps/tao` | `feat/open-harmony` | `813572fbe582005e2fb513458bc212842745ceab` |
| `tauri-apps/cargo-mobile2` | `feat/ohos` | `549bb6d663d9c04f2cd52b5a65669121ae175828` |

## 唯一的大坑：版本不匹配

你的 `Cargo.lock` 锁的是 **tauri 2.12.5**，而鸿蒙分支是 **2.11.5**。
直接把 `Cargo.toml` 的 `tauri = "2"` patch 过去，会因为版本语义不匹配报
`failed to select a version` 或运行时 `version mismatch`。

两个选择（`Cargo.toml.ohos.patch` 里默认选 A）：

- **A（推荐）**：把整个 tauri 包族降到 2.11.5 基线，用分支的 `rev` 固定，其他 crate 不动。
  代价是 `tauri-plugin-opener/dialog/fs` 要跟着降到兼容版本。
- **B**：只 patch 到分支但保留 2.12.5，构建时加 `--ignore-version-mismatches`。
  能编过，但属于官方明确警告「可能有未知行为」的路径，不推荐。

## 需要补的三个 Android 专属插件

这三处是 Android 原生实现，鸿蒙要重写（其余业务代码平台无关）：

| 文件 | 行数 | 功能 | 鸿蒙实现 |
|---|---|---|---|
| `src/android_login.rs` | 70 | 网页登录 WebView，含取消/限流/网络错误映射 | 见 `arks/web-login.md` |
| `src/android_documents.rs` | 55 | 选目录、解析插件文件 URI | 见 `arks/plugin-documents.md` |
| `src/commands.rs::set_orientation` | ~8 | 横竖屏切换 | 见 `arks/orientation.md` |

`hghub-hpp` 这个 crate（rquickjs / reqwest / tokio / dom_query / axum）本身是平台无关的，
64 个插件通过 `include_str!` 编进 Rust 二进制，跟着 `.so` 一起过去，不用改。

## 目录

```
鸿蒙移植/
  README.md                     本文件
  Cargo.toml.ohos.patch         Cargo.toml 的完整替换段（版本对齐 + patch 源）
  config.toml.ohos              src-tauri/.cargo/config.toml 的 OHOS 链接配置
  tauri.ohos.conf.json          平台覆盖配置（bundleName / 图标）
  build_ohos.sh                 一键构建脚本（装工具链 → init → build）
  arks/
    web-login.md                网页登录插件的鸿蒙实现方案
    plugin-documents.md         插件目录读取的鸿蒙实现方案
    orientation.md              横竖屏的鸿蒙实现方案
  toolchain.md                  工具链安装清单与常见报错
```

## 交付边界

本机（`E:\HGhub-v005`）目前**没有** DevEco Studio、OHOS SDK、hdc、hvigor，Rust 也只装了
Android target（`aarch64-linux-android`）。所以这里给出的是**可执行的移植工程**，不是已签名的 HAP。
HAP 必须在装了 DevEco + 华为开发者账号的机器上跑 `build_ohos.sh` 产出——这一步绕不过去，
因为鸿蒙应用的签名证书和调试 profile 绑定华为账号与设备 UDID。

## 复现顺序（大概）

```bash
# 1. 装工具链（详见 toolchain.md）
# 2. 应用补丁
cd E:/HGhub-v005/HGhub-0.0.5/src-tauri
cp Cargo.toml Cargo.toml.android.bak
cp ../鸿蒙移植/Cargo.toml.ohos.patch Cargo.toml
cp ../鸿蒙移植/config.toml.ohos .cargo/config.toml
cp ../鸿蒙移植/tauri.ohos.conf.json ./tauri.ohos.conf.json

# 3. 补三个插件（arks/ 下有代码和挂载位置）

# 4. 构建
bash E:/HGhub-v005/鸿蒙移植/build_ohos.sh
```

## 授权与署名

上游 HGhub 采用 `PolyForm-Noncommercial-1.0.0`（非商业许可），Tauri 为 MIT/Apache-2.0。
移植版必须保留原许可证与署名，不得用于商业用途。
