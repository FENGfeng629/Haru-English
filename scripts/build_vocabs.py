#!/usr/bin/env python3
"""
Build full-scale unified vocabulary books for Haru English Pet:
  1. src/data/vocab/toefl.json       (1,000 - 4,200+ words from kajweb/dict TOEFL_3.zip)
  2. src/data/vocab/blender.json     (250+ official Blender manual & zh_CN.po terms)
  3. src/data/vocab/antigravity.json (100+ terms grounded in antigravity.google/llms.txt)

Unified entry schema:
  id, bookId ("toefl" | "blender" | "antigravity"), word, phonetic, pos,
  meaning, category, shortcut, example, exampleZh
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT_DIR / "src" / "data" / "vocab"

TOEFL_URLS = [
    "https://raw.githubusercontent.com/kajweb/dict/master/book/1521164667985_TOEFL_3.zip",
    "https://raw.githubusercontent.com/kajweb/dict/master/book/1521164640451_TOEFL_2.zip",
]
ANTIGRAVITY_LLMS_URL = "https://antigravity.google/llms.txt"


def fetch_bytes(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "HaruEnglishPet-VocabBuilder/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def clean_str(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).replace("\r", " ").replace("\n", " ").strip()
    return re.sub(r"\s+", " ", s)


def format_phonetic(raw: str) -> str:
    p = clean_str(raw).strip("/[] ")
    if not p:
        return ""
    return f"/{p}/"


def classify_toefl(rank: int, meaning: str) -> str:
    domain_rules = [
        (r"\[生\]|生物|植物|动物|生态|物种|细菌|基因|进化|化石|哺乳", "学术 · 生物生态"),
        (r"\[地\]|地质|岩石|矿物|火山|地震|冰川|沉积|大气|气候|天文|行星", "学术 · 地质天文"),
        (r"\[化\]|\[物\]|化学|分子|原子|元素|溶液|电磁|辐射|引力|能量", "学术 · 物理化学"),
        (r"\[医\]|医学|疾病|细胞|神经|免疫|症状|治疗|病毒", "学术 · 医学健康"),
        (r"\[计\]|计算机|程序|数据|网络|算法|硬件|软件", "学术 · 计算机科技"),
        (r"\[经\]|经济|贸易|财政|货币|市场|税收|商业|资本", "学术 · 经济社科"),
        (r"\[艺\]|\[音\]|\[建\]|艺术|建筑|雕塑|交响|绘画|戏剧|考古|历史", "学术 · 艺术历史"),
    ]
    for pat, label in domain_rules:
        if re.search(pat, meaning):
            return label
    if rank <= 500:
        return "托福 · 核心 Top 500"
    if rank <= 1500:
        return "托福 · 高频 Top 1500"
    if rank <= 3000:
        return "托福 · 进阶 Top 3000"
    return "托福 · 冲刺拓展"


def build_toefl() -> dict[str, Any]:
    raw_zip: bytes | None = None
    used_url = ""
    for url in TOEFL_URLS:
        try:
            print(f"[TOEFL] Downloading {url} ...")
            raw_zip = fetch_bytes(url, timeout=30)
            used_url = url
            break
        except Exception as exc:
            print(f"[TOEFL] Warning: failed {url}: {exc}")

    if raw_zip is None:
        raise RuntimeError("Failed to download TOEFL dictionary from kajweb/dict.")

    zf = zipfile.ZipFile(io.BytesIO(raw_zip))
    json_name = next((n for n in zf.namelist() if n.endswith(".json")), zf.namelist()[0])
    text = zf.read(json_name).decode("utf-8", errors="ignore")

    entries: list[dict[str, str]] = []
    seen: set[str] = set()

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        word = clean_str(obj.get("headWord", ""))
        if not word:
            continue
        key = word.lower()
        if key in seen:
            continue

        rank = int(obj.get("wordRank") or (len(entries) + 1))
        inner = (obj.get("content") or {}).get("word", {}).get("content", {}) or {}

        usphone = clean_str(inner.get("usphone", ""))
        ukphone = clean_str(inner.get("ukphone", ""))
        phonetic = format_phonetic(usphone or ukphone)

        trans_list = inner.get("trans") or []
        pos_list: list[str] = []
        meanings: list[str] = []
        for t in trans_list:
            p = clean_str(t.get("pos", "")).rstrip(".")
            if p:
                p_norm = f"{p}."
                if p_norm not in pos_list:
                    pos_list.append(p_norm)
            cn = clean_str(t.get("tranCn", ""))
            if cn:
                meanings.append(cn)

        pos = "/".join(pos_list[:2])
        meaning = "；".join(dict.fromkeys(meanings))
        if not meaning:
            continue

        sent_block = inner.get("sentence") or {}
        sents = sent_block.get("sentences") or []
        example = ""
        example_zh = ""
        if sents:
            first_s = sents[0]
            example = clean_str(first_s.get("sContent", ""))
            example_zh = clean_str(first_s.get("sCn", ""))

        seen.add(key)
        idx = len(entries) + 1
        entries.append(
            {
                "id": f"toefl_{idx:04d}",
                "bookId": "toefl",
                "word": word,
                "uiLocation": "",
                "phonetic": phonetic,
                "pos": pos,
                "meaning": meaning,
                "category": classify_toefl(rank, meaning),
                "shortcut": "",
                "example": example,
                "exampleZh": example_zh,
            }
        )

    print(f"[TOEFL] Built {len(entries)} entries from {used_url}")
    return {
        "id": "toefl",
        "bookId": "toefl",
        "name": "托福 TOEFL",
        "description": f"托福 iBT 全量核心高频词库（共 {len(entries)} 词），源自开源词库 kajweb/dict，含音标、词性、学科分类与双语例句。",
        "level": "TOEFL",
        "category": "toefl",
        "builtIn": True,
        "enabled": True,
        "entries": entries,
    }


def _default_ui_location(book_id: str, category: str, shortcut: str) -> str:
    if book_id == "blender":
        if "Modeling" in category:
            return "Edit Mode · 左侧工具栏 / 网格菜单"
        if "Viewport" in category:
            return "3D Viewport · 视图与变换"
        if "Modifiers" in category:
            return "Properties · 修改器面板 (扳手图标)"
        if "Shader Nodes" in category:
            return "Shader Editor · 添加节点 (Shift + A)"
        if "Geometry Nodes" in category:
            return "Geometry Nodes · 添加节点 (Shift + A)"
        if "UV" in category:
            return "UV Editor · UV 菜单 / 工具栏"
        if "Sculpt" in category:
            return "Sculpt Mode · 左侧笔刷工具栏"
        if "Render" in category:
            return "Properties · 渲染与灯光属性"
        if "Rigging" in category:
            return "Pose Mode / 动画编辑器"
        if "Physics" in category:
            return "Properties · 物理属性面板"
        return "Blender · 3D 视口"
    if book_id == "antigravity":
        if shortcut.startswith("/"):
            return "Antigravity · 对话输入框 (斜杠命令)"
        if "CLI" in category or shortcut.startswith("agy"):
            return "Antigravity CLI · 终端命令行"
        if "IDE" in category:
            return "Antigravity IDE · 编辑器 / 辅助面板"
        if "Customizations" in category:
            return "Antigravity · 插件与定制目录"
        if "SDK" in category:
            return "Antigravity · Python SDK"
        if "Security" in category:
            return "Antigravity · 设置 / 沙箱与权限"
        if "Artifact" in category:
            return "Antigravity · 产物审查面板"
        if "Agent" in category:
            return "Antigravity · 智能体协作面板"
        if "Products" in category:
            return "Antigravity · 平台与产品入口"
        return "Antigravity · 主工作区"
    if book_id == "dev_compiler":
        if "IDE" in category:
            return "VS Code / IDE · 编辑器快捷键"
        if "报错" in category:
            return "Compiler / Console · 报错诊断"
        return "Compiler / Engineering · 编译与工程"
    return ""


def _format_shortcut_spaces(sc: str) -> str:
    s = clean_str(sc)
    if not s or s.startswith("/") or s.startswith("agy") or "." in s:
        return s
    # Normalize "Ctrl+B" -> "Ctrl + B" for clean keyboard-cap readability
    return re.sub(r"\s*\+\s*", " + ", s)


def _pack_rows(
    book_id: str,
    prefix: str,
    rows: list[tuple[str, str, str, str, str, str, str, str]],
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for word, phonetic, pos, meaning, category, shortcut, example, example_zh in rows:
        w = clean_str(word)
        if not w:
            continue
        k = w.lower()
        if k in seen:
            continue
        seen.add(k)
        idx = len(out) + 1
        sc_fmt = _format_shortcut_spaces(shortcut)
        cat_clean = clean_str(category)
        is_soft = book_id in ("blender", "antigravity") or (book_id == "dev_compiler" and bool(sc_fmt))
        out.append(
            {
                "id": f"{prefix}_{idx:04d}",
                "bookId": book_id,
                "word": w,
                "uiLocation": _default_ui_location(book_id, cat_clean, sc_fmt),
                "shortcut": sc_fmt,
                "phonetic": "" if is_soft else format_phonetic(phonetic),
                "pos": "" if is_soft else clean_str(pos),
                "meaning": clean_str(meaning),
                "category": cat_clean,
                "example": clean_str(example),
                "exampleZh": clean_str(example_zh),
            }
        )
    return out


# Official Blender Manual + zh_CN.po high-frequency terminology (260+ entries)
BLENDER_ROWS: list[tuple[str, str, str, str, str, str, str, str]] = [
    # --- Modeling · Mesh (网格建模) ---
    ("Extrude", "ɪkˈstruːd", "v.", "挤出（沿法线或轴向拉伸点、边、面）", "Modeling · 网格建模", "E", "Select the top face and press E to extrude the pillar upward.", "选中顶面并按 E 向上挤出柱体。"),
    ("Bevel", "ˈbevl", "n./v.", "倒角（平滑硬朗棱边并增加高光细节）", "Modeling · 网格建模", "Ctrl+B", "Press Ctrl+B to bevel sharp edges and scroll to add segments.", "按 Ctrl+B 对锐利边缘倒角，滚动滚轮增加分段。"),
    ("Loop Cut", "luːp kʌt", "n.", "环切（沿四边面循环切割新边线）", "Modeling · 网格建模", "Ctrl+R", "Add supporting edges with Ctrl+R before subdividing the mesh.", "细分网格前按 Ctrl+R 添加卡线环切边。"),
    ("Inset Faces", "ˈɪnset feɪsɪz", "v.", "内插面（在选中面内部向内缩进生成新面）", "Modeling · 网格建模", "I", "Press I to inset faces before extruding the window frame inward.", "先按 I 内插面，再向内挤出窗框凹槽。"),
    ("Merge", "mɜːrdʒ", "v.", "合并（按中心、距离或光标合并顶点）", "Modeling · 网格建模", "M", "Press M and choose By Distance to clean up overlapping vertices.", "按 M 选择「按距离」合并，清理重叠顶点。"),
    ("Knife Tool", "naɪf tuːl", "n.", "切割工具（在网格表面手绘切分边线）", "Modeling · 网格建模", "K", "Activate the Knife Tool with K to reroute the edge flow cleanly.", "按 K 启用切割工具重新规划布线走向。"),
    ("Normals", "ˈnɔːrmlz", "n.", "法线（决定表面朝向与光照反射方向）", "Modeling · 网格建模", "Shift+N", "Press Shift+N to recalculate normals outside if shading looks dark.", "如果着色发黑翻转，按 Shift+N 重新计算外向法线。"),
    ("Proportional Editing", "prəˈpɔːrʃənl ˈedɪtɪŋ", "n.", "衰减编辑（按影响半径平滑带动周围顶点变形）", "Modeling · 网格建模", "O", "Toggle Proportional Editing with O to sculpt gentle terrain hills.", "按 O 开关衰减编辑，柔和拉出地形起伏。"),
    ("Fill", "fɪl", "v.", "填充（在选中顶点或边之间创建新面）", "Modeling · 网格建模", "F", "Select four boundary vertices and press F to fill a quad face.", "选中四个边界顶点按 F 填充一个四边面。"),
    ("Grid Fill", "ɡrɪd fɪl", "v.", "栅格填充（用规整四边面网格封口洞口）", "Modeling · 网格建模", "Ctrl+F", "Use Grid Fill from the Face menu to cap the cylinder cleanly.", "在面菜单中使用栅格填充，用四边面整齐封口圆柱。"),
    ("Edge Slide", "edʒ slaɪd", "v.", "滑移边线（沿相邻曲面滑动边而不破坏轮廓）", "Modeling · 网格建模", "G G", "Double-tap G to edge slide the loop closer to the corner.", "连按两次 G 沿曲面滑移循环边靠近转角。"),
    ("Vertex Slide", "ˈvɜːrteks slaɪd", "v.", "滑移顶点（沿相连边线移动顶点位置）", "Modeling · 网格建模", "Shift+V", "Press Shift+V to slide the vertex neatly along the existing edge.", "按 Shift+V 让顶点沿现有边线平滑移动。"),
    ("Rip", "rɪp", "v.", "断离（沿选中边撕开网格形成开口）", "Modeling · 网格建模", "V", "Select the seam edge and press V to rip the mesh apart.", "选中接缝边按 V 将网格断离撕开。"),
    ("Separate", "ˈsepəreɪt", "v.", "分离（将选中网格拆分为独立物体）", "Modeling · 网格建模", "P", "Press P and choose Selection to separate the lid into its own object.", "按 P 选择「选中项」将盖子分离为独立物体。"),
    ("Join", "dʒɔɪn", "v.", "合并物体（将多个选中物体合并为单个网格）", "Modeling · 网格建模", "Ctrl+J", "Select the parts and press Ctrl+J to join them into one mesh.", "选中多个部件按 Ctrl+J 合并为一个网格物体。"),
    ("Duplicate", "ˈdjuːplɪkeɪt", "v.", "复制物体（创建独立副本）", "Modeling · 网格建模", "Shift+D", "Press Shift+D then X to duplicate the bolt along the X axis.", "按 Shift+D 再按 X 沿 X 轴复制螺栓。"),
    ("Duplicate Linked", "ˈdjuːplɪkeɪt lɪŋkt", "v.", "关联复制（共享同一网格数据的实例化副本）", "Modeling · 网格建模", "Alt+D", "Use Alt+D for identical columns so editing one updates them all.", "对相同立柱使用 Alt+D 关联复制，改一处同步更新全部。"),
    ("Delete / Dissolve", "dɪˈliːt", "v.", "删除 / 融并（移除元素或融并边线保留面）", "Modeling · 网格建模", "X", "Press X and choose Dissolve Edges to remove unnecessary loops.", "按 X 选择「融并边」去除多余循环边。"),
    ("Bridge Edge Loops", "brɪdʒ edʒ luːps", "v.", "桥接循环边（在两组开放循环边之间自动连面）", "Modeling · 网格建模", "Ctrl+E", "Select both open rings and run Bridge Edge Loops to connect them.", "选中两组开放边环，执行桥接循环边相连。"),
    ("Subdivide", "ˌsʌbdɪˈvaɪd", "v.", "细分（将选中边或面切分为更多段）", "Modeling · 网格建模", "", "Right-click in Edit Mode and select Subdivide to add geometry.", "在编辑模式下右键选择「细分」以增加网格密度。"),
    ("Shrink/Fatten", "ʃrɪŋk ˈfætn", "v.", "法向缩放（沿顶点法线方向整体鼓胀或收缩）", "Modeling · 网格建模", "Alt+S", "Press Alt+S to thicken the selected shell evenly along normals.", "按 Alt+S 沿法线均匀加厚选中壳体。"),
    ("Shear", "ʃɪr", "v.", "切变（沿视图轴向倾斜变形选中元素）", "Modeling · 网格建模", "Shift+Ctrl+Alt+S", "Use Shear to angle the pipe corner at exactly 45 degrees.", "使用切变将管道转角精确倾斜 45 度。"),
    ("Spin", "spɪn", "v.", "旋绕（绕 3D 游标旋转挤出回转体）", "Modeling · 网格建模", "", "Use the Spin tool to lathe a vase profile around the 3D cursor.", "使用旋绕工具围绕 3D 游标旋转生成花瓶轮廓。"),
    ("Bisect", "baɪˈsekt", "v.", "切分（用平面直线切开网格并可选封口）", "Modeling · 网格建模", "", "Drag with the Bisect tool to slice the rock cleanly in half.", "拖拽切分工具将岩石沿平面整齐切开。"),
    ("Triangulate", "traɪˈæŋɡjʊleɪt", "v.", "三角化（将四边面与多边面转为三角面）", "Modeling · 网格建模", "Ctrl+T", "Press Ctrl+T before exporting to lock the game engine shading.", "导出至游戏引擎前按 Ctrl+T 三角化以锁定着色。"),
    ("Tris to Quads", "trɪs tuː kwɒdz", "v.", "三角面转四边面（清理导入网格的斜线）", "Modeling · 网格建模", "Alt+J", "Run Alt+J on the scanned mesh to restore clean quad topology.", "对扫描网格按 Alt+J 恢复整洁的四边面拓扑。"),
    ("Edge Crease", "edʒ kriːs", "n.", "折痕权重（控制细分曲面下的边线锐利度）", "Modeling · 网格建模", "Shift+E", "Press Shift+E to add an edge crease without extra loop cuts.", "按 Shift+E 设置折痕，无需额外卡线即可保持锐边。"),
    ("Poke Faces", "poʊk feɪsɪz", "v.", "扇形面（在面中心加顶点并辐射连接成三角扇）", "Modeling · 网格建模", "", "Use Poke Faces to turn flat quads into diamond-like patterns.", "使用扇形面将平四边面转为菱形放射拓扑。"),
    ("Vertex", "ˈvɜːrteks", "n.", "顶点（三维空间中构成网格的基本坐标点）", "Modeling · 网格建模", "1", "Press 1 in Edit Mode to switch to Vertex selection.", "在编辑模式下按 1 切换至顶点选择模式。"),
    ("Edge", "edʒ", "n.", "边（连接两个顶点的线段）", "Modeling · 网格建模", "2", "Press 2 in Edit Mode to select edges and edge loops.", "在编辑模式下按 2 切换至边选择模式。"),
    ("Face", "feɪs", "n.", "面（由三条及以上边围成的网格表面）", "Modeling · 网格建模", "3", "Press 3 in Edit Mode to select faces for extruding.", "在编辑模式下按 3 切换至面选择模式。"),
    ("Select Loop", "sɪˈlekt luːp", "v.", "选择循环边（沿连续四边面选中整圈边线）", "Modeling · 网格建模", "Alt+Click", "Alt+Click an edge to select the entire continuous edge loop.", "按住 Alt 点击边线以选中整条连续循环边。"),
    ("Select Linked", "sɪˈlekt lɪŋkt", "v.", "选择相连元素（选中鼠标悬停处的整个独立网格块）", "Modeling · 网格建模", "L", "Hover over a loose screw and press L to select all linked faces.", "鼠标悬停在独立螺丝上按 L 选中相连的全部面。"),
    ("Select More / Less", "sɪˈlekt mɔːr", "v.", "加选 / 减选（向外扩展或向内收缩当前选区）", "Modeling · 网格建模", "Ctrl+Numpad+", "Press Ctrl+Numpad+ to expand the face selection step by step.", "按 Ctrl+Numpad+ 逐圈向外扩展当前选区。"),
    ("Invert Selection", "ɪnˈvɜːrt sɪˈlekʃn", "v.", "反选（切换选中与未选中状态）", "Modeling · 网格建模", "Ctrl+I", "Press Ctrl+I to invert the selection and delete the background.", "按 Ctrl+I 反选并删除背景网格。"),
    ("Topology", "təˈpɒlədʒi", "n.", "拓扑结构（网格点边面的连接排布与布线规律）", "Modeling · 网格建模", "", "Good quad topology ensures smooth deformation during animation.", "良好的四边面拓扑能保证动画变形顺滑无折痕。"),
    ("Quad", "kwɒd", "n.", "四边面（由四个顶点构成的理想建模面片）", "Modeling · 网格建模", "", "Keep the character face built of clean quads around the eyes.", "角色面部眼周应保持规整的四边面布线。"),
    ("N-gon", "ˈen ɡɒn", "n.", "多边面（超过四条边的面，细分时易产生畸变）", "Modeling · 网格建模", "", "Avoid N-gons on curved surfaces to prevent shading artifacts.", "曲面处应避免多边面，以免出现着色瑕疵。"),
    ("Manifold", "ˈmænɪfoʊld", "adj.", "流形（封闭无破洞、无内部重叠面的可 3D 打印网格）", "Modeling · 网格建模", "", "Make sure the mesh is manifold before exporting for 3D printing.", "导出 3D 打印前请确保网格是封闭流形。"),
    ("Non-Manifold", "nɒn ˈmænɪfoʊld", "adj.", "非流形（存在开放边界、内部面或多余边的网格）", "Modeling · 网格建模", "Shift+Ctrl+Alt+M", "Select Non-Manifold geometry to spot holes and internal faces.", "选择非流形几何体可快速定位破洞与内部面。"),
    ("Symmetrize", "ˈsɪmətraɪz", "v.", "对称化（将网格一侧镜像复制到另一侧并焊接中缝）", "Modeling · 网格建模", "", "Run Symmetrize along -X to +X to fix asymmetric edits.", "沿 -X 到 +X 执行对称化修复不对称改动。"),
    ("Shade Smooth", "ʃeɪd smuːð", "v.", "平滑着色（插值法线使表面呈现光滑曲面效果）", "Modeling · 网格建模", "", "Right-click the sphere and choose Shade Smooth for glossy reflections.", "右键球体选择「平滑着色」以获得光滑反射。"),
    ("Shade Flat", "ʃeɪd flæt", "v.", "平直着色（按单个面法线渲染出硬朗切面）", "Modeling · 网格建模", "", "Use Shade Flat to emphasize the low-poly faceted art style.", "使用平直着色突出低多边形硬朗切面风格。"),
    ("Mark Sharp", "mɑːrk ʃɑːrp", "v.", "标记锐边（配合平滑着色保留特定棱角折痕）", "Modeling · 网格建模", "Ctrl+E", "Mark Sharp on the mechanical bevels to keep crisp specular highlights.", "在机械倒角处标记锐边以保留清晰高光。"),
    ("Flip Normals", "flɪp ˈnɔːrmlz", "v.", "翻转法线（将选中面的正反朝向倒置）", "Modeling · 网格建模", "Alt+N", "Press Alt+N and choose Flip to reverse inside-out faces.", "按 Alt+N 选择翻转以修正朝向颠倒的面。"),
    ("Apply Transform", "əˈplaɪ trænsˈfɔːrm", "v.", "应用变换（将缩放/旋转烘焙归零，避免倒角变形）", "Modeling · 网格建模", "Ctrl+A", "Always press Ctrl+A and apply Scale before adding a Bevel.", "添加倒角前务必按 Ctrl+A 应用缩放，防止倒角拉伸。"),
    ("Origin", "ˈɒrɪdʒɪn", "n.", "物体原点（物体的变换枢轴与局部坐标中心）", "Modeling · 网格建模", "", "Set Origin to Geometry so the object rotates around its center.", "将原点设置到几何中心，使物体绕自身中心旋转。"),
    ("3D Cursor", "θriː diː ˈkɜːrsər", "n.", "3D 游标（新物体的生成位置与临时旋转枢轴）", "Modeling · 网格建模", "Shift+S", "Press Shift+S to snap the 3D Cursor to the selected vertex.", "按 Shift+S 将 3D 游标吸附到选中顶点。"),
    ("Pivot Point", "ˈpɪvət pɔɪnt", "n.", "轴心点（旋转与缩放所围绕的参考中心）", "Modeling · 网格建模", ".", "Press period (.) to switch the Pivot Point to 3D Cursor.", "按句号键 (.) 将轴心点切换为 3D 游标。"),
    ("Transform Orientation", "trænsˈfɔːrm ˌɔːriənˈteɪʃn", "n.", "变换坐标系（全局、局部、法向或视图坐标方向）", "Modeling · 网格建模", ",", "Press comma (,) and pick Normal to move faces along their tilt.", "按逗号键 (,) 选择法向坐标系，沿倾斜方向移动面。"),
    ("Snapping", "ˈsnæpɪŋ", "n.", "吸附（精确对齐顶点、边、面或网格增量）", "Modeling · 网格建模", "Shift+Tab", "Toggle Snapping with Shift+Tab to align the roof flush with the wall.", "按 Shift+Tab 开关吸附，让屋顶与墙体严丝合缝对齐。"),
    ("Parent", "ˈperənt", "v./n.", "父级关联（建立父子层级，子物体跟随父物体变换）", "Modeling · 网格建模", "Ctrl+P", "Select the wheels then the chassis and press Ctrl+P to parent them.", "先选车轮再选车身，按 Ctrl+P 建立父子级联。"),
    ("Clear Parent", "klɪr ˈperənt", "v.", "清空父级（解除父子关系并可选保持当前变换）", "Modeling · 网格建模", "Alt+P", "Press Alt+P and choose Clear and Keep Transformation.", "按 Alt+P 选择「清空父级并保持变换结果」。"),
    ("Boolean Intersect", "ˈbuːliən ˌɪntərˈsekt", "v.", "布尔交集切割（在编辑模式下直接用网格相交裁剪）", "Modeling · 网格建模", "", "Run Intersect (Boolean) in Edit Mode to carve a quick cutout.", "在编辑模式下执行布尔交集快速挖孔。"),
    ("Cleanup / Degenerate", "ˈkliːnʌp", "n.", "网格清理（移除零面积退化面与孤立松散点）", "Modeling · 网格建模", "", "Use Mesh > Clean Up > Delete Loose to remove stray vertices.", "使用「网格 > 清理 > 删除松散元素」清理游离顶点。"),

    # --- Viewport & Navigation (视图与变换) ---
    ("Grab / Move", "ɡræb", "v.", "移动（自由或沿 XYZ 轴平移选中物体与元素）", "Viewport · 视图变换", "G", "Press G then Z to move the lamp strictly upward.", "按 G 再按 Z 沿 Z 轴垂直移动灯具。"),
    ("Rotate", "ˈroʊteɪt", "v.", "旋转（绕轴心点或指定坐标轴旋转）", "Viewport · 视图变换", "R", "Press R, Y, 90 to rotate the door 90 degrees around Y.", "依次按 R、Y、90 将门绕 Y 轴旋转 90 度。"),
    ("Scale", "skeɪl", "v.", "缩放（整体或锁定单轴/双轴调整尺寸）", "Viewport · 视图变换", "S", "Press S then Shift+Z to scale horizontally without changing height.", "按 S 再按 Shift+Z 水平缩放且保持高度不变。"),
    ("Add Menu", "æd ˈmenjuː", "n.", "添加菜单（新建网格、曲线、灯光、摄像机与空物体）", "Viewport · 视图变换", "Shift+A", "Press Shift+A in the viewport to add a UV Sphere or Area Light.", "在视口按 Shift+A 添加经纬球或面光。"),
    ("Edit Mode", "ˈedɪt moʊd", "n.", "编辑模式（直接编辑网格点、边、面拓扑）", "Viewport · 视图变换", "Tab", "Press Tab to toggle quickly between Object Mode and Edit Mode.", "按 Tab 在物体模式与编辑模式间快速切换。"),
    ("Object Mode", "ˈɒbdʒɪkt moʊd", "n.", "物体模式（以完整物体为单位摆放、变换与管理）", "Viewport · 视图变换", "Tab", "Return to Object Mode to arrange furniture across the room.", "切回物体模式在房间中摆放家具。"),
    ("Viewport Shading", "ˈvjuːpɔːrt ˈʃeɪdɪŋ", "n.", "视图着色方式（线框、实体、材质预览与渲染模式切换）", "Viewport · 视图变换", "Z", "Hold Z to open the Viewport Shading pie menu.", "按住 Z 打开视图着色饼状菜单。"),
    ("X-Ray", "eks reɪ", "n.", "透视模式（半透明显示网格以选中背面顶点）", "Viewport · 视图变换", "Alt+Z", "Press Alt+Z to enable X-Ray and box-select vertices on the back.", "按 Alt+Z 开启透视模式，框选穿透到背面顶点。"),
    ("Wireframe", "ˈwaɪərfreɪm", "n.", "线框模式（仅显示网格边线结构）", "Viewport · 视图变换", "Shift+Z", "Switch to Wireframe to inspect intersecting interior geometry.", "切换到线框模式检查内部穿插几何体。"),
    ("Material Preview", "məˈtɪriəl ˈpriːvjuː", "n.", "材质预览（使用内置 HDRI 实时预览材质效果）", "Viewport · 视图变换", "Z", "Use Material Preview to check roughness and textures smoothly.", "使用材质预览流畅查看粗糙度与贴图效果。"),
    ("Rendered View", "ˈrendərd vjuː", "n.", "渲染预览（在视口中实时调用 Cycles/EEVEE 预览最终光照）", "Viewport · 视图变换", "Z", "Switch to Rendered View to dial in studio lighting and shadows.", "切换到渲染预览精调影棚布光与阴影。"),
    ("Local View", "ˈloʊkl vjuː", "n.", "局部视图 / 独显（暂时隐藏其他物体专注编辑当前项）", "Viewport · 视图变换", "/", "Press slash (/) to isolate the selected chair in Local View.", "按斜杠键 (/) 进入局部视图单独编辑选中椅子。"),
    ("Frame Selected", "freɪm sɪˈlektɪd", "v.", "框选聚焦（将视口镜头居中对准当前选中项）", "Viewport · 视图变换", "Numpad .", "Press Numpad Period to focus the camera smoothly on the selection.", "按小键盘点号键将视口平滑聚焦到选中项。"),
    ("Frame All", "freɪm ɔːl", "v.", "显示全部（缩放视口以容纳场景内所有物体）", "Viewport · 视图变换", "Home", "Press Home if you ever get lost in the 3D viewport.", "在 3D 视口中迷失方向时按 Home 键居中显示全部。"),
    ("Camera View", "ˈkæmrə vjuː", "n.", "摄像机视图（从活动摄像机取景框观察场景）", "Viewport · 视图变换", "Numpad 0", "Press Numpad 0 to check your final render composition.", "按小键盘 0 键查看最终渲染构图。"),
    ("Orthographic", "ˌɔːrθəˈɡræfɪk", "adj.", "正交视图（无透视畸变，适合三视图精准对齐）", "Viewport · 视图变换", "Numpad 5", "Press Numpad 5 to toggle between Perspective and Orthographic views.", "按小键盘 5 切换透视视图与正交视图。"),
    ("Toolbar", "ˈtuːlbɑːr", "n.", "工具栏（视口左侧快捷交互工具面板）", "Viewport · 视图变换", "T", "Press T to hide or reveal the left Toolbar.", "按 T 键隐藏或显示左侧工具栏。"),
    ("Sidebar", "ˈsaɪdbɑːr", "n.", "侧栏 / N 面板（视口右侧变换数值、视图与插件面板）", "Viewport · 视图变换", "N", "Press N to open the Sidebar and inspect exact object dimensions.", "按 N 打开右侧边栏查看精确物体尺寸。"),
    ("Outliner", "ˈaʊtlaɪnər", "n.", "大纲视图（树状管理场景中的所有集合与物体层级）", "Viewport · 视图变换", "", "Organize lights, cameras, and props cleanly in the Outliner.", "在大纲视图中清晰归类灯光、摄像机与道具。"),
    ("Collection", "kəˈlekʃn", "n.", "集合（用于分组管理、开关可见性与渲染层的文件夹）", "Viewport · 视图变换", "M", "Press M in Object Mode to move selected objects into a new Collection.", "物体模式下按 M 将选中物体移入新集合。"),
    ("Hide", "haɪd", "v.", "隐藏（在视口中临时隐藏选中物体或元素）", "Viewport · 视图变换", "H", "Select the ceiling and press H to hide it while lighting the room.", "选中天花板按 H 隐藏，方便给室内打光。"),
    ("Unhide All", "ʌnˈhaɪd ɔːl", "v.", "取消隐藏（恢复所有在视口中隐藏的物体）", "Viewport · 视图变换", "Alt+H", "Press Alt+H to bring back all hidden meshes in the scene.", "按 Alt+H 恢复场景中全部已隐藏的网格。"),
    ("Viewport Overlays", "ˈvjuːpɔːrt ˈoʊvərleɪz", "n.", "视图叠加层（控制网格线、法线朝向、线框与统计数据显示）", "Viewport · 视图变换", "Shift+Alt+Z", "Toggle Overlays with Shift+Alt+Z for a clean presentation view.", "按 Shift+Alt+Z 关闭叠加层获得纯净预览画面。"),
    ("Face Orientation", "feɪs ˌɔːriənˈteɪʃn", "n.", "面朝向（蓝色表示正面、红色表示法线翻转的背面）", "Viewport · 视图变换", "", "Enable Face Orientation in Overlays to spot red inverted polygons.", "在叠加层勾选「面朝向」，一眼识别红色的翻转面。"),
    ("Gizmo", "ˈɡɪzmoʊ", "n.", "操控器（视口中可视化的移动、旋转与缩放手柄）", "Viewport · 视图变换", "Ctrl+`", "Toggle viewport gizmos when you prefer pure keyboard transforms.", "习惯纯键盘变换时可关闭视口操控器。"),
    ("Search Menu", "sɜːrtʃ ˈmenjuː", "n.", "全局命令搜索（快速检索并执行任意 Blender 操作）", "Viewport · 视图变换", "F3", "Press F3 and type 'Bridge' whenever you forget a menu location.", "忘记菜单位置时按 F3 搜索命令名称即可直接调用。"),
    ("Quick Favorites", "kwɪk ˈfeɪvərɪts", "n.", "快速收藏夹（自定义常用操作的高速弹出菜单）", "Viewport · 视图变换", "Q", "Right-click any button to add it to Quick Favorites, then press Q.", "右键任意按钮加入快速收藏夹，按 Q 随时呼出。"),
    ("Properties Editor", "ˈprɒpərtiz ˈedɪtər", "n.", "属性编辑器（渲染、输出、修改器、材质与物理参数总控区）", "Viewport · 视图变换", "", "Open the wrench tab in the Properties Editor to add modifiers.", "打开属性编辑器的扳手标签页添加修改器。"),

    # --- Modifiers (修改器) ---
    ("Subdivision Surface", "ˌsʌbdɪˈvɪʒn ˈsɜːrfɪs", "n.", "表面细分修改器（Catmull-Clark 平滑细分曲面）", "Modifiers · 修改器", "Ctrl+2", "Press Ctrl+2 to add a level-2 Subdivision Surface modifier.", "按 Ctrl+2 快速添加 2 级表面细分修改器。"),
    ("Mirror", "ˈmɪrər", "n.", "镜像修改器（沿 XYZ 轴实时对称建模并自动裁切中缝）", "Modifiers · 修改器", "", "Enable Clipping on the Mirror modifier so center vertices stay welded.", "在镜像修改器中勾选「范围限制」，使中线顶点自动吸附焊接。"),
    ("Solidify", "səˈlɪdɪfaɪ", "n.", "实体化修改器（为薄面片增加可控壁厚）", "Modifiers · 修改器", "", "Add a Solidify modifier to give the glass cup realistic wall thickness.", "添加实体化修改器为玻璃杯赋予真实壁厚。"),
    ("Array", "əˈreɪ", "n.", "阵列修改器（按固定偏移、物体或曲线批量复制排列）", "Modifiers · 修改器", "", "Use an Array modifier with an Empty offset to build a spiral staircase.", "使用阵列修改器配合空物体偏移快速制作旋转楼梯。"),
    ("Boolean", "ˈbuːliən", "n.", "布尔修改器（非破坏性执行网格差集、并集与交集运算）", "Modifiers · 修改器", "", "Use a Boolean Difference modifier to cut vents into the hard-surface panel.", "使用布尔差集修改器在硬表面面板上切出散热孔。"),
    ("Bevel Modifier", "ˈbevl ˈmɒdɪfaɪər", "n.", "倒角修改器（非破坏性按角度或权重自动给棱边倒角）", "Modifiers · 修改器", "", "Set Limit Method to Angle so the Bevel modifier only rounds sharp corners.", "将限定方式设为「角度」，让倒角修改器只处理锐角棱边。"),
    ("Decimate", "ˈdesɪmeɪt", "n.", "精简修改器（在尽量保持轮廓前提下大幅降低面数）", "Modifiers · 修改器", "", "Apply Decimate with Collapse ratio 0.3 to create an LOD mesh.", "使用塌陷比例 0.3 的精简修改器生成低模 LOD。"),
    ("Remesh", "riːˈmeʃ", "n.", "重构网格修改器（用体素或四边面重新生成均匀拓扑）", "Modifiers · 修改器", "", "Use Voxel Remesh to fuse overlapping sculpted parts seamlessly.", "使用体素重构网格将重叠雕刻部件无缝融合。"),
    ("Shrinkwrap", "ˈʃrɪŋkræp", "n.", "缩裹修改器（将网格表面紧密贴合投影到目标物体上）", "Modifiers · 修改器", "", "Use Shrinkwrap to snap retopology quads tightly onto the high-poly sculpt.", "使用缩裹修改器让重拓扑四边面紧贴高模表面。"),
    ("Lattice", "ˈlætɪs", "n.", "晶格修改器（通过外部控制笼整体柔性弯曲变形网格）", "Modifiers · 修改器", "", "Bind the stylized character to a Lattice for non-destructive silhouette tweaks.", "给风格化角色绑定晶格修改器，非破坏性调整大轮廓。"),
    ("Curve Modifier", "kɜːrv ˈmɒdɪfaɪər", "n.", "曲线修改器（使网格沿贝塞尔曲线弯曲延展）", "Modifiers · 修改器", "", "Pair Array and Curve modifiers to route cables along a Bezier path.", "配合阵列与曲线修改器，让线缆沿贝塞尔路径自然蜿蜒。"),
    ("Simple Deform", "ˈsɪmpl dɪˈfɔːrm", "n.", "简易形变修改器（快速扭曲、弯曲、锥化与拉伸）", "Modifiers · 修改器", "", "Use Simple Deform set to Bend 360° to roll a flat strip into a ring.", "将简易形变设为弯曲 360°，把平直条带卷成圆环。"),
    ("Displace", "dɪsˈpleɪs", "n.", "置换修改器（依据噪波或灰度贴图真实起伏顶点）", "Modifiers · 修改器", "", "Drive a Displace modifier with a Clouds texture to sculpt rocky ground.", "用云絮纹理驱动置换修改器生成崎岖岩石地面。"),
    ("Skin", "skɪn", "n.", "蒙皮修改器（将纯顶点与边线快速包覆生成管状网格）", "Modifiers · 修改器", "Ctrl+A", "Adjust branch thickness in the Skin modifier using Ctrl+A in Edit Mode.", "在编辑模式下按 Ctrl+A 调整蒙皮修改器生成的枝干粗细。"),
    ("Screw", "skruː", "n.", "螺旋修改器（将剖面曲线旋转 360° 生成对称回转体）", "Modifiers · 修改器", "", "Draw half a wineglass profile and add a Screw modifier for live editing.", "画出半边酒杯剖面并加螺旋修改器，随时非破坏调整造型。"),
    ("Wireframe Modifier", "ˈwaɪərfreɪm", "n.", "线框修改器（将网格所有边转为真实有厚度的实体支架）", "Modifiers · 修改器", "", "Add a Wireframe modifier to turn a sphere into a geodesic dome.", "添加线框修改器把球体变成镂空穹顶支架。"),
    ("Weld", "weld", "n.", "焊接修改器（按阈值距离非破坏性合并临近顶点）", "Modifiers · 修改器", "", "Place a Weld modifier after Array to stitch adjacent tile seams.", "在阵列修改器后放一个焊接修改器缝合相邻瓦片接缝。"),
    ("Weighted Normal", "ˈweɪtɪd ˈnɔːrml", "n.", "加权法向修改器（按大面面积加权修正硬表面倒角着色）", "Modifiers · 修改器", "", "Add Weighted Normal after Bevel to get flawless flat-panel shading.", "在倒角后添加加权法向，获得完美无扭曲的硬表面平面着色。"),
    ("Data Transfer", "ˈdeɪtə ˈtrænsfɜːr", "n.", "数据传递修改器（从参考物体传递法线、UV 或顶点组）", "Modifiers · 修改器", "", "Transfer custom normals from a sphere onto stylized foliage cards.", "将球体的平滑法线传递给风格化树叶面片。"),
    ("Multiresolution", "ˌmʌltiˌrezəˈluːʃn", "n.", "多级精度修改器（支持多层级细分的非破坏性雕刻与烘焙）", "Modifiers · 修改器", "", "Sculpt pores on level 5 of Multiresolution and bake a normal map to level 1.", "在 5 级多级精度上雕刻毛孔，再烘焙法线贴图到 1 级低模。"),
    ("Surface Deform", "ˈsɜːrfɪs dɪˈfɔːrm", "n.", "表面形变修改器（让高模衣服跟随低模布料模拟变形）", "Modifiers · 修改器", "", "Bind the detailed jacket to a simple proxy cloth using Surface Deform.", "用表面形变将精细外套绑定到简模布料代理上。"),
    ("Triangulate Modifier", "traɪˈæŋɡjʊleɪt", "n.", "三角化修改器（保持编辑期四边面同时输出稳定三角面）", "Modifiers · 修改器", "", "Keep a Triangulate modifier at the bottom of the stack for game assets.", "在修改器堆栈底部保留三角化修改器以适配游戏资产。"),
    ("Cast", "kæst", "n.", "铸型修改器（将网格向球体、圆柱或立方体形态塑形）", "Modifiers · 修改器", "", "Use a Cast modifier set to Sphere to round a subdivided cube cleanly.", "使用球体模式的铸型修改器把细分立方体规整为正球体。"),
    ("Wave", "weɪv", "n.", "波浪修改器（在网格表面生成随时间传播的涟漪动画）", "Modifiers · 修改器", "", "Add a Wave modifier to animate gentle concentric ripples on a pond.", "添加波浪修改器在池塘水面生成柔和的同心涟漪动画。"),
    ("Armature Modifier", "ˈɑːrmətʃər", "n.", "骨架修改器（将网格顶点权重绑定至骨骼以驱动形变）", "Modifiers · 修改器", "", "Place the Armature modifier above Subdivision Surface for faster playback.", "将骨架修改器置于表面细分之上可显著提升动画播放帧率。"),
    ("Cloth", "klɒθ", "n.", "布料修改器（基于物理模拟织物褶皱、垂坠与风吹）", "Modifiers · 修改器", "", "Pin the waist vertex group in the Cloth modifier to drape the skirt.", "在布料修改器中固定腰部顶点组，模拟裙摆自然垂坠。"),
    ("Collision", "kəˈlɪʒn", "n.", "碰撞修改器（使物体能阻挡布料、软体与粒子穿透）", "Modifiers · 修改器", "", "Enable Collision on the mannequin so the simulated cape rests on its shoulders.", "给人台开启碰撞，让模拟披风自然搭在肩膀上。"),
    ("Modifier Stack", "ˈmɒdɪfaɪər stæk", "n.", "修改器堆栈（从上到下依次求值的非破坏性处理管线）", "Modifiers · 修改器", "", "Order matters in the Modifier Stack: Mirror usually goes before Bevel.", "修改器堆栈顺序至关重要：镜像通常放在倒角之前。"),

    # --- Shader Nodes & Materials (着色器节点与材质) ---
    ("Shader Editor", "ˈʃeɪdər ˈedɪtər", "n.", "着色器编辑器（基于节点连线搭建 PBR 材质与世界环境）", "Shader Nodes · 着色器节点", "Shift+F3", "Open the Shader Editor to connect procedural textures into Principled BSDF.", "打开着色器编辑器将程序化纹理接入原理化 BSDF。"),
    ("Principled BSDF", "ˈprɪnsəpld biː es diː ef", "n.", "原理化 BSDF（基于迪士尼 PBR 标准的通用全能着色器）", "Shader Nodes · 着色器节点", "", "Principled BSDF handles metals, plastics, glass, and skin in one node.", "原理化 BSDF 一个节点即可覆盖金属、塑料、玻璃与皮肤材质。"),
    ("Base Color", "beɪs ˈkʌlər", "n.", "基础色（材质的漫反射反照率或金属着色基准）", "Shader Nodes · 着色器节点", "", "Plug the Albedo texture set to sRGB into Base Color.", "将色彩空间为 sRGB 的反照率贴图接入基础色。"),
    ("Metallic", "məˈtælɪk", "n.", "金属度（0 为非金属绝缘体，1 为纯金属反射）", "Shader Nodes · 着色器节点", "", "Set Metallic to 1.0 for brushed aluminum and 0.0 for painted wood.", "拉丝铝材质将金属度设为 1.0，漆木则设为 0.0。"),
    ("Roughness", "ˈrʌfnəs", "n.", "粗糙度（控制表面高光镜面清晰度与磨砂漫散射）", "Shader Nodes · 着色器节点", "", "Drive Roughness with a grunge map to break up uniform plastic highlights.", "用做旧灰度图驱动粗糙度，打破死板均匀的塑料高光。"),
    ("IOR", "aɪ oʊ ɑːr", "n.", "折射率（光线穿透玻璃、水或透明介质时的偏折系数）", "Shader Nodes · 着色器节点", "", "Use an IOR of 1.333 for water and 1.45 to 1.52 for glass.", "水的折射率设为 1.333，常见玻璃设为 1.45 至 1.52。"),
    ("Specular", "ˈspekjʊlər", "n.", "高光（调节非金属表面的反射强度与着色）", "Shader Nodes · 着色器节点", "", "Lower Specular IOR Level slightly for dusty matte clay.", "为落灰哑光黏土略微降低高光反射强度。"),
    ("Transmission", "trænzˈmɪʃn", "n.", "透射（控制玻璃、晶体等透明材质的折射透光比例）", "Shader Nodes · 着色器节点", "", "Raise Transmission Weight to 1.0 with low Roughness for clear crystal.", "将透射权重拉至 1.0 并降低粗糙度即可得到通透水晶。"),
    ("Subsurface Scattering", "ˌsʌbˈsɜːrfɪs ˈskætərɪŋ", "n.", "次表面散射 / SSS（模拟皮肤、玉石与蜡烛内部透光）", "Shader Nodes · 着色器节点", "", "Add subtle Subsurface Scattering so ears glow warmly in backlight.", "加入柔和次表面散射，让逆光下的耳廓泛出暖红透光。"),
    ("Coat", "koʊt", "n.", "清漆涂层（在底漆上方叠加一层高光透明保护层）", "Shader Nodes · 着色器节点", "", "Increase Coat Weight to 1.0 to simulate automotive clear-coat paint.", "将清漆权重提至 1.0 模拟汽车金属漆表面的透明罩光层。"),
    ("Sheen", "ʃiːn", "n.", "光泽（模拟天鹅绒、布料边缘的柔和绒毛反光）", "Shader Nodes · 着色器节点", "", "Turn up Sheen Weight for soft velvet and microfiber sofa fabrics.", "提高光泽权重表现天鹅绒与超纤沙发布料的微绒质感。"),
    ("Emission", "ɪˈmɪʃn", "n.", "自发光（让材质本身成为发光体照亮周围场景）", "Shader Nodes · 着色器节点", "", "Set Emission Strength to 8.0 for glowing neon signage.", "将自发光强度设为 8.0 制作霓虹灯牌。"),
    ("Alpha", "ˈælfə", "n.", "透明度（控制贴图镂空裁切或半透明混合）", "Shader Nodes · 着色器节点", "", "Connect the leaf opacity mask to the Alpha socket for crisp cutouts.", "将树叶透明遮罩接入 Alpha 接口实现边缘锐利镂空。"),
    ("Normal Map", "ˈnɔːrml mæp", "n.", "法线贴图节点（用切线空间紫蓝贴图模拟凹凸光照细节）", "Shader Nodes · 着色器节点", "", "Set the Normal Map image to Non-Color before plugging it in.", "法线贴图务必先将色彩空间设为「非彩色」再接入。"),
    ("Bump", "bʌmp", "n.", "凹凸节点（由黑白高度图实时扰动法线模拟微观起伏）", "Shader Nodes · 着色器节点", "", "Pass a fine Noise Texture through a Bump node for orange-peel paint.", "将细密噪波纹理接入凹凸节点模拟橘皮漆面。"),
    ("Displacement", "dɪsˈpleɪsmənt", "n.", "置换节点（在 Cycles 渲染时真实偏移微多边形表面几何）", "Shader Nodes · 着色器节点", "", "Connect the height map to a Displacement node for true brick relief.", "将高度图接入置换节点在渲染时生成真实砖缝立体起伏。"),
    ("Color Ramp", "ˈkʌlər ræmp", "n.", "颜色渐变节点（重映射灰度值对比度或着色阶梯）", "Shader Nodes · 着色器节点", "", "Tighten the black and white stops on a Color Ramp to sharpen rust masks.", "拉近颜色渐变节点黑白滑块，让铁锈遮罩边界更锐利。"),
    ("Mix Color", "mɪks ˈkʌlər", "n.", "混合颜色节点（按混合模式与系数融合两路颜色/纹理）", "Shader Nodes · 着色器节点", "", "Use Mix Color in Multiply mode to layer ambient occlusion onto albedo.", "用正片叠底模式的混合颜色节点将 AO 叠在基础色上。"),
    ("Mix Shader", "mɪks ˈʃeɪdər", "n.", "混合着色器（按因子混合两个完整着色器分支）", "Shader Nodes · 着色器节点", "", "Blend a Diffuse and Transparent BSDF with a Mix Shader for lace curtains.", "用混合着色器融合漫反射与透明 BSDF 表现蕾丝窗帘。"),
    ("Noise Texture", "nɔɪz ˈtekstʃər", "n.", "噪波纹理（生成连续自然的 Perlin 程序化纹理）", "Shader Nodes · 着色器节点", "", "Increase Detail and Roughness on Noise Texture for organic stone grain.", "提高噪波纹理的细节与粗糙度生成自然石材肌理。"),
    ("Voronoi Texture", "vəˈrɔɪnɔɪ ˈtekstʃər", "n.", "沃罗诺伊纹理（生成细胞、裂纹、鹅卵石与水波焦散图案）", "Shader Nodes · 着色器节点", "", "Use Voronoi Distance to Edge to create procedural cracked mud.", "使用沃罗诺伊的「到边距离」模式生成程序化龟裂泥地。"),
    ("Wave Texture", "weɪv ˈtekstʃər", "n.", "波浪纹理（生成条纹、年轮与木纹扭曲图案）", "Shader Nodes · 着色器节点", "", "Distort a Rings Wave Texture to build seamless procedural wood grain.", "扭曲环形波浪纹理即可制作无缝程序化木纹。"),
    ("Image Texture", "ˈɪmɪdʒ ˈtekstʃər", "n.", "图像纹理节点（加载外部 PNG/EXR/JPG 位图贴图）", "Shader Nodes · 着色器节点", "", "Press Ctrl+T with Node Wrangler to auto-add Mapping for Image Texture.", "启用 Node Wrangler 后按 Ctrl+T 自动为图像纹理配齐映射节点。"),
    ("Texture Coordinate", "ˈtekstʃər koʊˈɔːrdɪnət", "n.", "纹理坐标节点（提供生成、物体、UV、窗口与反射坐标）", "Shader Nodes · 着色器节点", "Ctrl+T", "Use Object coordinates so procedural textures stay uniform without UV seams.", "使用「物体」坐标可让程序化纹理无需 UV 且无接缝。"),
    ("Mapping Node", "ˈmæpɪŋ noʊd", "n.", "映射节点（平移、旋转与缩放纹理坐标空间）", "Shader Nodes · 着色器节点", "Ctrl+T", "Adjust Scale in the Mapping node to tile the brick texture evenly.", "在映射节点中调节缩放比例让砖块纹理均匀平铺。"),
    ("Fresnel", "freɪˈnel", "n.", "菲涅耳节点（按观察掠射角计算边缘反射增强权重）", "Shader Nodes · 着色器节点", "", "Use Fresnel as a Mix factor so surfaces reflect more strongly at grazing angles.", "用菲涅耳作为混合系数，让物体在掠射角边缘呈现更强反光。"),
    ("Layer Weight", "ˈleɪər weɪt", "n.", "层权重节点（输出菲涅耳与朝向值，常用于边缘光与布料）", "Shader Nodes · 着色器节点", "", "Plug Layer Weight Facing into a Color Ramp for stylized rim shading.", "将层权重的「朝向」接入颜色渐变制作风格化边缘光。"),
    ("Ambient Occlusion", "ˈæmbiənt əˈkluːʒn", "n.", "环境光遮蔽 / AO 节点（识别缝隙凹槽以自动添加污渍与阴影）", "Shader Nodes · 着色器节点", "", "Use Ambient Occlusion to automatically gather dirt in mechanical crevices.", "利用环境光遮蔽节点在机械凹槽缝隙处自动生成积灰。"),
    ("Light Path", "laɪt pæθ", "n.", "光程节点（区分摄像机、阴影、漫反射与光泽射线做渲染优化）", "Shader Nodes · 着色器节点", "", "Use Light Path Is Shadow Ray to let sunlight pass cleanly through glass.", "利用光程节点的「阴影射线」让阳光无噪点穿透玻璃。"),
    ("Glass BSDF", "ɡlæs biː es diː ef", "n.", "玻璃 BSDF（专注折射与反射的轻量玻璃着色器）", "Shader Nodes · 着色器节点", "", "Mix Glass BSDF with Transparent BSDF for clean architectural windows.", "将玻璃 BSDF 与透明 BSDF 混合可获得通透的建筑窗玻璃。"),
    ("Transparent BSDF", "trænsˈpærənt", "n.", "透明 BSDF（完全透光且不产生折射偏移的透明节点）", "Shader Nodes · 着色器节点", "", "Use Transparent BSDF for alpha-cutout decals and foliage cards.", "透明 BSDF 常用于 Alpha 镂空贴花与植被面片。"),
    ("Principled Volume", "ˈprɪnsəpld ˈvɒljuːm", "n.", "原理化体积（制作雾气、云层、烟雾与丁达尔体积光）", "Shader Nodes · 着色器节点", "", "Plug Principled Volume with low Density into World Volume for god rays.", "将低密度原理化体积接入世界体积输出即可产生丁达尔光束。"),
    ("Node Wrangler", "noʊd ˈræŋɡlər", "n.", "节点整理器（Blender 内置必备高效节点快捷键插件）", "Shader Nodes · 着色器节点", "Ctrl+Shift+Click", "Ctrl+Shift+Click any node with Node Wrangler to preview its output.", "启用节点整理器后按 Ctrl+Shift+点击 任意节点即可直接预览输出。"),
    ("Material Output", "məˈtɪriəl ˈaʊtpʊt", "n.", "材质输出节点（汇总表面、体积与置换的最终着色终端）", "Shader Nodes · 着色器节点", "", "Connect your final shader to the Surface socket of Material Output.", "将最终着色器接入材质输出节点的「表面」接口。"),
    ("World Shader", "wɜːrld ˈʃeɪdər", "n.", "世界环境着色器（控制天空纹理、HDRI 照明与全局雾效）", "Shader Nodes · 着色器节点", "", "Switch Shader Editor to World to load an Environment Texture HDRI.", "将着色器编辑器切换至「世界」以加载 HDRI 环境贴图。"),

    # --- Geometry Nodes (几何节点) ---
    ("Geometry Nodes", "dʒiˈɒmətri noʊdz", "n.", "几何节点（非破坏性程序化建模、散布与模拟节点系统）", "Geometry Nodes · 几何节点", "", "Build parametric fences and buildings that adapt automatically with Geometry Nodes.", "用几何节点搭建参数化栅栏与建筑，尺寸随曲线自动适配。"),
    ("Group Input", "ɡruːp ˈɪnpʊt", "n.", "组输入节点（将节点参数暴露到修改器面板供实时调节）", "Geometry Nodes · 几何节点", "", "Drag any socket to Group Input to expose a slider in the Modifier tab.", "将任意接口拖到组输入，即可在修改器面板暴露滑块参数。"),
    ("Group Output", "ɡruːp ˈaʊtpʊt", "n.", "组输出节点（将处理完成的最终几何体输出至场景）", "Geometry Nodes · 几何节点", "", "Connect the joined mesh stream into Group Output.", "将合并后的几何流接入组输出节点。"),
    ("Join Geometry", "dʒɔɪn dʒiˈɒmətri", "n.", "合并几何体（把多路网格、曲线或点云汇总到一起）", "Geometry Nodes · 几何节点", "", "Use Join Geometry to keep the base terrain alongside scattered trees.", "使用合并几何体同时保留原始地形与散布的树木。"),
    ("Set Position", "set pəˈzɪʃn", "n.", "设置位置（按偏移向量或场公式移动点、顶点与实例）", "Geometry Nodes · 几何节点", "", "Plug Noise Texture into Set Position Offset to displace points procedurally.", "将噪波纹理接入设置位置的偏移接口，程序化扰动点位。"),
    ("Transform Geometry", "trænsˈfɔːrm dʒiˈɒmətri", "n.", "变换几何体（在节点流中平移、旋转与缩放整组几何）", "Geometry Nodes · 几何节点", "", "Use Transform Geometry to center the generated asset before output.", "用变换几何体在输出前将生成的资产居中对齐。"),
    ("Distribute Points on Faces", "dɪˈstrɪbjuːt pɔɪnts", "n.", "分布点于面上（在表面按密度或泊松圆盘随机撒点）", "Geometry Nodes · 几何节点", "", "Switch Distribute Points on Faces to Poisson Disk so rocks never overlap.", "将分布模式改为泊松圆盘，避免散布的石头互相穿插。"),
    ("Instance on Points", "ˈɪnstəns ɒn pɔɪnts", "n.", "实例化于点上（在每个点位高效放置轻量级物体实例）", "Geometry Nodes · 几何节点", "", "Scatter thousands of grass blades effortlessly with Instance on Points.", "用实例化于点上轻松散布数万根草叶而不占内存。"),
    ("Realize Instances", "ˈriːəlaɪz ˈɪnstənsɪz", "n.", "实现实例（将轻量实例转为可独立变形与导出的真实网格）", "Geometry Nodes · 几何节点", "", "Add Realize Instances before applying deformations or exporting FBX.", "在执行形变或导出 FBX 前需添加「实现实例」节点。"),
    ("Set Shade Smooth", "set ʃeɪd smuːð", "n.", "设置平滑着色（在几何节点中控制生成面的平滑状态）", "Geometry Nodes · 几何节点", "", "Append Set Shade Smooth after Curve to Mesh for smooth pipes.", "在曲线转网格后接上设置平滑着色，让管道表面光滑。"),
    ("Set Material", "set məˈtɪriəl", "n.", "设置材质（为程序化生成的几何体指定对应材质槽）", "Geometry Nodes · 几何节点", "", "Assign bark and leaf materials separately using two Set Material nodes.", "用两个设置材质节点分别为树干与树叶指定材质。"),
    ("Curve to Mesh", "kɜːrv tuː meʃ", "n.", "曲线转网格（沿路径曲线扫掠剖面生成管道或丝带）", "Geometry Nodes · 几何节点", "", "Feed a Curve Circle as the Profile Curve in Curve to Mesh to build ropes.", "将曲线圆环接入曲线转网格的轮廓曲线接口即可生成绳索。"),
    ("Mesh to Curve", "meʃ tuː kɜːrv", "n.", "网格转曲线（将网格边线提取转换为可扫掠曲线）", "Geometry Nodes · 几何节点", "", "Convert edge selections with Mesh to Curve to generate piping trims.", "用网格转曲线将选中边转为曲线，快速生成包边线条。"),
    ("Resample Curve", "riːˈsæmpl kɜːrv", "n.", "重采样曲线（按固定点数或间距重新均匀分布控制点）", "Geometry Nodes · 几何节点", "", "Use Resample Curve set to Length for evenly spaced fence posts.", "将重采样曲线设为按长度模式，让栅栏立柱等距排列。"),
    ("Trim Curve", "trɪm kɜːrv", "n.", "修剪曲线（按起止因子动态裁切曲线，常用于生长动画）", "Geometry Nodes · 几何节点", "", "Animate the End factor on Trim Curve to grow vines across a wall.", "给修剪曲线的结束值打关键帧，制作藤蔓沿墙生长动画。"),
    ("Geometry Proximity", "dʒiˈɒmətri prɒkˈsɪməti", "n.", "几何接近（计算到目标网格的最近距离以驱动动态反应）", "Geometry Nodes · 几何节点", "", "Use Geometry Proximity to clear grass automatically along a walking path.", "利用几何接近计算距离，自动清除步道两侧的杂草。"),
    ("Raycast", "ˈreɪkæst", "n.", "光线投射（沿方向发射射线检测碰撞位置与法线）", "Geometry Nodes · 几何节点", "", "Use Raycast downward to drop scattered boulders flush onto uneven ground.", "向下发射光线投射，让散布巨石精准贴合崎岖地面。"),
    ("Capture Attribute", "ˈkæptʃər ˈætrɪbjuːt", "n.", "捕获属性（在拓扑变化前冻结并沿数据流传递场属性）", "Geometry Nodes · 几何节点", "", "Capture the spline factor before Curve to Mesh to shade gradients along cables.", "在曲线转网格前捕获样条参数，方便给线缆做沿程渐变着色。"),
    ("Store Named Attribute", "stɔːr neɪmd ˈætrɪbjuːt", "n.", "存储命名属性（把自定义几何属性写入网格供着色器读取）", "Geometry Nodes · 几何节点", "", "Store a 'wear' attribute and read it via the Attribute node in Shader Editor.", "存储名为 wear 的属性并在着色器中用属性节点读取。"),
    ("Random Value", "ˈrændəm ˈvæljuː", "n.", "随机值（按种子与范围生成每点独立的随机标量或向量）", "Geometry Nodes · 几何节点", "", "Drive instance Scale and Z Rotation with Random Value for natural forests.", "用随机值驱动实例缩放与 Z 轴旋转，让森林错落自然。"),
    ("Map Range", "mæp reɪndʒ", "n.", "映射范围（将输入数值区间线性或平滑重映射到新区间）", "Geometry Nodes · 几何节点", "", "Use Map Range to convert proximity distance into a 0–1 scale mask.", "使用映射范围将接近距离换算为 0 到 1 的缩放遮罩。"),
    ("Combine XYZ", "kəmˈbaɪn eks waɪ ziː", "n.", "合并 XYZ（将三个独立浮点数拼装为三维向量）", "Geometry Nodes · 几何节点", "", "Feed a Random Value into Z of Combine XYZ to randomize vertical rotation.", "将随机值接入合并 XYZ 的 Z 分量以随机化垂直旋转。"),
    ("Separate XYZ", "ˈsepəreɪt eks waɪ ziː", "n.", "分离 XYZ（将三维位置或法线向量拆分为单独的 X、Y、Z 通道）", "Geometry Nodes · 几何节点", "", "Use Separate XYZ on Normal Z to scatter snow only on upward slopes.", "分离法线的 Z 分量，只在朝上的斜坡表面散布积雪。"),
    ("Simulation Zone", "ˌsɪmjʊˈleɪʃn zoʊn", "n.", "模拟区域（逐帧迭代更新几何状态的物理/粒子模拟框）", "Geometry Nodes · 几何节点", "", "Build custom flocking particles and trail effects inside a Simulation Zone.", "在模拟区域内搭建自定义群集粒子与拖尾特效。"),
    ("Repeat Zone", "rɪˈpiːt zoʊn", "n.", "重复区域（按指定迭代次数循环执行同一组节点操作）", "Geometry Nodes · 几何节点", "", "Use a Repeat Zone to stack procedural floors or recursive branches.", "利用重复区域循环堆叠程序化楼层或递归树枝。"),
    ("Switch Node", "swɪtʃ noʊd", "n.", "切换节点（按布尔开关在两路几何或参数间灵活切换）", "Geometry Nodes · 几何节点", "", "Expose a Switch node boolean to toggle low-poly proxy display.", "暴露切换节点的布尔开关，一键切换低模代理显示。"),
    ("Field", "fiːld", "n.", "场（几何节点中按元素惰性求值的菱形接口数据流）", "Geometry Nodes · 几何节点", "", "Diamond sockets indicate a Field evaluated per vertex, edge, or instance.", "菱形接口代表「场」，会对每个顶点、边或实例独立求值。"),
    ("Spreadsheet", "ˈspredʃiːt", "n.", "电子表格编辑器（实时查看顶点坐标、属性与实例数量）", "Geometry Nodes · 几何节点", "", "Inspect the Spreadsheet editor to debug named attributes and point counts.", "打开电子表格编辑器实时排查命名属性与点云数量。"),

    # --- UV Editing & Texturing (UV 展开与贴图) ---
    ("UV Unwrap", "juː viː ʌnˈræp", "v.", "UV 展开（将三维网格表面展平映射到二维贴图坐标）", "UV · UV 编辑", "U", "Select all faces in Edit Mode and press U to UV Unwrap.", "编辑模式下全选面按 U 执行 UV 展开。"),
    ("Mark Seam", "mɑːrk siːm", "v.", "标记缝合边（指定展开 UV 时的裁切切口线）", "UV · UV 编辑", "Ctrl+E", "Mark Seam along hidden underside edges to avoid visible texture breaks.", "在隐蔽背面边线上标记缝合边，避免贴图接缝外露。"),
    ("Clear Seam", "klɪr siːm", "v.", "清除缝合边（取消已标记的红色 UV 裁切线）", "UV · UV 编辑", "Ctrl+E", "Select misplaced red edges and choose Clear Seam.", "选中标错的红色边线执行清除缝合边。"),
    ("Smart UV Project", "smɑːrt juː viː prəˈdʒekt", "v.", "智能 UV 投射（按夹角阈值自动快速切分硬表面 UV）", "UV · UV 编辑", "U", "Use Smart UV Project for fast lightmap or mechanical asset unwrapping.", "对硬表面机械资产或光照贴图可使用智能 UV 投射快速展开。"),
    ("Cube Projection", "kjuːb prəˈdʒekʃn", "v.", "立方体投射（从六面正交投影展开建筑墙体 UV）", "UV · UV 编辑", "U", "Apply Cube Projection to keep brick textures evenly scaled on walls.", "对墙体使用立方体投射以保持砖块纹理比例一致。"),
    ("Pack Islands", "pæk ˈaɪləndz", "v.", "打包孤岛（自动紧凑排布所有 UV 块以最大化贴图利用率）", "UV · UV 编辑", "", "Run Pack Islands with a small margin to prevent texture bleeding.", "执行打包孤岛并留出适当边距，防止贴图渗色。"),
    ("Average Islands Scale", "ˈævərɪdʒ ˈaɪləndz skeɪl", "v.", "平均孤岛缩放（统一各 UV 块与三维表面的像素密度比例）", "UV · UV 编辑", "", "Run Average Islands Scale before packing so texel density stays consistent.", "打包前先执行平均孤岛缩放，保证各部位纹理清晰度一致。"),
    ("Pin", "pɪn", "v.", "钉固（锁定部分 UV 顶点，重新展开时保持不动）", "UV · UV 编辑", "P", "Pin the aligned border vertices with P before re-unwrapping the cloth.", "重新展开前按 P 钉固已对齐的边界 UV 顶点。"),
    ("Unpin", "ʌnˈpɪn", "v.", "取消钉固（释放已锁定的 UV 顶点）", "UV · UV 编辑", "Alt+P", "Press Alt+P in the UV Editor to release pinned vertices.", "在 UV 编辑器中按 Alt+P 取消钉固顶点。"),
    ("Live Unwrap", "laɪv ʌnˈræp", "n.", "实时展开（移动钉固点或标记缝合边时实时重算 UV）", "UV · UV 编辑", "", "Enable Live Unwrap to straighten curved UV islands interactively.", "开启实时展开，拖拽钉固点即可交互拉直弯曲 UV 孤岛。"),
    ("UV Sync Selection", "juː viː sɪŋk sɪˈlekʃn", "n.", "UV 选区同步（在 3D 视口与 UV 编辑器之间双向联动选中）", "UV · UV 编辑", "", "Turn on UV Sync Selection to locate a UV island directly on the 3D model.", "开启 UV 选区同步，在 UV 图中选中即能定位 3D 模型对应面。"),
    ("Texel Density", "ˈteksl ˈdensəti", "n.", "纹素密度（每单位三维面积所分配的贴图像素数量）", "UV · UV 编辑", "", "Maintain consistent Texel Density across props so textures look equally crisp.", "保持道具间一致的纹素密度，避免贴图有的糊有的锐。"),
    ("UDIM", "juː dɪm", "n.", "多象限贴图（将 UV 扩展到 1001/1002 等多张高分辨率贴图）", "UV · UV 编辑", "", "Split hero characters across UDIM tiles for 4K film-grade texture detail.", "将主角 UV 拆分至多个 UDIM 象限以承载影视级 4K 贴图细节。"),
    ("Texture Paint", "ˈtekstʃər peɪnt", "n.", "纹理绘制模式（直接在三维模型表面手绘贴图与遮罩）", "UV · UV 编辑", "", "Switch to Texture Paint to hand-paint dirt masks right onto the model.", "切至纹理绘制模式直接在模型表面手绘污渍遮罩。"),
    ("Bake", "beɪk", "v.", "烘焙（将高模法线、AO 或光照信息渲染写入低模贴图）", "UV · UV 编辑", "", "Bake the high-poly sculpt details into a Tangent Space Normal Map in Cycles.", "在 Cycles 中将高模雕刻细节烘焙为切线空间法线贴图。"),
    ("Margin", "ˈmɑːrdʒɪn", "n.", "边距扩展（UV 孤岛外扩像素，消除 mipmap 缩小后的黑缝）", "UV · UV 编辑", "", "Set Bake Margin to 16 px so mipmaps never bleed background color.", "将烘焙边距设为 16 像素，防止远景 mipmap 出现黑边渗色。"),
    ("Stretch Display", "stretʃ dɪˈspleɪ", "n.", "拉伸显示（用蓝绿黄红热力图可视化 UV 畸变程度）", "UV · UV 编辑", "", "Check UV Stretch Display to ensure every island stays cool dark blue.", "开启拉伸显示，确保所有 UV 孤岛呈低畸变的深蓝色。"),
    ("UV Island", "juː viː ˈaɪlənd", "n.", "UV 孤岛（由缝合边切分出的独立连续 UV 展开块）", "UV · UV 编辑", "L", "Press L in the UV Editor to select a whole UV Island at once.", "在 UV 编辑器中按 L 键一键选中整块 UV 孤岛。"),

    # --- Sculpting (数字雕刻) ---
    ("Sculpt Mode", "skʌlpt moʊd", "n.", "雕刻模式（像揉捏数字黏土一样用笔刷塑造高模细节）", "Sculpt · 数字雕刻", "", "Switch to Sculpt Mode to block out organic character anatomy.", "切换至雕刻模式塑造有机角色解剖结构。"),
    ("Dyntopo", "ˈdaɪntoʊpoʊ", "n.", "动态拓扑（雕刻笔刷经过处实时细分三角面增加细节）", "Sculpt · 数字雕刻", "Ctrl+D", "Press Ctrl+D to toggle Dyntopo while sketching creatures freely.", "自由起草生物造型时按 Ctrl+D 开启动态拓扑。"),
    ("Voxel Remesh", "ˈvɒksl riːˈmeʃ", "v.", "体素重构网格（按统一体素尺寸重建均匀雕刻网格）", "Sculpt · 数字雕刻", "Ctrl+R", "Press Shift+R to preview voxel size, then Ctrl+R to Voxel Remesh.", "按 Shift+R 预览体素网格尺寸，再按 Ctrl+R 执行重构。"),
    ("Brush Radius", "brʌʃ ˈreɪdiəs", "n.", "笔刷半径（实时拖拽调节雕刻/绘制笔刷大小）", "Sculpt · 数字雕刻", "F", "Press F and move the mouse to resize the sculpt brush quickly.", "按 F 键移动鼠标快速调整笔刷大小。"),
    ("Brush Strength", "brʌʃ streŋθ", "n.", "笔刷强度（实时调节笔刷雕刻力度或绘制不透明度）", "Sculpt · 数字雕刻", "Shift+F", "Press Shift+F to dial down Brush Strength for subtle skin wrinkles.", "按 Shift+F 调低笔刷强度以刻画细腻皮肤纹理。"),
    ("Clay Strips", "kleɪ strɪps", "n.", "黏土条笔刷（堆叠雕塑感明显的扁平泥条体块）", "Sculpt · 数字雕刻", "", "Use Clay Strips to build up muscle volume with expressive planes.", "用黏土条笔刷堆叠出富有体块感的肌肉结构。"),
    ("Grab Brush", "ɡræb brʌʃ", "n.", "抓取笔刷（大范围推拉调整整体剪影与比例）", "Sculpt · 数字雕刻", "G", "Use the Grab Brush early to refine the head silhouette and proportions.", "起型阶段多用抓取笔刷反复校准头部剪影与比例。"),
    ("Smooth Brush", "smuːð brʌʃ", "n.", "平滑笔刷（按住 Shift 随时抹平粗糙笔触与凹凸）", "Sculpt · 数字雕刻", "Shift", "Hold Shift while sculpting to smooth harsh transitions on the fly.", "雕刻过程中按住 Shift 可随时切换平滑笔刷抹平过渡。"),
    ("Crease Brush", "kriːs brʌʃ", "n.", "折痕笔刷（向内捏合刻画锐利皱纹、衣褶与眼睑线）", "Sculpt · 数字雕刻", "", "Carve crisp cloth folds and brow wrinkles with the Crease Brush.", "使用折痕笔刷刻画锐利的衣物褶皱与眉间纹。"),
    ("Inflate Brush", "ɪnˈfleɪt brʌʃ", "n.", "膨胀笔刷（沿表面法线向外鼓胀体积）", "Sculpt · 数字雕刻", "", "Use Inflate gently to plump up lips and rounded cushions.", "轻刷膨胀笔刷让嘴唇与软垫显得饱满圆润。"),
    ("Pinch Brush", "pɪntʃ brʌʃ", "n.", "捏拢笔刷（将周围顶点向笔触中心拉拢锐化棱线）", "Sculpt · 数字雕刻", "", "Run the Pinch Brush along armor ridges to tighten beveled edges.", "沿盔甲棱脊轻扫捏拢笔刷，收紧硬朗转折线。"),
    ("Scrape / Flatten", "skreɪp", "n.", "刮削 / 刮平笔刷（削平凸起体块打造硬朗切面）", "Sculpt · 数字雕刻", "", "Use Scrape to carve planar stone facets on stylized rocks.", "用刮削笔刷在风格化岩石上切出硬朗的平面转折。"),
    ("Snake Hook", "sneɪk hʊk", "n.", "蛇钩笔刷（拉出长角、触须与飘逸发丝等延伸结构）", "Sculpt · 数字雕刻", "", "Enable Dyntopo and use Snake Hook to pull out curved horns.", "开启动态拓扑并用蛇钩笔刷直接拉出弯曲犄角。"),
    ("Mask Brush", "mæsk brʌʃ", "n.", "遮罩笔刷（涂黑保护局部区域不受后续雕刻影响）", "Sculpt · 数字雕刻", "M", "Press M to paint a protective mask over the eyes before sculpting cheeks.", "按 M 涂抹遮罩保护眼部，再放心雕刻脸颊。"),
    ("Invert Mask", "ɪnˈvɜːrt mæsk", "v.", "反转遮罩（交换保护区与可编辑区）", "Sculpt · 数字雕刻", "Ctrl+I", "Press Ctrl+I in Sculpt Mode to invert the painted mask.", "在雕刻模式下按 Ctrl+I 反转当前遮罩区域。"),
    ("Clear Mask", "klɪr mæsk", "v.", "清除遮罩（一键移除全部雕刻遮罩）", "Sculpt · 数字雕刻", "Alt+M", "Press Alt+M to clear all sculpt masks and resume full editing.", "按 Alt+M 清除全部遮罩恢复自由雕刻。"),
    ("Face Sets", "feɪs sets", "n.", "面组（用彩色区域划分部件，便于局部隐藏与独立雕刻）", "Sculpt · 数字雕刻", "W", "Use Face Sets to isolate fingers so adjacent digits never stick together.", "用面组区分每根手指，雕刻时互不粘连干扰。"),
    ("Symmetry", "ˈsɪmətri", "n.", "镜像对称（开启 X/Y/Z 轴同步双侧雕刻）", "Sculpt · 数字雕刻", "", "Enable X Symmetry in the top header when sculpting faces.", "雕刻人脸时在顶栏开启 X 轴对称以左右同步塑造。"),
    ("Elastic Deform", "ɪˈlæstɪk dɪˈfɔːrm", "n.", "弹性形变笔刷（保持体积守恒的自然软体推拉变形）", "Sculpt · 数字雕刻", "", "Use Elastic Deform to adjust character proportions without pinching.", "使用弹性形变笔刷调整角色比例，不会产生生硬拉扯。"),
    ("Pose Brush", "poʊz brʌʃ", "n.", "姿态笔刷（无需绑骨即可像关节一样弯折四肢摆姿势）", "Sculpt · 数字雕刻", "", "Quickly bend a sculpted arm with the Pose Brush to test silhouettes.", "用姿态笔刷快速弯折雕像手臂预览剪影动态。"),
    ("Retopology", "ˌriːtəˈpɒlədʒi", "n.", "重拓扑（在数百万面高模表面重建动画友好的规整低模）", "Sculpt · 数字雕刻", "", "Retopology turns a dense sculpt into an animation-ready quad mesh.", "重拓扑将密集高模转化为适合绑骨动画的规整四边面低模。"),

    # --- Render, Lighting & Compositing (渲染、灯光与合成) ---
    ("Cycles", "ˈsaɪklz", "n.", "Cycles 路径追踪渲染器（物理精确的全局光照与反射渲染）", "Render · 渲染灯光", "", "Switch to Cycles GPU Compute for photorealistic reflections and caustics.", "切换至 Cycles GPU 计算以获得照片级反射与全局光照。"),
    ("EEVEE", "ˈiːviː", "n.", "EEVEE 实时渲染引擎（高速光栅化与屏幕空间光线追踪）", "Render · 渲染灯光", "", "Use EEVEE for fast stylized animation previews and motion graphics.", "使用 EEVEE 高速渲染风格化动画与动态图形。"),
    ("Render Image", "ˈrendər ˈɪmɪdʒ", "v.", "渲染图像（渲染当前活动摄像机的静态成图）", "Render · 渲染灯光", "F12", "Press F12 to render the current camera view at full resolution.", "按 F12 以完整分辨率渲染当前摄像机画面。"),
    ("Render Animation", "ˈrendər ˌænɪˈmeɪʃn", "v.", "渲染动画（按起止帧范围逐帧输出视频或图像序列）", "Render · 渲染灯光", "Ctrl+F12", "Press Ctrl+F12 to render the entire timeline to a PNG sequence.", "按 Ctrl+F12 将整段时间轴渲染输出为 PNG 序列。"),
    ("Denoising", "diːˈnɔɪzɪŋ", "n.", "降噪（利用 OpenImageDenoise / OptiX 消除低采样噪点）", "Render · 渲染灯光", "", "Enable OpenImageDenoise to get clean Cycles renders at 128 samples.", "开启 OpenImageDenoise，128 采样即可得到干净无噪点画面。"),
    ("Samples", "ˈsæmplz", "n.", "采样数（每像素追踪的光线数量，越高画面越纯净）", "Render · 渲染灯光", "", "Use Adaptive Sampling with a Noise Threshold of 0.02 to save render time.", "开启自适应采样并将噪点阈值设为 0.02，大幅缩短渲染耗时。"),
    ("Light Bounces", "laɪt baʊnsɪz", "n.", "光线弹射次数（控制漫反射、光泽与透射光线的反弹深度）", "Render · 渲染灯光", "", "Increase Transmission Bounces to 12 so stacked glass never turns black.", "将透射弹射提高至 12，防止多层玻璃发黑。"),
    ("HDRI", "eɪtʃ diː ɑːr aɪ", "n.", "高动态范围环境贴图（提供真实 360° 环境照明与反射）", "Render · 渲染灯光", "", "Load a studio HDRI in World Shader for instant realistic reflections.", "在世界着色器中加载影棚 HDRI，瞬间获得逼真反射。"),
    ("Area Light", "ˈeriə laɪt", "n.", "面光（模拟柔光箱与窗户的柔和阴影主光源）", "Render · 渲染灯光", "", "Place a large soft Area Light at 45 degrees as your key light.", "在 45 度角放置一盏大尺寸面光作为柔和主光。"),
    ("Point Light", "pɔɪnt laɪt", "n.", "点光（向四周均匀辐射光线的灯泡式光源）", "Render · 渲染灯光", "", "Adjust Point Light Radius to soften hard pinpoint shadows.", "调大点光源半径可柔化尖锐的阴影边缘。"),
    ("Sun Light", "sʌn laɪt", "n.", "日光（模拟无限远平行阳光，方向决定阴影角度）", "Render · 渲染灯光", "", "Rotate the Sun Light low near the horizon for golden-hour shadows.", "将日光角度调低靠近地平线，营造黄金时刻长阴影。"),
    ("Spot Light", "spɒt laɪt", "n.", "聚光灯（带锥角与边缘柔和度的舞台/手电筒光束）", "Render · 渲染灯光", "", "Use a Spot Light inside a volume box to create dramatic stage beams.", "在体积盒内放置聚光灯可营造极具张力的舞台光柱。"),
    ("Depth of Field", "depθ əv fiːld", "n.", "景深（模拟真实镜头对焦清晰区与前后背景虚化）", "Render · 渲染灯光", "", "Enable Depth of Field and pick the hero subject as the Focus Object.", "在摄像机中开启景深并吸取主角作为对焦物体。"),
    ("Focal Length", "ˈfoʊkl leŋθ", "n.", "焦距（控制广角透视张力或长焦人像压缩感）", "Render · 渲染灯光", "", "Use an 85mm Focal Length for flattering character portraits.", "拍摄角色肖像建议使用 85mm 焦距以减少面部透视畸变。"),
    ("F-Stop", "ef stɒp", "n.", "光圈值（数值越小背景虚化越强烈，如 f/1.8）", "Render · 渲染灯光", "", "Lower the F-Stop to 2.0 for creamy bokeh behind the product.", "将光圈值调低至 2.0 为产品背景带来奶油般虚化。"),
    ("Motion Blur", "ˈmoʊʃn blɜːr", "n.", "运动模糊（模拟高速移动物体在快门期间的拖影感）", "Render · 渲染灯光", "", "Enable Motion Blur in Render Properties for realistic spinning wheels.", "在渲染属性中开启运动模糊，让高速旋转的车轮更真实。"),
    ("AgX", "eɪ dʒiː eks", "n.", "AgX 色彩管理（Blender 新一代高光去饱和电影级色调映射）", "Render · 渲染灯光", "", "Use AgX View Transform so bright neon lights roll off gracefully.", "使用 AgX 视图变换，让高亮度霓虹灯色彩过渡自然不溢色。"),
    ("Filmic", "ˈfɪlmɪk", "n.", "胶片色彩空间（经典高动态范围宽容度视图变换）", "Render · 渲染灯光", "", "Filmic preserves highlight detail far better than Standard sRGB.", "相比标准 sRGB，Filmic 能保留丰富得多的高光层次。"),
    ("Compositor", "kəmˈpɒzɪtər", "n.", "合成器（内置节点式后期调色、辉光 Glare 与暗角合成）", "Render · 渲染灯光", "", "Add a Glare (Fog Glow) node in the Compositor for soft bloom.", "在合成器中添加眩光（雾化辉光）节点营造柔和泛光。"),
    ("Cryptomatte", "ˈkrɪptoʊmæt", "n.", "加密遮罩（自动按物体或材质生成精准抗锯齿后期选区）", "Render · 渲染灯光", "", "Enable Cryptomatte Object pass to color-grade props individually.", "开启加密遮罩物体通道，后期可对单个道具独立调色。"),
    ("Render Passes", "ˈrendər ˈpæsɪz", "n.", "渲染通道（分拆漫反射、高光、阴影、雾场等分层输出）", "Render · 渲染灯光", "", "Enable the Mist Pass to composite controllable atmospheric depth fog.", "开启雾场通道，在合成器中灵活调节远景空气感雾效。"),
    ("View Layer", "vjuː ˈleɪər", "n.", "视图层（将前景、背景与阴影捕捉器拆分为独立渲染层）", "Render · 渲染灯光", "", "Split foreground characters and background city into separate View Layers.", "将前景角色与背景城市拆分到不同视图层分别渲染合成。"),
    ("Shadow Catcher", "ˈʃædoʊ ˈkætʃər", "n.", "阴影捕捉器（仅接收阴影并透明显示，用于实拍合成）", "Render · 渲染灯光", "", "Mark the floor plane as a Shadow Catcher to composite CGI onto video.", "将地面设为阴影捕捉器，无缝把三维模型合成到实拍视频中。"),

    # --- Rigging, Animation & Physics (骨骼、动画与物理) ---
    ("Armature", "ˈɑːrmətʃər", "n.", "骨架（由层级骨骼构成的角色驱动控制系统）", "Rigging · 骨骼动画", "", "Add an Armature and align bones inside the character's limbs.", "添加骨架并将各节骨骼对齐摆放于角色四肢内部。"),
    ("Pose Mode", "poʊz moʊd", "n.", "姿态模式（旋转移动骨骼摆动作并记录动画关键帧）", "Rigging · 骨骼动画", "Ctrl+Tab", "Switch the armature to Pose Mode to animate the walk cycle.", "将骨架切至姿态模式制作循环走路动画。"),
    ("Weight Paint", "weɪt peɪnt", "n.", "权重绘制（用红到蓝热力图分配骨骼对网格顶点的影响力）", "Rigging · 骨骼动画", "", "Use Weight Paint to smooth harsh pinching around the shoulder joint.", "使用权重绘制柔化肩关节弯曲时的生硬挤压。"),
    ("Automatic Weights", "ˌɔːtəˈmætɪk weɪts", "n.", "自动权重（一键按骨骼距离自动计算初始蒙皮权重）", "Rigging · 骨骼动画", "Ctrl+P", "Parent the mesh to the armature With Automatic Weights to start fast.", "按 Ctrl+P 选择「附带自动权重」快速完成初始绑骨。"),
    ("Inverse Kinematics", "ˈɪnvɜːrs ˌkɪnəˈmætɪks", "n.", "反向动力学 / IK（拖动脚掌或手腕自动解算整条肢体弯曲）", "Rigging · 骨骼动画", "Shift+I", "Add an Inverse Kinematics constraint so the feet stay planted on the floor.", "添加反向动力学约束，让角色脚掌牢牢踩稳地面。"),
    ("Forward Kinematics", "ˈfɔːrwərd ˌkɪnəˈmætɪks", "n.", "正向动力学 / FK（从肩到肘逐节旋转骨骼，适合手臂弧线摆动）", "Rigging · 骨骼动画", "", "Use Forward Kinematics for natural swinging arms during a walk.", "走路摆臂时使用正向动力学更容易调出自然弧线。"),
    ("Bone Constraints", "boʊn kənˈstreɪnts", "n.", "骨骼约束（复制旋转、阻尼追踪与限位等自动化联动规则）", "Rigging · 骨骼动画", "", "Add a Copy Rotation constraint to make gears turn in sync.", "添加「复制旋转」约束让齿轮同步咬合转动。"),
    ("Shape Keys", "ʃeɪp kiːz", "n.", "形态键（记录并混合面部眨眼、口型等顶点变形目标）", "Rigging · 骨骼动画", "", "Create Blink and Smile Shape Keys to animate facial expressions.", "创建眨眼与微笑形态键来驱动丰富面部表情动画。"),
    ("Driver", "ˈdraɪvər", "n.", "驱动器（用表达式或另一物体属性自动联动控制参数）", "Rigging · 骨骼动画", "", "Add a Driver so turning the steering wheel rotates the front tires.", "添加驱动器，转动方向盘时自动联动前轮转向。"),
    ("Keyframe", "ˈkiːfreɪm", "n.", "关键帧（在时间轴特定帧记录位置、旋转、缩放或材质数值）", "Rigging · 骨骼动画", "I", "Press I to insert a Location/Rotation Keyframe on frame 1.", "在第 1 帧按 I 插入位置/旋转关键帧。"),
    ("Delete Keyframe", "dɪˈliːt ˈkiːfreɪm", "v.", "删除关键帧（清除当前帧已记录的动画关键帧）", "Rigging · 骨骼动画", "Alt+I", "Press Alt+I to remove an unwanted keyframe at the playhead.", "按 Alt+I 删除播放头当前位置多余的关键帧。"),
    ("Timeline", "ˈtaɪmlaɪn", "n.", "时间轴（播放控制、帧范围设置与关键帧总览）", "Rigging · 骨骼动画", "Space", "Press Spacebar to play or pause animation on the Timeline.", "按空格键在时间轴上播放或暂停动画预览。"),
    ("Dope Sheet", "doʊp ʃiːt", "n.", "摄影表（集中拖拽调整多个物体关键帧的节奏与时机）", "Rigging · 骨骼动画", "", "Shift keyframes in the Dope Sheet to adjust overall timing.", "在摄影表中批量错开关键帧，轻松调整动画节奏。"),
    ("Graph Editor", "ɡræf ˈedɪtər", "n.", "曲线编辑器（通过贝塞尔函数曲线精调缓入缓出与弹性）", "Rigging · 骨骼动画", "", "Tweak Bezier handles in the Graph Editor for snappy ease-out motion.", "在曲线编辑器中调节贝塞尔手柄，调出利落的缓出动感。"),
    ("NLA Editor", "en el eɪ ˈedɪtər", "n.", "非线性动画编辑器（拼接、混合与循环复用多个动作片段）", "Rigging · 骨骼动画", "", "Blend a Walk strip into a Jump strip smoothly in the NLA Editor.", "在非线性动画编辑器中将走路与跳跃动作片段平滑过渡。"),
    ("Interpolation", "ɪnˌtɜːrpəˈleɪʃn", "n.", "插值模式（贝塞尔平滑、线性匀速或常量阶梯过渡）", "Rigging · 骨骼动画", "T", "Press T in the Graph Editor and pick Linear for steady turntable spins.", "在曲线编辑器按 T 选择「线性」插值制作匀速转盘展示。"),
    ("Rigid Body", "ˈrɪdʒɪd ˈbɒdi", "n.", "刚体物理（模拟积木倒塌、碎块碰撞等硬质力学运动）", "Physics · 物理模拟", "", "Set the ground to Passive Rigid Body and falling crates to Active.", "将地面设为被动刚体，下落的木箱设为活动刚体。"),
    ("Soft Body", "sɒft ˈbɒdi", "n.", "软体物理（模拟果冻、气球与弹性物体的晃动形变）", "Physics · 物理模拟", "", "Use Soft Body physics to give bouncing slime realistic squash and stretch.", "用软体物理为弹跳史莱姆赋予真实的挤压与拉伸弹性。"),
    ("Particle System", "ˈpɑːrtɪkl ˈsɪstəm", "n.", "粒子系统（发射火星、雨雪或生成毛发与草地分布）", "Physics · 物理模拟", "", "Use a Hair Particle System to groom fur across the plush toy.", "使用毛发粒子系统为毛绒玩具梳理细腻绒毛。"),
    ("Force Field", "fɔːrs fiːld", "n.", "力场（风力、湍流、涡流与引力等影响物理模拟的场源）", "Physics · 物理模拟", "", "Add a Wind and Turbulence Force Field to billow the curtain naturally.", "添加风力与湍流力场，让窗帘随微风自然飘动。"),
]


# Comprehensive Antigravity UI buttons, panels, Slash Commands & shortcuts (100+ entries, no brand fluff)
ANTIGRAVITY_ROWS: list[tuple[str, str, str, str, str, str, str, str]] = [
    # --- Core UI Panels, Modes & Action Buttons ---
    ("Planning Mode", "", "", "规划模式（修改代码前先生成可审阅的实施计划）", "IDE · 核心模式", "/plan", "Switch to Planning Mode so the agent drafts an implementation plan before editing.", "切换至规划模式，让智能体在改代码前先拟定实施计划。"),
    ("Auxiliary Pane", "", "", "辅助面板（右侧可折叠的智能体对话、产物与插件视图）", "IDE · 界面面板", "Ctrl + L", "Toggle the Auxiliary Pane to chat with the agent alongside your code.", "切换辅助面板，在代码旁随时与智能体对话或查看产物。"),
    ("Files Changed", "", "", "变更文件列表（汇总当前任务全部新增、修改与删除的文件）", "IDE · 界面面板", "", "Click Files Changed at the bottom of the chat to inspect every edited file.", "点击对话底部的变更文件列表，逐一检查所有改动文件。"),
    ("Inline Command", "", "", "行内指令框（在编辑器当前光标或选区原地唤起 AI 改写）", "IDE · 编辑器操作", "Ctrl + I", "Select a helper function and press Ctrl + I to open Inline Command.", "选中辅助函数并按 Ctrl + I 唤起行内指令框直接改写。"),
    ("Visual Diff Overlays", "", "", "可视化差异浮层（在编辑器中直接高亮增删行并提供接受/拒绝按钮）", "IDE · 代码审查", "", "Inspect Visual Diff Overlays line by line before accepting edits.", "在编辑器中逐行查看可视化差异浮层后再决定是否采纳。"),
    ("Accept All Changes", "", "", "全部接受按钮（一键采纳当前审查队列中的所有代码修改）", "IDE · 代码审查", "", "Click Accept All Changes once the build and tests pass.", "确认编译与测试全部通过后，点击「全部接受」采纳修改。"),
    ("Reject Hunk", "", "", "拒绝此块按钮（撤销单个差异代码块的改动并保留其余修改）", "IDE · 代码审查", "", "Use Reject Hunk to discard an unintended formatting tweak.", "使用「拒绝此块」单独撤回不需要的格式改动。"),
    ("Proceed", "", "", "继续执行按钮（审阅实施计划产物后批准智能体开始编码）", "Artifact · 产物审查", "", "Review the plan artifact and click Proceed to start implementation.", "审阅完实施计划产物后点击「继续」按钮启动编码。"),
    ("Context Mentions", "", "", "上下文引用按钮（键入 @ 将指定文件、符号或目录挂载到提示词）", "IDE · 对话输入框", "@", "Type @ to trigger Context Mentions and attach StorageService.cs.", "输入 @ 触发上下文引用，精准挂载指定源码文件。"),
    ("Voice Dictation", "", "", "语音听写按钮（在对话或 CLI 中直接口述英文/中文指令）", "IDE · 对话输入框", "/voice", "Enable Voice Dictation with /voice to speak refactor requests hands-free.", "用 /voice 开启语音听写，直接口述重构需求。"),
    ("Agent Side Panel", "", "", "智能体侧边栏（停靠在编辑器一侧的主交互与任务面板）", "IDE · 界面面板", "Ctrl + L", "Open the Agent Side Panel to review running subagents and artifacts.", "打开智能体侧边栏查看运行中的子智能体与产物。"),
    ("Overview Panel", "", "", "总览面板（集中展示蜂群目标、任务分组与验证截图时间线）", "IDE · 界面面板", "", "Switch to the Overview Panel to track all parallel swarm workers.", "切至总览面板一览全部并行蜂群任务进度。"),
    ("Remote Agents", "", "", "远程智能体面板（派发并管理运行在云端/远程主机的持久任务）", "IDE · 界面面板", "", "Open Remote Agents to offload heavy builds to a cloud workspace.", "打开远程智能体面板，把耗时构建卸载到云端工作区。"),
    ("Remote Control", "", "", "远程接管开关（跨设备查看实时进度并审批工具调用）", "IDE · 界面面板", "", "Use Remote Control to approve a deployment gate from another device.", "使用远程接管在其他设备上实时审批部署操作。"),
    ("Connect over SSH", "", "", "SSH 远程连接入口（直连远端 Linux 主机进行智能体开发与调试）", "IDE · 界面面板", "SSH", "Use Connect over SSH to edit and compile directly on your Linux server.", "通过 SSH 远程连接直接在远端 Linux 服务器上改码编译。"),
    ("Model Picker", "", "", "模型选择器（按任务复杂度切换 Gemini Pro / Flash 等推理模型）", "IDE · 对话输入框", "", "Use the Model Picker to switch to a lighter model for quick lookups.", "通过模型选择器为简单查询切换更轻快的模型。"),
    ("AI Credits", "", "", "AI 额度指示器（查看当前周期剩余计算额度与消耗速率）", "CLI · 状态命令", "/credits", "Run /credits to inspect remaining AI Credits in the CLI.", "运行 /credits 查看当前剩余的 AI 额度。"),
    ("Model Quotas", "", "", "模型配额面板（查看各档模型当前的速率限制与可用余量）", "CLI · 状态命令", "/usage", "Type /usage to inspect current Model Quotas across tiers.", "输入 /usage 查看各档模型的当前可用配额。"),
    ("Open Workspace", "", "", "打开工作区（指定授权给智能体读写与运行命令的项目根目录）", "IDE · 文件菜单", "", "Use Open Workspace so the agent scopes all edits to your project root.", "打开工作区，使智能体将所有读写操作限定在项目根目录内。"),
    ("Agent Client Protocol", "", "", "智能体客户端协议（将 Antigravity 接入第三方编辑器的标准开关）", "IDE · 扩展集成", "ACP", "Enable Agent Client Protocol (ACP) to connect external editors.", "启用智能体客户端协议（ACP）以对接其他编辑器。"),

    # --- Agentic Architecture & Artifacts ---
    ("Agent", "ˈeɪdʒənt", "n.", "智能体（具备自主规划、工具调用、代码读写与验证能力的 AI 执行者）", "Agent · 智能体架构", "", "Ask the agent to diagnose the race condition and verify the fix with tests.", "让智能体定位并发竞态问题并通过测试验证修复结果。"),
    ("Subagent", "ˈsʌbˌeɪdʒənt", "n.", "子智能体（在独立上下文中执行专项调研、浏览或编码任务的派生代理）", "Agent · 智能体架构", "", "Delegate broad codebase exploration to a research subagent to save main context.", "将大范围代码库调研委派给研究型子智能体以节省主上下文。"),
    ("Custom Subagent", "ˈkʌstəm ˈsʌbˌeɪdʒənt", "n.", "自定义子智能体（通过提示词与权限配置定义的专职角色代理）", "Agent · 智能体架构", "", "Define a custom subagent specialized in SQL performance tuning.", "定义一个专攻 SQL 性能调优的自定义子智能体。"),
    ("Swarm", "swɔːrm", "n.", "蜂群多智能体协作（多名分工明确的智能体共享消息板并行推进大项目）", "Agent · 智能体架构", "/swarm", "Coordinate frontend, backend, and QA workers simultaneously using /swarm.", "使用 /swarm 同时调度前端、后端与测试智能体协同攻坚。"),
    ("Coordinator", "koʊˈɔːrdɪneɪtər", "n.", "协调者（蜂群协作中负责拆解任务、派发简报与汇总验收的主控智能体）", "Agent · 智能体架构", "", "The coordinator briefs each worker and merges verified branches back to main.", "协调者负责向各执行者派发简报，并将验证通过的分支合并回主线。"),
    ("Worker", "ˈwɜːrkər", "n.", "执行者（蜂群中认领具体模块、在独立工作副本中编码验证的成员）", "Agent · 智能体架构", "", "Spawn each author worker with a shared workspace so edits never collide.", "为每位编写者分配独立工作副本，避免并发编辑冲突。"),
    ("Artifact", "ˈɑːrtɪfækt", "n.", "产物 / 工件（智能体生成的结构化计划、演练报告、图表或截图文档）", "Artifact · 产物系统", "", "Artifacts give you a concise, verifiable record of plans and test results.", "产物为你提供简洁且可验证的实施计划与测试结果记录。"),
    ("Implementation Plan", "ˌɪmplɪmenˈteɪʃn plæn", "n.", "实施计划（写代码前向用户呈现的设计方案、改动清单与验证步骤）", "Artifact · 产物系统", "/plan", "Review the Implementation Plan artifact and click Proceed before code edits start.", "审阅实施计划产物，确认无误后点击继续再开始改写代码。"),
    ("Walkthrough", "ˈwɔːkθruː", "n.", "演练总结（任务结束后汇总变更文件、验证证据与效果截图的交付文档）", "Artifact · 产物系统", "", "Open the Walkthrough artifact to inspect every verified test and screenshot.", "打开演练总结产物，逐项查看验证通过的测试与截图。"),
    ("Artifact Review", "ˈɑːrtɪfækt rɪˈvjuː", "n.", "产物审查（像代码评审一样对计划书或演练文档逐段批注反馈）", "Artifact · 产物系统", "", "Leave inline comments during Artifact Review to refine architecture choices.", "在产物审查中直接添加行内批注来微调架构方案。"),
    ("Generative UI", "ˈdʒenərətɪv juː aɪ", "n.", "生成式交互界面（在对话中实时渲染可交互 HTML 图表、演示与控件）", "Artifact · 产物系统", "/generative_ui", "Use /generative_ui to render interactive architecture diagrams inline.", "使用 /generative_ui 在对话中直接渲染可交互架构图。"),
    ("Browser Agent", "ˈbraʊzər ˈeɪdʒənt", "n.", "浏览器智能体（操作内置浏览器点击、填表、调试与截取实况页面）", "Agent · 智能体架构", "/browser", "Invoke /browser to test the checkout UI live on localhost and inspect errors.", "调用 /browser 在本地实时测试结账页面交互并排查报错。"),
    ("Browser Recording", "ˈbraʊzər rɪˈkɔːrdɪŋ", "n.", "浏览器录屏（记录浏览器智能体操作全过程用于复盘与验收）", "Agent · 智能体架构", "", "Watch the Browser Recording attached to the walkthrough to verify UI animations.", "观看演练报告附带的浏览器录屏以验收界面动效。"),
    ("Context Window", "ˈkɒntekst ˈwɪndoʊ", "n.", "上下文窗口（模型当前会话可容纳的提示词、代码与工具输出总容量）", "Context · 上下文与推理", "/context", "Monitor token usage with /context and compact history before hitting limits.", "使用 /context 监控 Token 占用，在触达上限前及时压缩历史。"),
    ("Token", "ˈtoʊkən", "n.", "词元 / Token（大语言模型计费与上下文长度计算的基本文本单位）", "Context · 上下文与推理", "", "Delegating noisy logs to a subagent keeps thousands of tokens out of main chat.", "把冗长日志排查交给子智能体，可为主对话省下数千 Token。"),
    ("Prompt", "prɒmpt", "n.", "提示词（向智能体清晰传达目标、约束条件与验收标准的自然语言指令）", "Context · 上下文与推理", "", "A well-scoped prompt with explicit acceptance tests leads to faster convergence.", "目标明确且带验收条件的提示词能让智能体更快收敛到理想结果。"),
    ("Tool Call", "tuːl kɔːl", "n.", "工具调用（智能体主动执行读文件、编辑、搜索或终端命令的动作）", "Agent · 智能体架构", "", "Independent read tool calls run in parallel to cut round-trip latency.", "互不依赖的文件读取工具调用会并行执行以缩短响应延迟。"),
    ("Verification", "ˌverɪfɪˈkeɪʃn", "n.", "闭环验证（通过编译、单测、浏览器交互与日志检查确认改动真正可用）", "Agent · 智能体架构", "", "Never mark a task done without running automated verification first.", "在运行自动化验证确认无误前，绝不草率宣告任务完成。"),
    ("Guardrails", "ˈɡɑːrdreɪlz", "n.", "安全护栏（限制破坏性操作、防止越权访问与保障代码质量的安全边界）", "Security · 安全与沙箱", "", "Verification and guardrails keep autonomous edits safe on production repos.", "闭环验证与安全护栏保障自主修改在生产仓库中安全可控。"),
    ("Reasoning Effort", "ˈriːznɪŋ ˈefərt", "n.", "推理思考深度（调节模型思考预算，在速度与深度推理间取得平衡）", "Context · 上下文与推理", "/effort", "Switch /effort to high when untangling subtle concurrency bugs.", "排查棘手并发缺陷时可用 /effort 调高思考深度。"),
    ("At-Mention", "æt ˈmenʃn", "n.", "@ 引用提及（在输入框键入 @ 快速附加文件、符号或会话上下文）", "IDE · 编辑器交互", "@", "Use @StorageService.cs to pin the exact file into your prompt.", "输入 @StorageService.cs 将指定文件精准挂载到提示词中。"),
    ("Voice Mode", "vɔɪs moʊd", "n.", "语音交互模式（直接口述需求与听写指令，解放双手快速编程）", "IDE · 编辑器交互", "/voice", "Toggle /voice to dictate refactor instructions while reviewing code.", "开启 /voice 在浏览代码的同时直接口述重构指令。"),

    # --- Slash Commands (App & CLI) ---
    ("Plan Command", "plæn kəˈmænd", "n.", "规划模式命令（先输出详尽分步方案，经确认后再动手修改）", "Slash · 斜杠命令", "/plan", "Start complex feature work with /plan to align on design before coding.", "复杂功能开发前先用 /plan 对齐设计方案再动手写代码。"),
    ("Goal Command", "ɡoʊl kəˈmænd", "n.", "长程目标命令（驱动智能体持续推进并反复验证，直至彻底达成目标）", "Slash · 斜杠命令", "/goal", "Use /goal for overnight test-coverage pushes that require thorough iteration.", "适合用 /goal 跑需要多轮彻底迭代的夜间测试覆盖率提升任务。"),
    ("Compact Command", "kəmˈpækt kəˈmænd", "n.", "上下文压缩命令（总结历史对话释放上下文窗口空间）", "Slash · 斜杠命令", "/compact", "Run /compact after finishing a milestone so the next phase stays sharp.", "完成一个里程碑后运行 /compact，让下一阶段上下文保持清爽。"),
    ("Schedule Command", "ˈskedʒuːl kəˈmænd", "n.", "定时调度命令（创建一次性计时器或 Cron 周期自动任务）", "Slash · 斜杠命令", "/schedule", "Use /schedule to run a dependency security audit every Monday morning.", "使用 /schedule 设置每周一早自动执行依赖安全巡检。"),
    ("Grill Me Command", "ɡrɪl miː kəˈmænd", "n.", "深度拷问命令（通过交互式追问帮你理清需求歧义与架构取舍）", "Slash · 斜杠命令", "/grill-me", "Trigger /grill-me to stress-test your database schema before implementation.", "动手前触发 /grill-me 对数据库表设计进行边界拷问。"),
    ("Teamwork Command", "ˈtiːmwɜːrk kəˈmænd", "n.", "团队协作命令（一键组建自主多智能体团队并行拆分大型工程）", "Slash · 斜杠命令", "/teamwork", "Use /teamwork when a migration spans frontend, API, and docs simultaneously.", "当迁移同时横跨前端、接口与文档时，启用 /teamwork 并行推进。"),
    ("Learn Command", "lɜːrn kəˈmænd", "n.", "沉淀学习命令（将纠错经验或复杂配置流程持久化为复用技能）", "Slash · 斜杠命令", "/learn", "Run /learn after solving a tricky build setup so the agent remembers it next time.", "解决棘手构建配置后运行 /learn，让智能体下次自动复用。"),
    ("Boost Command", "buːst kəˈmænd", "n.", "深度增强命令（启用多视角深度思考、战略规划与严格验证）", "Slash · 斜杠命令", "/boost", "Invoke /boost on high-stakes architecture refactors and deep research.", "面对高风险架构重构与深度调研时调用 /boost。"),
    ("Side Question", "saɪd ˈkwestʃən", "n.", "旁路提问命令（不打断主任务上下文，快速顺手问一个支线问题）", "Slash · 斜杠命令", "/btw", "Use /btw to ask a quick git syntax question without polluting the main task.", "用 /btw 顺手查一条 git 语法而不干扰当前主任务上下文。"),
    ("Automation Command", "ˌɔːtəˈmeɪʃn kəˈmænd", "n.", "后台自动化命令（交互式设计并创建长期运行的定时后台自动化）", "Slash · 斜杠命令", "/automation", "Launch /automation to build a daily inbox digest job.", "使用 /automation 创建每日自动汇总后台任务。"),
    ("Dynamic Workflow", "daɪˈnæmɪk ˈwɜːrkfloʊ", "n.", "动态工作流命令（用 Python 脚本编排并行与流水线级多智能体任务）", "Slash · 斜杠命令", "/run-workflow", "Use /run-workflow to fan out bug triage across fifty files in parallel.", "用 /run-workflow 并行对五十个文件展开缺陷排查与汇总。"),
    ("Plugin Command", "ˈplʌɡɪn kəˈmænd", "n.", "插件管理命令（安装、启停或打包自定义技能、规则与 MCP 插件）", "Slash · 斜杠命令", "/plugin", "Open /plugin to bundle your team's skills and MCP servers into one package.", "打开 /plugin 将团队的技能与 MCP 服务打包成统一插件。"),
    ("Agents Command", "ˈeɪdʒənts kəˈmænd", "n.", "CLI 智能体列表命令（查看与管理当前活跃的子智能体状态）", "Slash · 斜杠命令", "/agents", "Run /agents in the CLI to inspect active subagents and their states.", "在 CLI 中运行 /agents 查看活跃子智能体及其运行状态。"),
    ("Code Search Command", "koʊd sɜːrtʃ kəˈmænd", "n.", "CLI 代码检索命令（跨仓库高速定位符号定义与调用链）", "Slash · 斜杠命令", "/codesearch", "Use /codesearch to trace every caller of an exported service method.", "使用 /codesearch 追踪导出服务方法的全部调用处。"),
    ("Diff Command", "dɪf kəˈmænd", "n.", "CLI 差异对比命令（在终端内直观审查未提交的代码增删改动）", "Slash · 斜杠命令", "/diff", "Run /diff before committing to verify every modified line.", "提交代码前运行 /diff 逐行核对所有改动。"),
    ("Permissions Command", "pərˈmɪʃnz kəˈmænd", "n.", "CLI 权限配置命令（查看或调整命令执行与文件访问审批策略）", "Slash · 斜杠命令", "/permissions", "Run /permissions to audit which shell commands are auto-approved.", "运行 /permissions 审查哪些终端命令已配置为自动放行。"),
    ("Resume Command", "rɪˈzjuːm kəˈmænd", "n.", "恢复会话命令（从历史列表中一键续接之前的对话上下文）", "Slash · 斜杠命令", "/resume", "Type /resume in agy CLI to pick up yesterday's debugging session.", "在 agy CLI 输入 /resume 无缝续接昨天的调试会话。"),
    ("Status Line Command", "ˈsteɪtəs laɪn", "n.", "状态栏自定义命令（配置 CLI 底部显示的模型、分支与额度信息）", "Slash · 斜杠命令", "/statusline", "Customize your CLI footer with /statusline to display git branch and tokens.", "使用 /statusline 自定义终端底部状态栏，实时显示分支与用量。"),
    ("Window Title Command", "ˈwɪndoʊ ˈtaɪtl", "n.", "终端标题命令（设置当前终端标签页名称便于多会话区分）", "Slash · 斜杠命令", "/title", "Use /title to label each terminal tab by feature branch.", "用 /title 按功能分支给每个终端标签页命名。"),
    ("Changelog Command", "ˈtʃeɪndʒlɒɡ kəˈmænd", "n.", "更新日志命令（快速查看 Antigravity 最新版本特性与修复记录）", "Slash · 斜杠命令", "/changelog", "Run /changelog to see newly released CLI flags and slash commands.", "运行 /changelog 查看最新发布的 CLI 参数与斜杠命令。"),
    ("Customizations Guide", "ˌkʌstəmaɪˈzeɪʃnz ɡaɪd", "n.", "定制系统指南命令（查看技能、规则、钩子与插件加载优先级说明）", "Slash · 斜杠命令", "/agy-customizations", "Run /agy-customizations to learn how workspace rules override global rules.", "运行 /agy-customizations 了解工作区规则如何覆盖全局规则。"),

    # --- Customizations (Skills / Rules / Plugins / Hooks / MCP / Sidecars) ---
    ("Agent Skill", "ˈeɪdʒənt skɪl", "n.", "智能体技能（包含 SKILL.md 指令、脚本与参考文档的可复用能力包）", "Customizations · 定制扩展", "SKILL.md", "Place domain instructions in SKILL.md so the agent loads them automatically.", "将领域规范写入 SKILL.md，智能体遇到相关任务时自动加载。"),
    ("Rule", "ruːl", "n.", "持久规则（自动注入上下文的团队编码风格、命名与架构约束）", "Customizations · 定制扩展", ".agent/rules", "Add a project rule enforcing strict TypeScript types across all modules.", "添加项目规则，强制所有模块遵循严格 TypeScript 类型规范。"),
    ("Plugin", "ˈplʌɡɪn", "n.", "插件包（将技能、规则、子智能体、MCP 与钩子整体安装启停的单元）", "Customizations · 定制扩展", "plugin.json", "Distribute your org's best practices as a single versioned Plugin.", "将团队最佳实践打包为一个带版本号的插件统一分发。"),
    ("Marketplace", "ˈmɑːrkɪtpleɪs", "n.", "插件市场（浏览与一键安装官方及合作伙伴插件与技能的目录）", "Customizations · 定制扩展", "", "Search the Marketplace to connect Google Workspace, Figma, or Cloudflare.", "在插件市场搜索并一键接入 Google Workspace、Figma 或 Cloudflare。"),
    ("Hook", "hʊk", "n.", "生命周期钩子（在工具调用前后或会话事件触发的自动化校验脚本）", "Customizations · 定制扩展", "hooks.json", "Attach a post-edit hook to format files and run lint checks automatically.", "绑定编辑后钩子，在写入文件后自动执行格式化与代码检查。"),
    ("MCP Server", "em siː piː ˈsɜːrvər", "n.", "模型上下文协议服务器（以标准协议为智能体接入外部 API 与数据工具）", "Customizations · 定制扩展", "MCP", "Configure an MCP server to let the agent query Postgres or Jira safely.", "配置 MCP 服务器让智能体安全查询数据库或工单系统。"),
    ("MCP App", "em siː piː æp", "n.", "MCP 交互应用（工具返回结果可直接渲染为对话内或侧边栏交互 UI）", "Customizations · 定制扩展", "/mcp-app-development", "Build an MCP App so database query results render as an interactive table.", "开发 MCP 应用，让数据库查询结果直接呈现为可交互表格。"),
    ("Sidecar", "ˈsaɪdkɑːr", "n.", "伴生服务进程（随插件自动启停的本地常驻辅助进程或守护服务）", "Customizations · 定制扩展", "", "Package a local indexer daemon as a Sidecar inside your plugin.", "将本地索引守护进程作为伴生服务打包进插件随用随启。"),
    ("Customization Discovery", "ˌkʌstəmaɪˈzeɪʃn dɪˈskʌvəri", "n.", "定制发现机制（按项目、用户全局与插件目录自动扫描加载扩展）", "Customizations · 定制扩展", "", "Workspace customizations take higher priority during Customization Discovery.", "在定制发现机制中，工作区级配置优先于用户全局配置生效。"),
    ("Workflow Migration", "ˈwɜːrkfloʊ maɪˈɡreɪʃn", "n.", "工作流迁移（将旧版 legacy workflows 自动转换为现代 SKILL.md 技能）", "Customizations · 定制扩展", "", "Migrate legacy workflow files to modern skills for cleaner discovery.", "将旧版工作流文件迁移为现代技能包以获得更清晰的发现机制。"),
    ("Firebase Studio Migration", "ˈfaɪərbeɪs ˈstjuːdioʊ", "n.", "Firebase Studio 迁移（将 Firebase Studio 项目配置平滑导入 Antigravity）", "Customizations · 定制扩展", "", "Follow the Firebase Studio migration guide to transfer Nix environments.", "按照 Firebase Studio 迁移指南平滑迁移 Nix 开发环境。"),

    # --- IDE, Editor & Browser Controls ---
    ("Inline Edit", "ˈɪnlaɪn ˈedɪt", "n.", "行内编辑（在代码选区原地唤起 AI 精准改写与补全）", "IDE · 编辑器交互", "Ctrl+I", "Highlight the sorting helper and press Ctrl+I to optimize it in place.", "选中排序辅助函数按 Ctrl+I 原地发起行内优化。"),
    ("Agent Chat", "ˈeɪdʒənt tʃæt", "n.", "智能体对话栏（聚焦或展开侧边 AI 聊天面板）", "IDE · 编辑器交互", "Ctrl+L", "Press Ctrl+L to focus Agent Chat and ask about the current file.", "按 Ctrl+L 聚焦智能体对话栏并针对当前文件提问。"),
    ("Command Palette", "kəˈmænd ˈpælɪt", "n.", "命令面板（模糊检索并执行 IDE 全部内置与扩展命令）", "IDE · 编辑器交互", "Ctrl+Shift+P", "Press Ctrl+Shift+P to open the Command Palette and switch themes.", "按 Ctrl+Shift+P 打开命令面板快速切换主题或设置。"),
    ("Quick Open", "kwɪk ˈoʊpən", "n.", "快速打开（按文件名模糊搜索并秒跳至项目任意源码）", "IDE · 编辑器交互", "Ctrl+P", "Hit Ctrl+P and type TtsService to jump right to the TTS engine.", "按 Ctrl+P 输入 TtsService 秒速跳转到语音引擎代码。"),
    ("Tab Autocomplete", "tæb ˌɔːtoʊkəmˈpliːt", "n.", "Tab 智能预测补全（结合上下文预测多行代码与光标跳转）", "IDE · 编辑器交互", "Tab", "Press Tab to accept the predicted multi-line implementation instantly.", "按 Tab 键一键采纳上下文预测的多行代码实现。"),
    ("Side Panel", "saɪd ˈpænəl", "n.", "侧边面板（停靠在编辑器一侧的对话、产物与 UI 插件视图）", "IDE · 编辑器交互", "", "Toggle UI plugin panels directly inside the Side Panel.", "在侧边面板中直接切换查看 UI 插件视图。"),
    ("Overview Panel", "ˈoʊvərvjuː ˈpænəl", "n.", "总览面板（集中展示蜂群目标、任务分组与验证截图时间线）", "IDE · 编辑器交互", "", "Open the Overview Panel to track every parallel swarm group at a glance.", "打开总览面板一目了然地追踪所有并行蜂群任务组。"),
    ("Review Changes", "rɪˈvjuː ˈtʃeɪndʒɪz", "n.", "变更审查（在编辑器内逐块对比并接受或回退智能体的修改）", "IDE · 编辑器交互", "", "Use Review Changes to accept verified hunks and discard stray edits.", "使用变更审查逐块接受已验证的修改并丢弃多余改动。"),
    ("Integrated Terminal", "ˈɪntɪɡreɪtɪd ˈtɜːrmɪnl", "n.", "集成终端（内置命令行环境，实时查看构建与测试日志）", "IDE · 编辑器交互", "Ctrl+`", "Press Ctrl+` to reveal the Integrated Terminal and inspect build logs.", "按 Ctrl+` 展开集成终端查看构建输出日志。"),
    ("Jupyter Notebook", "ˈdʒuːpɪtər ˈnoʊtbʊk", "n.", "Jupyter 笔记本支持（让智能体直接读写、运行并分析代码单元格）", "IDE · 编辑器交互", "", "Ask the agent to add visualization cells directly inside your Jupyter Notebook.", "让智能体直接在 Jupyter 笔记本中添加数据可视化单元格。"),
    ("Checkpoint", "ˈtʃekpɔɪnt", "n.", "检查点快照（自动记录每轮编辑前的代码状态，支持随时一键回滚）", "IDE · 编辑器交互", "", "Restore the earlier Checkpoint if an experimental refactor breaks tests.", "如果实验性重构导致测试失败，可随时一键回滚至先前检查点。"),
    ("Allowlist", "əˈlaʊlɪst", "n.", "白名单（浏览器代理或命令权限中预先允许访问的域名与规则列表）", "Security · 安全与沙箱", "", "Add localhost and staging domains to the browser Allowlist.", "将本地开发与测试环境域名加入浏览器白名单。"),
    ("Denylist", "dɪˈnaɪlɪst", "n.", "黑名单（明确禁止智能体访问或执行的敏感网站与危险命令）", "Security · 安全与沙箱", "", "Keep production billing portals on the Denylist to prevent accidental clicks.", "将生产计费后台列入黑名单，杜绝误操作风险。"),
    ("Chrome Profile", "kroʊm ˈproʊfaɪl", "n.", "独立浏览器配置文件（隔离浏览器代理的 Cookie 与登录态，保护个人隐私）", "Security · 安全与沙箱", "", "Use a separate Chrome Profile for automated UI testing sessions.", "为自动化界面测试会话使用独立的 Chrome 配置文件。"),

    # --- CLI & Terminal Features ---
    ("Headless Mode", "ˈhedləs moʊd", "n.", "无头批处理模式（以非交互方式在脚本或 CI 流水线中直接运行 agy）", "CLI · 终端命令行", "agy -p", "Run agy -p in GitHub Actions to generate release notes automatically.", "在 GitHub Actions 中运行 agy -p 自动生成发布说明。"),
    ("Execution Mode", "ˌeksɪˈkjuːʃn moʊd", "n.", "执行模式（在规划、审慎确认与自动执行之间切换 CLI 自主程度）", "CLI · 终端命令行", "", "Choose the appropriate Execution Mode before running database migrations.", "执行数据库迁移前请选择合适的 CLI 执行模式。"),
    ("Vim Editor Mode", "vɪm ˈedɪtər moʊd", "n.", "Vim 编辑模式（在 CLI 输入框启用 Normal / Insert 键位高效编辑提示词）", "CLI · 终端命令行", "", "Enable Vim Editor Mode in agy CLI for keyboard-driven prompt editing.", "在 agy CLI 中开启 Vim 编辑模式，用纯键盘高效编辑长提示词。"),
    ("Background Task", "ˈbækɡraʊnd tæsk", "n.", "后台任务（耗时构建、监听或开发服务在后台异步运行，完成后主动通知）", "CLI · 终端命令行", "", "Start the dev server as a Background Task while running browser checks.", "将开发服务器作为后台任务启动，同时运行浏览器验收。"),
    ("Cron Expression", "krɒn ɪkˈspreʃn", "n.", "Cron 定时表达式（五段式周期调度语法，如 '0 9 * * 1' 表示每周一 9 点）", "CLI · 终端命令行", "/schedule", "Pass a standard 5-field Cron Expression to schedule recurring checks.", "传入标准五段式 Cron 表达式即可设定周期性巡检任务。"),
    ("Transcript", "ˈtrænskrɪpt", "n.", "会话记录文件（以 JSONL 格式完整持久化每步思考、工具调用与输出）", "CLI · 终端命令行", "transcript.jsonl", "Inspect transcript.jsonl to audit every tool call in a past session.", "查看 transcript.jsonl 可完整回溯历史会话中的每次工具调用。"),

    # --- Python SDK ---
    ("Persona", "pərˈsoʊnə", "n.", "智能体人设（SDK 中定义系统提示词、专长角色与回复风格的配置）", "SDK · Python SDK", "", "Configure a Security Auditor Persona in the Antigravity Python SDK.", "在 Antigravity Python SDK 中配置一位安全审计专家人设。"),
    ("Policy", "ˈpɒləsi", "n.", "安全策略（SDK 中以代码控制工具审批、路径范围与执行配额的规则）", "SDK · Python SDK", "", "Attach a read-only Policy to prevent untrusted tasks from writing files.", "为不可信任务挂载只读策略，禁止其写入本地文件。"),
    ("Structured Output", "ˈstrʌktʃərd ˈaʊtpʊt", "n.", "结构化输出（强制模型按 Pydantic / JSON Schema 返回强类型结果）", "SDK · Python SDK", "", "Use Structured Output to parse code-review findings directly into JSON.", "使用结构化输出将代码审查结论直接解析为强类型 JSON。"),
    ("Lifecycle Hook", "ˈlaɪfsaɪkl hʊk", "n.", "SDK 生命周期钩子（拦截会话启动、工具执行前后与结束事件的回调）", "SDK · Python SDK", "", "Register a Lifecycle Hook to log tool latency metrics to OpenTelemetry.", "注册生命周期钩子将工具耗时指标上报至 OpenTelemetry。"),
    ("Local Model", "ˈloʊkl ˈmɒdl", "n.", "本地模型接入（在 SDK 中对接本地 Ollama 或私有部署推理端点）", "SDK · Python SDK", "", "Point the Antigravity SDK to a Local Model for air-gapped environments.", "在离线内网环境中可将 Antigravity SDK 指向本地模型端点。"),
    ("Tool Registry", "tuːl ˈredʒɪstri", "n.", "工具注册表（SDK 中声明 Python 函数为智能体可调用工具的集合）", "SDK · Python SDK", "", "Register custom database helpers in the Tool Registry for your agent.", "将自定义数据库辅助函数注册到工具注册表供智能体调用。"),

    # --- Terminal Sandbox & Permissions ---
    ("Terminal Sandbox", "ˈtɜːrmɪnl ˈsændbɒks", "n.", "终端沙箱（隔离文件系统写权限与网络访问的受限命令执行环境）", "Security · 安全与沙箱", "", "Terminal Sandbox blocks commands from modifying files outside the workspace.", "终端沙箱会拦截任何试图修改工作区外部文件的命令。"),
    ("Permission Policy", "pərˈmɪʃn ˈpɒləsi", "n.", "权限审批策略（定义哪些命令自动放行、哪些必须人工确认）", "Security · 安全与沙箱", "/permissions", "Tighten your Permission Policy so destructive git pushes always ask first.", "收紧权限审批策略，确保高风险 git 推送操作必须经人工确认。"),
    ("Read-Only Sandbox", "riːd ˈoʊnli ˈsændbɒks", "n.", "只读无网沙箱（研究型子智能体专用的零副作用安全探索环境）", "Security · 安全与沙箱", "", "Research subagents operate inside a Read-Only Sandbox with no network access.", "研究型子智能体运行在无网络访问的只读沙箱中，杜绝副作用。"),
    ("Network Isolation", "ˈnetwɜːrk ˌaɪsəˈleɪʃn", "n.", "网络隔离（阻断沙箱内未经授权的外部网络请求，防止数据外泄）", "Security · 安全与沙箱", "", "Network Isolation ensures untrusted scripts cannot exfiltrate credentials.", "网络隔离确保不可信脚本无法向外泄露本地凭证。"),
    ("Approval Gate", "əˈpruːvl ɡeɪt", "n.", "人工审批关卡（执行敏感命令、外部请求或部署前暂停等待用户批准）", "Security · 安全与沙箱", "", "An Approval Gate pauses execution before running production migrations.", "执行生产环境迁移前，人工审批关卡会暂停并等待确认。"),
    ("Enterprise Plan", "ˈentərpraɪz plæn", "n.", "企业版方案（提供统一 SSO、安全策略管控与组织级云端协作）", "Security · 安全与沙箱", "", "Enterprise Plan adds centralized audit logs and policy enforcement for teams.", "企业版方案为研发团队提供集中审计日志与统一安全策略管控。"),
]


# Programming, Compiler Errors & IDE Shortcuts (120+ entries)
DEV_COMPILER_ROWS: list[tuple[str, str, str, str, str, str, str, str]] = [
    # --- 1. 编译器与运行时常见报错英文 ---
    ("Syntax Error", "ˈsɪntæks ˈerər", "n.", "语法错误（代码不符合语言词法或语法规则，无法解析）", "报错 · 编译错误", "", "SyntaxError: Unexpected token '}' at line 42, column 5.", "语法错误：第 42 行第 5 列出现意外的符号 '}'。"),
    ("Undefined Reference", "ˌʌndɪˈfaɪnd ˈrefrəns", "n.", "未定义引用（链接阶段找不到函数或全局变量的实体实现）", "报错 · 链接错误", "", "ld: undefined reference to `ComputeHash(char const*)'.", "链接器错误：找不到函数 ComputeHash 的定义实现。"),
    ("Memory Leak", "ˈmeməri liːk", "n.", "内存泄漏（堆内存分配后未释放且失去引用，导致占用持续增长）", "报错 · 运行时", "", "AddressSanitizer: detected memory leaks of 4096 bytes in 2 allocations.", "内存检测器：检测到 2 次分配共泄漏 4096 字节内存。"),
    ("Segmentation Fault", "ˌseɡmenˈteɪʃn fɔːlt", "n.", "段错误 / 非法内存访问（程序读写了未分配或受保护的内存地址）", "报错 · 运行时", "", "Segmentation fault (core dumped) at address 0x00000000.", "段错误（核心已转储）：在空地址 0x00000000 处发生非法访存。"),
    ("Circular Dependency", "ˈsɜːrkjələr dɪˈpendənsi", "n.", "循环依赖（模块 A 依赖 B 且 B 又反过来依赖 A，导致初始化异常）", "报错 · 工程构建", "", "Warning: Circular dependency detected: auth.ts -> user.ts -> auth.ts.", "警告：检测到循环依赖 auth.ts -> user.ts -> auth.ts。"),
    ("Deprecated", "ˈdeprəkeɪtɪd", "adj.", "已弃用（接口仍可用但将在未来版本移除，建议迁移至新替代方案）", "报错 · 编译警告", "", "DeprecationWarning: Buffer() is deprecated due to security issues. Use Buffer.from() instead.", "弃用警告：Buffer() 因安全问题已弃用，请改用 Buffer.from()。"),
    ("Null Pointer Exception", "nʌl ˈpɔɪntər ɪkˈsepʃn", "n.", "空指针异常（试图在 null / None 对象上调用方法或读取属性）", "报错 · 运行时", "", "NullReferenceException: Object reference not set to an instance of an object.", "空引用异常：未将对象引用设置到对象的实例。"),
    ("Stack Overflow", "stæk ˈoʊvərfloʊ", "n.", "栈溢出（无限递归或过深函数调用耗尽调用栈空间）", "报错 · 运行时", "", "RangeError: Maximum call stack size exceeded in recursiveParse().", "范围错误：recursiveParse() 中超出最大调用栈深度。"),
    ("Race Condition", "reɪs kənˈdɪʃn", "n.", "竞态条件（多线程并发读写共享状态且缺少同步锁导致的随机错误）", "报错 · 并发缺陷", "", "WARNING: DATA RACE — Write at 0x00c00012a080 by goroutine 7.", "警告：检测到数据竞争——协程 7 在无锁状态下写入共享地址。"),
    ("Deadlock", "ˈdedlɒk", "n.", "死锁（多个线程互相持有对方等待的锁，导致程序永久挂起）", "报错 · 并发缺陷", "", "fatal error: all goroutines are asleep - deadlock!", "致命错误：所有协程均处于阻塞等待状态——发生死锁！"),
    ("Type Mismatch", "taɪp ˌmɪsˈmætʃ", "n.", "类型不匹配（传入值或返回值的静态类型与声明不符）", "报错 · 编译错误", "", "TS2322: Type 'string' is not assignable to type 'number'.", "类型错误：不能将 string 类型赋值给 number 类型。"),
    ("Unresolved Symbol", "ˌʌnrɪˈzɒlvd ˈsɪmbl", "n.", "无法解析的符号（找不到变量、类型或导入成员的声明）", "报错 · 编译错误", "", "error CS0103: The name 'dockScale' does not exist in the current context.", "编译错误：当前上下文中不存在名称 'dockScale'。"),
    ("Index Out of Bounds", "ˈɪndeks aʊt əv baʊndz", "n.", "数组下标越界（访问索引小于 0 或大于等于集合长度）", "报错 · 运行时", "", "IndexOutOfRangeException: Index 10 was outside the bounds of the array.", "索引越界异常：索引 10 超出了数组有效范围。"),
    ("Out of Memory", "aʊt əv ˈmeməri", "n.", "内存耗尽 / OOM（进程申请内存超出系统或容器上限被终止）", "报错 · 运行时", "", "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory.", "致命错误：达到堆内存上限分配失败——JS 堆内存耗尽。"),
    ("Buffer Overflow", "ˈbʌfər ˈoʊvərfloʊ", "n.", "缓冲区溢出（写入数据长度超出目标缓冲区容量，覆盖相邻内存）", "报错 · 安全缺陷", "", "ERROR: AddressSanitizer: heap-buffer-overflow on address 0x602000000014.", "错误：堆缓冲区溢出，写入越过已分配内存边界。"),
    ("Unhandled Rejection", "ʌnˈhændld rɪˈdʒekʃn", "n.", "未捕获的异步拒绝（Promise 失败但缺少 .catch 或 try/catch 处理）", "报错 · 运行时", "", "UnhandledPromiseRejection: Failed to fetch /api/config (HTTP 502).", "未捕获的 Promise 拒绝：请求 /api/config 返回 502。"),
    ("Permission Denied", "pərˈmɪʃn dɪˈnaɪd", "n.", "权限被拒绝（当前用户缺少读写文件、端口或执行脚本的权限）", "报错 · 系统错误", "", "EACCES: permission denied, open '/etc/hosts'.", "权限拒绝：无权打开或写入受保护的系统文件。"),
    ("Connection Refused", "kəˈnekʃn rɪˈfjuːzd", "n.", "连接被拒绝（目标主机端口未监听或被防火墙拦截）", "报错 · 网络错误", "", "Error: connect ECONNREFUSED 127.0.0.1:5432.", "网络错误：连接本地 5432 数据库端口被拒绝。"),
    ("Timeout Exceeded", "ˈtaɪmaʊt ɪkˈsiːdɪd", "n.", "超时错误（网络请求或锁等待超出预设时间阈值）", "报错 · 网络错误", "", "TimeoutError: Operation timed out after 15000ms waiting for response.", "超时错误：等待响应超过 15000 毫秒后操作超时。"),
    ("CORS Error", "kɔːrz ˈerər", "n.", "跨域资源共享拦截（浏览器阻止前端访问未授权跨域的后端接口）", "报错 · Web 调试", "", "Access to fetch at 'https://api.example.com' has been blocked by CORS policy.", "跨域拦截：前端请求被浏览器的 CORS 安全策略阻止。"),
    ("Assertion Failed", "əˈsɜːrʃn feɪld", "n.", "断言失败（测试或调试期间实际结果违背了预期不变量）", "报错 · 测试调试", "", "AssertionError: Expected 200 OK, but received 401 Unauthorized.", "断言失败：期望返回 200 OK，但实际收到 401 未授权。"),
    ("Duplicate Symbol", "ˈdjuːplɪkeɪt ˈsɪmbl", "n.", "重复定义符号（同一作用域或链接单元中定义了两个同名标识符）", "报错 · 链接错误", "", "error LNK2005: _init_logger already defined in utils.obj.", "链接错误：符号 _init_logger 已在 utils.obj 中重复定义。"),
    ("Module Not Found", "ˈmɒdjuːl nɒt faʊnd", "n.", "找不到模块（缺少依赖包或导入路径拼写错误）", "报错 · 工程构建", "", "ModuleNotFoundError: No module named 'requests'.", "模块未找到错误：当前环境中未安装名为 requests 的模块。"),
    ("Invalid Cast", "ɪnˈvælɪd kæst", "n.", "无效类型转换（运行时强制将对象转为不兼容的目标类型）", "报错 · 运行时", "", "InvalidCastException: Unable to cast object of type 'Int32' to type 'String'.", "无效转换异常：无法将 Int32 类型对象强转为 String。"),
    ("Version Conflict", "ˈvɜːrʒn ˈkɒnflɪkt", "n.", "依赖版本冲突（两个库要求同一子依赖的不兼容主版本号）", "报错 · 工程构建", "", "ERESOLVE unable to resolve dependency tree: peer react@'^18.0.0' conflict.", "依赖解析失败：peer dependency 要求不兼容的 React 版本。"),
    ("Unreachable Code", "ʌnˈriːtʃəbl koʊd", "n.", "不可达代码（位于 return/break/throw 之后永远不会执行的语句）", "报错 · 编译警告", "", "warning CS0162: Unreachable code detected after return statement.", "编译警告：在 return 语句之后检测到永远不会执行的代码。"),
    ("Illegal State", "ɪˈliːɡl steɪt", "n.", "非法状态异常（在对象尚未初始化或已关闭时调用了不合法操作）", "报错 · 运行时", "", "IllegalStateException: Cannot send message on a closed WebSocket.", "非法状态异常：无法在已关闭的 WebSocket 上发送消息。"),
    ("Broken Pipe", "ˈbroʊkən paɪp", "n.", "管道破裂（向已被对端关闭的套接字或标准输出继续写入数据）", "报错 · 系统错误", "", "BrokenPipeError: [Errno 32] Broken pipe while streaming response.", "管道破裂错误：流式写入响应时客户端已提前断开连接。"),
    ("Division by Zero", "dɪˈvɪʒn baɪ ˈzɪroʊ", "n.", "除零错误（整数除法运算中分母为零引发的算术异常）", "报错 · 运行时", "", "ZeroDivisionError: integer division or modulo by zero.", "除零错误：整数除法或取模运算中除数为零。"),
    ("File Locked / In Use", "faɪl lɒkt", "n.", "文件被占用锁定（另一进程正持有文件句柄导致无法覆盖或删除）", "报错 · 系统错误", "", "IOException: The process cannot access the file because it is being used by another process.", "IO 异常：文件正由另一进程使用，当前进程无法访问。"),
    ("Merge Conflict", "mɜːrdʒ ˈkɒnflɪkt", "n.", "合并冲突（Git 合并分支时同一代码行存在互不相容的修改）", "报错 · Git 协作", "", "CONFLICT (content): Merge conflict in Services/StorageService.cs.", "内容冲突：StorageService.cs 中存在需要手动解决的合并冲突。"),
    ("Detached HEAD", "dɪˈtætʃt hed", "n.", "游离 HEAD 状态（Git 当前检出在具体提交哈希上，未指向任何分支）", "报错 · Git 协作", "", "Note: switching to '4954fa9'. You are in 'detached HEAD' state.", "提示：已切换至提交 4954fa9，当前处于游离 HEAD 状态。"),

    # --- 2. 核心编译阶段与工程高频词 ---
    ("Lexer", "ˈleksər", "n.", "词法分析器（将源代码字符流切分为 Token 序列的编译前端阶段）", "编译 · 编译原理", "", "The lexer scans raw source text into identifiers, keywords, and literals.", "词法分析器将原始源码扫描切分为标识符、关键字与字面量。"),
    ("Parser", "ˈpɑːrsər", "n.", "语法分析器（按文法规则将 Token 流构造成抽象语法树）", "编译 · 编译原理", "", "The parser validates token grammar and constructs an AST.", "语法分析器校验词元语法规则并构建抽象语法树。"),
    ("AST", "eɪ es tiː", "n.", "抽象语法树（Abstract Syntax Tree，表示代码逻辑结构的树状模型）", "编译 · 编译原理", "", "Linters and formatters walk the AST to inspect and rewrite code safely.", "代码检查与格式化工具通过遍历抽象语法树安全地分析与改写代码。"),
    ("IR", "aɪ ɑːr", "n.", "中间表示（Intermediate Representation，独立于源语言与目标架构的优化层）", "编译 · 编译原理", "", "LLVM lowers C++ and Rust into a unified IR for cross-platform optimization.", "LLVM 将 C++ 与 Rust 降至统一中间表示以执行跨平台优化。"),
    ("Linker", "ˈlɪŋkər", "n.", "链接器（合并多个目标文件与静态库、解析外部符号并生成可执行文件）", "编译 · 编译原理", "", "The linker resolves external symbols across object files into one binary.", "链接器跨多个目标文件解析外部符号并组装成最终二进制程序。"),
    ("Runtime", "ˈrʌntaɪm", "n.", "运行时环境（程序执行期间提供内存管理、调度与标准库支持的底层环境）", "编译 · 编译原理", "", "The .NET runtime handles JIT compilation and garbage collection automatically.", ".NET 运行时自动负责即时编译与垃圾回收。"),
    ("Bytecode", "ˈbaɪtkoʊd", "n.", "字节码（介于源码与机器码之间、由虚拟机解释或 JIT 执行的紧凑指令）", "编译 · 编译原理", "", "Python compiles .py modules into bytecode cached under __pycache__.", "Python 会将源码编译为字节码并缓存在 __pycache__ 目录中。"),
    ("JIT Compilation", "dʒɪt ˌkɒmpɪˈleɪʃn", "n.", "即时编译（程序运行期间动态将热点字节码编译为原生机器码加速）", "编译 · 编译原理", "", "JIT compilation optimizes hot loops dynamically based on runtime types.", "即时编译会根据运行时类型信息动态优化热点循环。"),
    ("AOT Compilation", "eɪ oʊ tiː ˌkɒmpɪˈleɪʃn", "n.", "提前编译（构建期直接编译为原生机器码，缩短启动时间与体积）", "编译 · 编译原理", "", "Native AOT compilation produces a fast-starting standalone executable.", "原生提前编译能产出启动极快的独立可执行文件。"),
    ("Garbage Collection", "ˈɡɑːrbɪdʒ kəˈlekʃn", "n.", "垃圾回收 / GC（自动追踪并回收不再被引用的堆内存对象）", "编译 · 内存管理", "", "Avoid allocating large temporary buffers in hot loops to reduce GC pauses.", "避免在高频循环中分配大块临时缓冲区以减少垃圾回收停顿。"),
    ("Serialize", "ˈsɪriəlaɪz", "v.", "序列化（将内存数据结构转换为 JSON / Protobuf 等可传输或存储格式）", "工程 · 数据处理", "", "Serialize the settings object to camelCase JSON before writing to disk.", "写入磁盘前将配置对象序列化为小驼峰格式的 JSON。"),
    ("Deserialize", "diːˈsɪriəlaɪz", "v.", "反序列化（将 JSON / 二进制字节流还原为强类型内存对象）", "工程 · 数据处理", "", "Deserialize the API payload and validate required fields defensively.", "反序列化接口报文并对必填字段进行防御性校验。"),
    ("Idempotent", "aɪˈdempətənt", "adj.", "幂等的（同一请求执行一次与重复执行多次产生的系统结果完全一致）", "工程 · 架构设计", "", "Design payment webhooks to be idempotent so retries never double-charge.", "将支付回调设计为幂等接口，确保重试不会造成重复扣款。"),
    ("Immutable", "ɪˈmjuːtəbl", "adj.", "不可变的（对象创建后内部状态不可修改，天然适合并发安全共享）", "工程 · 架构设计", "", "Freeze immutable configuration snapshots to prevent accidental mutation.", "冻结不可变配置快照以防止多线程意外修改状态。"),
    ("Concurrency", "kənˈkʌrənsi", "n.", "并发（单核或多核上交替推进多个任务逻辑，强调任务调度结构）", "工程 · 并发系统", "", "Async/await simplifies I/O concurrency without blocking the UI thread.", "Async/await 能在不阻塞界面线程的前提下简化 I/O 并发。"),
    ("Parallelism", "ˈpærəlelɪzəm", "n.", "并行（在多核 CPU/GPU 上同一时刻物理同时执行多个计算任务）", "工程 · 并发系统", "", "Use data parallelism across CPU cores to speed up batch image encoding.", "利用多核 CPU 的数据并行显著加速批量图像编码。"),
    ("Asynchronous", "eɪˈsɪŋkrənəs", "adj.", "异步的（发起耗时 I/O 操作后立即返回，完成时通过回调或 Promise 通知）", "工程 · 并发系统", "", "Run TTS synthesis asynchronously so desktop animations never stutter.", "异步执行语音合成，确保桌面动画流畅不掉帧。"),
    ("Closure", "ˈkloʊʒər", "n.", "闭包（函数捕获并记住其定义时所处词法作用域变量的特性）", "工程 · 语言特性", "", "Watch out for stale variables captured inside event-handler closures.", "留意事件回调闭包中可能捕获到过期变量的问题。"),
    ("Polymorphism", "ˌpɒliˈmɔːrfɪzəm", "n.", "多态（不同子类通过统一接口表现出各自特定的行为实现）", "工程 · 面向对象", "", "Polymorphism lets the TTS engine swap Edge and OpenAI providers seamlessly.", "多态让语音引擎可以无缝切换 Edge 与 OpenAI 合成服务。"),
    ("Dependency Injection", "dɪˈpendənsi ɪnˈdʒekʃn", "n.", "依赖注入 / DI（由外部容器传入依赖对象，降低模块耦合便于单测）", "工程 · 架构设计", "", "Pass StorageService via dependency injection to make unit testing easy.", "通过依赖注入传入存储服务，让单元测试更易于替换模拟对象。"),
    ("Recursion", "rɪˈkɜːrʒn", "n.", "递归（函数直接或间接调用自身以拆分树形或分治问题）", "工程 · 算法基础", "", "Always define a clear base case to prevent infinite recursion.", "编写递归函数时务必定义清晰的终止基准条件。"),
    ("Memoization", "ˌmemoʊaɪˈzeɪʃn", "n.", "记忆化缓存（按入参缓存纯函数计算结果，避免重复昂贵运算）", "工程 · 性能优化", "", "Memoization cuts repeated search filtering time on large lists.", "记忆化缓存能大幅削减大列表重复筛选的计算开销。"),
    ("Refactor", "ˌriːˈfæktər", "v.", "重构（在不改变外部可观测行为的前提下改善代码内部结构）", "工程 · 开发实践", "", "Refactor the monolithic handler into focused, testable helper methods.", "将臃肿的处理函数重构为职责单一、易于测试的辅助方法。"),
    ("Transpile", "trænsˈpaɪl", "v.", "转译（将一种高级语言源码转换为另一种目标高级语言，如 TS -> JS）", "编译 · 前端工程", "", "TypeScript transpiles typed modules down to standard ES2022 JavaScript.", "TypeScript 会将带类型的模块转译为标准 ES2022 JavaScript。"),
    ("Tree Shaking", "triː ˈʃeɪkɪŋ", "n.", "摇树优化（打包器静态分析并剔除未被引用的死代码以减小体积）", "编译 · 前端工程", "", "Use ES module named exports so bundlers can apply tree shaking effectively.", "使用 ES 模块具名导出，让打包工具能够高效执行摇树优化。"),
    ("Source Map", "sɔːrs mæp", "n.", "源码映射（将压缩或编译后的代码行号映射回原始源码便于断点调试）", "编译 · 调试工具", "", "Enable source maps in staging builds to inspect readable stack traces.", "在预发布构建中开启源码映射，以便查看清晰可读的报错堆栈。"),
    ("Hot Reload", "hɒt ˌriːˈloʊd", "n.", "热重载（代码保存后无需重启整个应用即可即时更新运行状态）", "工程 · 开发体验", "", "Hot reload preserves UI state while tweaking stylesheets in real time.", "实时调整样式表时，热重载能保留当前界面状态无需重启。"),
    ("Linting", "ˈlɪntɪŋ", "n.", "静态代码检查（编译前自动扫描潜在缺陷、未使用变量与风格问题）", "工程 · 质量保障", "", "Run linting in pre-commit hooks to catch typos before code review.", "在提交前钩子中运行静态代码检查，提前拦截低级拼写与缺陷。"),
    ("Toolchain", "ˈtuːltʃeɪn", "n.", "工具链（串联编译器、链接器、打包器与调试器的完整构建工具集）", "编译 · 工程构建", "", "Pin the SDK version in global.json to keep the build toolchain consistent.", "在 global.json 中锁定 SDK 版本以保证团队构建工具链一致。"),
    ("Deterministic", "dɪˌtɜːrmɪˈnɪstɪk", "adj.", "确定性的（相同输入在任何机器上重复构建或运行都产出完全一致结果）", "工程 · 工程构建", "", "Lockfiles guarantee deterministic dependency installs across CI runners.", "锁文件保证在所有 CI 节点上执行确定性的依赖安装。"),
    ("Mutex", "ˈmjuːteks", "n.", "互斥锁（保证同一时刻只有一个线程进入临界区访问共享资源）", "工程 · 并发系统", "", "Guard shared cache mutations with a lightweight mutex lock.", "使用轻量级互斥锁保护共享缓存的并发写入操作。"),
    ("Semaphore", "ˈseməfɔːr", "n.", "信号量（限制同时访问有限资源的最大并发线程或请求数量）", "工程 · 并发系统", "", "Use SemaphoreSlim(3) to cap concurrent TTS prewarm requests at three.", "使用 SemaphoreSlim(3) 将并发语音预热请求数上限控制在 3 个。"),
    ("Event Loop", "ɪˈvent luːp", "n.", "事件循环（单线程非阻塞运行时持续分发异步回调与微任务的调度机制）", "工程 · 运行时", "", "Avoid heavy synchronous JSON parsing that stalls the browser event loop.", "避免繁重的同步 JSON 解析，防止阻塞浏览器事件循环。"),
    ("Call Stack", "kɔːl stæk", "n.", "调用栈（记录当前活跃函数调用层级、局部变量与返回地址的栈结构）", "编译 · 调试工具", "", "Inspect the Call Stack pane in the debugger to see who triggered the error.", "在调试器的调用栈面板中查看是谁触发了本次报错。"),
    ("Heap Allocation", "hiːp ˌæləˈkeɪʃn", "n.", "堆内存分配（在动态内存区域按需申请生命周期跨函数的对象空间）", "编译 · 内存管理", "", "Reuse buffers with ArrayPool to minimize frequent heap allocations.", "通过对象池复用缓冲区，尽量减少高频堆内存分配。"),
    ("Profiling", "ˈproʊfaɪlɪŋ", "n.", "性能剖析（采样统计 CPU 耗时、内存热点与渲染帧率以定位瓶颈）", "工程 · 性能优化", "", "Run CPU profiling before optimizing to target the actual bottleneck.", "优化前先做 CPU 性能剖析，精准定位真正的耗时瓶颈。"),
    ("Regression", "rɪˈɡreʃn", "n.", "回归缺陷（新增改动意外破坏了原本正常工作的功能）", "工程 · 质量保障", "", "Add a regression test whenever you fix a production edge-case bug.", "每次修复线上边界缺陷后都补充一条回归测试防止复发。"),
    ("Mocking", "ˈmɒkɪŋ", "n.", "模拟打桩（单元测试中用可控假对象替代真实网络或数据库依赖）", "工程 · 测试调试", "", "Use mocking to test API retry logic without hitting live servers.", "使用模拟打桩测试接口重试逻辑，无需真正请求线上服务器。"),
    ("Debounce", "diːˈbaʊns", "v./n.", "防抖（连续高频触发事件时延迟至停止输入后再执行一次回调）", "工程 · 前端性能", "", "Debounce the vocabulary search input by 140ms to keep typing silky smooth.", "为词库搜索框加上 140ms 防抖，保证大词量输入丝滑不卡顿。"),
    ("Throttle", "ˈθrɒtl", "v./n.", "节流（限制高频事件在固定时间间隔内最多执行一次，如滚动/鼠标追踪）", "工程 · 前端性能", "", "Throttle global cursor hit-testing to 60Hz to keep CPU usage near zero.", "将全局鼠标命中检测节流在 60Hz 以保持极低 CPU 占用。"),
    ("Schema Migration", "ˈskiːmə maɪˈɡreɪʃn", "n.", "数据结构迁移（版本升级时自动将旧版数据库或本地配置平滑升级到新结构）", "工程 · 数据处理", "", "Bump vocabVersion to trigger an automatic schema migration on startup.", "递增 vocabVersion 版本号以在启动时自动触发数据结构迁移。"),
    ("Fallback", "ˈfɔːlbæk", "n.", "降级回退方案（主服务不可用时自动切换至备用引擎以保证可用性）", "工程 · 架构设计", "", "If Edge Neural TTS fails offline, fall back gracefully to local WebSpeech.", "若离线时 Edge 神经语音不可用，自动优雅降级至系统本地语音。"),
    ("Environment Variable", "ɪnˈvaɪrənmənt ˈveriəbl", "n.", "环境变量（在进程外部注入密钥、路径或运行模式的键值对配置）", "工程 · 运维部署", "", "Never hardcode API tokens; load them from environment variables instead.", "切勿硬编码 API 密钥，应改由环境变量或本地安全配置读取。"),
    ("Exit Code", "ˈeksɪt koʊd", "n.", "退出状态码（进程结束时返回给操作系统的整数，0 代表成功，非 0 代表异常）", "编译 · 终端调试", "", "The CI step failed because dotnet test returned exit code 1.", "CI 流水线失败，因为 dotnet test 返回了非零退出码 1。"),
    ("Stdout / Stderr", "stændərd aʊt", "n.", "标准输出 / 标准错误流（命令行程序输出正常结果与报错信息的两个独立流）", "编译 · 终端调试", "", "Redirect stderr to build.log so compiler errors are preserved.", "将标准错误流重定向至 build.log 以便完整保存编译报错。"),
    ("Hotfix", "ˈhɒtfɪks", "n.", "紧急热修复（针对线上严重故障快速发布的小范围定向修复补丁）", "工程 · Git 协作", "", "Ship a hotfix commit immediately to resolve the startup crash.", "立即发布紧急热修复提交以解决启动崩溃问题。"),
    ("Pull Request", "pʊl rɪˈkwest", "n.", "拉取请求 / PR（提交分支代码供团队评审、跑通检查后合并主干的流程）", "工程 · Git 协作", "", "Open a Pull Request with screenshots and passing unit tests attached.", "发起拉取请求并附上效果截图与通过的单元测试记录。"),
    ("Cherry-Pick", "ˈtʃeri pɪk", "v.", "择优拣选提交（将另一分支中的单个指定提交精准复制到当前分支）", "工程 · Git 协作", "", "Cherry-pick the bugfix commit onto the release/v1.2 branch.", "将该缺陷修复提交单独拣选合并到 release/v1.2 发布分支。"),

    # --- 3. 高频 IDE / 编辑器按钮与快捷键 (VS Code / 通用 IDE 键位) ---
    ("Command Palette", "", "", "命令面板（快速搜索并执行编辑器全部命令、构建与插件操作）", "IDE · 导航与命令", "Ctrl + Shift + P", "Press Ctrl + Shift + P to open the Command Palette and reload the window.", "按 Ctrl + Shift + P 打开命令面板执行任意 IDE 命令。"),
    ("Go to Definition", "", "", "转到定义（直接跳转到函数、类或变量声明源码处）", "IDE · 代码导航", "F12", "Put the cursor on SaveSettings and press F12 to Go to Definition.", "光标放在 SaveSettings 上按 F12 直接跳转到定义处。"),
    ("Peek Definition", "", "", "速览定义（在当前编辑器内嵌浮窗查看定义而不离开当前行）", "IDE · 代码导航", "Alt + F12", "Press Alt + F12 to Peek Definition without losing your scroll position.", "按 Alt + F12 在当前位置原地速览定义，不打断阅读上下文。"),
    ("Find All References", "", "", "查找所有引用（列出该符号在整个项目中的全部调用位置）", "IDE · 代码导航", "Shift + F12", "Press Shift + F12 before deleting a helper to check all references.", "删除辅助函数前按 Shift + F12 查找全项目全部引用处。"),
    ("Rename Symbol", "", "", "重命名符号（跨文件安全同步重命名变量、函数或类名）", "IDE · 智能重构", "F2", "Press F2 to Rename Symbol safely across all referencing files.", "按 F2 跨文件安全重构并同步重命名符号。"),
    ("Quick Fix", "", "", "快速修复 / 代码操作（自动导入缺失命名空间、提取函数或修复警告）", "IDE · 智能重构", "Ctrl + .", "Press Ctrl + . on a squiggly underline to apply a Quick Fix.", "光标停在波浪线报错处按 Ctrl + . 唤出快速修复菜单。"),
    ("Format Document", "", "", "格式化文档（一键按项目规范整理缩进、空格与换行）", "IDE · 代码编辑", "Shift + Alt + F", "Press Shift + Alt + F to Format Document cleanly before committing.", "提交前按 Shift + Alt + F 一键规范格式化当前文档。"),
    ("Toggle Line Comment", "", "", "切换行注释（快速为当前行或选中多行添加/取消注释）", "IDE · 代码编辑", "Ctrl + /", "Press Ctrl + / to Toggle Line Comment on the selected block.", "选中代码块按 Ctrl + / 快速添加或取消行注释。"),
    ("Toggle Block Comment", "", "", "切换块注释（用 /* ... */ 包裹或取消包裹当前选区）", "IDE · 代码编辑", "Shift + Alt + A", "Press Shift + Alt + A to wrap an inline expression in a block comment.", "按 Shift + Alt + A 为行内选区加上或取消块级注释。"),
    ("Toggle Breakpoint", "", "", "切换断点（在当前行打上或取消调试器暂停断点）", "IDE · 调试控制", "F9", "Press F9 on the error branch to set a debugger breakpoint.", "在报错分支行按 F9 设下调试断点。"),
    ("Start Debugging", "", "", "开始调试（编译并附加调试器运行当前项目）", "IDE · 调试控制", "F5", "Press F5 to Start Debugging and inspect live variable values.", "按 F5 启动调试器并实时检查变量状态。"),
    ("Step Over", "", "", "单步跳过（执行当前语句并停在下一行，不进入子函数内部）", "IDE · 调试控制", "F10", "Press F10 to Step Over helper calls while tracing main logic.", "按 F10 单步跳过子函数调用，专注追踪主逻辑。"),
    ("Step Into", "", "", "单步步入（进入当前行调用的子函数内部逐行排查）", "IDE · 调试控制", "F11", "Press F11 to Step Into SynthesizeAsync and inspect its cache lookup.", "按 F11 步入函数内部逐行排查执行细节。"),
    ("Step Out", "", "", "单步跳出（执行完当前函数剩余代码并返回上层调用者）", "IDE · 调试控制", "Shift + F11", "Press Shift + F11 to Step Out once you finish inspecting a helper.", "检查完子函数后按 Shift + F11 快速跳回上层调用处。"),
    ("Find in Files", "", "", "全局跨文件搜索（在整个工作区中按关键字或正则检索文本）", "IDE · 搜索替换", "Ctrl + Shift + F", "Press Ctrl + Shift + F to search every occurrence of CurrentVocabVersion.", "按 Ctrl + Shift + F 在整个项目中全局检索关键字。"),
    ("Replace in Files", "", "", "全局跨文件替换（在多个文件中批量预览并替换匹配文本）", "IDE · 搜索替换", "Ctrl + Shift + H", "Use Ctrl + Shift + H to replace legacy book IDs across the repo.", "按 Ctrl + Shift + H 跨文件批量替换匹配文本。"),
    ("Go to File", "", "", "快速打开文件（模糊匹配文件名秒跳任意项目源码）", "IDE · 导航与命令", "Ctrl + P", "Press Ctrl + P and type app.js to jump straight to the file.", "按 Ctrl + P 输入文件名秒速打开目标文件。"),
    ("Go to Symbol", "", "", "转到文件中的符号（快速浏览并跳转至当前文件的函数/类定义）", "IDE · 代码导航", "Ctrl + Shift + O", "Press Ctrl + Shift + O to jump between methods in MainWindow.xaml.cs.", "按 Ctrl + Shift + O 快速在当前文件的函数与类间跳转。"),
    ("Go to Line", "", "", "跳转到指定行号（对照报错堆栈行号精准定位）", "IDE · 代码导航", "Ctrl + G", "Press Ctrl + G and enter 690 to jump directly to the error line.", "按 Ctrl + G 输入行号直接定位到报错堆栈所在行。"),
    ("Toggle Terminal", "", "", "开关集成终端（展开或收起底部命令行终端面板）", "IDE · 面板与视图", "Ctrl + `", "Press Ctrl + ` to open the integrated terminal and run dotnet build.", "按 Ctrl + ` 快速展开底部集成终端执行构建命令。"),
    ("Split Editor", "", "", "拆分编辑器（将窗口并排分屏，同时对照两份代码文件）", "IDE · 面板与视图", "Ctrl + \\", "Press Ctrl + \\ to Split Editor and compare HTML beside JS.", "按 Ctrl + \\ 并排拆分编辑器，左右对照编辑多文件。"),
    ("Add Next Occurrence", "", "", "选中下一个相同匹配（多光标同时批量编辑相同变量名）", "IDE · 多光标编辑", "Ctrl + D", "Select a token and tap Ctrl + D to multi-edit matching occurrences.", "选中变量后连按 Ctrl + D 逐个添加多光标同步修改。"),
    ("Multi-Cursor", "", "", "添加多光标（按住 Alt 点击任意位置同时在多行键入代码）", "IDE · 多光标编辑", "Alt + Click", "Hold Alt + Click to place cursors on multiple JSON fields at once.", "按住 Alt 点击多处即可放置多个光标同时输入。"),
    ("Move Line Up / Down", "", "", "上下移动当前行（无需剪切粘贴直接调整语句顺序）", "IDE · 代码编辑", "Alt + Up/Down", "Press Alt + Up/Down to reorder statements without copy-pasting.", "按 Alt + 方向上下键直接调整代码行顺序。"),
    ("Duplicate Line", "", "", "向下复制当前行（快速克隆一行代码或配置项）", "IDE · 代码编辑", "Shift + Alt + Down", "Press Shift + Alt + Down to duplicate the current JSON entry.", "按 Shift + Alt + Down 快速向下复制当前行。"),
    ("Fold / Unfold Region", "", "", "折叠 / 展开代码块（收起长函数体以便总览文件结构）", "IDE · 代码编辑", "Ctrl + Shift + [", "Press Ctrl + Shift + [ to fold a large method body cleanly.", "按 Ctrl + Shift + [ 折叠当前代码块便于浏览大纲。"),
    ("Trigger Suggest", "", "", "手动触发智能补全（立即弹出成员属性与方法提示列表）", "IDE · 智能提示", "Ctrl + Space", "Press Ctrl + Space to Trigger Suggest for available API fields.", "按 Ctrl + Space 主动唤出智能代码补全提示列表。"),
    ("Parameter Hints", "", "", "参数签名提示（查看当前调用函数的重载参数类型与说明）", "IDE · 智能提示", "Ctrl + Shift + Space", "Press Ctrl + Shift + Space inside parentheses to inspect parameter hints.", "在函数括号内按 Ctrl + Shift + Space 查看参数类型签名。"),
    ("Problems Panel", "", "", "问题面板（集中列出所有编译报错、类型警告与 Lint 提示）", "IDE · 面板与视图", "Ctrl + Shift + M", "Open the Problems Panel with Ctrl + Shift + M to jump through errors.", "按 Ctrl + Shift + M 打开问题面板逐条定位编译报错与警告。"),
    ("Source Control", "", "", "源代码管理面板（查看 Git 变更文件、暂存差异与提交记录）", "IDE · 面板与视图", "Ctrl + Shift + G", "Press Ctrl + Shift + G to review staged diffs in Source Control.", "按 Ctrl + Shift + G 切换至 Git 源代码管理视图。"),
    ("Organize Imports", "", "", "整理导入语句（自动删除未使用的 import 并按规范排序）", "IDE · 智能重构", "Shift + Alt + O", "Press Shift + Alt + O to remove unused imports automatically.", "按 Shift + Alt + O 自动清理无用的导入声明并排序。"),
    ("Navigate Back", "", "", "后退到上一光标位置（跳转定义后一键回到原阅读处）", "IDE · 代码导航", "Alt + Left", "Press Alt + Left to Navigate Back right after inspecting a definition.", "按 F12 看完定义后，按 Alt + Left 一键退回原阅读位置。"),
    ("Toggle Sidebar", "", "", "开关主侧边栏（隐藏或展开左侧文件资源管理器以扩大代码视野）", "IDE · 面板与视图", "Ctrl + B", "Press Ctrl + B to hide the sidebar when reading wide diffs.", "查看宽行差异对比时按 Ctrl + B 隐藏左侧边栏。"),
    ("Zen Mode", "", "", "禅模式（全屏隐藏干扰面板，专注沉浸式写代码）", "IDE · 面板与视图", "Ctrl + K Z", "Press Ctrl + K Z to enter distraction-free Zen Mode.", "按 Ctrl + K Z 进入无干扰全屏沉浸式编码模式。"),
    ("Delete Line", "", "", "整行删除（无需选中整行直接快速删去光标所在行）", "IDE · 代码编辑", "Ctrl + Shift + K", "Press Ctrl + Shift + K to delete an obsolete debug log line instantly.", "按 Ctrl + Shift + K 一键删除光标所在的整行调试日志。"),
]


def build_dev_compiler() -> dict[str, Any]:
    entries = _pack_rows("dev_compiler", "dev", DEV_COMPILER_ROWS)
    print(f"[DevCompiler] Built {len(entries)} entries")
    return {
        "id": "dev_compiler",
        "bookId": "dev_compiler",
        "name": "编程与编译",
        "description": f"编程与编译英语高频词库（共 {len(entries)} 词），聚焦编译器/运行时报错英文、编译原理与工程核心术语及高频 IDE 快捷键。",
        "level": "DEV",
        "category": "dev_compiler",
        "builtIn": True,
        "enabled": True,
        "entries": entries,
    }


def build_blender() -> dict[str, Any]:
    entries = _pack_rows("blender", "blender", BLENDER_ROWS)
    print(f"[Blender] Built {len(entries)} entries")
    return {
        "id": "blender",
        "bookId": "blender",
        "name": "Blender 3D",
        "description": f"Blender 官方手册与简体中文术语规范高频词库（共 {len(entries)} 词），覆盖 Modeling / Modifiers / Shader Nodes / Geometry Nodes / UV / Sculpt / Render / Rigging 与快捷键。",
        "level": "3D",
        "category": "blender",
        "builtIn": True,
        "enabled": True,
        "entries": entries,
    }


def build_antigravity() -> dict[str, Any]:
    doc_count = 0
    try:
        print(f"[Antigravity] Verifying index at {ANTIGRAVITY_LLMS_URL} ...")
        llms_txt = fetch_bytes(ANTIGRAVITY_LLMS_URL, timeout=15).decode("utf-8", errors="ignore")
        doc_count = len(re.findall(r"https://antigravity\.google/docs/[^\s\)]+", llms_txt))
        print(f"[Antigravity] Indexed {doc_count} official doc pages from llms.txt")
    except Exception as exc:
        print(f"[Antigravity] Warning: could not fetch llms.txt ({exc}), using curated dataset.")

    entries = _pack_rows("antigravity", "ag", ANTIGRAVITY_ROWS)
    print(f"[Antigravity] Built {len(entries)} entries")
    return {
        "id": "antigravity",
        "bookId": "antigravity",
        "name": "Antigravity",
        "description": f"Google Antigravity 全量核心英文词库（共 {len(entries)} 词，参考官方文档索引 {doc_count or 100}+ 页面），覆盖 IDE、2.0 App、CLI (agy)、Python SDK、Customizations、Slash Commands、Swarm 与沙箱权限。",
        "level": "AI",
        "category": "antigravity",
        "builtIn": True,
        "enabled": True,
        "entries": entries,
    }


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = path.stat().st_size / 1024
    print(f"[Saved] {path} ({len(data['entries'])} entries, {size_kb:.1f} KB)")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    toefl = build_toefl()
    blender = build_blender()
    antigravity = build_antigravity()
    dev_compiler = build_dev_compiler()

    write_json(OUT_DIR / "toefl.json", toefl)
    write_json(OUT_DIR / "blender.json", blender)
    write_json(OUT_DIR / "antigravity.json", antigravity)
    write_json(OUT_DIR / "dev_compiler.json", dev_compiler)

    print(
        f"\nDone! Total entries: TOEFL={len(toefl['entries'])}, "
        f"Blender={len(blender['entries'])}, Antigravity={len(antigravity['entries'])}, "
        f"DevCompiler={len(dev_compiler['entries'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
