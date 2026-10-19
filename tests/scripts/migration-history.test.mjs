import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
// Ignore CRLF/LF and terminal empty statements, not arbitrary SQL whitespace.
const normalizeHistoricalSql = sql => sql.replace(/\r\n/g, '\n').trim().replace(/(?:;\s*)+$/, ';');

test('historical SQL keeps its verified normalized content digest', () => {
  const sql = readFileSync(new URL('20260820155850_activity_expense_reminder_backfill.sql', directory), 'utf8');
  const hash = createHash('sha256').update(normalizeHistoricalSql(sql)).digest('hex');
  assert.equal(hash, 'c2e125ea22c78aa29213be5ac554a4fb021f5f137863d2822af53c70acf12291');
  assert.equal(normalizeHistoricalSql('select 1;\r\n;\r\n'), normalizeHistoricalSql('select 1;\n'));
});

test('historical backfill uses the observed hosted version, not a second identity', () => {
  assert.ok(existsSync(new URL('20260820155850_activity_expense_reminder_backfill.sql', directory)));
  assert.equal(existsSync(new URL('202608210001_activity_expense_reminder_backfill.sql', directory)), false);
});

test('migration versions are unique and the historical backfill has one identity', () => {
  const versions = files.map(file => file.split('_')[0]);
  assert.equal(new Set(versions).size, versions.length);
  assert.equal(files.filter(file => file.endsWith('_activity_expense_reminder_backfill.sql')).length, 1);
});

test('the observed hosted boundary has exactly eight ordered transactional successors', () => {
  const pending = files.filter(file => file > '20261017031547_personal_account_opening_foundation.sql');
  assert.deepEqual(pending, [
    '20261018060819_personal_account_read_model.sql',
    '20261018061919_personal_account_management.sql',
    '20261019055603_personal_pilot_access.sql',
    '20261019063444_personal_single_book.sql',
    '20261019081156_personal_categories.sql',
    '20261019110133_personal_entry_batches.sql',
    '20261019132245_shop_aggregate_read_models.sql',
    '20261019140721_shop_read_page_capacity.sql',
  ]);
  for (const file of pending) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/^\s*--.*$/gm, '').trim();
    assert.match(sql, /^begin\s*;/i, file);
    assert.match(sql, /commit\s*;\s*$/i, file);
  }
});
