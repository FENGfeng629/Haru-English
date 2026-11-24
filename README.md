<p align="center">
  <img src="wwwroot/assets/haru-icon.png" alt="Haru English" width="110" />
</p>

<h1 align="center">Haru English</h1>

<p align="center">
  <b>一款陪你聊天学英语、攻克计算机软件英文高频词的 Windows 透明悬浮 Live2D 桌面宠物</b><br/>
  Windows transparent Live2D AI English learning desktop companion powered by WPF, WebView2, PixiJS & Cubism 4.
</p>

---

**Haru English** 是一款轻量级、纯桌面悬浮的 Windows 二次元 Live2D 英语学习桌宠。没有厚重的传统软件窗口，由身着职场西装的 Live2D 导师 **Haru** 透明悬浮在你的桌面上——你可以随时和她**用英语聊天对话**练习口语与表达，也可以按需切换和导入**各类计算机软件的英文高频专业词汇**（如 Blender 3D 界面术语与快捷键，或一键导入 Photoshop、VS Code、Unity、Unreal、Figma 等任意软件词库），在日常使用电脑的碎片时间里自然掌握软件英语与实用英文。

## ✨ 核心功能 / Core Features

### 1. 💬 与桌宠自然聊天学英语 (AI English Chat & Translation)
- **沉浸式 AI 英语对话**：支持按 `A1`–`C2` 不同英语水平与 Haru 自由聊天，自动附带中文翻译、温柔语法纠错与实用表达建议，对话中遇到的生词可一键收藏至个人生词本。
- **实时词句翻译解析**：切换到 **Translate** 模式，快速查询英文单词、软件菜单短语与长句，提供音标、释义、语法拆解与重点词提取。
- **语音输入 & 神经网络朗读口型同步**：
  - **🎤 语音转文字 (STT)**：支持 Whisper API 与浏览器内置语音识别双模式，直接开口和桌宠对话。
  - **🔊 多音色神经网络朗读 (TTS)**：内置 9 种免费 Microsoft Edge 神经网络英文音色，同时支持 OpenAI TTS 与系统语音；Haru 开口朗读时实时驱动 Live2D 口型同步。
- **兼容主流大模型 API**：支持 OpenAI、DeepSeek、SiliconFlow、Gemini OpenAI 兼容端点以及 Ollama 等本地模型，不配置 API 时也可离线使用词库学习与互动。

### 2. 🖥️ 计算机软件英文高频词库 & 多词书学习 (Software Vocabulary & Multi-Book Hub)
- **内置计算机软件高频词库（Blender 3D 示例）**：精选软件英文界面高频术语（如 `Extrude`、`Bevel`、`Loop Cut`、`Subdivision Surface`、`Normals` 等），每条词条均附**音标、词性、中文释义、功能分类、对应快捷键与真实操作场景双语例句**，帮你彻底告别汉化插件，直接看懂英文原版软件界面。
- **自由选择与扩展各类软件词库**：支持一键导入 `.json` / `.csv` / `.txt` 词表，既可追加到已有词书，也可新建专属软件词库（如 **Photoshop / Premiere / Unity / Unreal Engine / VS Code / AutoCAD / Maya / Figma** 等任意计算机软件的高频英文词）。
- **多词书切换与生词本管理**：同时内置**托福 TOEFL 核心高频词库**与**个人不熟练生词本（Weak Words）**，支持分页浏览、按词书筛选与针对性复习。

### 3. 🎯 主动陪伴、待机抽查与学习激励 (Proactive Quizzes & Milestones)
- **待机自动单词小测验**：根据你设定的活跃度（静谧 25 分钟 / 适中 12 分钟 / 活跃 5 分钟 / 超活跃 2 分钟），Haru 会在你电脑间隙主动弹出四选一单词抽查；支持指定抽查**软件词库、托福词库、个人生词本或混合抽查**，答错词汇自动收录到生词本强化记忆。
- **学习时长与连续打卡鼓励**：累计学习满 1 小时触发庆祝鼓励，长时间未复习时温柔提醒热身。

### 4. 🎭 无边框透明 Live2D 桌宠互动 (Transparent Click-Through Live2D Pet)
- **全屏透明点击穿透**：基于 `pixi-live2d-display` + Live2D Cubism 4 模型 `haru_greeter_t03.model3.json`，桌宠周围透明区域不影响正常操作其他软件窗口，眼球平滑跟随鼠标移动。
- **全身部位触碰与英文动作托盘**：点击头顶、脸颊、肩膀等部位触发专属 Live2D 表情动作与英文台词；点击 **Act** 托盘可通过英文情绪/动作词（`Happy`, `Excited`, `Confused`, `Cheer`, `Wave` 等）边互动边学表达。
- **独立设置窗口 & 托盘快捷管理**：支持自由拖拽定位、缩放尺寸、锁定位置、隐藏到系统托盘，以及独立无边框设置中心管理 API、语音、词库与私人云同步（WebDAV / GitHub Gist / 自定义 REST）。

## 🚀 快速开始 / Quick Start

### 方式一：直接下载运行（推荐）
前往本仓库右侧的 **[Releases](https://github.com/FENGfeng629/Haru-English/releases)** 页面下载最新压缩包，解压后直接双击 `HaruEnglishPet.exe` 即可启动。

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

## 🔒 隐私与数据说明 / Privacy

所有个人配置、API Key、自定义导入词库、生词本与学习统计均保存在本地 `%APPDATA%\HaruEnglishPet\` 目录中，不会写入代码仓库或上传至任何第三方服务器（除非你主动配置个人云同步）。

## 📌 致谢与声明 / Credits

- Live2D 示例模型 `haru_greeter_t03` 及 Cubism Core 归 Live2D Inc. 所有，请遵守 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 使用。
