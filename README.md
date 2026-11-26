<p align="center">
  <img src="wwwroot/assets/haru-icon.png" alt="Haru English" width="110" />
</p>

<h1 align="center">Haru English</h1>

<p align="center">
  <b>一款陪你聊天学英语、专攻托福 / Blender 3D / Antigravity 高频词的 Windows 透明悬浮 Live2D 桌宠</b><br/>
  Windows transparent Live2D AI English learning desktop companion powered by WPF, WebView2, PixiJS & Cubism 4.
</p>

---

**Haru English** 是一款纯桌面悬浮的 Windows Live2D 英语学习桌宠。无边框透明悬浮在桌面上，由 Live2D 角色 **Haru** 陪你进行日常英语文字/语音对话、即时翻译与词汇抽查；词库中心精选聚焦 **托福 TOEFL 核心高频词**、**Blender 3D 英文界面高频术语（含快捷键）** 与 **Antigravity AI 编程高频术语（含斜杠命令与快捷键）**，并配有现代化的侧边栏 Bento 独立设置中心，让你在日常使用电脑的间隙轻松练英语。

> **🆕 最新更新亮点**
> - **软件界面按钮与键位英汉对照模式**：Blender 3D（282 词，支持从本机 Blender 5.2 提取官方 `zh_HANS` 界面按钮与快捷键）与 Antigravity（101 词）全面升级为「按钮名 + `📍 界面路径 uiLocation` + `<kbd>快捷键</kbd>`」结构，支持 **认按钮（英→中） / 找按钮（中→英） / 记键位（操作→键位）** 三向互考，并与托福 TOEFL（4,264 词）兼容共存。
> - **「每日喂词 + 间隔复习 + 对话实战」闭环**：默认专注抽查当前词库，按词频自动解锁**每日词袋**（5 / 10 / 20 词），先投喂认词再按 `+10 分钟 → +1 天 → +3 天 → 已掌握` 间隔复习，并将正在学的词自动注入 AI 对话用 `**加粗**` 复现。
> - **开机自启动 & 零延迟点读**：设置页新增「开机自动启动」开关（写入当前用户 Windows 启动项）；重构前端 Web Audio `AudioBuffer` 内存缓存 + 测验预热，点击喇叭点读近乎零延迟。

## ✨ 核心功能 / Features

### 1. 悬浮桌宠与极简快捷托盘 (Live2D Pet & Side Dock)
- **透明悬浮 & 点击穿透**：基于 `pixi-live2d-display` + Live2D Cubism 4，透明区域完全不遮挡其他窗口操作，支持自由拖拽、缩放（45%–160%）、置顶显示、锁定位置以及**全屏自动隐身 / 勿扰**（看视频、打游戏或演示全屏时自动隐藏并暂停抽查）。
- **4 枚极简侧边悬浮按钮**：
  - **Chat**：打开英语对话、语音对话与翻译面板
  - **Act**：打开 16 个英文表情与动作词汇面板
  - **Quiz**：立即开始 4 题单词抽查测验
  - **Set**：打开独立应用设置与词库中心窗口
- **自定义 Live2D 形象**：支持切换「本地内置 Haru（离线秒开）」「云端镜像 Haru」，也支持导入任意本地或在线 Cubism 4 `.model3.json` 自定义模型。
- **全局快捷键**：支持自定义全局热键，默认 `Alt + T` 快速语音对话、`Alt + Q` 立即抽查单词、`Alt + H` 显示/隐藏桌宠。

### 2. AI 英语对话、语音陪练与翻译 (Chat / Talk / Translate)
- **💬 Chat 文字对话**：支持按 `A1`–`C1` 英语水平自由交流，提供「温柔聊天 / 严格纠错」两种 AI 纠错风格与「始终显示 / 悬停点击 / 隐藏」中文释义策略，对话生词可一键收藏至个人生词本。
- **🎙️ Talk 语音对话**：一键开启语音输入，直接说英语，识别完成后自动发送给 Haru 回复。
- **🌐 Translate 即时翻译**：快速查询英文单词、短语与长句释义。
- **🔊 语音合成（TTS）与口型同步**：内置免费 Microsoft Edge 神经网络（9 种美/英/爱尔兰/印/澳音色）、OpenAI TTS（6 种音色）与系统本地语音，支持 0.6x–1.5x 语速调节与实时试听，朗读时同步驱动 Live2D 口型。
- **🎤 语音识别（STT）**：支持「智能自动 / 系统本地 / Whisper API」三种识别方式。
- **兼容主流大模型 API**：内置 OpenAI、DeepSeek、硅基流动、Gemini、Ollama 及自定义 OpenAI 兼容接口预设，支持一键连通性测试；不填 API Key 也可在离线词库模式下正常使用词库学习与免费 Edge 语音。

