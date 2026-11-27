//! 内置插件种子。
//!
//! 应用本身不联网拉内容，本构建把一批 HPP 单文件插件随包带上：首次启动时写入
//! `<app_data>/hpp/`，之后与其他插件同等对待——用户可停用、覆盖或删除。
//! 只在索引里没有这个 id 时才种一次，绝不覆盖用户已有的配置。
//!
//! ## 为什么元信息不在这里现算
//!
//! `hpp::runtime::inspect` 会新建一个 QuickJS 运行时并把插件源码 `eval` 一遍——
//! 也就是**真的执行插件顶层代码**，每个还带 5 秒超时。一个插件没问题，六十几个
//! 在启动路径上累加，足以把 setup 拖到超时：命令还没 `.manage()` 注册，前端已经在
//! 调 `hpp_manage`，于是报 "state not managed"。
//!
//! 所以 meta 由 `build_builtin.mjs` 在**构建期**求值好写进 `builtin_meta.json`，
//! 这里只做一次 JSON 解析。启动路径上没有 QuickJS，也就没有 panic 和卡顿。
//! 清单与 `SEEDS` 一一对应，顺序由同一个脚本保证。

use crate::builtin_seeds::SEEDS;
use hghub_hpp::model::Meta;
use serde_json::{json, Value};
use std::path::Path;

/// 构建期提取的插件元信息，与 `SEEDS` 同序。
const BUILTIN_META: &str = include_str!("../../builtin/builtin_meta.json");

/// 把随包插件写进插件目录。已存在同 id 条目时不做任何改动。
///
/// 单个插件失败（meta 不合法、写盘出错）只跳过它自己并打到 stderr，
/// 不影响其余插件落地——否则一个坏插件就能让整批源集体消失。
pub fn plant(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| format!("建插件目录失败：{e}"))?;

    let index_path = root.join("index.json");
    // 索引存在但解析不了时不要覆盖：那是用户的数据，交给 PluginManager 自己报错。
    let mut index: Vec<Value> = if index_path.exists() {
        match serde_json::from_slice::<Vec<Value>>(
            &std::fs::read(&index_path).map_err(|e| e.to_string())?,
        ) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        }
    } else {
        Vec::new()
    };

    let metas: Vec<Value> = serde_json::from_str(BUILTIN_META)
        .map_err(|e| format!("内置插件清单不是合法 JSON：{e}"))?;

    let mut added = 0usize;
    let mut failed = 0usize;
    for (i, seed) in SEEDS.iter().enumerate() {
        let Some(raw) = metas.get(i) else {
            failed += 1;
            eprintln!("[builtin] 清单缺少 {} 的元信息", seed.id);
            continue;
        };
        // 清单与代码表错位时宁可不种，也不要写进一个身份不对的条目。
        if raw.get("id").and_then(Value::as_str) != Some(seed.id) {
            failed += 1;
            eprintln!("[builtin] 清单第 {i} 项与 {} 不对应", seed.id);
            continue;
        }
        let meta = match Meta::parse(raw.clone()) {
            Ok(m) => m,
            Err(e) => {
                failed += 1;
                eprintln!("[builtin] {} 元信息无效：{e}", seed.id);
                continue;
            }
        };
        match plant_one(root, &mut index, seed, &meta) {
            Ok(true) => added += 1,
            Ok(false) => {}
            Err(e) => {
                failed += 1;
                eprintln!("[builtin] 插件 {} 种入失败：{e}", seed.id);
            }
        }
    }

    if added == 0 {
        return Ok(());
    }

    let bytes = serde_json::to_vec_pretty(&index).map_err(|e| e.to_string())?;
    // 原子写：先落临时文件再改名，避免断电留下半截索引。
    let tmp = root.join("index.json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("写临时索引失败：{e}"))?;
    std::fs::rename(&tmp, &index_path).map_err(|e| format!("替换索引失败：{e}"))?;
    eprintln!("[builtin] 新种入 {added} 个插件，失败 {failed} 个");
    Ok(())
}

/// 种入单个插件。返回 true 表示索引发生了新增。
fn plant_one(
    root: &Path,
    index: &mut Vec<Value>,
    seed: &crate::builtin_seeds::Seed,
    meta: &Meta,
) -> Result<bool, String> {
    let id = meta.id.clone();
    if id.is_empty() || id == "." || id == ".." || id.contains('/') || id.contains('\\') {
        return Err(format!("id 不能当目录名：{id:?}"));
    }

    // 已有同 id：用户可能升级过或停用过，保持原样。
    let exists = index.iter().any(|e| {
        e.get("meta")
            .and_then(|m| m.get("id"))
            .and_then(|v| v.as_str())
            == Some(id.as_str())
    });
    if exists {
        // 文件可能被用户删了而索引还在，补回去以免加载失败。
        let dir = root.join(&id);
        if !dir.join("plugin.js").exists() {
            std::fs::create_dir_all(&dir).map_err(|e| format!("建插件子目录失败：{e}"))?;
            std::fs::write(dir.join("plugin.js"), seed.code)
                .map_err(|e| format!("补写插件源码失败：{e}"))?;
        }
        return Ok(false);
    }

    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建插件子目录失败：{e}"))?;
    std::fs::write(dir.join("plugin.js"), seed.code)
        .map_err(|e| format!("写插件源码失败：{e}"))?;

    // origin 是 Option<PluginOrigin> 且带 #[serde(default)]。这里刻意不写：
    // PluginOrigin 是带固定字段的结构体，随手编一个形状对不上的对象会让
    // 整个 index.json 反序列化失败，连带把用户其它插件一起弄挂。缺省即 None。
    let entry = json!({
        "meta": serde_json::to_value(meta).map_err(|e| e.to_string())?,
        "enabled": seed.enabled,
        "source": "builtin",
        "usable": true,
        "settings": {},
        "endpoint": {}
    });
    index.push(entry);
    Ok(true)
}
