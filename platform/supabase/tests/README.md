# SQL isolation tests

Not migrations. Each script opens a transaction, inserts fixture rows, impersonates users, and ends with `RAISE EXCEPTION` so nothing commits.

Run against a database that already has the migrations, not against production if you can avoid it. The scripts roll back, but they still fire triggers inside the transaction.

```bash
psql "$DB_URL" -f platform/supabase/tests/isolation_tests_community.sql
psql "$DB_URL" -f platform/supabase/tests/isolation_tests_intelligence.sql
```

The result you want is an error whose message says all checks passed. A message that lists failed checks is a real failure.

`isolation_tests_intelligence.sql` expects `20261104100000_rls_tenant_isolation_intelligence.sql` to have been applied.