### 3. 表情与动作词汇互动 (Act)
- 内置 16 个英文表情与动作词条，支持按「全部 / 表情 / 动作」筛选。
- 点击任意英文词条，Haru 会立刻做出对应 Live2D 表情或动作并大声朗读单词与例句，支持一键收入个人生词本。

### 4. 托福 & Blender 3D & Antigravity 全量三词库与抽查测验 (Vocabulary Hub & Quiz)
- **三大全量内置词库（共 4,621 词）+ 个人生词本**：
  - **托福 TOEFL（4,264 词）**：基于开源词库 `kajweb/dict` 构建的托福 iBT 全量高频词库，含音标、词性、学科/词频分类与双语例句。
  - **Blender 3D（256 词）**：参考 Blender 官方文档与简体中文术语规范，覆盖 Modeling / Viewport / Modifiers / Shader Nodes / Geometry Nodes / UV / Sculpt / Render / Rigging / Physics 全流程高频专业术语，附带对应**快捷键**与实操双语例句。
  - **Antigravity（101 词）**：基于 `antigravity.google/llms.txt` 官方文档索引提取，覆盖 Antigravity IDE、2.0 App、CLI (`agy`)、Python SDK、Customizations（Skills / Rules / Plugins / Hooks / MCP / Sidecars）、Slash Commands、Swarm/Subagents 与 Terminal Sandbox/Permissions，附带对应**命令与快捷键**（如 `/plan`、`Ctrl+I`、`SKILL.md`、`agy`）。
  - **个人生词本**：支持手动添加词条、标记掌握状态、筛选待巩固词汇，抽查答错的词会自动收录。
- **大词量丝滑体验（词表 / 词库包 / 统计三视图）**：顶部支持「全部 / 生词本 / 托福 TOEFL / Blender 3D / Antigravity」一键切换，单词卡片展示分类标签与等宽快捷键徽章；列表采用**每页 30 条增量分页加载 + 搜索防抖**，4,600+ 词搜索与滚动依然流畅不卡顿，并支持通过 `scripts/build_vocabs.py` 一键重建全量词库或导入 `.json` / `.txt` / `.csv` 扩展。
- **手动 & 待机自动单词抽查（Quiz）**：每组 4 题，支持自动预热音频与 Web Audio 内存缓存实现零延迟点读，测验卡片顶部可一键切换「混合 / 托福 / Blender / Antigravity / 生词」；待机抽查频率支持「关闭 / 30 分钟 / 12 分钟 / 5 分钟」。

### 5. 现代化独立设置中心 & 数据同步 (Settings & Sync)
- **6 大侧边栏分区**（总览与外观、英语学习、词库中心、AI 模型接口、语音与听力、数据与设置），所有修改实时自动保存，左下角常驻状态卡片展示生词本数量、今日专注时长与当前模式。
- **外观定制**：支持浅色 / 深色 / 跟随系统主题，以及晴空蓝、樱花粉、紫罗兰、翡翠绿 4 种强调色。
- **本地存储、备份与云同步**：所有个人数据保存在 `%APPDATA%\HaruEnglishPet`，支持本地 JSON 学习记录导出/导入合并，以及 WebDAV、GitHub 私有 Gist、自定义 REST 云端同步（支持双向合并与测验后自动同步）。

## 🚀 快速开始 / Quick Start

### 方式一：直接下载运行（推荐）
前往本仓库 **[Releases](https://github.com/FENGfeng629/Haru-English/releases)** 页面下载最新压缩包，解压后双击 `HaruEnglishPet.exe` 即可运行。

> 环境要求：Windows 10 / 11 (x64)，需安装 [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/) 与 Microsoft Edge WebView2 Runtime（Windows 11 默认自带）。

### 方式二：从源码编译运行

```powershell
# 1. 克隆仓库
git clone https://github.com/FENGfeng629/Haru-English.git
cd Haru-English

# 2. 编译 Release 版本
dotnet build HaruEnglishPet.csproj -c Release

# 3. 运行程序
.\bin\Release\net10.0-windows10.0.19041.0\HaruEnglishPet.exe
```

也可以直接双击项目根目录的 `启动Haru桌宠.bat` 启动。

## 📌 致谢与声明 / Credits

- Live2D 示例模型 `haru_greeter_t03` 及 Cubism Core 归 Live2D Inc. 所有，请遵守 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 使用。
