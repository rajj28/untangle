// Turns the real exported audit-pack .xlsx into a spreadsheet-style HTML page the recorder can film,
// one tab per sheet, exactly as exported (no invented cells).
// Usage: node scripts/workbook-view.mjs <file.xlsx> [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import XLSX from "xlsx";

const [input, output = "recordings/workbook.html"] = process.argv.slice(2);
if (!input) throw new Error("usage: workbook-view.mjs <file.xlsx> [out.html]");
const book = XLSX.read(readFileSync(input));
const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const column = (index) => { let s = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

const sheets = book.SheetNames.map((name, sheetIndex) => {
  const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" });
  const width = Math.max(6, ...rows.map((row) => row.length));
  const head = `<tr><th></th>${Array.from({ length: width }, (_, i) => `<th>${column(i)}</th>`).join("")}</tr>`;
  const body = rows.slice(0, 60).map((row, r) => `<tr><th>${r + 1}</th>${Array.from({ length: width }, (_, i) => {
    const value = row[i] ?? "";
    const numeric = /^-?[$€£₹]?[\d,]+(\.\d+)?$/.test(String(value).trim());
    return `<td class="${numeric ? "n" : ""}${r === 0 ? " h" : ""}">${escape(value)}</td>`;
  }).join("")}</tr>`).join("");
  return { name, html: `<table id="s${sheetIndex}" class="${sheetIndex ? "" : "on"}">${head}${body}</table>`, rows: rows.length };
});

writeFileSync(output, `<!doctype html><html><head><meta charset="utf-8"><title>${escape(basename(input))}</title><style>
body{margin:0;font:13px Calibri,Segoe UI,Arial,sans-serif;background:#fff;display:flex;flex-direction:column;height:100vh}
.bar{background:#217346;color:#fff;padding:10px 16px;font:600 15px Segoe UI,Arial}.bar span{opacity:.75;font-weight:400;margin-left:12px}
.grid{flex:1;overflow:auto}table{border-collapse:collapse;display:none;min-width:100%}table.on{display:table}
th{background:#f3f3f3;color:#555;font-weight:400;border:1px solid #d4d4d4;padding:3px 8px;position:sticky;top:0}
td{border:1px solid #e1e1e1;padding:4px 10px;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}td.h{font-weight:700;background:#e8f1ec}
.tabs{display:flex;gap:2px;background:#f3f3f3;border-top:1px solid #ccc;padding:0 8px;overflow-x:auto}
.tab{padding:7px 16px;cursor:pointer;color:#333;white-space:nowrap}.tab.on{background:#fff;color:#217346;font-weight:700;border-bottom:3px solid #217346}
</style></head><body><div class="bar">${escape(basename(input))}<span>${sheets.length} sheets</span></div>
<div class="grid">${sheets.map((s) => s.html).join("")}</div>
<div class="tabs">${sheets.map((s, i) => `<div class="tab${i ? "" : " on"}" data-i="${i}">${escape(s.name)}</div>`).join("")}</div>
<script>document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab,table").forEach(e=>e.classList.remove("on"));t.classList.add("on");document.getElementById("s"+t.dataset.i).classList.add("on")})</script>
</body></html>`);
console.log(`${output}: ${sheets.map((s) => `${s.name}(${s.rows})`).join(", ")}`);
