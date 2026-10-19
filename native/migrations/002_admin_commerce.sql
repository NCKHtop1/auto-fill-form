-- PandaStudy billing/admin commerce v2.
-- Additive migration: configurable packages, scheduled login promotions and immutable order snapshots.

ALTER TABLE ps_billing_orders ADD COLUMN IF NOT EXISTS package_id text;
ALTER TABLE ps_billing_orders ADD COLUMN IF NOT EXISTS package_name text;
ALTER TABLE ps_billing_orders ADD COLUMN IF NOT EXISTS package_badge text;
ALTER TABLE ps_billing_orders ADD COLUMN IF NOT EXISTS credited_quantity integer;
ALTER TABLE ps_billing_orders ADD COLUMN IF NOT EXISTS list_price_vnd bigint;

UPDATE ps_billing_orders
SET credited_quantity = CASE
      WHEN order_code LIKE 'PSSTART-%' THEN 20
      WHEN order_code LIKE 'PSPOPULAR-%' THEN 100
      WHEN order_code LIKE 'PSRESEARCH-%' THEN 250
      WHEN order_code LIKE 'PSPRO-%' THEN 500
      ELSE quantity
    END,
    package_id = CASE
      WHEN order_code LIKE 'PSSTART-%' THEN 'starter'
      WHEN order_code LIKE 'PSPOPULAR-%' THEN 'popular'
      WHEN order_code LIKE 'PSRESEARCH-%' THEN 'research'
      WHEN order_code LIKE 'PSPRO-%' THEN 'pro'
      ELSE package_id
    END,
    package_name = CASE
      WHEN order_code LIKE 'PSSTART-%' THEN 'Bắt đầu'
      WHEN order_code LIKE 'PSPOPULAR-%' THEN 'Phổ biến'
      WHEN order_code LIKE 'PSRESEARCH-%' THEN 'Nghiên cứu'
      WHEN order_code LIKE 'PSPRO-%' THEN 'Chuyên sâu'
      ELSE package_name
    END,
    package_badge = CASE
      WHEN order_code LIKE 'PSPOPULAR-%' THEN 'Phổ biến nhất'
      ELSE package_badge
    END,
    list_price_vnd = CASE
      WHEN order_code LIKE 'PSSTART-%' THEN 10000
      WHEN order_code LIKE 'PSPOPULAR-%' THEN 50000
      WHEN order_code LIKE 'PSRESEARCH-%' THEN 125000
      WHEN order_code LIKE 'PSPRO-%' THEN 250000
      ELSE COALESCE(list_price_vnd,amount_vnd)
    END
WHERE credited_quantity IS NULL OR list_price_vnd IS NULL;

ALTER TABLE ps_billing_orders ALTER COLUMN credited_quantity SET NOT NULL;
ALTER TABLE ps_billing_orders ALTER COLUMN list_price_vnd SET NOT NULL;

ALTER TABLE ps_billing_orders DROP CONSTRAINT IF EXISTS ps_billing_orders_check;
ALTER TABLE ps_billing_orders DROP CONSTRAINT IF EXISTS ps_billing_orders_unit_price_vnd_check;
ALTER TABLE ps_billing_orders DROP CONSTRAINT IF EXISTS ps_billing_orders_unit_price_positive_check;
ALTER TABLE ps_billing_orders DROP CONSTRAINT IF EXISTS ps_billing_orders_amount_positive_check;
ALTER TABLE ps_billing_orders
  ADD CONSTRAINT ps_billing_orders_amount_positive_check CHECK (amount_vnd > 0);
