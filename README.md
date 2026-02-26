# 🕊️ BirdTagger AI (Openclaw Skill)

BirdTagger AI 是一个由 AI 驱动的自动化鸟类摄影整理工具，作为一个 Openclaw/Moltbot 技能运行。它可以自动扫描你的照片目录，识别画面中的鸟类，并提供**物理文件夹分类**或是**无损 XMP 元数据注入**两种整理方式，最后还会为你生成一份漂亮的 HTML 整理战报。

## ✨ 特性

- **智能识别**: 接入前沿的视觉大模型（支持 GPT-4o-mini 和降级至 GPT-4o），自动识别照片中的鸟类（科、属、种）。
- **双模运行**:
  - `organize`: 物理整理模式。将照片按 `科/属/种` 的目录结构自动归档。
  - `xmp`: 无损打标模式。直接生成 XMP Sidecar 文件，在 Lightroom 等管理软件中无缝读取标签，无需移动原文件。
- **自动提取预览图**: 兼容多种主流 RAW 格式 (`.cr2`, `.cr3`, `.arw`, `.nef`, `.dng` 等)，利用 Exiftool 极速提取内嵌预览图供 AI 分析，省去漫长的 RAW 解码步骤。
- **Life List 记录**: 自动维护本地的 `life_list.json`，每当系统识别出你从未拍过的新鸟种 (Lifers)，都会记录下来并在最后的战报中为你庆祝。
- **可视化战报**: 每次运行结束后，自动生成一份美观且现代（基于 TailwindCSS）的整理战报，直观展示新鸟种、需人工复核的照片和完整清单。

## 📦 安装要求

- **Node.js**: v18+ (推荐)
- **Exiftool**: 必须在系统中安装并可用（命令行直接输入 `exiftool` 能运行）。用于极速提取 RAW 照片的预览。
  - macOS: `brew install exiftool`
  - Windows: 下载安装包并配置环境变量。
- **OpenAI API Key**: 用于调用视觉模型。

## 🚀 快速开始

### 1. 克隆项目 & 安装依赖

```bash
git clone https://github.com/YuChiHuaCheng/openclaw-bird-tagger-xmp.git
cd openclaw-bird-tagger-xmp
npm install
```

### 2. 配置环境变量

将 `.env.example` 复制为 `.env`，填入你的 OpenAI 秘钥。

```bash
cp .env.example .env
```

在 `.env` 中填写:
```env
OPENAI_API_KEY=sk-xxxxxx...
```

### 3. 运行命令

*注意：此脚本通常作为 Openclaw 平台上的技能来被 Moltbot 调用，但你也可以直接在命令行运行测试。*

**使用 XMP 模式无损打标：**
```bash
node index.js --target_directory="/path/to/your/photos" --execution_mode="xmp"
```

**使用物理归类模式（按鸟种建文件夹）：**
```bash
node index.js --target_directory="/path/to/your/photos" --execution_mode="organize"
```

## 🛠️ 参数说明

运行 `index.js` 时需要传递以下关键参数（也可以通过同名的系统环境变量注入）：

- `--target_directory` / `TARGET_DIRECTORY`: 存放你待整理照片（JPG或RAW格式）的绝对路径。
- `--execution_mode` / `EXECUTION_MODE`: `xmp` 或者 `organize` 二选一。

## 📝 输出物

- **整理后的文件**: 若使用 `organize` 将整理在如 `/Dir/鸭科/绿头鸭属/绿头鸭/xx.jpg`。
- **XMP Sidecar**: 若使用 `xmp`，则会在原照片旁边生成同名的 `.xmp` 文件，例如 `IMG_1234.xmp`。
- **战报 HTML**: 在 `target_directory` 下会生成形如 `鸟类整理战报_20240324T123000.html` 的美观报告页。
- **Life List DB**: 根目录生成 `life_list.json` 来持久化你的“终生鸟种”。

## 🤝 贡献与开源协议

本项目开源发布，欢迎提交 Issue 和 Pull Request，一起来让 AI 拍鸟体验更完善！
