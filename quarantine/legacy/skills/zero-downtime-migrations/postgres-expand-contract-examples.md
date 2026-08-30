# PostgreSQL Zero-Downtime Migration Recipes

SQL patterns for schema migrations on live production databases without table locks or service downtime.

---

## 1. Adding a Column with a Default Value

In modern PostgreSQL (v11+), adding a column with a constant `DEFAULT` is metadata-only and instantaneous.

```sql
-- Phase 1 (Expand)
ALTER TABLE users ADD COLUMN status_code VARCHAR(20) DEFAULT 'active' NOT NULL;
```

---

## 2. Renaming a Column (Expand -> Dual-Write -> Contract)

Never run `ALTER TABLE users RENAME COLUMN old_name TO new_name` on a live service.

### Phase 1: Add new column
```sql
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
```

### Phase 2: Dual-write trigger (or application-level dual-writing)
```sql
CREATE OR REPLACE FUNCTION sync_user_name()
RETURNS TRIGGER AS $$
BEGIN
  NEW.full_name := COALESCE(NEW.full_name, NEW.name);
  NEW.name := COALESCE(NEW.name, NEW.full_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_user_name
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION sync_user_name();
```

### Phase 3: Backfill data in batches
```sql
-- Run repeatedly in background batches until 0 rows updated
UPDATE users
SET full_name = name
WHERE id IN (
  SELECT id FROM users
  WHERE full_name IS NULL
  LIMIT 1000
);
```

### Phase 4: Switch app reads to `full_name`, drop trigger
```sql
DROP TRIGGER IF EXISTS trg_sync_user_name ON users;
DROP FUNCTION IF EXISTS sync_user_name();
```

### Phase 5: Drop old column
```sql
ALTER TABLE users DROP COLUMN name;
```

---

## 3. Creating Indexes Safely on Large Tables

Standard `CREATE INDEX` takes a table-level `SHARE` lock that blocks all `INSERT`, `UPDATE`, and `DELETE` queries.

```sql
-- Always use CONCURRENTLY
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

---

## 4. Adding Foreign Keys Safely

Adding a foreign key validates all existing rows, taking a strong lock for the duration of the scan.

```sql
-- Step 1: Add constraint without validating existing rows (instantaneous)
ALTER TABLE orders
ADD CONSTRAINT fk_orders_user_id
FOREIGN KEY (user_id) REFERENCES users(id)
NOT VALID;

-- Step 2: Validate existing rows in background (does not block writes)
ALTER TABLE orders
VALIDATE CONSTRAINT fk_orders_user_id;
```
