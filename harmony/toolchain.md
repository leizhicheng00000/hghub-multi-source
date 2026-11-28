# 工具链安装清单与常见报错

## 必装清单（2026-11-27 本机实测）

| 组件 | 实测状态 |
|---|---|
| DevEco Studio | ✅ `E:/huawei/DevEco Studio`（26.0.1.290，2026-11-27 装） |
| HarmonyOS SDK | ✅ `E:/huawei/DevEco Studio/sdk/default/openharmony/native` |
| hdc | ✅ `sdk/default/openharmony/toolchains/hdc.exe` |
| hvigor | ✅ `E:/huawei/DevEco Studio/tools/hvigor/bin/hvigorw` |
| 签名工具 | ✅ `sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar` |
| Rust | ✅ 1.99.1（要求 ≥ 1.90） |
| OHOS Rust target | ✅ 已手动装好（镜像 404 绕过，见下） |
| Node / pnpm | ✅ Node 22.22.2 / pnpm 12.18.0 |
| Java | ✅ 1.8.0_481 |
| tauri-cli（OHOS 分支） | ✅ v2.11.4，从本地源码编译安装 |
| 华为开发者账号 + 调试证书/profile | ❌ 需要你提供（无法代做） |
| 鸿蒙真机或模拟器 | ❌ 需要你提供（签名 profile 绑 UDID） |

## 安装顺序

### 1. DevEco Studio

从华为开发者官网下载。安装时勾选 **HarmonyOS NEXT SDK**（不是 OpenHarmony SDK，
也不是 API 9 的老 SDK）。装完记下路径，例如：

```
D:\Program Files\Huawei\DevEco Studio\sdk\HarmonyOS-NEXT-DB6\openharmony\native
```

这个路径后面是 `OHOS_NDK_HOME`。

### 2. 开发者账号与签名材料

1. 登录 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html)，实名认证
2. 创建应用，包名填 `com.hghub.player`（**必须和 tauri.conf.json 的 identifier 一致**）
3. 申请调试证书 + 调试 profile，profile 绑定设备 UDID
4. 手机开开发者模式：`设置 → 关于手机 → 连点版本号 7 次`
5. `hdc shell bm get --udid` 取 UDID

最快的方式：DevEco 打开 `src-tauri/gen/ohos` 工程 →
`File → Project Structure → Signing Configs → Automatically generate signature`。

### 3. Rust 与 target（本机已实测，注意镜像 404）

```bash
rustc --version   # 本机 1.99.1，满足 >= 1.90
```

**本机已装好**：`rust-std-aarch64-unknown-linux-ohos` 已装进
`stable-x86_64-pc-windows-gnu` 工具链，`components` 清单已登记，
`rustc --print target-libdir --target aarch64-unknown-linux-ohos` 解析正常。

如果换机器需要重装，注意：**本机 rustup 被清华镜像覆盖**，
`rustup target add aarch64-unknown-linux-ohos` 会 404（镜像上没有这个 target），
即使临时设 `RUSTUP_DIST_SERVER=https://static.rust-lang.org` 也不生效。
绕过方法（已验证可用）：

```bash
# 从官方直接下 std 包（32.9 MB）
curl -sSL "https://static.rust-lang.org/dist/2026-10-15/rust-std-1.99.1-aarch64-unknown-linux-ohos.tar.xz" \
  -o rust-std-ohos.tar.xz
# Git Bash 没 xz，用 Python 解
python -c "import tarfile; tarfile.open('rust-std-ohos.tar.xz','r:xz').extractall('.')"
cd rust-std-1.99.1-aarch64-unknown-linux-ohos
./install.sh --prefix="C:/Users/雷志程/.rustup/toolchains/stable-x86_64-pc-windows-gnu" --disable-ldconfig
```

日期和版本号要跟 `rustc --version` 对得上。

### 4. tauri-cli（关键，别装错）

**crates.io 的 tauri-cli 没有 `ohos` 子命令**，必须从官方分支装。
本机 GitHub 的 libgit2（`schannel: failed to receive handshake`）和 git CLI
（`CONNECT tunnel failed, response 502`）都连不上，所以改成**走 GitHub API 下载源码 tar 包**：

