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

    // Persist initial record with status=processing and summary null
    const id = uuidv4();
    const rawJson = JSON.stringify(parsed.data);
    await db.query(
      `insert into processed_files (id, filename, filetype, size, summary_json, raw_json, status)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        id,
        metadata.filename,
        metadata.filetype,
        metadata.size_kb,
        null,
        rawJson,
        "processing",
      ]
    );

    // Respond immediately; frontend can poll /api/logs/:id for completion
    res.status(202).json({
      id,
      status: "processing",
      metadata,
      file_type_description,
    });

    // Background summarization (fire-and-forget)
    setImmediate(async () => {
      try {
        const ai_summary = await summarize({
          apiKey,
          parsedData: parsed.data,
          metadata,
        });
        const isObject = ai_summary && typeof ai_summary === "object";
        const isNonEmpty = isObject && Object.keys(ai_summary).length > 0;
        if (!isNonEmpty) {
          throw new Error("Empty summary received from Gemini");
        }
        const summaryJson = JSON.stringify(ai_summary);
        await db.query(
          `update processed_files
             set summary_json = $1::jsonb,
                 status = 'completed',
                 last_error = null
           where id = $2`,
          [summaryJson, id]
        );
      } catch (err) {
        console.error("[SUMMARY ERROR]", err);
        await db.query(
          `update processed_files
             set status = 'failed',
                 last_error = $1
           where id = $2`,
          [String(err && err.message ? err.message : err), id]
        );
      }
    });
  } catch (e) {
    next(e);
  }
};

exports.list = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select id, filename, filetype, size as size_kb, uploaded_at, summary_json, status
       from processed_files
       order by uploaded_at desc`
    );
    const data = rows.map((r) => ({
      id: r.id,
      status: r.status,
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
      `select id, filename, filetype, size as size_kb, uploaded_at, summary_json, raw_json, status, last_error
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
      status: r.status,
      metadata: {
        filename: r.filename,
        filetype: r.filetype,
        size_kb: r.size_kb,
        upload_timestamp: r.uploaded_at,
      },
      raw_parsed_data: r.raw_json,
      ai_summary: r.summary_json,
      last_error: r.last_error || null,
    });
  } catch (e) {
    next(e);
  }
};

// On-demand summarization for an existing record (GET/POST)
exports.summarizeNow = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `select id, filename, filetype, size as size_kb, uploaded_at, raw_json
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
    const data = r.raw_json;

    let record_count = 1;
    let detected_columns = [];
    if (Array.isArray(data)) {
      record_count = data.length;
      if (record_count && typeof data[0] === "object" && data[0] !== null) {
        detected_columns = Object.keys(data[0]);
      }
    } else if (data && typeof data === "object") {
      detected_columns = Object.keys(data);
    }

    const metadata = {
      filename: r.filename,
      filetype: r.filetype,
      size_kb: r.size_kb,
      upload_timestamp: r.uploaded_at,
      record_count,
      detected_columns,
    };

    await db.query(
      `update processed_files set status = 'processing', last_error = null where id = $1`,
      [id]
    );

    const apiKey = process.env.GEMINI_API_KEY || "";
    const ai_summary = await summarize({ apiKey, parsedData: data, metadata });

    if (
      !ai_summary ||
      typeof ai_summary !== "object" ||
      !Object.keys(ai_summary).length
    ) {
      throw new Error("Empty summary received from Gemini");
    }

    await db.query(
      `update processed_files
          set summary_json = $1::jsonb,
              status = 'completed',
              last_error = null
        where id = $2`,
      [JSON.stringify(ai_summary), id]
    );

    res.json({ id, status: "completed", ai_summary });
  } catch (e) {
    try {
      if (req.params?.id) {
        await db.query(
          `update processed_files set status = 'failed', last_error = $1 where id = $2`,
          [String(e && e.message ? e.message : e), req.params.id]
        );
      }
    } catch (_) {}
    next(e);
  }
};

// Delete a record
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `delete from processed_files where id = $1 returning id`,
      [id]
    );
    if (!result.rowCount) {
      const err = new Error("Not found");
      err.status = 404;
      throw err;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
};
