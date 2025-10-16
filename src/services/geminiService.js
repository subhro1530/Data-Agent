const fs = require("fs");
const path = require("path");
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Truncate large inputs to keep requests small
function buildSample(input, maxChars = 120_000) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[Truncated for summarization: original length ${text.length} chars]`
  );
}

async function summarize({ apiKey, parsedData, metadata }) {
  if (!apiKey) {
    // Fallback stub if API key missing
    return {
      summary: "AI summarization unavailable (missing GEMINI_API_KEY).",
      insights: ["Sample-based parsing completed"],
      anomalies: [],
      data_overview: {
        filetype: metadata.filetype,
        records: metadata.record_count,
        columns: metadata.detected_columns || [],
      },
    };
  }

  const sample = buildSample({ metadata, data: parsedData });

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Summarize this data in a structured JSON format focusing on key patterns, insights, and anomalies.
Requirements:
- Respond ONLY with valid JSON.
- Shape:
  {
    "summary": "string",
    "insights": ["..."],
    "anomalies": ["..."],
    "data_overview": {
      "records": number,
      "columns": ["..."],
      "notes": ["..."]
    }
  }

Data (sampled/truncated if large):
${sample}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const candidates = json.candidates || [];
  const content = candidates[0]?.content?.parts?.[0]?.text || "{}";

  // The API is instructed to return pure JSON text
  try {
    return JSON.parse(content);
  } catch {
    // Fallback: wrap as text if parsing fails
    return {
      summary: String(content).slice(0, 1000),
      insights: [],
      anomalies: [],
      data_overview: {},
    };
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
