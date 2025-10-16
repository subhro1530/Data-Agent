const path = require("path");
const { parseString } = require("@fast-csv/parse");

function bufferToString(buf) {
  return buf.toString("utf-8");
}

function detectFileType({ buffer, originalname = "", mimetype = "" }) {
  const ext = (path.extname(originalname) || "").toLowerCase();
  const head = buffer.slice(0, 512).toString("utf-8").trim();

  if (
    ext === ".json" ||
    mimetype === "application/json" ||
    head.startsWith("{") ||
    head.startsWith("[")
  ) {
    return "json";
  }
  if (
    ext === ".csv" ||
    mimetype === "text/csv" ||
    (head.includes(",") && head.includes("\n"))
  ) {
    return "csv";
  }
  if (ext === ".log" || ext === ".txt" || mimetype === "text/plain") {
    return "log";
  }
  // fallback heuristic
  if (head.includes("{") || head.includes("[")) return "json";
  if (head.includes(",") && head.includes("\n")) return "csv";
  return "txt";
}

function hasHeader(firstLine) {
  // Heuristic: if any token contains letters, assume header
  const tokens = firstLine
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));
  return tokens.some((t) => /[a-zA-Z]/.test(t));
}

function parseCSV(buffer) {
  const text = buffer.toString("utf-8").replace(/\r\n/g, "\n");
  const [firstLine] = text.split("\n");
  const headers = hasHeader(firstLine) ? true : undefined;

  return new Promise((resolve, reject) => {
    const rows = [];
    parseString(text, { headers, ignoreEmpty: true, trim: true })
      .on("error", reject)
      .on("data", (row) => rows.push(row))
      .on("end", () => {
        const detected_columns = rows.length ? Object.keys(rows[0]) : [];
        resolve({
          data: rows,
          description: `CSV with ${detected_columns.length} columns and ${rows.length} rows`,
          record_count: rows.length,
          detected_columns,
        });
      });
  });
}

function parseJSON(buffer) {
  const text = bufferToString(buffer);
  let json = JSON.parse(text);
  // Normalize: ensure array of objects or object
  if (Array.isArray(json)) {
    const record_count = json.length;
    const detected_columns =
      record_count && typeof json[0] === "object" && json[0] !== null
        ? Object.keys(json[0])
        : [];
    return {
      data: json,
      description: `JSON array with ${record_count} records`,
      record_count,
      detected_columns,
    };
  }
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json);
    return {
      data: json,
      description: `JSON object with ${keys.length} keys`,
      record_count: 1,
      detected_columns: keys,
    };
  }
  return {
    data: { value: json },
    description: `Primitive JSON value`,
    record_count: 1,
    detected_columns: ["value"],
  };
}

function parseLogOrTxt(buffer) {
  const text = bufferToString(buffer).replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  const tsRegexes = [
    /^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]?/, // ISO-ish
    /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/, // syslog-like
  ];

  const start = Date.now();
  const records = lines.map((line, idx) => {
    let detectedTs = null;
    for (const rx of tsRegexes) {
      const m = line.match(rx);
      if (m) {
        detectedTs = m[1];
        break;
      }
    }
    const timestamp = detectedTs || new Date(start + idx * 1000).toISOString();

    // Simple pattern hints
    const httpMatch = line.match(/\s(\d{3})\s/);
    const levelMatch = line.match(/\b(INFO|WARN|ERROR|DEBUG|FATAL|TRACE)\b/i);

    const details = {};
    if (httpMatch) details.http_status = Number(httpMatch[1]);
    if (levelMatch) details.level = levelMatch[1].toUpperCase();

    return { timestamp, message: line, ...details };
  });

  const statusCount = records.reduce((acc, r) => {
    if (r.http_status) acc[r.http_status] = (acc[r.http_status] || 0) + 1;
    return acc;
  }, {});
  const description = `Log/TXT file with ${records.length} lines${
    Object.keys(statusCount).length
      ? `; statuses: ${Object.keys(statusCount).join(", ")}`
      : ""
  }`;

  return {
    data: records,
    description,
    record_count: records.length,
    detected_columns: ["timestamp", "message"],
  };
}

async function parseFile({ buffer, originalname, mimetype }) {
  const type = detectFileType({ buffer, originalname, mimetype });

  if (type === "csv") {
    const res = await parseCSV(buffer);
    return { filetype: "csv", ...res };
  }
  if (type === "json") {
    const res = parseJSON(buffer);
    return { filetype: "json", ...res };
  }
  const res = parseLogOrTxt(buffer);
  return { filetype: type === "log" ? "log" : "txt", ...res };
}

module.exports = {
  parseFile,
};
