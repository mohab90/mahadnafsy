-- Keep the certificate lifecycle used by the admin UI representable in MySQL.
ALTER TABLE certificate_requests
  MODIFY COLUMN status ENUM(
    'PENDING',
    'PRICED',
    'PAID',
    'IN_PROGRESS',
    'NOT_SENT',
    'ISSUED',
    'SHIPPED',
    'AT_BRANCH',
    'DELIVERED'
  ) NOT NULL DEFAULT 'PENDING';
