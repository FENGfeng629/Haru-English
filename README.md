<p align="center">
  <img src="wwwroot/assets/haru-icon.png" alt="Haru English" width="110" />
</p>

<h1 align="center">Haru English</h1>

<p align="center">
  Windows transparent Live2D AI English learning desktop companion powered by WPF, WebView2, PixiJS & Cubism 4.
</p>

---

一款纯桌面悬浮的 Windows 二次元 Live2D 英语学习软件：没有厚重的传统软件窗口，由身着职场西装的 Live2D 导师 **Haru** 透明悬浮在桌面上陪你沉浸式练英语。

## ✨ 核心功能 / Features

1. **无边框透明 Live2D 桌宠 (Transparent Click-Through Live2D Pet)**
   - 基于 `pixi-live2d-display` + Live2D Cubism 4 模型 `haru_greeter_t03.model3.json`。
   - 全屏透明点击穿透：Haru 周围透明区域不影响正常操作其他窗口；眼球平滑跟随鼠标移动。
   - **全身部位互动**：点击头顶、脸颊、肩膀、衣摆等部位触发对应 Live2D 表情动作与英文互动台词。
   - 支持自由拖拽定位、右键或系统托盘菜单随时调节尺寸与锁定位置。

2. **悬浮英文表情动作托盘 (English Expression & Motion Palette)**
   - 点击 **🎭 Act** 呼出快捷托盘，全部表情与动作以英文单词展示（`Happy`, `Shy`, `Surprised`, `Excited`, `Angry`, `Sad`, `Pouting`, `Friendly`, `Nod`, `Shake`, `Wink`, `Wave`, `Bow`, `Confused`, `Cheer`, `Sleepy`）。
   - 点击任意单词立即触发对应动作、大声朗读单词与例句，支持一键加入「不熟练的英文」词库。

3. **AI 英语对话、翻译与语音口型同步 (AI Chat, Translation, STT/TTS & Lip-Sync)**
   - **💬 Chat 模式**：按 `A1`–`C2` 英语水平自然对话，附中文翻译、温柔语法纠错与生词一键收藏。
   - **🌐 Translate 模式**：英文单词、短语与长句即时翻译，附音标、语法解析与重点词提取。
   - **🎤 语音转文字 (STT)**：支持 Whisper API 与浏览器内置语音识别双模式。
   - **🔊 多音色神经网络朗读 (TTS)**：内置 9 种免费 Microsoft Edge 神经网络英文音色，亦支持 OpenAI TTS 与系统语音，朗读时实时驱动 Live2D 口型同步。

4. **主动陪伴与学习激励 (Proactive Quizzes & Milestones)**
   - **待机自动单词小测验**：按活跃度（静谧 25 分钟 / 适中 12 分钟 / 活跃 5 分钟 / 超活跃 2 分钟）主动弹出测验，优先抽查不熟练词汇。
   - **学习时长提醒与鼓励**：每累计学习满 1 小时弹出庆祝夸奖；连续 2 天以上未学习时温柔提醒热身。

5. **自定义大模型 API、可扩展知识库 & 私人云同步**
   - 支持任意 OpenAI 兼容接口（OpenAI、DeepSeek、SiliconFlow、Gemini OpenAI 端点、Ollama 本地模型等）。
   - 支持导入 `.json` / `.csv` / `.txt` 扩充英文知识库，所有个人数据与配置保存在 `%APPDATA%\HaruEnglishPet\`（不会随代码泄露）。
   - 支持 WebDAV、GitHub Gist 及自定义 REST 接口双向同步生词本与学习统计。

## 🛠️ 环境要求与构建 / Build & Run

- **OS**: Windows 10 / 11 (x64)
- **SDK**: [.NET 10 SDK](https://dotnet.microsoft.com/)（含 Windows Desktop Runtime）
- **Runtime**: Microsoft Edge WebView2 Runtime（Windows 11 默认自带）

```powershell
# 克隆仓库
git clone https://github.com/FENGfeng629/Haru-English.git
cd Haru-English

# 编译 Release 版本
dotnet build HaruEnglishPet.csproj -c Release

# 运行程序
.\bin\Release\net10.0-windows10.0.19041.0\HaruEnglishPet.exe
```

也可以直接双击项目根目录的 `启动Haru桌宠.bat` 启动。

## 📌 致谢与声明 / Credits

- Live2D 示例模型 `haru_greeter_t03` 及 Cubism Core 归 Live2D Inc. 所有，请遵守 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 使用。
