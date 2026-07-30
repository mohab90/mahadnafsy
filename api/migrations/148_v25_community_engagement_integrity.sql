CREATE TABLE IF NOT EXISTS community_post_likes (
  tenant_id VARCHAR(64) NOT NULL,
  post_id VARCHAR(100) NOT NULL,
  subscriber_id VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, post_id, subscriber_id),
  INDEX idx_community_likes_post (tenant_id, post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_post_comments (
  id VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  post_id VARCHAR(100) NOT NULL,
  subscriber_id VARCHAR(100) NOT NULL,
  author VARCHAR(200) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_community_comments_post (tenant_id, post_id, created_at),
  INDEX idx_community_comments_subscriber (tenant_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
