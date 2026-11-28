# 横竖屏切换 → HarmonyOS 实现

## 现状

`src/commands.rs` 里：

```rust
#[cfg(target_os = "android")]
pub async fn set_orientation(landscape: bool, plugin: tauri::State<'_, OrientationPlugin>) -> Result<(), String> {
    let _ = plugin.0.run_mobile_plugin::<()>("setOrientation", json!({"landscape": landscape}));
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn set_orientation(landscape: bool) -> Result<(), String> {
    let _ = landscape; Ok(())
}
```

桌面端是空实现；Android 调 `OrientationPlugin.kt` 改 `requestedOrientation`。
鸿蒙目前会走进 `not(android)` 分支——**能编过、不会崩，但横竖屏锁定不生效**，
播放器里的「 immersive 模式 / 强制横屏」会失灵。

## 鸿蒙实现

### 1. Rust 侧：加一个 ohos 分支

在 `src/commands.rs` 里把条件编译改成三分支：

```rust
#[cfg(target_os = "android")]
pub async fn set_orientation(landscape: bool, plugin: tauri::State<'_, OrientationPlugin>) -> Result<(), String> {
    let _ = plugin.0.run_mobile_plugin::<()>("setOrientation", json!({"landscape": landscape}));
    Ok(())
}

#[cfg(target_os = "ohos")]
pub fn set_orientation(landscape: bool) -> Result<(), String> {
    let _ = crate::ohos_bridge::call_arkts_sync(
        "setOrientation",
        serde_json::json!({"landscape": landscape}),
    );
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ohos")))]
pub fn set_orientation(landscape: bool) -> Result<(), String> {
    let _ = landscape; Ok(())
}
```

### 2. ArkTS 侧

在 `EntryAbility.ets` 里加方法（鸿蒙用 `window.setOrientation`）：

```ets
import window from '@ohos.window';

// 在 EntryAbility 类里
public setOrientation(landscape: boolean): void {
  const win = window.getLastWindow(this.context);
  win.then((windowClass) =>
    windowClass.setOrientation(
      landscape
        ? window.Orientation.LANDSCAPE
        : window.Orientation.PORTRAIT,
      window.WindowOrientationChangeReason.APP_SWITCH
    )
  ).catch((err: BusinessError) => {
    hilog.error(0x0000, 'HGhub', 'setOrientation failed: %{public}s', err.message);
  });
}
```

`libhuangguo_client_lib.so` 的 NAPI 导出里把这个函数暴露给 Rust：

```ets
// Index.d.ts 对应声明
export const setOrientation: (landscape: boolean) => void;
```

### 3. 注册时机

`EntryAbility` 现有模板里 `onWindowStageCreate` 已经拿了 `windowStage.getMainWindowSync()`，
把 `setOrientation` 挂到 NAPI bridge 上要在这个回调之后——否则窗口还没创建，调用会失败。

建议顺序：

```ets
async onWindowStageCreate(windowStage: window.WindowStage): Promise<void> {
  const mainWindow = windowStage.getMainWindowSync();
  await mainWindow.setWindowLayoutFullScreen(false);
  // 在这里注册 NAPI 回调
  registerOrientationBridge(mainWindow);
  super.onWindowStageCreate(windowStage);
}
```

## 验收

1. 播放横屏视频 → 自动转横屏，状态栏正常
2. 点返回 / 退出全屏 → 回竖屏
3. 平板（2in1）上同样生效
4. 横屏切后台再回来 → 方向保持
