#!/usr/bin/env python3
"""
Extract authentic Blender 5.2 UI button names, official Simplified Chinese
translations (via bpy.app.translations), UI locations, and keyboard shortcuts
directly from the local Blender installation, and merge into
src/data/vocab/blender.json.

Usage:
  1. Run with Blender directly:
     "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup --python scripts/extract_blender_keymap.py
  2. Or run with standard Python (auto-locates local Blender 5.2+ and invokes it):
     python scripts/extract_blender_keymap.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
BLENDER_JSON = ROOT_DIR / "src" / "data" / "vocab" / "blender.json"

TARGET_KEYMAPS = [
    ("Mesh", "Modeling · 网格建模", "Edit Mode · 左侧工具栏 / 网格菜单"),
    ("Object Mode", "Viewport · 视图变换", "Object Mode · 物体菜单 / 视口"),
    ("3D View", "Viewport · 视图变换", "3D Viewport · 视图控制"),
    ("Node Editor", "Shader Nodes · 着色器节点", "Shader / Geometry Nodes · 节点编辑器"),
    ("UV Editor", "UV · UV 编辑", "UV Editor · UV 菜单 / 工具栏"),
    ("Sculpt", "Sculpt · 数字雕刻", "Sculpt Mode · 笔刷工具栏"),
    ("Pose", "Rigging · 骨骼动画", "Pose Mode · 姿态工具栏"),
]

SKIP_KEY_TYPES = {
    "LEFTMOUSE", "RIGHTMOUSE", "MIDDLEMOUSE", "WHEELUPMOUSE", "WHEELDOWNMOUSE",
    "MOUSEMOVE", "INBETWEEN_MOUSEMOVE", "TIMER", "TIMER0", "TIMER1", "TIMER2",
    "NONE", "EVT_TWEAK_L", "EVT_TWEAK_M", "EVT_TWEAK_R", "BUTTON4MOUSE",
    "BUTTON5MOUSE", "TRACKPADPAN", "TRACKPADZOOM", "NDOF_MOTION",
}

KEY_PRETTY = {
    "RET": "Enter",
    "NUMPAD_ENTER": "Numpad Enter",
    "SPACE": "Space",
    "ESC": "Esc",
    "TAB": "Tab",
    "DEL": "Delete",
    "BACK_SPACE": "Backspace",
    "PERIOD": ".",
    "COMMA": ",",
    "SLASH": "/",
    "BACK_SLASH": "\\",
    "ACCENT_GRAVE": "`",
    "SEMI_COLON": ";",
    "QUOTE": "'",
    "LEFT_BRACKET": "[",
    "RIGHT_BRACKET": "]",
    "MINUS": "-",
    "EQUAL": "=",
    "NUMPAD_PERIOD": "Numpad .",
    "NUMPAD_PLUS": "Numpad +",
    "NUMPAD_MINUS": "Numpad -",
    "NUMPAD_SLASH": "Numpad /",
    "NUMPAD_ASTERIX": "Numpad *",
    "NUMPAD_0": "Numpad 0",
    "NUMPAD_1": "Numpad 1",
    "NUMPAD_3": "Numpad 3",
    "NUMPAD_5": "Numpad 5",
    "NUMPAD_7": "Numpad 7",
    "HOME": "Home",
    "END": "End",
    "PAGE_UP": "PageUp",
    "PAGE_DOWN": "PageDown",
    "ONE": "1",
    "TWO": "2",
    "THREE": "3",
    "FOUR": "4",
    "FIVE": "5",
    "ZERO": "0",
}


def format_shortcut(kmi) -> str:
    ktype = getattr(kmi, "type", "")
    if not ktype or ktype in SKIP_KEY_TYPES:
        return ""
    if getattr(kmi, "map_type", "") not in ("KEYBOARD", ""):
        return ""
    parts = []
    if getattr(kmi, "ctrl", False):
        parts.append("Ctrl")
    if getattr(kmi, "alt", False):
        parts.append("Alt")
    if getattr(kmi, "shift", False):
        parts.append("Shift")
    if getattr(kmi, "oskey", False):
        parts.append("Win")
    key_label = KEY_PRETTY.get(ktype, ktype.title() if len(ktype) > 1 else ktype.upper())
    parts.append(key_label)
    return " + ".join(parts)


def format_shortcut_dict(ev: dict) -> str:
    ktype = str(ev.get("type", "") or "")
    if not ktype or ktype in SKIP_KEY_TYPES:
        return ""
    parts = []
    if ev.get("ctrl"):
        parts.append("Ctrl")
    if ev.get("alt"):
        parts.append("Alt")
    if ev.get("shift"):
        parts.append("Shift")
    if ev.get("oskey"):
        parts.append("Win")
    key_label = KEY_PRETTY.get(ktype, ktype.title() if len(ktype) > 1 else ktype.upper())
    parts.append(key_label)
    return " + ".join(parts)


def run_inside_blender() -> int:
    import bpy  # type: ignore

    # Enable Simplified Chinese translation lookup inside headless Blender
    try:
        bpy.context.preferences.view.language = "zh_HANS"
        bpy.context.preferences.view.use_translate_interface = True
        bpy.context.preferences.view.use_translate_tooltips = True
    except Exception:
        pass

    # Load blender_default.py directly (works reliably in -b headless mode!)
    scripts_dir = Path(bpy.utils.resource_path("LOCAL")) / "scripts" / "presets" / "keyconfig" / "keymap_data"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import blender_default  # type: ignore

    keymaps_data = blender_default.generate_keymaps(blender_default.Params())
    target_map = {name: (cat, loc) for name, cat, loc in TARGET_KEYMAPS}
    extracted: dict[str, dict[str, str]] = {}

    for km_name, _space_info, km_content in keymaps_data:
        if km_name not in target_map:
            continue
        category, ui_loc = target_map[km_name]
        items = km_content.get("items", []) if isinstance(km_content, dict) else []
        for item in items:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            op_id, ev = item[0], item[1]
            if not isinstance(op_id, str) or "." not in op_id or not isinstance(ev, dict):
                continue
            if op_id.startswith(("wm.call_menu", "wm.call_panel", "wm.context_", "screen.")):
                continue

            shortcut = format_shortcut_dict(ev)
            if not shortcut:
                continue

            mod_name, func_name = op_id.split(".", 1)
            op_mod = getattr(bpy.ops, mod_name, None)
            op_fn = getattr(op_mod, func_name, None) if op_mod else None
            if op_fn is None:
                continue
            try:
                rna = op_fn.get_rna_type()
            except Exception:
                continue

            en_name = (getattr(rna, "name", "") or "").strip()
            if not en_name or len(en_name) < 2 or len(en_name) > 42:
                continue
            if any(bad in en_name.lower() for bad in ("test", "debug", "dummy", "internal")):
                continue

            zh_name = bpy.app.translations.pgettext_iface(en_name)
            if zh_name == en_name:
                zh_name = bpy.app.translations.pgettext(en_name)
            desc_en = (getattr(rna, "description", "") or "").strip()
            if not re.search(r"[\u4e00-\u9fff]", zh_name):
                continue

            key = en_name.lower()
            if key in extracted:
                continue

            extracted[key] = {
                "word": en_name,
                "uiLocation": ui_loc,
                "shortcut": shortcut,
                "phonetic": "",
                "pos": "v./n.",
                "meaning": zh_name,
                "category": category,
                "example": desc_en if desc_en else f"Press {shortcut} in {ui_loc.split('·')[0].strip()} to run {en_name}.",
                "exampleZh": f"在「{ui_loc}」按 {shortcut} 执行「{zh_name}」。",
            }

    print(f"[BlenderExtract] Extracted {len(extracted)} official Blender {bpy.app.version_string} UI button + shortcut entries.")

    # Merge into existing blender.json (curated entries take priority for rich phonetics/examples,
    # while Blender 5.2 keymap enriches missing shortcuts & adds new authentic buttons)
    if BLENDER_JSON.exists():
        pack = json.loads(BLENDER_JSON.read_text(encoding="utf-8"))
    else:
        pack = {
            "id": "blender",
            "bookId": "blender",
            "name": "Blender 3D",
            "description": "Blender 5.2 界面按钮与快捷键英汉对照词库",
            "level": "3D",
            "category": "blender",
            "builtIn": True,
            "enabled": True,
            "entries": [],
        }

    entries = pack.get("entries") or []
    existing_map = {e["word"].strip().lower(): e for e in entries if e.get("word")}

    enriched = 0
    for k, ex in extracted.items():
        if k in existing_map:
            cur = existing_map[k]
            if not cur.get("shortcut") and ex["shortcut"]:
                cur["shortcut"] = ex["shortcut"]
                enriched += 1
            if not cur.get("uiLocation") and ex["uiLocation"]:
                cur["uiLocation"] = ex["uiLocation"]

    added = 0
    for k, ex in extracted.items():
        if k in existing_map:
            continue
        idx = len(entries) + 1
        entries.append(
            {
                "id": f"blender_{idx:04d}",
                "bookId": "blender",
                "word": ex["word"],
                "uiLocation": ex["uiLocation"],
                "shortcut": ex["shortcut"],
                "phonetic": ex["phonetic"],
                "pos": ex["pos"],
                "meaning": ex["meaning"],
                "category": ex["category"],
                "example": ex["example"],
                "exampleZh": ex["exampleZh"],
            }
        )
        existing_map[k] = entries[-1]
        added += 1

    pack["entries"] = entries
    pack["description"] = (
        f"Blender 5.2 官方界面按钮与快捷键英汉对照词库（共 {len(entries)} 词），"
        "覆盖 3D View / Mesh Edit / Modifiers / Shader Nodes / Geometry Nodes / UV / Sculpt / Render / Rigging。"
    )
    BLENDER_JSON.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[BlenderExtract] Enriched {enriched} existing entries, added {added} new Blender 5.2 entries -> total {len(entries)} in {BLENDER_JSON}")
    return 0


def find_local_blender() -> Path | None:
    candidates = [
        Path(r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"),
    ]
    base = Path(r"C:\Program Files\Blender Foundation")
    if base.exists():
        for d in sorted(base.iterdir(), reverse=True):
            exe = d / "blender.exe"
            if exe.exists() and exe not in candidates:
                candidates.append(exe)
    for c in candidates:
        if c.exists():
            return c
    return None


def main() -> int:
    try:
        import bpy  # noqa: F401
        return run_inside_blender()
    except ImportError:
        exe = find_local_blender()
        if exe is None:
            print("[BlenderExtract] Local Blender executable not found.")
            return 1
        print(f"[BlenderExtract] Launching headless Blender: {exe}")
        cmd = [str(exe), "-b", "--factory-startup", "--python", str(Path(__file__).resolve())]
        proc = subprocess.run(cmd, check=False)
        return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
