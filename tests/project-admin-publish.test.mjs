import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('admin publication binds the status and timestamps to the intended columns', async () => {
  const source = await readFile(new URL('../app/api/admin/projects/route.ts', import.meta.url), 'utf8');
  const sql = source.match(/prepare\("(UPDATE projects SET [^"]+)"\)/)?.[1];
  assert.ok(sql);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY,title TEXT,category TEXT,short_description TEXT,problem_statement TEXT,description TEXT,final_price_paise INTEGER,status TEXT,verified INTEGER,published_at TEXT,updated_at TEXT)');
    db.prepare('INSERT INTO projects (id,status,verified) VALUES (?,?,?)').run('review-test','PENDING_REVIEW',0);
    // Evaluate only the existing bind argument expression with controlled inputs.
    const args = source.match(/UPDATE projects SET[^;]+?\.bind\(([\s\S]+?)\)\.run\(\)/)?.[1];
    assert.ok(args);
    const values = new Function('body','price','status','now','id', `return [${args}];`)({ title:'Reviewed title',category:'AI',shortDescription:'Reviewed summary',problemStatement:'A problem',description:'Description' },100,'PUBLISHED','2026-09-12T00:00:00.000Z','review-test');
    db.prepare(sql).run(...values);
    const row = db.prepare('SELECT title,status,verified,final_price_paise,published_at,updated_at FROM projects WHERE id=?').get('review-test');
    assert.equal(row.title,'Reviewed title'); assert.equal(row.status,'PUBLISHED'); assert.equal(row.verified,1); assert.equal(row.final_price_paise,10000);
    assert.equal(row.published_at,'2026-09-12T00:00:00.000Z'); assert.equal(row.updated_at,row.published_at);
  } finally { db.close(); }
});
