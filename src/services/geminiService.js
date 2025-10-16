const fs = require("fs");
const path = require("path");
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Truncate large inputs to keep requests small
function buildSample(input, maxChars = 120_000) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[Truncated for summarization: original length ${text.length} chars]`
  );
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
  if (!candidates.length) {
    const pf = json.promptFeedback?.blockReason || "no-candidates";
    throw new Error(`Gemini returned no candidates (reason: ${pf})`);
  }
  // Find first part with text or inline_data
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
  // If still nothing useful, throw so caller marks failed
  throw new Error("Gemini returned empty or non-JSON content");
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
