-- Jalankan file ini JIKA database dapurmelty sudah dibuat sebelumnya.
USE dapurmelty;

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL AFTER is_active;

CREATE TABLE email_verification_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_verification_lookup (user_id, expires_at)
) ENGINE=InnoDB;
