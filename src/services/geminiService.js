const fs = require("fs");
const path = require("path");
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Truncate large inputs to keep requests small
function buildSample(input, maxChars = 6_000) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[Truncated for summarization: original length ${text.length} chars]`
  );
}

// Take only a few lines/rows to avoid large payloads
function sampleForPrompt(parsedData, opts = {}) {
  const { maxRows = 10, maxLines = 20, maxChars = 6_000, maxKeys = 20 } = opts;

  let sample = null;
  let info = {};

  if (Array.isArray(parsedData)) {
    if (
      parsedData.length &&
      typeof parsedData[0] === "object" &&
      parsedData[0] !== null
    ) {
      const rows = parsedData.slice(0, maxRows);
      const cols = Array.from(
        rows.reduce((set, r) => {
          Object.keys(r || {}).forEach((k) => set.add(k));
          return set;
        }, new Set())
      ).slice(0, maxKeys);
      sample = rows;
      info = {
        sample_kind: "array_of_objects",
        rows_sampled: rows.length,
        columns_detected: cols,
      };
    } else {
      const lines = parsedData.slice(0, maxLines);
      sample = lines;
      info = { sample_kind: "array_of_strings", lines_sampled: lines.length };
    }
  } else if (typeof parsedData === "string") {
    const lines = parsedData.split(/\r?\n/).slice(0, maxLines);
    sample = lines.join("\n");
    info = { sample_kind: "text_lines", lines_sampled: lines.length };
  } else if (parsedData && typeof parsedData === "object") {
    const keys = Object.keys(parsedData).slice(0, maxKeys);
    const shallow = {};
    for (const k of keys) {
      const v = parsedData[k];
      shallow[k] = Array.isArray(v)
        ? `[array len=${v.length}]`
        : v && typeof v === "object"
        ? "[object]"
        : v;
    }
    sample = shallow;
    info = { sample_kind: "object_shallow", keys_sampled: keys.length };
  } else {
    sample = parsedData;
    info = { sample_kind: "unknown" };
  }

  const payload = buildSample({ info, sample }, maxChars);
  return { payload, info };
}

function tryParseJsonLoose(txt) {
  if (!txt) return null;
  // Strip common markdown fences
  const cleaned = String(txt)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "");
  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}
  // Fallback: extract first {...} block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {}
  }
  return null;
}

function heuristicSummary(metadata, parsedData) {
  const cols = Array.isArray(metadata.detected_columns)
    ? metadata.detected_columns
    : [];
  const lcCols = cols.map((c) => String(c).toLowerCase());
  const recs = Number(metadata.record_count || 0);

  const hasLogHints =
    lcCols.includes("timestamp") || lcCols.includes("message");
  const financeHints = [
    "amount",
    "price",
    "cost",
    "revenue",
    "expense",
    "balance",
    "investment",
    "nav",
    "return",
    "roi",
  ];
  const webHints = [
    "status",
    "method",
    "url",
    "path",
    "user_agent",
    "ip",
    "latency",
  ];
  const salesHints = [
    "order",
    "customer",
    "product",
    "sku",
    "quantity",
    "sale",
    "discount",
    "tax",
    "total",
  ];
  const metricsHints = ["metric", "value", "count", "avg", "min", "max"];

  const hit = (list) => lcCols.some((c) => list.some((k) => c.includes(k)));
  let probable_domain = "general";
  if (hit(financeHints)) probable_domain = "finance";
  else if (hit(webHints)) probable_domain = "web-logs";
  else if (hit(salesHints)) probable_domain = "ecommerce";
  else if (hit(metricsHints)) probable_domain = "analytics";
  else if (hasLogHints) probable_domain = "logs";

  const file_type_guess = metadata.filetype
    ? String(metadata.filetype)
    : hasLogHints
    ? "log"
    : "unknown";
  const key_fields = cols.slice(0, 10);

  const insights = [];
  if (recs > 0 && cols.length > 0)
    insights.push(
      `Contains ${recs} records and ${cols.length} columns (sampled)`
    );
  if (hasLogHints)
    insights.push("Log-like structure with timestamps and messages");
  if (probable_domain === "finance")
    insights.push(
      "Financial fields detected (e.g., amount/balance/investment)"
    );
  if (probable_domain === "web-logs")
    insights.push("Web access/error fields present (status/url/method)");

  const anomalies = [];
  // Simple anomaly hints
  if (cols.some((c) => c === "" || c === "unnamed" || c.startsWith("column"))) {
    anomalies.push("Unnamed or placeholder columns detected");
  }

  const summaryParts = [];
  summaryParts.push(`Looks like a ${file_type_guess} dataset`);
  if (probable_domain !== "general")
    summaryParts.push(`in the ${probable_domain} domain`);
  if (recs) summaryParts.push(`with about ${recs} records`);
  const summary = summaryParts.join(" ") + ".";

  return {
    summary,
    file_type_guess,
    probable_domain,
    key_fields,
    insights,
    anomalies,
    data_overview: {
      records: recs,
      columns: cols,
      notes: ["Heuristic summary used (model output unavailable)"],
    },
  };
}

async function summarize({ apiKey, parsedData, metadata }) {
  if (!apiKey) {
    // Fallback stub if API key missing
    return {
      summary: "AI summarization unavailable (missing GEMINI_API_KEY).",
      file_type_guess: metadata.filetype || "unknown",
      probable_domain: "",
      key_fields: metadata.detected_columns || [],
      insights: ["Sample-based parsing completed"],
      anomalies: [],
      data_overview: {
        records: metadata.record_count,
        columns: metadata.detected_columns || [],
        notes: ["Local stub summary (no API key)"],
      },
    };
  }

  // Build a very small sample to avoid large requests
  const { payload: sample, info: sampleInfo } = sampleForPrompt(parsedData, {
    maxRows: 10,
    maxLines: 20,
    maxChars: 6_000,
  });

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are a data profiling assistant. Given a small sample of an uploaded file, infer:
1) What type of file/data this is (logs, sales CSV, metrics JSON, etc.) and what it stores.
2) Key fields/columns and any obvious patterns or anomalies.
3) Provide a concise, executive-style summary (1–2 sentences).

Strictly follow:
- Use ONLY the provided sample and metadata; do not assume unseen content.
- Respond ONLY with valid JSON (no Markdown, no commentary).
- Use this exact JSON schema:
{
  "summary": "string (1–2 sentences explaining what the file stores and its purpose)",
  "file_type_guess": "string (e.g., csv/log/json/txt + domain if possible)",
  "probable_domain": "string (e.g., finance, web-logs, ecommerce, analytics)",
  "key_fields": ["field1", "field2"],
  "insights": ["short bullet", "short bullet"],
  "anomalies": ["short bullet if any"],
  "data_overview": {
    "records": number,
    "columns": ["col1", "col2"],
    "notes": ["short note", "short note"]
  }
}

Metadata:
${buildSample(metadata, 1200)}

Sample (few rows/lines only, not full file):
${sample}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  try {
    const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Fall back to heuristic summary on HTTP error
      return heuristicSummary(metadata, parsedData);
    }

    const json = await res.json();
    const candidates = json.candidates || [];
    if (!candidates.length) {
      // Fall back to heuristic on blocked/no candidates
      return heuristicSummary(metadata, parsedData);
    }
    const parts = candidates[0]?.content?.parts || [];
    let text = parts.find((p) => typeof p.text === "string")?.text;
    if (!text && parts[0]?.inlineData?.data) {
      try {
        const b64 = parts[0].inlineData.data;
        text = Buffer.from(b64, "base64").toString("utf-8");
      } catch {}
    }
    const parsed = tryParseJsonLoose(text);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
      return parsed;
    }
    // Fallback: wrap text if any
    if (text && String(text).trim().length > 0) {
      return {
        summary: String(text).trim().slice(0, 800),
        file_type_guess: metadata.filetype || "unknown",
        probable_domain: "",
        key_fields: metadata.detected_columns || [],
        insights: [],
        anomalies: [],
        data_overview: {
          records: metadata.record_count,
          columns: metadata.detected_columns || [],
          notes: ["Model returned non-JSON; used textual fallback"],
        },
      };
    }
    // Final fallback: heuristic
    return heuristicSummary(metadata, parsedData);
  } catch {
    // Network/other error: heuristic
    return heuristicSummary(metadata, parsedData);
  }
}

module.exports = { summarize, buildSample };

// Dev-only CLI: summarize a local file without hitting the API server
// Usage: node src/services/geminiService.js <filePath>
if (require.main === module) {
  (async () => {
    const filePath = process.argv[2];
    if (!filePath) {
      console.error("Usage: node src/services/geminiService.js <filePath>");
      process.exit(1);
    }
    const apiKey = process.env.GEMINI_API_KEY || "";
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let parsedData;
    try {
      if (ext === ".json") {
        parsedData = JSON.parse(buf.toString("utf-8"));
      } else {
        parsedData = buf.toString("utf-8");
      }
    } catch {
      parsedData = buf.toString("utf-8");
    }
    const metadata = {
      filename: path.basename(filePath),
      filetype: ext.replace(".", "") || "txt",
      record_count: Array.isArray(parsedData)
        ? parsedData.length
        : typeof parsedData === "string"
        ? parsedData.split(/\r?\n/).filter(Boolean).length
        : 1,
      detected_columns: [],
    };
    const out = await summarize({ apiKey, parsedData, metadata });
    console.log(JSON.stringify(out, null, 2));
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
