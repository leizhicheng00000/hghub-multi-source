# HGhub 多源整合版（v0.0.5 · 64 源）

在 [HGhub](https://github.com/) 0.0.5 的 HPP 插件架构上，把原本只有 1 个内容源的安装包，
扩成**内置 64 个内容源**的 Android 构建，并修掉了原版「插件中心空白（state not managed）」的启动缺陷。

> **安装包**：[HGhub_0.0.5_arm64_64sources.apk](https://github.com/leizhicheng00000/hghub-multi-source/releases/download/v0.0.5-64sources/HGhub_0.0.5_arm64_64sources.apk)（60 MB，arm64-v8a，debug 签名，可直接覆盖安装）
> **插件包**：[HGhub-plugins-64.zip](https://github.com/leizhicheng00000/hghub-multi-source/releases/download/v0.0.5-64sources/HGhub-plugins-64.zip)（454 KB，64 个单文件插件）
> 全部产物见 **[Releases](https://github.com/leizhicheng00000/hghub-multi-source/releases/tag/v0.0.5-64sources)**。
> **鸿蒙 NEXT 安装包**：[HGhub_0.0.5_harmony_arm64_signed.hap](harmony/HGhub_0.0.5_harmony_arm64_signed.hap)（13 MB，已签名，纯血鸿蒙专用）。

---

## 一、这个仓库里有什么

| 目录 | 内容 |
|---|---|
| `app/` | HGhub 0.0.5 完整源码（已集成 64 源；剔除了 `target/`、`node_modules/`、`jniLibs/` 等构建产物） |
| `plugins/` | 64 个 HPP 插件单文件，可直接在 App「插件中心 → 导入」里选文件加载 |
| `plugins/_index.json` | 插件索引：id / 名称 / 版本 / 默认启停 / 是否成人 / 字节数 |
| `tools/` | 构建与校验脚本（插件抓取、meta 提取、语法检查、API 兼容性检查、探活、打包） |
| `integration/` | 相对上游 0.0.5 改动的 4 个文件（见第四节） |
| `docs/` | 交付说明、源清单 |
| `harmony/` | 鸿蒙 NEXT 版 HAP 安装包、交叉编译脚本、签名材料与移植文档 |

---

## 二、这 64 个源是怎么来的

来自 5 个公开的 HPP 插件仓库，同 id 冲突时优先取修复版：

| 来源仓库 | 提供数量 |
|---|---|
| `leohenshuai/hghub-plugins`（修复版） | 28 |
| `poisonhs/HGhub-Plugin` | 25 |
| `CoderL98/hghub-plugins` | 21 |
| `skfunghk/hghub-plugins` | 8 |
| `Beihaisir/HGhub-plugins` | 1 |

合并去重后 **64 个唯一源**；其中 `huangguo`（黄果短剧）是本项目自己重写的，不是上游插件。

### 黄果插件（`plugins/huangguo.js` v4.1.0）

原插件随官方站改版全部失效。本版是从零重写的，关键点：

1. **站点迁移**：旧域名 → `https://huangguoai.io`，接口同时改版
   （`/api/category/{tid}` → `/api/videos/category/{tid}`，`/api/chigua` → `/api/posts` 等）。
2. **加密通道 `dx150-edge-v1`**：ECDH P-256 → HKDF-SHA256 → AES-256-GCM。
   宿主 `hg.crypto` 只给 digest/hmac/aes/rsa，**没有 ECDH、没有 HKDF**，
   所以在插件里手写了 P-256（BigInt + Jacobian 坐标）和 HKDF。
3. **播放**：`POST /api/videos/{id}/episodes/{ep}/playback`，匿名即可拿到 m3u8，
   不需要登录态（早期结论「播放要登录」是因为用错了端点）。
4. **封面**：站点封面是 AES-128-CBC 密文（密钥在站点公开的 `crypto-image-protocol.js` 里），
   插件注册 `transform: { type: "plugin", name: "cover" }` 自行解密；
   已解密过的图会先按 magic number 判定放行，不会被二次解密。

---

## 三、安装

1. 到 **Releases** 下载 `HGhub_0.0.5_arm64_全源64_修复版.apk`；
2. **先卸载旧版或清除应用数据**再安装（旧 `index.json` 可能残留坏索引）；
3. 打开后进「插件中心」，能看到源即成功；被标记成人的源默认隐藏，去「设置 → 显示成人内容」打开。

> 若列表空白 / 播放一直转圈，大概率是运营商 DNS 污染（黄果站尤其明显）。
> 把手机 DNS 改成 `223.5.5.5` 或换移动数据再试。

---

## 四、相对上游 0.0.5 改了什么

只有三处，都在 `app/src-tauri/src/`：

### 1. `builtin.rs` —— 多插件种入

上游只硬编码了 1 个内置插件（`const HUANGGUO_CODE = include_str!(...)`）。
改为遍历 `SEEDS` 数组：每个 id 独立判存在、已有不覆盖、目录名过滤 `..` `/` `\\`，
单个插件解析失败只跳过它自己。

### 2. `builtin_seeds.rs`（新增，脚本生成）

64 条 `include_str!` + 初始启停值，由 `tools/build_builtin.mjs` 生成，别手改。

### 3. `lib.rs` —— 两处顺序调整（这是修 bug 的关键）

```rust
// 改前：先种插件，后注册宿主
builtin::plant(&dir.join("hpp"))?;           // 64 次 inspect，每次最多 5 秒
app.manage(plugins::PluginHost::new(...));   // 排在这后面，还没轮到执行

// 改后：先注册宿主（PluginHost::new 只存路径，零 IO），再种插件
app.manage(plugins::PluginHost::new(dir.join("hpp")));
if let Err(e) = builtin::plant(&dir.join("hpp")) {
    eprintln!("[builtin] 内置插件写入失败：{e}");
}
```

**踩坑记录**：`hghub_hpp::runtime::inspect()` 并不是「读源码里的 meta 文本」，
而是 `Runtime::new()` + `Module::declare().eval()` —— **真的执行插件顶层代码**，
每个带 5 秒 deadline。上一版在 `setup()` 里对 64 个插件挨个 inspect，
启动路径被占满，`app.manage()` 还没执行，前端就来取数据，于是报：

```
state not managed for field 'host' on command 'hpp_manage'
```

修法是**把 meta 提取搬到构建期**：`tools/build_builtin.mjs` 用 Node 把每个插件的
`meta` 对象算好，写成 `app/builtin/builtin_meta.json`；启动时只 `serde_json` 解析这一个
JSON，再做 `Meta::parse` 校验，**启动路径上零 QuickJS**。

> `Meta::parse` 的校验很严：id 首字符必须小写字母或数字、字符集 `a-z0-9._-`、≤64 字节、
> 不以点结尾、非 Windows 保留名；version 必须三段；protocol 必须为 1；
> settings 每项需 key（唯一）/ label / type ∈ text|password|switch|number|select。
> `tools/meta_validate.mjs` 复刻了这套规则，可在打包前本地跑一遍。

---

## 五、自己构建

环境：Node 18+ / pnpm / Rust stable / Android SDK + NDK r27b / JDK 17。

```bash
cd app
pnpm install

# 交叉编译（Windows 上务必先看 tools/env.sh 的注释）
source ../tools/env.sh
pnpm tauri android build --debug --target aarch64 --apk --ci
```

产物：`app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

### Windows 构建会踩的坑（都已在 `tools/env.sh` 里处理）

| 现象 | 根因 | 处理 |
|---|---|---|
| `ld: cannot find ...rlib`（文件明明存在） | GNU binutils 按 GBK 解码中文路径（`C:\Users\雷志程\` → `À×Ö¾³Ì`） | `RUSTUP_HOME`/`CARGO_HOME`/`TEMP` 全部搬到纯 ASCII 路径 |
| rustc 无法 spawn 链接器 | NDK 的 `aarch64-linux-android24-clang` 是 `.cmd` 包装器 | 复制 `clang.exe` 成带 triple 的名字 |
| `only metadata stub found for core` | 两个 rustup home 混用 | 固定 `RUSTC` 绝对路径 |
| rustc `0xc0000409` / `os error 1453` | 内存不足（explorer 泄漏到 8 GB+ 时必然崩） | 释放内存、`CARGO_BUILD_JOBS=4`、关 debuginfo |
| APK 体积翻倍 | `assemble` 会把上一轮产物追加进 zip | 打包前删掉旧 APK |

另注：`.cargo/config.toml` 里**不要**写任何 `rustflags`，
否则会污染 Android 目标，把 linker 覆盖成 `rust-lld` 直接链接失败。

---

## 六、源清单（64）

默认启用 22 个、停用 42 个；标成人的 32 个默认在插件中心隐藏。

「停用」只代表**当时从我这台机器访问首页超时**，不代表源已失效 ——
当初黄果也是这样，实际是 DNS 污染。全部源都已内置，插件中心点开关即可启用。

| # | 插件 ID | 名称 | 版本 | 默认 | 内容 |
|---|---|---|---|---|---|
| 1 | `4kav` | 4k-av | 1.0.3 | ✅ 启用 | 普通 |
| 2 | `91porn` | 91porn | 1.0.1 | ⏸ 停用 | 成人 |
| 3 | `anfuns` | anfuns | 1.0.1 | ⏸ 停用 | 普通 |
| 4 | `anime1.source` | Anime1 | 1.1.0 | ⏸ 停用 | 普通 |
| 5 | `aowu` | 嗷呜动漫 | 1.0.1 | ⏸ 停用 | 普通 |
| 6 | `apple` | 小苹果 | 1.0.1 | ⏸ 停用 | 普通 |
| 7 | `auete.source` | Auete影视 | 1.0.0 | ✅ 启用 | 普通 |
| 8 | `av321.source` | 321AV | 1.0.0 | ⏸ 停用 | 成人 |
| 9 | `av591.source` | 591AV | 1.0.0 | ⏸ 停用 | 成人 |
| 10 | `avjb` | AVJB | 1.0.0 | ⏸ 停用 | 成人 |
| 11 | `avtoday` | avtoday | 1.0.4 | ⏸ 停用 | 成人 |
| 12 | `bfzy.source` | 暴风资源 | 1.0.4 | ⏸ 停用 | 普通 |
| 13 | `bl911` | 911爆料网 | 1.0.1 | ⏸ 停用 | 成人 |
| 14 | `cg91.source` | 91吃瓜 | 1.0.3 | ⏸ 停用 | 成人 |
| 15 | `chengguo.source` | 橙果短剧 | 1.0.2 | ✅ 启用 | 成人 |
| 16 | `dbku.source` | 独播库 | 1.0.1 | ✅ 启用 | 普通 |
| 17 | `dhvideo.source` | 豆花电影网 | 1.0.0 | ✅ 启用 | 普通 |
| 18 | `dpw.source` | 66大片网 | 1.1.0 | ✅ 启用 | 普通 |
| 19 | `duanju55.source` | 五五短剧 | 1.0.0 | ✅ 启用 | 普通 |
| 20 | `duanjutt` | 短剧天堂 | 1.0.1 | ⏸ 停用 | 普通 |
| 21 | `duobo` | 多播 duobo | 1.0.3 | ✅ 启用 | 成人 |
| 22 | `gimy.source` | Gimy TV | 1.0.0 | ✅ 启用 | 普通 |
| 23 | `girigiri.source` | GiriGiri | 1.0.0 | ⏸ 停用 | 普通 |
| 24 | `haijiao` | 海角 | 1.0.1 | ⏸ 停用 | 成人 |
| 25 | `hanime` | Hanime1 | 1.0.4 | ⏸ 停用 | 成人 |
| 26 | `hanime16.source` | H動漫 hanime16 | 1.0.1 | ⏸ 停用 | 成人 |
| 27 | `haose` | 好色TV | 1.0.2 | ⏸ 停用 | 成人 |
| 28 | `hdmoli` | hdmoli | 2.0.0 | ✅ 启用 | 普通 |
| 29 | `heiliao.source` | 黑料网 | 1.0.3 | ⏸ 停用 | 成人 |
| 30 | `hhkan.source` | 好好看 | 1.0.3 | ⏸ 停用 | 普通 |
| 31 | `hjkk` | 韩剧看看 | 1.0.1 | ⏸ 停用 | 普通 |
| 32 | `hkdoll` | 玩偶姐姐 | 1.0.5 | ⏸ 停用 | 成人 |
| 33 | `hl365.source` | 黑料不打烊 | 1.1.0 | ⏸ 停用 | 成人 |
| 34 | `hlws.source` | 51黑料 | 1.0.1 | ✅ 启用 | 成人 |
| 35 | `huangguo` | 黄果短剧 | 4.1.0 | ✅ 启用 | 普通 |
| 36 | `j18` | 18J.TV | 1.0.0 | ⏸ 停用 | 成人 |
| 37 | `javtiful.source` | Javtiful | 1.1.0 | ⏸ 停用 | 成人 |
| 38 | `jdys` | 绝对影视 | 1.0.1 | ✅ 启用 | 普通 |
| 39 | `jisu.source` | 极速追剧 | 1.0.1 | ✅ 启用 | 普通 |
| 40 | `jpyy` | 金牌影视 | 1.0.1 | ⏸ 停用 | 普通 |
| 41 | `juzong.source` | 剧踪影院 | 1.0.1 | ✅ 启用 | 普通 |
| 42 | `kxyy.source` | 开心影院 | 1.0.0 | ✅ 启用 | 普通 |
| 43 | `lovebox.source` | 18PORNY | 1.0.0 | ✅ 启用 | 成人 |
| 44 | `madou` | 麻豆社 | 1.0.3 | ⏸ 停用 | 成人 |
| 45 | `manko.source` | Manko | 1.1.0 | ⏸ 停用 | 成人 |
| 46 | `mfdmgw.source` | 免费动漫 | 1.0.1 | ✅ 启用 | 普通 |
| 47 | `mrds` | 每日大赛 | 1.0.2 | ⏸ 停用 | 成人 |
| 48 | `mwxk62` | KKAV | 1.1.2 | ✅ 启用 | 成人 |
| 49 | `netflixgc.source` | 奈飞工厂 | 1.0.1 | ⏸ 停用 | 普通 |
| 50 | `pianku.source` | 片库 | 1.1.0 | ✅ 启用 | 普通 |
| 51 | `porna91` | 91Porna | 1.0.2 | ⏸ 停用 | 成人 |
| 52 | `pornhub` | Pornhub | 1.0.2 | ⏸ 停用 | 成人 |
| 53 | `pornlulu` | 撸撸视频 Pornlulu | 1.0.2 | ⏸ 停用 | 成人 |
| 54 | `porny` | 91Porny（九色） | 1.0.1 | ⏸ 停用 | 成人 |
| 55 | `rou` | Rou Video | 1.0.0 | ⏸ 停用 | 成人 |
| 56 | `saohuo` | 烧火电影 | 1.0.1 | ⏸ 停用 | 普通 |
| 57 | `tangxin` | 糖心Vlog | 1.0.1 | ⏸ 停用 | 成人 |
| 58 | `tiantian` | 天天影视 | 1.0.1 | ⏸ 停用 | 普通 |
| 59 | `wwgz` | 农民影视 | 1.0.3 | ⏸ 停用 | 普通 |
| 60 | `xhamster` | xHamster | 1.0.2 | ⏸ 停用 | 成人 |
| 61 | `xiaohys` | 小红影视 | 1.0.1 | ✅ 启用 | 普通 |
| 62 | `xingya` | 星芽短剧 | 1.0.4 | ⏸ 停用 | 普通 |
| 63 | `xx9` | 主播视频 | 1.0.3 | ⏸ 停用 | 成人 |
| 64 | `yingxi.source` | 影夕视频 | 1.0.1 | ✅ 启用 | 普通 |

---

## 七、鸿蒙版（HarmonyOS NEXT）

本仓库同时提供纯血鸿蒙（HarmonyOS NEXT 5.0.0 及以上）的 HAP 安装包，
源码通过 Tauri 官方 `feat/open-harmony` 分支交叉编译，React 前端零改动，
由 ArkWeb 承载。详见 [`harmony/README.md`](harmony/README.md)。

**先确认你的手机要不要这个包：**

| 手机系统 | 该装什么 |
|---|---|
| 非华为安卓机（小米 / OPPO / vivo / 三星等） | 安卓 APK，不要装 HAP |
| 华为 HarmonyOS 4.x 及以下 | 也是安卓 APK（底层兼容 AOSP） |
| 华为 HarmonyOS NEXT 5.x | 本仓库的 HAP |

### 产物

- `harmony/HGhub_0.0.5_harmony_arm64_signed.hap` — 已签名，13 MB
- 包名 `com.hghub.player`，与安卓版一致
- 最低 API 12（HarmonyOS NEXT 5.0.0），支持手机 / 平板 / 2in1
- 发布证书签名，有效期至 2029-11-28，不绑定设备 UDID

### 源码与脚本

`harmony/` 下包含交叉编译与打包脚本（`build_hap.sh`、`build_ohos.sh`、`sign_hap.sh`）、
工具链踩坑记录（`toolchain.md`）、Cargo/tauri 配置补丁，以及三个待补 ArkTS 插件的设计文档（`arks/`）。

签名材料在 `harmony/signing/`，其中 `hghub-release.p12` 是发布密钥库（密码 `Hghub@2026`）。
发布新版必须用同一把密钥签名，否则老用户无法覆盖升级。

### 已知降级项

鸿蒙版目前有三处功能降级（不影响启动与播放）：网页登录、插件目录选择、强制横屏。
方案已写在 `harmony/arks/`，等待后续补 ArkTS 实现。

---

## 八、更新记录

- **2026-11-28** 新增 HarmonyOS NEXT 版 HAP：Tauri OHOS 分支交叉编译 + 发布证书签名。
- **2026-11-27** 内置源 1 → 64；修 `state not managed` 启动崩溃；黄果插件 v4.1.0 修封面解密。
- **2026-11-26** 黄果插件 v4.0：重写加密通道，支持匿名播放。
- **2026-11-25** 完成 Android arm64 交叉编译环境打通。
