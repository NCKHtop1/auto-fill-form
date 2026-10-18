-- PandaStudy billing v1. Apply once through scripts/migrate-billing.js.
-- The runner wraps this migration in a PostgreSQL transaction.
CREATE TABLE IF NOT EXISTS ps_billing_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ps_billing_customers (
  id uuid PRIMARY KEY,
  google_sub text NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  reserved_credits bigint NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_credits + reserved_credits <= 9007199254740991)
);

CREATE TABLE IF NOT EXISTS ps_billing_orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  order_code text NOT NULL UNIQUE,
  request_key text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  unit_price_vnd integer NOT NULL CHECK (unit_price_vnd = 500),
  amount_vnd bigint NOT NULL CHECK (amount_vnd = quantity::bigint * unit_price_vnd),
  bank_id text NOT NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_name text NOT NULL,
  payment_memo text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','pending_review','approved','rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES ps_billing_customers(id),
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, request_key),
  CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ps_billing_orders_customer_created
  ON ps_billing_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ps_billing_orders_review_queue
  ON ps_billing_orders(status, created_at);

CREATE TABLE IF NOT EXISTS ps_billing_bank_payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES ps_billing_orders(id),
  bank_id text NOT NULL,
  account_number text NOT NULL,
  reference_norm text NOT NULL CHECK (length(reference_norm) BETWEEN 3 AND 120),
  reference_original text NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  verified_by uuid NOT NULL REFERENCES ps_billing_customers(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bank_id, account_number, reference_norm)
);

CREATE TABLE IF NOT EXISTS ps_billing_operations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  operation_key text NOT NULL,
  form_id text NOT NULL,
  payload_hash char(64) NOT NULL,
  claim_token uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('dispatching','unknown','consumed','released')),
  credits integer NOT NULL DEFAULT 1 CHECK (credits = 1),
  result_json jsonb,
  dispatch_started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  resolved_by uuid REFERENCES ps_billing_customers(id),
  resolution_evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, operation_key),
  CHECK ((status IN ('consumed','released')) = (settled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ps_billing_operations_pending
  ON ps_billing_operations(status, dispatch_started_at);

CREATE TABLE IF NOT EXISTS ps_billing_ledger (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  kind text NOT NULL CHECK (kind IN ('topup','reserve','consume','release')),
  source_id uuid NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  available_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_delta <> 0 OR reserved_delta <> 0),
  CHECK (
    (kind = 'topup' AND available_delta > 0 AND reserved_delta = 0) OR
    (kind = 'reserve' AND available_delta = -1 AND reserved_delta = 1) OR
    (kind = 'consume' AND available_delta = 0 AND reserved_delta = -1) OR
    (kind = 'release' AND available_delta = 1 AND reserved_delta = -1)
  )
);
CREATE INDEX IF NOT EXISTS ps_billing_ledger_customer_created
  ON ps_billing_ledger(customer_id, created_at);

CREATE TABLE IF NOT EXISTS ps_billing_admin_actions (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES ps_billing_customers(id),
  action text NOT NULL CHECK (action IN ('approve','reject','resolve_consume','resolve_release')),
  target_id uuid NOT NULL,
  request_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  evidence text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, request_key)
);

CREATE TABLE IF NOT EXISTS ps_billing_outbox (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES ps_billing_orders(id),
  dedupe_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type = 'topup_submitted'),
  recipient text NOT NULL,
  payload_json jsonb NOT NULL,
  message_json jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','retry','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  failure_code text,
  delivery_uncertain boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, event_type, recipient)
);
CREATE INDEX IF NOT EXISTS ps_billing_outbox_pending
  ON ps_billing_outbox(status, next_attempt_at);
ALTER TABLE ps_billing_outbox ADD COLUMN IF NOT EXISTS message_json jsonb;

INSERT INTO ps_billing_schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
