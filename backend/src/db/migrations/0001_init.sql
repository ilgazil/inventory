-- Journal d'opérations (append-only) : unique source de vérité côté serveur.
CREATE TABLE IF NOT EXISTS ops (
  seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid       CHAR(36)     NOT NULL,
  device_id  VARCHAR(64)  NOT NULL,
  hlc        VARCHAR(96)  NOT NULL,
  type       VARCHAR(32)  NOT NULL,
  entity_id  CHAR(36)     NOT NULL,
  payload    JSON         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (seq),
  UNIQUE KEY uq_ops_uuid (uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cache des recherches produit par code-barres (Open Food Facts / Open Products Facts).
CREATE TABLE IF NOT EXISTS barcode_cache (
  barcode    VARCHAR(64)   NOT NULL,
  found      TINYINT(1)    NOT NULL,
  source     VARCHAR(32)   NOT NULL,
  name       VARCHAR(512)  NULL,
  brand      VARCHAR(255)  NULL,
  quantity   VARCHAR(64)   NULL,
  image_url  VARCHAR(1024) NULL,
  fetched_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (barcode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
