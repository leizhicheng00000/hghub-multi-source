# HGhub 鸿蒙版（HarmonyOS NEXT）安装说明

## 零、先看这一条：你的手机是不是华为？

这决定了你到底该装哪个包，两者不能混用：

| 你的手机 | 该装什么 | 说明 |
|---|---|---|
| **任何非华为安卓机**（小米 / OPPO / vivo / 荣耀独立后机型 / 三星 / 一加…） | **原来那个 APK** | 它们跑的是 Android，不认 HAP。直接用 `HGhub_0.0.5_arm64_全源64_修复版.apk`，功能完整，不需要鸿蒙版 |
| 华为 / 荣耀老机型，HarmonyOS 4.x 及以下 | **也是 APK** | 这一代鸿蒙底层仍是 AOSP 兼容层，APK 直接装 |
| 华为，HarmonyOS NEXT（5.0.0 及以上，纯血鸿蒙） | **本目录的 HAP** | 这一代彻底移除了 Android 兼容层，只能装 HAP |

一句话：**只有纯血鸿蒙（NEXT）才需要 HAP，其它所有手机装 APK 就对了。**

## 一、当前进度

| 环节 | 状态 | 说明 |
|---|---|---|
| Rust 交叉编译 | ✅ 已通过 | `libhuangguo_client_lib.so` 11.8 MB，aarch64 |
| 前端打包 | ✅ 已内嵌 | React 前端编译进 .so，启动即加载，无需额外资源 |
| HAP 组装 | ✅ 已通过 | 13 MB |
| **签名** | ✅ **已完成** | 发布证书 + 发布 Profile，签名校验 `Verify success` |
| 装机验证 | ⬜ 待你在鸿蒙设备上执行 | 本机无鸿蒙设备，无法代跑 |

### 产物信息

| 项 | 值 |
|---|---|
| 文件名 | `HGhub_0.0.5_harmony_arm64_signed.hap` |
| 大小 | 13 MB |
| 包名 | `com.hghub.player`（与安卓版一致） |
| 版本 | 1.0.0 |
| 最低系统 | API 12（HarmonyOS NEXT 5.0.0） |
| 支持设备 | phone / tablet / 2in1 |
| SHA256 | `9203956a151dc88b1d74cbe5dc92143936b67abfc378d31febe77eb35e858aff` |
| 签名类型 | 发布证书（有效期至 2029-11-28），**不绑定任何设备 UDID** |

> 注：重新签名后 SHA256 会变（签名块里带时间戳），这是正常的。校验时以当次输出为准。

## 二、文件在哪

```
E:/HGhub-v005/交付/
├── HGhub_0.0.5_harmony_arm64_signed.hap     ← ★ 已签名，装这个
├── HGhub_0.0.5_harmony_arm64_unsigned.hap   ← 未签名（仅供留档，装不上）
└── 签名材料/
    ├── hghub-release.p12     ← 发布证书密钥库（alias=hghub-release，密码 Hghub@2026）
    ├── hghub-release.cer     ← 发布证书，有效期 2029-11-28
    ├── hghub-release.p7b     ← 发布 Profile，已绑定 com.hghub.player
    ├── hghub-release.csr     ← 证书请求文件（已用掉，留档）
    ├── hghub.p12             ← 调试证书密钥库（备用）
    ├── hghub-debug.cer       ← 调试证书（调试 Profile 没建，需设备 UDID）
    └── hghub.csr             ← 调试证书请求（已用掉）
```

**`hghub-release.p12` 务必自己备份一份**。以后要发新版应用，必须用同一把密钥签名，
密钥丢了就只能换新证书，老用户无法覆盖升级。

构建脚本（以后改代码重新出包用）：

```
E:/HGhub-v005/鸿蒙移植/build_hap.sh    ← 一键编译 + 打 HAP
E:/HGhub-v005/鸿蒙移植/sign_hap.sh     ← 一键签名
```

## 三、签名是怎么做的（已完成，留档）

签名需要三样东西，都已办好：

1. **发布证书** `hghub-release.cer`
   控制台「证书 → 新增证书 → 类型选发布证书 → 上传 CSR」签发，有效期 3 年。
2. **发布 Profile** `hghub-release.p7b`
   控制台「Profile → 添加 → 类型选**发布** → 选应用黄果 → 选发布证书」。
   关键点：**类型选「发布」就不需要绑定设备 UDID**，这是不依赖真机也能签出可用包的原因。
   （「调试」类型必须绑 UDID，只能装在绑过的那台机器上。）
3. **签名命令**（已执行成功）：

