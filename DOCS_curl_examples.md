# AI Data Agent — cURL examples

1. Service health

```bash
curl http://localhost:8080/health
# {
#   "status": "ok"
# }
```

2. API health (with DB check)

```bash
curl http://localhost:8080/api/health
# {
#   "status": "ok",
#   "timestamp": "2025-10-16T08:23:45.000Z",
#   "uptime_seconds": 1234,
#   "db": {
#     "status": "ok",
#     "now": "2025-10-16T08:23:45.000Z",
#     "version": "PostgreSQL 16.x ...",
#     "latency_ms": 8
#   }
# }
```

3. Upload CSV (field name must be "file")

```bash
curl -F "file=@D:\path\to\sample.csv" http://localhost:8080/api/upload
# 202 Accepted
# {
#   "id": "b9d4e3cd-0f2f-4c36-9b8b-6a13b9a2b1f0",
#   "status": "processing",
#   "metadata": {
#     "filename": "sample.csv",
#     "filetype": "csv",
#     "size_kb": 34.2,
#     "upload_timestamp": "2025-10-16T08:23:45.000Z",
#     "record_count": 250,
#     "detected_columns": ["date","amount","category","notes"]
#   },
#   "file_type_description": "CSV with 4 columns and 250 rows"
# }
```

4. Upload JSON

```bash
curl -F "file=@D:\path\to\data.json" http://localhost:8080/api/upload
# 202 Accepted
# {
#   "id": "2eab626b-e744-4a8a-be72-7387f30f8f84",
#   "status": "processing",
#   "metadata": {
#     "filename": "data.json",
#     "filetype": "json",
#     "size_kb": 12.7,
#     "upload_timestamp": "2025-10-16T08:24:10.000Z",
#     "record_count": 100,
#     "detected_columns": ["id","name","value"]
#   },
#   "file_type_description": "JSON array with 100 records"
# }
```

5. Upload LOG/TXT

```bash
curl -F "file=@D:\path\to\server.log" http://localhost:8080/api/upload
# 202 Accepted
# {
#   "id": "a1b2c3d4-1111-2222-3333-444455556666",
#   "status": "processing",
#   "metadata": {
#     "filename": "server.log",
#     "filetype": "log",
#     "size_kb": 48.9,
#     "upload_timestamp": "2025-10-16T08:25:01.000Z",
#     "record_count": 1200,
#     "detected_columns": ["timestamp","message"]
#   },
#   "file_type_description": "Log/TXT file with 1200 lines; statuses: 200, 403, 500"
# }
```

6. List processed entries

```bash
curl http://localhost:8080/api/logs
# [
#   {
#     "id": "b9d4e3cd-0f2f-4c36-9b8b-6a13b9a2b1f0",
#     "status": "completed",
#     "metadata": {
#       "filename": "sample.csv",
#       "filetype": "csv",
#       "size_kb": 34.2,
#       "upload_timestamp": "2025-10-16T08:23:45.000Z"
#     },
#     "ai_summary": {
#       "summary": "Monthly investment CSV with amounts and categories.",
#       "file_type_guess": "csv/finance",
#       "probable_domain": "finance",
#       "key_fields": ["date","amount","category"],
#       "insights": ["Amounts vary by month","Categories dominated by 'equity'"],
#       "anomalies": [],
#       "data_overview": { "records": 250, "columns": ["date","amount","category"], "notes": [] }
#     }
#   }
# ]
```

7. Get one entry by id

```bash
curl http://localhost:8080/api/logs/<id>
# {
#   "id": "<id>",
#   "status": "completed",
#   "metadata": {
#     "filename": "sample.csv",
#     "filetype": "csv",
#     "size_kb": 34.2,
#     "upload_timestamp": "2025-10-16T08:23:45.000Z"
#   },
#   "raw_parsed_data": [ { "date": "2024-01-01", "amount": 1000, "category": "equity" }, ... ],
#   "ai_summary": {
#     "summary": "Monthly investment CSV with amounts and categories.",
#     "file_type_guess": "csv/finance",
#     "probable_domain": "finance",
#     "key_fields": ["date","amount","category"],
#     "insights": ["Amounts vary by month","Categories dominated by 'equity'"],
#     "anomalies": [],
#     "data_overview": { "records": 250, "columns": ["date","amount","category"], "notes": [] }
#   },
#   "last_error": null
# }
```

8. Trigger on-demand summarization (POST)

```bash
curl -X POST http://localhost:8080/api/logs/<id>/summarize
# {
#   "id": "<id>",
#   "status": "completed",
#   "ai_summary": {
#     "summary": "Investment transactions with amounts and categories.",
#     "file_type_guess": "csv/finance",
#     "probable_domain": "finance",
#     "key_fields": ["date","amount","category"],
#     "insights": ["Stable monthly contributions","Few missing notes"],
#     "anomalies": ["Outlier detected in 2024-07"],
#     "data_overview": { "records": 250, "columns": ["date","amount","category"], "notes": [] }
#   }
# }
```

9. Trigger on-demand summarization (GET — browser-friendly)

```bash
curl http://localhost:8080/api/logs/<id>/summarize
# same response as POST
```

10. Delete a record

```bash
curl -X DELETE http://localhost:8080/api/logs/<id>
# 204 No Content
```

Notes:

- Replace <id> with the actual id returned from upload or list endpoints.
- Upload returns 202 and processes Gemini in the background; poll the detail endpoint until status is "completed" or "failed".