```bash
# 四个仓库的分支 commit 已在 README.md 列出
curl -sSL "https://api.github.com/repos/tauri-apps/tauri/tarball/<commit>" -o tauri.tar.gz
python -c "import tarfile; tarfile.open('tauri.tar.gz','r:gz').extractall('tauri')"
# wry / tao / cargo-mobile2 同理

# 从本地源码装 tauri-cli
cargo install --path gitdeps/tauri/crates/tauri-cli --locked --root E:/rustup
export PATH="E:/rustup/bin:$PATH"
cargo tauri ohos --help   # 应看到 init / dev / build
```

源码已落盘在 `鸿蒙移植/gitdeps/`，`Cargo.toml.ohos.patch` 里的四个
`[patch.crates-io]` 全部改成 `path = ".../gitdeps/..."` 本地路径，构建时零网络依赖。

### 5. 环境变量

中文用户名路径（`C:\Users\雷志程`）会被 GNU binutils 按 GBK 误解码，
这个项目原来就在 `env.sh` 里处理过。保持同样的重定向：

```bash
export RUSTUP_HOME=E:/rustup
export CARGO_HOME=E:/cargo
export TMP=E:/tmp
export OHOS_NDK_HOME="D:/Program Files/Huawei/DevEco Studio/sdk/HarmonyOS-NEXT-DB6/openharmony/native"
export PATH="$OHOS_NDK_HOME/bin:$PATH"
```

## 常见报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `error: no such command: 'ohos'` | 装的是 crates.io 的 tauri-cli | 按上面第 4 步从分支重装 |
| `failed to select a version for tauri` | Cargo.lock 锁 2.12.5，分支是 2.11.5 | 删 `src-tauri/Cargo.lock` 重新解析 |
| `OHOS_NDK_HOME not set` | 没设环境变量 | 按第 5 步设置，路径指向 `openharmony/native` |
| clang 找不到 / `ld: cannot find -lc++` | PATH 里没有 NDK 的 bin | `export PATH="$OHOS_NDK_HOME/bin:$PATH"` |
| `linker 'cc' not found` | 链接器被宿主 cc 覆盖 | 用补丁里的 `.cargo/config.toml`，别加覆盖 Android 的 rustflags |
| `No space left on device` | Rust target 目录太大 | `export CARGO_TARGET_DIR=E:/cargo-target`，E 盘留 20 GB+ |
| `git clone` 超时 | 四个分支都在 GitHub | 配代理或 ghproxy；分支体积小，不是网络瓶颈的话多试几次 |
| `hvigor: command not found` | 没用 DevEco 自带终端 | 用 DevEco 的 Terminal，或把 `<DevEco>/tools/hvigor/bin` 加进 PATH |
| `install failed: signature verification failed` | HAP 没签名或 profile 设备不匹配 | 重新用 DevEco 自动签名，确认 UDID 在 profile 里 |
| `version mismatch` 警告 | tauri 包族版本不齐 | 构建时加 `--ignore-version-mismatches`，但优先修 lock |
| 前端页面空白 | CSP 拦了 ArkWeb 的自定义 scheme | 用补丁里的 `tauri.ohos.conf.json`，已放开 `http://hg.localhost` |
| 插件中心报 `state not managed` | `app.manage(PluginHost)` 被后置 | 保持原 `lib.rs` 的顺序，插件注册之前先 manage |

## 磁盘空间

实测 Android 版构建中间产物：

- `src-tauri/target/`：数 GB（debug + release）
- `node_modules/`：约 300 MB
- OHOS 工程模板 + HAP：约 200 MB

建议 E 盘预留 **20 GB** 以上。

## 网络

需要访问：

- `github.com`：拉 4 个官方分支（tauri / wry / tao / cargo-mobile2）
- `crates.io`：拉 Rust 依赖
- `registry.npmjs.org`：前端依赖（项目有 `.npmrc`，按原配置走）

这台机器 `git push` 走本地代理会 502，但 `api.github.com` 和 `uploads.github.com` 正常。
拉代码时如果 `git clone` 失败，可以改用 `cargo` 的 git 拉取（走自己的 HTTP 栈）或配 git 代理。
