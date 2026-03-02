import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 1. CLI Argument Parsing & Environment Loading ---
const args = process.argv.slice(2);
function getArg(name) {
    const val = args.find(a => a.startsWith(`--${name}=`));
    return val ? val.split('=')[1] : null;
}

// Openclaw / Moltbot skill parameters:
const targetDir = getArg('target_directory') || process.env.TARGET_DIRECTORY;
const executionMode = getArg('execution_mode') || process.env.EXECUTION_MODE;

if (!targetDir || !fs.existsSync(targetDir)) {
    console.error("❌ Error: target_directory is missing or does not exist.");
    process.exit(1);
}

if (!['xmp', 'organize'].includes(executionMode)) {
    console.error("❌ Error: execution_mode must be 'xmp' or 'organize'.");
    process.exit(1);
}

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is missing.");
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: openaiApiKey,
    baseURL: process.env.OPENAI_BASE_URL
});

// Allowed image extensions (RAW & JPG)
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.cr2', '.cr3', '.arw', '.nef', '.dng', '.raf', '.orf', '.rw2']);

// Scan target directory for files
const filesToProcess = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(dirent => dirent.isFile() && ALLOWED_EXTS.has(path.extname(dirent.name).toLowerCase()))
    .map(dirent => path.join(targetDir, dirent.name));

console.log(`📸 Found ${filesToProcess.length} images to process in ${targetDir}.`);
console.log(`⚙️ Execution Mode: ${executionMode}`);

// Load Life List DB
const lifeListPath = process.env.LIFE_LIST_PATH || path.join(__dirname, 'life_list.json');
let lifeList = { species_list: [] };
if (fs.existsSync(lifeListPath)) {
    try {
        lifeList = JSON.parse(fs.readFileSync(lifeListPath, 'utf8'));
    } catch (e) {
        console.warn("⚠️ Failed to parse life_list.json, starting fresh.");
    }
}

// Stats for HTML Report
const stats = {
    totalProcessed: 0,
    lifers: [],
    speciesList: [],
    manualReviewCount: 0,
    startTime: new Date()
};

const processedDetails = [];

// --- 2. AI Vision API Routing ---
async function callVisionModel(base64Image, modelName) {
    if (process.env.MOCK_VISION_JSON) {
        const mockData = JSON.parse(fs.readFileSync(process.env.MOCK_VISION_JSON, 'utf8'));
        const responseBirds = mockData.shift() || [];
        fs.writeFileSync(process.env.MOCK_VISION_JSON, JSON.stringify(mockData));
        return responseBirds;
    }

    console.log(`📡 [DEBUG] Sending request to model: ${modelName}`);
    const promptText = `识别画面中所有清晰可见的鸟类主体，并强制返回 JSON 对象。结构约束：{"birds": [{"family": "xx科", "genus": "xx属", "species": "xx鸟", "confidence": 0.95}]}。如果不是鸟类，返回空数组。如果不确定，confidence 填写低于 0.6 的值，并尝试给出最可能的物种，或者填写 '未知鸟类'。`;

    const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ]
            }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
    });

    let resultText = response.choices[0].message.content;
    try {
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(resultText);
        return data.birds || [];
    } catch (e) {
        console.error("❌ Failed to parse JSON response from OpenAI", resultText);
        return [];
    }
}

