import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = path.join(__dirname, 'mock_dir');
const MOCK_LIFE_LIST = path.join(__dirname, 'mock_life_list.json');
const MOCK_VISION_JSON = path.join(__dirname, 'mock_vision_responses.json');
const INDEX_JS_PATH = path.join(__dirname, '..', 'index.js');

console.log("🚀 Starting BirdTagger AI Automated Testing Environment");

const mockResponses = [
    // Image 1: Call 1 (Use Case A: Multi-species)
    [
        { family: "鹭科", genus: "白鹭属", species: "白鹭", confidence: 0.98 },
        { family: "鹭科", genus: "苍鹭属", species: "苍鹭", confidence: 0.95 }
    ],
    // Image 2: Call 2 (Use Case B: New bird species)
    [
        { family: "鸥科", genus: "红嘴鸥属", species: "红嘴鸥", confidence: 0.99 }
    ],
    // Image 3: Call 3 (Needs manual review, < 0.6)
    [
        { family: "未知科", genus: "未知属", species: "未知鸟类", confidence: 0.40 }
    ],
    // Image 3: Call 4 (Fallback for Image 3, still fails)
    [
        { family: "未知科", genus: "未知属", species: "未知鸟类", confidence: 0.30 }
    ],
    // Image 4: Call 5 (Normal)
    [
        { family: "燕科", genus: "燕属", species: "家燕", confidence: 0.90 }
    ],
    // Image 5: Call 6 (Normal)
    [
        { family: "鸭科", genus: "鸭属", species: "绿头鸭", confidence: 0.92 }
    ]
];

async function runTests() {
    let allPassed = true;
    try {
        console.log("=== Setting up Mock Environment ===");
        if (fs.existsSync(MOCK_DIR)) fs.rmSync(MOCK_DIR, { recursive: true, force: true });
        fs.mkdirSync(MOCK_DIR, { recursive: true });

        // Create 5 mock JPG files
        for (let i = 1; i <= 5; i++) {
            fs.writeFileSync(path.join(MOCK_DIR, `mock_${i}.jpg`), Buffer.from(`dummy_image_data_${i}`));
        }

        // Create mock DB and vision responses
        const initialLifeList = { species_list: ['白鹭'] };
        fs.writeFileSync(MOCK_LIFE_LIST, JSON.stringify(initialLifeList));
        fs.writeFileSync(MOCK_VISION_JSON, JSON.stringify(mockResponses));

        // Let's run index.js
        console.log("=== Running Main Script (XMP Mode) ===");
        const env = {
            ...process.env,
            OPENAI_API_KEY: 'mock-key',
            MOCK_VISION_JSON,
            LIFE_LIST_PATH: MOCK_LIFE_LIST
        };

        execSync(`node "${INDEX_JS_PATH}" --target_directory="${MOCK_DIR}" --execution_mode=xmp`, {
            env, stdio: 'inherit'
        });

        console.log("\n=== Verifying Acceptance Criteria ===");

        // Verify Use Case A
        const xmp1Path = path.join(MOCK_DIR, 'mock_1.xmp');
        if (fs.existsSync(xmp1Path)) {
            const content = fs.readFileSync(xmp1Path, 'utf8');
            if (content.includes('白鹭') && content.includes('苍鹭')) {
                console.log("✅ Use Case A (Multi-species XMP write): Passed!");
            } else {
                console.error("❌ Use Case A: Failed -> Missing species in XMP.");
                allPassed = false;
            }
        } else {
            console.error("❌ Use Case A: Failed -> mock_1.xmp was not created.");
            allPassed = false;
        }

        // Verify Use Case B
        const updatedLifeList = JSON.parse(fs.readFileSync(MOCK_LIFE_LIST, 'utf8'));
        if (updatedLifeList.species_list.includes('红嘴鸥')) {
            console.log("✅ Use Case B (New bird species discovery): Passed!");
        } else {
            console.error("❌ Use Case B: Failed -> '红嘴鸥' not found in life list.");
            allPassed = false;
        }

        // Verify Use Case C
        const files = fs.readdirSync(MOCK_DIR);
        const reportFile = files.find(f => f.startsWith('鸟类整理战报_') && f.endsWith('.html'));
        if (reportFile) {
            console.log(`✅ Use Case C (HTML report generation): Passed! (${reportFile})`);
        } else {
            console.error("❌ Use Case C: Failed -> Report HTML not found.");
            allPassed = false;
        }

    } catch (e) {
        console.error("Test framework error", e.message || e);
        allPassed = false;
    } finally {
        if (allPassed) {
            console.log("\n🎉 Code Self-Review and Test Suite passed successfully.");
        } else {
            console.error("\n⚠️ Test Suite failed.");
            process.exitCode = 1;
        }

        // Cleanup
        console.log("🧹 Cleaning up mock environment...");
        if (fs.existsSync(MOCK_DIR)) fs.rmSync(MOCK_DIR, { recursive: true, force: true });
        if (fs.existsSync(MOCK_LIFE_LIST)) fs.rmSync(MOCK_LIFE_LIST, { force: true });
        if (fs.existsSync(MOCK_VISION_JSON)) fs.rmSync(MOCK_VISION_JSON, { force: true });
        console.log("Done.");
    }
}

runTests();