```bash
java -jar "E:/ohsdk3/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar" sign-app \
 -keyAlias "hghub-release" -keyPwd "Hghub@2026" -signAlg "SHA256withECDSA" -mode "localSign" \
 -appCertFile "hghub-release.cer" -profileFile "hghub-release.p7b" \
 -inFile "HGhub_0.0.5_harmony_arm64_unsigned.hap" \
 -keystoreFile "hghub-release.p12" -keystorePwd "Hghub@2026" \
 -outFile "HGhub_0.0.5_harmony_arm64_signed.hap"
```

验证结果：`Digest verify result: true` / `Verify success`。

## 四、装到鸿蒙设备

手机开启「设置 → 系统 → 开发者选项 → USB 调试」，数据线连电脑：

```bash
"E:/ohsdk3/sdk/default/openharmony/toolchains/hdc.exe" list targets
"E:/ohsdk3/sdk/default/openharmony/toolchains/hdc.exe" install -r "E:/HGhub-v005/交付/HGhub_0.0.5_harmony_arm64_signed.hap"
```

装完桌面出现「HGhub」图标，首次启动允许联网权限即可。

**关于发布签名包的侧载限制**：用发布证书签的包签名链合法、可在任意鸿蒙设备侧载安装，
但 HarmonyOS NEXT 对「非应用市场来源」的应用有额外提示（首次安装需在系统设置里允许）。
若要彻底免掉这层提示，唯一途径是把应用上传到 AppGallery 走审核上架。

## 五、成人内容与插件网络需求

### 5.1 成人内容默认开启

鸿蒙版与安卓版共用同一套 64 个插件。这一版把「显示成人内容」默认值改成了**开启**，32 个成人源装好即可见，不用进设置翻开关；设置里的开关仍保留，可随时关闭。
老版本升级上来时会用一次性迁移标记 `hpp.matureV2` 强制打开一次，之后尊重用户选择。

### 5.2 网络需求标注

64 个源已按真实源站域名和解析 IP 分成三档：

| 档位 | 数量 | 含义 |
|---|---|---|
| 🟢 可直连 | 14 | 源站在境内/香港，或域名已失效，不用代理 |
| 🟡 需海外节点 | 37 | 源站在境外，任意地区海外节点即可 |
| 🔴 需特定国家节点 | 13 | 站点有地区限制，必须选对应国家 |

🔴 特定节点清单：Javtiful / Hanime1 / hanime16 / GiriGiri / 18J.TV → **日本**；
Pornhub / xHamster / AVJB / Manko / 奈飞工厂 → **美国**；麻豆社 / 玩偶姐姐 → **美国或香港**；Gimy TV → **台湾或香港**。

完整逐条对照见 **[网络需求对照表.md](网络需求对照表.md)**。App 内插件中心的详情页也加了 🟢/🟡/🔴 标签和节点建议。

---

## 六、已知限制（不影响启动和播放）

鸿蒙没有 Android 那套原生插件机制，以下三处功能目前是**降级实现**，需要补 ArkTS 代码（方案已写在 `鸿蒙移植/arks/` 下）：

| 功能 | 安卓做法 | 鸿蒙现状 |
|---|---|---|
| 网页登录 | 独立进程 WebView 抓 OAuth 回调 | 走系统浏览器，登录态需手动复制；或后续补 LoginPage |
| 插件目录选择 | SAF 授权目录 | 需手动把 `.js` 插件放进应用沙箱目录；后续补 DocumentViewPicker |
| 强制横屏 | 改 `requestedOrientation` | 暂为空实现，视频可全屏播放但不会自动转横屏 |

播放、插件运行、番剧列表这些主流程都是 Rust 侧逻辑，与平台无关，已完整编译进包。

## 七、什么情况下要重新出包

改了前端或 Rust 代码后：

```bash
bash "E:/HGhub-v005/鸿蒙移植/build_hap.sh"
bash "E:/HGhub-v005/鸿蒙移植/sign_hap.sh"
```

脚本已固化全部环境变量和踩过的坑（SDK 路径、ohpm 路径、能力版本对齐），不要手敲命令。

**注意**：如果哪天执行了 `cargo tauri ohos init`（重新生成工程骨架），
`gen/ohos/entry/hvigorfile.ts` 会被重置回模板，模板里那个调用
`cargo tauri ohos dev-eco-studio-script` 的钩子会让单独打包直接 panic。
届时把 `entry/hvigorfile.ts` 换成本项目里那份（`plugins: []` 的极简版）即可，备份在 `E:/hgport/entry_hvigorfile.ts.bak`。

若换成别的鸿蒙设备、系统版本更低导致装不上，把 `gen/ohos/build-profile.json5` 里
`compatibleSdkVersion` 的 `5.0.0(12)` 再往下调到设备对应 API 即可重新打包。
