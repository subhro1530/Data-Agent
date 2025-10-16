const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { parseFile } = require("../utils/fileParser");
const { summarize } = require("../services/geminiService");

function toKB(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

exports.upload = async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error('No file uploaded. Use form-data field "file".');
      err.status = 400;
      throw err;
    }

    const { originalname, mimetype, size, buffer } = req.file;
    const parsed = await parseFile({ buffer, originalname, mimetype });

    const metadata = {
      filename: originalname,
      filetype: parsed.filetype,
      size_kb: toKB(size),
      upload_timestamp: new Date().toISOString(),
      record_count: parsed.record_count,
      detected_columns: parsed.detected_columns || [],
    };

    const file_type_description = parsed.description || "";
    const apiKey = process.env.GEMINI_API_KEY || "";
    const ai_summary = await summarize({
      apiKey,
      parsedData: parsed.data,
      metadata,
    });

    // Persist to DB
    const id = uuidv4();
    const summaryJson = JSON.stringify(ai_summary);
    const rawJson = JSON.stringify(parsed.data);
    await db.query(
      `insert into processed_files (id, filename, filetype, size, summary_json, raw_json)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        id,
        metadata.filename,
        metadata.filetype,
        metadata.size_kb,
        summaryJson,
        rawJson,
      ]
    );

    const finalResponse = {
      id,
      metadata,
      file_type_description,
      raw_parsed_data: parsed.data,
      ai_summary,
    };

    res.status(201).json(finalResponse);
  } catch (e) {
    next(e);
  }
};

exports.list = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select id, filename, filetype, size as size_kb, uploaded_at, summary_json
       from processed_files
       order by uploaded_at desc`
    );
    const data = rows.map((r) => ({
      id: r.id,
      metadata: {
        filename: r.filename,
        filetype: r.filetype,
        size_kb: r.size_kb,
        upload_timestamp: r.uploaded_at,
      },
      ai_summary: r.summary_json,
    }));
    res.json(data);
  } catch (e) {
    next(e);
  }
};

exports.detail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `select id, filename, filetype, size as size_kb, uploaded_at, summary_json, raw_json
       from processed_files
       where id = $1
       limit 1`,
      [id]
    );
    if (!rows.length) {
      const err = new Error("Not found");
      err.status = 404;
      throw err;
    }
    const r = rows[0];
    res.json({
      id: r.id,
      metadata: {
        filename: r.filename,
        filetype: r.filetype,
        size_kb: r.size_kb,
        upload_timestamp: r.uploaded_at,
      },
      raw_parsed_data: r.raw_json,
      ai_summary: r.summary_json,
    });
  } catch (e) {
    next(e);
  }
};
