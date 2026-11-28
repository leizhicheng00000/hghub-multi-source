# 插件目录插件 → HarmonyOS 实现

## Android 现状

`src/android_documents.rs`（55 行）调 Java 层两个方法：

| 方法 | 返回 | 作用 |
|---|---|---|
| `pickDirectory` | `{files: [{name, location}]}` | 用 Android SAF 选一个目录，列出里面的文件 |
| `resolveEntry` | `{location}` | 把目录内的相对引用解析成可读取的 URI |

Java 实现在 `src-tauri/android/PluginDocumentsPlugin.kt` + `PluginDocumentPaths.kt`，
走的是 Android `ACTION_OPEN_DOCUMENT_TREE` 的授权 URI。

## 鸿蒙实现思路

HarmonyOS NEXT 没有 SAF，用的是 **文件选择器 picker**（`@kit.CoreFileKit` 的 `picker.DocumentViewPicker`）
和 **文件分享沙箱 URI**。能力上能对上，只是 API 名字不同。

### 1. Rust 侧

新建 `src/ohos_documents.rs`，接口签名照抄 `AndroidDocuments`：

```rust
// src/ohos_documents.rs
use hghub_hpp::{PluginError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize, Serialize)]
pub struct DocumentChoice {
    pub name: String,
    pub location: String,
}

#[derive(Clone)]
pub struct OhosDocuments;

impl OhosDocuments {
    pub async fn pick(&self) -> Result<Vec<DocumentChoice>> {
        // 调 ArkTS 的 pickDirectory，返回 [{name, uri}]
        let v = crate::ohos_bridge::call_arkts("pickDirectory", json!({})).await
            .map_err(|e| PluginError::internal(format!("选择目录失败：{e}")))?;
        serde_json::from_value(v)
            .map_err(|e| PluginError::internal(format!("目录结果解析失败：{e}")))
    }

    pub fn resolve(&self, base: &str, reference: &str) -> Result<String> {
        // 鸿蒙的 uri 一般是 file:// 或沙箱路径，拼接规则与 Android 不同，
        // 但对外仍返回 String，前端无感。
        if reference.starts_with('/') || reference.contains("://") {
            return Ok(reference.to_string());
        }
        let trimmed = base.trim_end_matches('/');
        Ok(format!("{trimmed}/{reference}"))
    }
}
```

`resolve()` 做成同步纯字符串拼接是有意的：Android 那次调用本来也是 `run_mobile_plugin`（同步），
而鸿蒙的沙箱路径本身就是绝对路径，不需要再走系统解析。

### 2. ArkTS 侧

在 EntryAbility 同目录加 `DocumentPicker.ets`：

```ets
import { picker } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import testNapi from 'libhuangguo_client_lib.so';

export async function pickDirectory(): Promise<string> {
  try {
    const documentPicker = new picker.DocumentViewPicker();
    const options = new picker.DocumentSelectOptions();
    // 插件是 .js 文件，限制可选类型避免用户选到别的
    options.fileSuffixFilters = ['.js', '.json'];
    const result = await documentPicker.select(options);

    const files = result.map((uri: string) => {
      const name = uri.substring(uri.lastIndexOf('/') + 1);
      return { name: name, location: uri };
    });
    return JSON.stringify(files);
  } catch (e) {
    const err = e as BusinessError;
    // 对齐 Android 的错误码，Rust 侧映射逻辑不用改
    if (err.code === 1) {
      throw new Error('UNSUPPORTED: 当前设备不支持目录选择');
    }
    throw new Error(`INVALID_ARGUMENT: ${err.message}`);
  }
}
```

### 3. 权限

`module.json5` 里加：

```json5
"requestPermissions": [
  { "name": "ohos.permission.INTERNET" },
  { "name": "ohos.permission.FILE_ACCESS_PERSIST" }
]
```

`FILE_ACCESS_PERSIST` 让应用记住用户授权的目录，重启后还能读插件——对应 Android 版
`takePersistableUriPermission` 的行为。不加这个，每次重启都要重新选目录。

### 4. 要注意的差异

- **Android**：`location` 是 `content://` URI，需要 `ContentResolver` 读取
- **鸿蒙**：`location` 是 `file://` 或沙箱路径，`fs.openSync` 直接能读

`hghub-hpp` 里的插件加载代码用的是 `std::fs::read_to_string`，对鸿蒙沙箱路径可以直接工作。
如果 ArkTS 返回的是 `file://` 前缀，在 Rust 侧去掉前缀再交给 `std::fs`。

## 验收

1. 插件中心 → 从文件导入 → 能打开系统文件选择器
2. 选一个含 `.js` 的目录 → 列表显示文件名
3. 装一个插件 → 能正常加载并出现在插件中心
4. 杀掉应用重启 → 插件还在（验证 `FILE_ACCESS_PERSIST` 生效）