(async () => {
    // --- 3. Main Processing Pipeline ---
    for (const filePath of filesToProcess) {
        let tmpJpgPath = path.join(os.tmpdir(), `bird_tagger_tmp_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
        console.log(`\n🔍 Processing: ${path.basename(filePath)}`);

        // Step 3.1: Exiftool Extraction
        try {
            if (path.extname(filePath).toLowerCase() === '.jpg' || path.extname(filePath).toLowerCase() === '.jpeg') {
                fs.copyFileSync(filePath, tmpJpgPath);
            } else {
                execSync(`exiftool -b -PreviewImage "${filePath}" > "${tmpJpgPath}"`, { stdio: 'ignore' });
            }

            // Fallback to thumbnail if preview is empty
            if (!fs.existsSync(tmpJpgPath) || fs.statSync(tmpJpgPath).size === 0) {
                execSync(`exiftool -b -ThumbnailImage "${filePath}" > "${tmpJpgPath}"`, { stdio: 'ignore' });
            }
        } catch (e) {
            console.error(`⚠️ Failed to extract preview for ${path.basename(filePath)}`);
            if (fs.existsSync(tmpJpgPath)) fs.unlinkSync(tmpJpgPath);
            continue;
        }

        if (!fs.existsSync(tmpJpgPath) || fs.statSync(tmpJpgPath).size === 0) {
            console.warn(`⚠️ No preview image could be extracted for ${path.basename(filePath)}. Skipping...`);
            if (fs.existsSync(tmpJpgPath)) fs.unlinkSync(tmpJpgPath);
            continue;
        }

        const base64Image = fs.readFileSync(tmpJpgPath).toString('base64');
        fs.unlinkSync(tmpJpgPath); // immediately clean up

        // Step 3.2: First Pass with Cost-effective Model
        let birds = await callVisionModel(base64Image, 'gpt-4o-mini');

        // Routing/Fallback logic
        let needsFallback = birds.length === 0 || birds.some(b => b.confidence < 0.60 || b.species === '未知鸟类');

        if (needsFallback) {
            console.log(`🔄 Low confidence or unknown for ${path.basename(filePath)}, routing to gpt-4o for deep scan...`);
            birds = await callVisionModel(base64Image, 'gpt-4o');

            // Manual Review Catch-all
            birds = birds.map(b => {
                if (b.confidence < 0.60 || b.species === '未知鸟类') {
                    return { ...b, species: '[需人工鉴定]', family: '00_需人工鉴定', genus: '未知' };
                }
                return b;
            });
        }

        if (birds.length === 0) {
            console.log(`ℹ️ No birds detected in ${path.basename(filePath)}`);
            continue;
        }

        stats.totalProcessed++;

        // Step 3.3: Life List DB Operations
        const newLifersThisPic = [];
        birds.forEach(b => {
            if (b.species === '[需人工鉴定]') {
                stats.manualReviewCount++;
            } else {
                if (!stats.speciesList.includes(b.species)) {
                    stats.speciesList.push(b.species);
                }
                if (!lifeList.species_list.includes(b.species)) {
                    lifeList.species_list.push(b.species);
                    b.is_new_lifer = true;
                    if (!stats.lifers.includes(b.species)) {
                        stats.lifers.push(b.species);
                        newLifersThisPic.push(b.species);
                    }
                }
            }
        });

        // (DB writing deferred to the end of processing)

        processedDetails.push({
            file: path.basename(filePath),
            birds,
            newLifers: newLifersThisPic
        });

        console.log(`🦆 Identified: ${birds.map(b => b.species).join(', ')}`);

        // Step 3.4: Dual Execution Modes
        if (executionMode === 'organize') {
            // Mode A: Organization (Physical Move/Copy)
            const primaryBird = birds[0];
            const destFolder = path.join(targetDir, primaryBird.family, primaryBird.genus, primaryBird.species);

            fs.mkdirSync(destFolder, { recursive: true });
            let destPath = path.join(destFolder, path.basename(filePath));

            // Collision handling by appending timestamp
            if (fs.existsSync(destPath)) {
                const ext = path.extname(destPath);
                const name = path.basename(destPath, ext);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '');
                destPath = path.join(destFolder, `${name}_${timestamp}${ext}`);
            }

            fs.renameSync(filePath, destPath);
            console.log(`📂 Moved to ${destPath}`);

        } else if (executionMode === 'xmp') {
            // Mode B: XMP Tag Generation
            const xmpRoot = path.parse(filePath).name;
            const xmpPath = path.join(targetDir, `${xmpRoot}.xmp`);

            if (fs.existsSync(xmpPath)) {
                console.log(`⏩ XMP already exists, skipping tag injection for ${path.basename(filePath)}`);
                continue;
            }

            const bagStr = birds.map(b => `<rdf:li>${b.family}</rdf:li>\n     <rdf:li>${b.species}</rdf:li>`).join('\n     ');
            const hierarchicalStr = birds.map(b => `<rdf:li>鸟类|${b.family}|${b.genus}|${b.species}</rdf:li>`).join('\n     ');

            const xmpContent = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/">
   <dc:subject>
    <rdf:Bag>
     ${bagStr}
    </rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag>
     ${hierarchicalStr}
    </rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

            fs.writeFileSync(xmpPath, xmpContent);
            console.log(`📝 Generated XMP sidecar at ${xmpPath}`);
        }
    }

    // Persist Life List DB once after all files are processed
    fs.writeFileSync(lifeListPath, JSON.stringify(lifeList, null, 2));

    // Step 3.5: Visual HTML Report Generation
    console.log("\n📊 Generating HTML Visual Report...");

    const ts = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
    const reportPath = path.join(targetDir, `鸟类整理战报_${ts}.html`);

    const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🕊️ AI 鸟类快搜 (BirdTagger AI) 战报</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    </style>
</head>
<body class="bg-slate-100 min-h-screen text-slate-800 p-4 md:p-8">
    <div class="max-w-4xl mx-auto space-y-8">
        
        <!-- Brand Header -->
        <header class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center relative overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-r from-teal-500/10 to-blue-500/10"></div>
            <h1 class="text-3xl md:text-5xl font-black text-slate-900 relative z-10 tracking-tight">🕊️ AI 鸟类快搜战报</h1>
            <p class="mt-4 text-slate-500 relative z-10 font-medium">BirdTagger AI Execution Report</p>
        </header>

        <!-- Hero Stats -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center items-center">
                <span class="text-slate-500 font-medium uppercase tracking-wider text-sm mb-2">执行模式</span>
                <span class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
                    ${executionMode === 'xmp' ? 'XMP 无损打标' : '物理文件夹整理'}
                </span>
            </div>
            <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center items-center">
                <span class="text-slate-500 font-medium uppercase tracking-wider text-sm mb-2">共处理照片数</span>
                <span class="text-5xl font-black text-slate-800">${stats.totalProcessed}</span>
            </div>
        </div>

        <!-- ⚠️ 待处理区 -->
        ${stats.manualReviewCount > 0 ? `
        <div class="bg-amber-50 rounded-2xl p-6 shadow-sm border border-amber-200 animate-pulse">
            <h2 class="text-xl font-bold text-amber-800 flex items-center gap-2 mb-2">
                ⚠️ 需人工鉴定
            </h2>
            <p class="text-amber-700">发现 <strong class="text-2xl">${stats.manualReviewCount}</strong> 张照片置信度过低或由于模糊遮挡无法识别，已标记为 <code>[需人工鉴定]</code>，请前往查阅复核。</p>
        </div>
        ` : ''}

        <!-- 🎉 新鸟种高光区 (Lifers) -->
        ${stats.lifers.length > 0 ? `
        <div class="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-8 shadow-lg text-white">
            <h2 class="text-2xl font-bold flex items-center gap-2 mb-6">
                🎉 恭喜解锁新鸟种 (Lifers)!
            </h2>
            <div class="flex flex-wrap gap-3">
                ${stats.lifers.map(l => `<span class="bg-white/20 px-4 py-2 rounded-full font-semibold border border-white/30 backdrop-blur-sm shadow-sm">${l}</span>`).join('')}
            </div>
        </div>
        ` : ''}

        <!-- 全部分类清单 -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 class="text-xl font-bold text-slate-800">📋 本次识别清单</h2>
                <span class="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-sm font-semibold">${stats.speciesList.length} 种</span>
            </div>
            <div class="p-6">
                <div class="flex flex-wrap gap-2">
                    ${stats.speciesList.length > 0 ?
            stats.speciesList.map(s => `<span class="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium border border-slate-200">${s}</span>`).join('') :
            '<span class="text-slate-400 italic">本次没有识别到任何具体鸟种。</span>'
        }
                </div>
            </div>
        </div>

        <footer class="text-center text-slate-400 text-sm mt-12 mb-8">
            <p>Generated by BirdTagger AI Agent Skill • ${new Date().toLocaleString('zh-CN')}</p>
        </footer>
    </div>
</body>
</html>`;

    fs.writeFileSync(reportPath, htmlTemplate.trim());
    console.log(`✅ Report generated at: ${reportPath}`);
    console.log("🚀 BirdTagger AI completed successfully!");

})();
