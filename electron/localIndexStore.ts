import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS image_index (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    taken_at TEXT,
    lat REAL,
    lon REAL,
    altitude REAL,
    place_name TEXT,
    country TEXT,
    description TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    combined_text TEXT NOT NULL,
    text_embedding_model TEXT,
    combined_text_embedding BLOB,
    embedding_backend TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_image_index_relative_path
    ON image_index(relative_path);

CREATE INDEX IF NOT EXISTS idx_image_index_taken_at
    ON image_index(taken_at);

CREATE INDEX IF NOT EXISTS idx_image_index_place_name
    ON image_index(place_name);
`;

export interface StoredImageRecordTransport {
  id: string;
  sha256: string;
  filename: string;
  relative_path: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  place_name: string | null;
  country: string | null;
  description: string;
  tags: string[];
  combined_text: string;
  text_embedding_model: string | null;
  combined_text_embedding_b64: string | null;
  embedding_backend: string;
  embedding_b64: string;
  created_at: string;
  updated_at: string;
}

export class LocalIndexStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.db.exec(CREATE_TABLE_SQL);
    this.db.exec(INDEXES_SQL);
  }

  hasSha256(sha256: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM image_index WHERE sha256 = ? LIMIT 1")
      .get(sha256);
    return row !== undefined;
  }

  upsert(record: StoredImageRecordTransport): void {
    this.deleteByRelativePath(record.relative_path, record.id);

    this.db
      .prepare(
        `
        INSERT INTO image_index (
            id,
            sha256,
            filename,
            relative_path,
            mime_type,
            file_size,
            width,
            height,
            taken_at,
            lat,
            lon,
            altitude,
            place_name,
            country,
            description,
            tags_json,
            combined_text,
            text_embedding_model,
            combined_text_embedding,
            embedding_backend,
            embedding,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            filename = excluded.filename,
            relative_path = excluded.relative_path,
            mime_type = excluded.mime_type,
            file_size = excluded.file_size,
            width = excluded.width,
            height = excluded.height,
            taken_at = excluded.taken_at,
            lat = excluded.lat,
            lon = excluded.lon,
            altitude = excluded.altitude,
            place_name = excluded.place_name,
            country = excluded.country,
            description = excluded.description,
            tags_json = excluded.tags_json,
            combined_text = excluded.combined_text,
            text_embedding_model = excluded.text_embedding_model,
            combined_text_embedding = excluded.combined_text_embedding,
            embedding_backend = excluded.embedding_backend,
            embedding = excluded.embedding,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        record.id,
        record.sha256,
        record.filename,
        record.relative_path,
        record.mime_type,
        record.file_size,
        record.width,
        record.height,
        record.taken_at,
        record.lat,
        record.lon,
        record.altitude,
        record.place_name,
        record.country,
        record.description,
        JSON.stringify(record.tags),
        record.combined_text,
        record.text_embedding_model,
        this.decodeOptionalBuffer(record.combined_text_embedding_b64),
        record.embedding_backend,
        Buffer.from(record.embedding_b64, "base64"),
        record.created_at,
        record.updated_at,
      );
  }

  close(): void {
    this.db.close();
  }

  private deleteByRelativePath(relativePath: string, keepId: string): void {
    this.db
      .prepare("DELETE FROM image_index WHERE relative_path = ? AND id != ?")
      .run(relativePath, keepId);
  }

  private decodeOptionalBuffer(value: string | null): Buffer | null {
    if (!value) {
      return null;
    }
    return Buffer.from(value, "base64");
  }

  get path(): string {
    return this.dbPath;
  }
}
