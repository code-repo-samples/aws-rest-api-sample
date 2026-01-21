const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// --- Configuration & CLI Arguments ---
const outputDir = './allure-results';

const argv = yargs(hideBin(process.argv))
    .option('html', { alias: 'f', type: 'string', default: 'report.html', description: 'Input k6 HTML report' })
    .option('appName', { alias: 'a', type: 'string', default: 'Logout-API', description: 'Application Name' })
    .option('runId', { alias: 'r', type: 'string', default: 'Build-11001', description: 'Build/Run Identifier' })
    .option('p90sla', { type: 'number', default: 150, description: 'Global P90 SLA in ms' }) 
    .option('slaConfig', { type: 'string', description: 'Path to sla.conf JSON file' })
    .help().argv;

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// --- 1. Load SLA Configuration (File > Command Line) ---
let customSlas = {};
if (argv.slaConfig && fs.existsSync(argv.slaConfig)) {
    try {
        customSlas = JSON.parse(fs.readFileSync(argv.slaConfig, 'utf8'));
        console.log(`Loaded custom SLAs from: ${argv.slaConfig}`);
    } catch (e) {
        console.error(`Error parsing ${argv.slaConfig}. Using global defaults.`);
    }
}

function getSlaForTrx(name) {
    return {
        p90: customSlas[name]?.p90 || argv.p90sla,
        minPass: customSlas[name]?.minPassCount || 1
    };
}

// --- 2. Metric Formatter for Summary ---
function formatOverallMetrics(appName, runId, stats) {
    const style = `padding: 8px; border: 1px solid #ddd;`;
    return `
    <h3>Performance Summary: ${appName}</h3>
    <table style="width:100%; border-collapse: collapse; font-family: sans-serif;">
        <tr style="background: #f8f9fa;">
            <td style="${style} font-weight:bold;">Run ID</td><td style="${style}">${runId}</td>
            <td style="${style} font-weight:bold;">Duration</td><td style="${style}">${stats.duration}s</td>
        </tr>
        <tr>
            <td style="${style} font-weight:bold;">Pass Rate</td><td style="${style}">${stats.passRate}%</td>
            <td style="${style} font-weight:bold;">Status</td><td style="${style}; color:green;">COMPLETED</td>
        </tr>
    </table><br>`;
}

// --- 3. Main Processing ---
try {
    const htmlContent = fs.readFileSync(argv.html, 'utf8');
    const $ = cheerio.load(htmlContent);

    const stats = {
        duration: $('b:contains("Duration")').parent().contents().last().text().trim(),
        passRate: $('b:contains("Pass %")').parent().contents().last().text().trim() || "0"
    };

    const metrics = [];
    $('h5:contains("API Summary")').next('table').find('tbody tr').each((i, el) => {
        const cols = $(el).find('td');
        const name = $(cols[0]).text().trim();
        const sla = getSlaForTrx(name);

        const m = {
            trxName: name,
            p50: $(cols[2]).text().trim(),
            p90: parseFloat($(cols[5]).text().trim()),
            pass: parseInt($(cols[10]).text().trim()),
            fail: parseInt($(cols[11]).text().trim()),
            p90Limit: sla.p90,
            passLimit: sla.minPass
        };

        // Pass Criteria: P90 within SLA AND Pass count met AND No hard failures
        m.status = (m.p90 <= m.p90Limit && m.pass >= m.passLimit && m.fail === 0) ? 'passed' : 'failed';
        metrics.push(m);
    });

    // Copy original report for attachment
    const attachmentHash = uuidv4();
    const attachmentSource = `${attachmentHash}-dashboard.html`;
    fs.copyFileSync(argv.html, path.join(outputDir, attachmentSource));

    const results = [];

    // --- SUMMARY TEST CASE (Always Passed) ---
    results.push({
        uuid: uuidv4(),
        name: `Overall Execution Summary & Dashboard`,
        status: "passed", 
        descriptionHtml: formatOverallMetrics(argv.appName, argv.runId, stats),
        attachments: [{ name: "Full k6 Report", type: "text/html", source: attachmentSource }],
        labels: [
            { name: "parentSuite", value: argv.appName },
            { name: "suite", value: argv.runId },
            { name: "subSuite", value: "Summary" }
        ],
        start: Date.now(), stop: Date.now() + 100
    });

    // --- TRANSACTION TEST CASES ---
    metrics.forEach(m => {
        results.push({
            uuid: uuidv4(),
            // FIXED TITLE: Using p90Limit variable
            name: `${m.trxName} [SLA: ${m.p90Limit}ms | P90: ${m.p90}ms | Pass: ${m.pass}]`,
            status: m.status,
            labels: [
                { name: "parentSuite", value: argv.appName },
                { name: "suite", value: argv.runId },
                { name: "subSuite", value: "Transactions" },
                { name: "P90 SLA", value: `${m.p90Limit}ms` },
                { name: "Pass Count", value: m.pass.toString() }
            ],
            steps: [
                { 
                    name: `Threshold Check: P90 Actual (${m.p90}ms) <= SLA (${m.p90Limit}ms)`, 
                    status: m.p90 <= m.p90Limit ? 'passed' : 'failed' 
                },
                { 
                    name: `Availability Check: Pass Count (${m.pass}) >= Min Required (${m.passLimit})`, 
                    status: m.pass >= m.passLimit ? 'passed' : 'failed' 
                }
            ],
            start: Date.now(), stop: Date.now() + 100 
        });
    });

    // Write result files
    results.forEach(res => {
        fs.writeFileSync(path.join(outputDir, `${res.uuid}-result.json`), JSON.stringify(res, null, 2));
    });
    
    // Executor Info for Allure Dashboard
    fs.writeFileSync(path.join(outputDir, 'executor.json'), JSON.stringify({
        name: "k6-Performance-Engine",
        buildName: `${argv.appName} - ${argv.runId}`,
        reportName: "K6 Allure Report"
    }, null, 2));

    console.log(`\n✅ Allure results generated successfully.`);
    console.log(`   SLA Target: ${argv.p90sla}ms`);
    console.log(`   Output Folder: ${outputDir}\n`);

} catch (err) {
    console.error(`❌ Error generating report: ${err.message}`);
}

//sla.conf

// {
//   "01_Home_Page": { "p90": 150, "minPassCount": 200 },
//   "02_Get_Pizza": { "p90": 300, "minPassCount": 100 }
// }


//node report_allure.js --html report.html --p90sla 150 --slaConfig sla.conf