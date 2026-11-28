# 网页登录插件 → HarmonyOS 实现

## Android 现状

`src/android_login.rs`（70 行）通过 Tauri 的 `PluginHandle::run_mobile_plugin_async` 调 Java 层：

| 方法 | 方向 | 作用 |
|---|---|---|
| `supported` | Rust → 原生 | 查询是否支持网页登录 |
| `openLogin` | Rust → 原生 | 打开登录 WebView，带 `session` 和 `request` |
| `cancelLogin` | Rust → 原生 | 取消指定会话的登录窗口 |

Java 层在 `src-tauri/android/LoginWebViewPlugin.kt`，用的是 Android WebView 独立进程。
Rust 侧 `WebLoginProvider` trait 的 `open()` 返回 `BoxFuture<Result<LoginCompletion>>`，
并处理 `CANCELLED` / `RATE_LIMITED` / `NETWORK` 三种错误码。

## 鸿蒙实现思路

Tauri 的 OHOS 分支**没有** Android 那套 `register_android_plugin` 机制。
鸿蒙侧走 NAPI：Rust 通过 `napi-ohos` 导出函数，ArkTS 侧实现 WebView 页面与回调。

### 1. Rust 侧：把插件句柄换成 NAPI 调用

新建 `src/ohos_login.rs`，保持 `WebLoginProvider` trait 签名不变，只替换内部实现：

```rust
// src/ohos_login.rs（鸿蒙专用）
use futures_util::future::BoxFuture;
use hghub_hpp::{
    web_login::{LoginCompletion, LoginRequest, WebLoginProvider},
    PluginError, Result,
};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct OhosLogin;

impl OhosLogin {
    pub async fn supported(&self) -> Result<bool> {
        // 鸿蒙 ArkWeb 始终可用
        Ok(true)
    }
}

impl WebLoginProvider for OhosLogin {
    fn open(
        &self,
        _: String,
        request: Arc<LoginRequest>,
        cancel: CancellationToken,
    ) -> BoxFuture<'static, Result<LoginCompletion>> {
        Box::pin(async move {
            // 通过 NAPI 调 ArkTS 的 openLogin；ArkTS 打开一个 WebView 页面，
            // 登录完成后用 napi 回调把 JSON 结果传回 Rust。
            let session = uuid::Uuid::new_v4().to_string();
            let json = serde_json::json!({
                "session": session,
                "request": request.as_ref(),
            });

            // 这里的 bridge_open_login 是你在 lib.rs 里用 napi_ohos 导出的函数
            let result = crate::ohos_bridge::call_arkts("openLogin", json).await;

            // 保持与 Android 版一致的取消语义：runtime 丢 future 时仍要关窗口
            tokio::spawn(async move {
                let _ = cancel.cancelled().await;
                let _ = crate::ohos_bridge::call_arkts(
                    "cancelLogin",
                    serde_json::json!({"session": session}),
                ).await;
            });

            match result {
                Ok(v) => serde_json::from_value::<LoginCompletion>(v)
                    .map_err(|e| PluginError::internal(format!("登录结果解析失败：{e}"))),
                Err(e) => {
                    // 错误码映射照抄 Android 版，保证前端拿到同样的 code
                    let code = e.get("code").and_then(|x| x.as_str()).unwrap_or("");
                    match code {
                        "CANCELLED" => Err(PluginError::cancelled()),
                        "RATE_LIMITED" => Err(PluginError::new("RATE_LIMITED", "请先关闭当前网页登录窗口")),
                        "NETWORK" => Err(PluginError::new("NETWORK", "登录页面加载失败")),
                        _ => Err(PluginError::internal(format!("鸿蒙网页登录出错：{e}"))),
                    }
                }
            }
        })
    }
}
```

### 2. `lib.rs` 的条件编译

现在 `src/lib.rs` 里是：

```rust
#[cfg(target_os = "android")]
let builder = builder.plugin(... register_android_plugin("com.hghub.player", "LoginWebViewPlugin") ...);
app.manage(android_login::AndroidLogin(handle));
```

改成：

```rust
#[cfg(target_os = "android")]
use android_login as login_impl;
#[cfg(target_os = "ohos")]
use ohos_login as login_impl;

#[cfg(target_os = "android")]
let builder = builder.plugin(/* 原 Android 插件注册 */);
#[cfg(target_os = "ohos")]
let builder = builder; // 鸿蒙不需要 Tauri mobile plugin

// 两个平台都执行，类型由 use 决定
app.manage(login_impl::OhosOrAndroidLogin);
```

注意两个 struct 名字要统一（可以在各自文件里 `pub use` 一个共同别名），
或者直接写两个 `app.manage()` 分支，更简单不容易出错。

### 3. ArkTS 侧：登录页面

在 `src-tauri/gen/ohos/entry/src/main/ets/pages/` 下加 `LoginPage.ets`：

```ets
import { webview } from '@kit.ArkWeb';
import { router } from '@kit.ArkUI';
import testNapi from 'libhuangguo_client_lib.so';

@Entry
@Component
struct LoginPage {
  @State private url: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    this.url = params['url'] ?? '';
  }

  build() {
    Column() {
      Web({ src: this.url, controller: this.controller })
        .width('100%')
        .height('100%')
        .onLoadIntercept((event) => {
          // 拦截登录完成回调 URL，解析 code/token 后回传 Rust
          const u = event.data.getRequestUrl();
          if (u.startsWith('hghub://login-callback')) {
            testNapi.onLoginResult(JSON.stringify({ url: u }));
            router.back();
            return true;
          }
          return false;
        })
        .onControllerAttached(() => {
          // 可在这里注入必要的 JS
        })
    }
  }
}
```

### 4. 需要你补的一处业务判断

Android 版 `LoginWebViewProfile.kt` 里有会话隔离逻辑（避免两个登录窗口串会话）。
鸿蒙版如果用同一个 `LoginPage`，`session` 参数要透传并在回调里带上，
否则 `cancelLogin` 关错窗口。上面示例里 `session` 已放进 JSON，回调时记得原样带回。

## 验收

1. 前端点登录 → ArkWeb 打开登录页
2. 登录成功 → Rust 收到 `LoginCompletion`，前端进入已登录态
3. 登录中途返回 → 前端收到 `CANCELLED`，不报错
4. 连开两次 → 第二次返回 `RATE_LIMITED`
5. 断网 → 返回 `NETWORK`