ALTER TABLE ps_billing_orders
  ADD CONSTRAINT ps_billing_orders_unit_price_positive_check CHECK (unit_price_vnd > 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ps_billing_orders_credited_quantity_check'
  ) THEN
    ALTER TABLE ps_billing_orders
      ADD CONSTRAINT ps_billing_orders_credited_quantity_check
      CHECK (credited_quantity BETWEEN 1 AND 1000000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ps_billing_orders_list_price_check'
  ) THEN
    ALTER TABLE ps_billing_orders
      ADD CONSTRAINT ps_billing_orders_list_price_check
      CHECK (list_price_vnd >= amount_vnd AND list_price_vnd > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ps_billing_packages (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  badge text NOT NULL DEFAULT '' CHECK (length(badge) <= 80),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 100000),
  price_vnd bigint NOT NULL CHECK (price_vnd > 0),
  list_price_vnd bigint NOT NULL CHECK (list_price_vnd >= price_vnd),
  featured boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ps_billing_packages_enabled_sort
  ON ps_billing_packages(enabled,sort_order,id);

INSERT INTO ps_billing_packages(id,name,badge,credits,price_vnd,list_price_vnd,featured,enabled,sort_order) VALUES
  ('starter','Bắt đầu','',20,10000,10000,false,true,10),
  ('popular','Phổ biến','Phổ biến nhất',100,45000,50000,true,true,20),
  ('research','Nghiên cứu','',250,110000,125000,false,true,30),
  ('pro','Chuyên sâu','',500,200000,250000,false,true,40)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ps_billing_promotions (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{3,48}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 1000000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES ps_billing_customers(id),
  updated_by uuid REFERENCES ps_billing_customers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS ps_billing_promotions_active
  ON ps_billing_promotions(enabled,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS ps_billing_promotion_grants (
  id uuid PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES ps_billing_promotions(id),
  customer_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  credits integer NOT NULL CHECK (credits > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(promotion_id,customer_id)
);
CREATE INDEX IF NOT EXISTS ps_billing_promotion_grants_customer
  ON ps_billing_promotion_grants(customer_id,granted_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ps_billing_ledger_check'
  ) THEN
    ALTER TABLE ps_billing_ledger DROP CONSTRAINT ps_billing_ledger_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ps_billing_ledger_check1'
  ) THEN
    ALTER TABLE ps_billing_ledger DROP CONSTRAINT ps_billing_ledger_check1;
  END IF;
END $$;

ALTER TABLE ps_billing_ledger DROP CONSTRAINT IF EXISTS ps_billing_ledger_kind_check;
ALTER TABLE ps_billing_ledger
  ADD CONSTRAINT ps_billing_ledger_kind_check
  CHECK (kind IN ('topup','promotion','reserve','consume','release'));

ALTER TABLE ps_billing_ledger DROP CONSTRAINT IF EXISTS ps_billing_ledger_delta_check;
ALTER TABLE ps_billing_ledger
  ADD CONSTRAINT ps_billing_ledger_delta_check CHECK (
    (kind IN ('topup','promotion') AND available_delta > 0 AND reserved_delta = 0) OR
    (kind = 'reserve' AND available_delta = -1 AND reserved_delta = 1) OR
    (kind = 'consume' AND available_delta = 0 AND reserved_delta = -1) OR
    (kind = 'release' AND available_delta = 1 AND reserved_delta = -1)
  );

CREATE TABLE IF NOT EXISTS ps_billing_config_audit (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  action text NOT NULL CHECK (action IN ('package_save','package_toggle','promotion_save','promotion_toggle')),
  entity_type text NOT NULL CHECK (entity_type IN ('package','promotion')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 120),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ps_billing_config_audit_created
  ON ps_billing_config_audit(created_at DESC);

INSERT INTO ps_billing_promotions(
  id,code,name,description,credits,starts_at,ends_at,enabled
) VALUES (
  '9f1c5f4a-5f96-4b2c-a4f5-102720260010',
  'WELCOME_OCT_2026',
  '10 phiếu trải nghiệm',
  'Tặng 10 phiếu một lần cho tài khoản đăng nhập trong thời gian ưu đãi.',
  10,
  '2026-10-19 23:40:00+07',
  '2026-10-28 00:00:00+07',
  true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO ps_billing_schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
