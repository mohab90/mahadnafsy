CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  tenant_id VARCHAR(64) NOT NULL,
  status_key VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  show_in_pipeline TINYINT(1) NOT NULL DEFAULT 1,
  is_terminal TINYINT(1) NOT NULL DEFAULT 0,
  allowed_next_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,status_key),
  INDEX idx_crm_pipeline_order (tenant_id,show_in_pipeline,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO crm_pipeline_stages
  (tenant_id,status_key,label,position,show_in_pipeline,is_terminal,allowed_next_json)
SELECT tenants.tenant_id,defaults.status_key,defaults.label,defaults.position,
       defaults.show_in_pipeline,defaults.is_terminal,JSON_ARRAY('*')
FROM (
  SELECT tenant_id FROM leads
  UNION SELECT tenant_id FROM staff
) tenants
CROSS JOIN (
  SELECT 'new' status_key,'جديد' label,10 position,1 show_in_pipeline,0 is_terminal
  UNION ALL SELECT 'contacted','تم التواصل',20,0,0
  UNION ALL SELECT 'interested','مهتم',30,0,0
  UNION ALL SELECT 'interested_booking','مهتم بالحجز',40,1,0
  UNION ALL SELECT 'interested_followup','مهتم ومتابعة',50,1,0
  UNION ALL SELECT 'postpone_month','تأجيل أكثر من شهر',60,0,0
  UNION ALL SELECT 'no_answer','لا يرد',70,0,0
  UNION ALL SELECT 'no_answer_wa','لا يرد / واتس أرسل',80,1,0
  UNION ALL SELECT 'no_answer_nowa','لا يرد / بدون واتس',90,1,0
  UNION ALL SELECT 'wrong_number','رقم خطأ أو مغلق',100,0,1
  UNION ALL SELECT 'with_colleague','مع زميل آخر',110,0,0
  UNION ALL SELECT 'not_interested','غير مهتم',120,1,1
  UNION ALL SELECT 'not_interested_hidden','غير مهتم / مخفي',130,0,1
  UNION ALL SELECT 'closed','مغلق',140,0,1
  UNION ALL SELECT 'converted','تحول لمشترك',150,0,1
  UNION ALL SELECT 'lost','مفقود',160,0,1
  UNION ALL SELECT 'won','تم البيع',170,0,1
  UNION ALL SELECT 'unqualified','غير مؤهل',180,0,1
  UNION ALL SELECT 'disqualified','مستبعد',190,0,1
  UNION ALL SELECT 'archived','مؤرشف',200,0,1
  UNION ALL SELECT 'other','أخرى',210,0,0
) defaults;
