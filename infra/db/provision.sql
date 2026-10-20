-- Run once as the Render admin user on the shared Postgres instance (ADR 0001).
-- Replace the three passwords before running; keep them only in Render env vars.
CREATE ROLE shop_dev LOGIN PASSWORD 'CHANGE_ME_DEV' CONNECTION LIMIT 5;
CREATE ROLE shop_val LOGIN PASSWORD 'CHANGE_ME_VAL' CONNECTION LIMIT 5;
CREATE ROLE shop_prd LOGIN PASSWORD 'CHANGE_ME_PRD' CONNECTION LIMIT 20;

-- Postgres 16+: the (non-superuser) admin must be a member of a role to create a database it owns.
GRANT shop_dev TO current_user;
GRANT shop_val TO current_user;
GRANT shop_prd TO current_user;

CREATE DATABASE shop_dev OWNER shop_dev;
CREATE DATABASE shop_val OWNER shop_val;
CREATE DATABASE shop_prd OWNER shop_prd;

REVOKE CONNECT ON DATABASE shop_dev, shop_val, shop_prd FROM PUBLIC;
GRANT CONNECT ON DATABASE shop_dev TO shop_dev;
GRANT CONNECT ON DATABASE shop_val TO shop_val;
GRANT CONNECT ON DATABASE shop_prd TO shop_prd;
