/* Local-demo seed: role_permissions (from auth-matrix) + region/branch/team + login users. Throwaway. */
const { Pool } = require('pg');
const argon2 = require('argon2');
const fs = require('fs');

const ORG = '00000000-0000-0000-0000-000000000001';
const SYS = '00000000-0000-0000-0000-000000000000';
const RID = {
  RM: '00000000-0000-0000-0000-0000000000a1', BM: '00000000-0000-0000-0000-0000000000a2',
  SM: '00000000-0000-0000-0000-0000000000a3', HEAD: '00000000-0000-0000-0000-0000000000a4',
  KYC: '00000000-0000-0000-0000-0000000000a5', DPO: '00000000-0000-0000-0000-0000000000a6',
  PARTNER: '00000000-0000-0000-0000-0000000000a7', ADMIN: '00000000-0000-0000-0000-0000000000a8',
  CUSTOMER: '00000000-0000-0000-0000-0000000000a9',
};
const REGION = '00000000-0000-0000-0000-0000000000c1';
const BRANCH = '00000000-0000-0000-0000-0000000000c2';
const TEAM = '00000000-0000-0000-0000-0000000000c3';
const BM_USER = '00000000-0000-0000-0000-0000000000e2';
const RM_USER = '00000000-0000-0000-0000-0000000000e1';

(async () => {
  const pool = new Pool({ connectionString: 'postgresql://app:app@localhost:55432/lms_dev' });
  const matrix = JSON.parse(fs.readFileSync('docs/contracts/auth-matrix.json', 'utf8')).capability_matrix;

  // role_permissions from the auth-matrix capability_matrix
  let rpCount = 0;
  for (const [role, caps] of Object.entries(matrix)) {
    const rid = RID[role];
    if (!rid) continue;
    for (const [cap, scope] of Object.entries(caps)) {
      await pool.query(
        `INSERT INTO role_permissions (org_id, role_id, capability, max_scope, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (role_id, capability) DO NOTHING`,
        [ORG, rid, cap, scope, SYS],
      );
      rpCount++;
    }
  }

  await pool.query(
    `INSERT INTO regions (region_id, org_id, code, name, created_by, updated_by)
     VALUES ($1,$2,'R1','Demo Region',$3,$3) ON CONFLICT DO NOTHING`,
    [REGION, ORG, SYS],
  );
  await pool.query(
    `INSERT INTO branches (branch_id, org_id, code, name, region_id, created_by, updated_by)
     VALUES ($1,$2,'B1','Demo Branch',$3,$4,$4) ON CONFLICT DO NOTHING`,
    [BRANCH, ORG, REGION, SYS],
  );

  const hash = await argon2.hash('Demo@12345');
  for (const [uid, uname, role, fullName] of [
    [BM_USER, 'bm', RID.BM, 'Demo Branch Manager'],
    [RM_USER, 'rm', RID.RM, 'Demo Relationship Manager'],
  ]) {
    await pool.query(
      `INSERT INTO users (user_id, org_id, username, email, full_name, password_hash, role_id, branch_id, mfa_enabled, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'active',$9,$9)
       ON CONFLICT (org_id, username) DO UPDATE SET password_hash = excluded.password_hash, status = 'active'`,
      [uid, ORG, uname, uname + '@demo.local', fullName, hash, role, BRANCH, SYS],
    );
  }

  await pool.query(
    `INSERT INTO teams (team_id, org_id, name, branch_id, created_by, updated_by)
     VALUES ($1,$2,'Demo Team',$3,$4,$4) ON CONFLICT DO NOTHING`,
    [TEAM, ORG, BRANCH, SYS],
  );

  const rp = await pool.query('SELECT count(*)::int AS n FROM role_permissions');
  const us = await pool.query("SELECT username, status FROM users WHERE username IN ('bm','rm') ORDER BY username");
  console.log('SEED OK — role_permissions:', rp.rows[0].n, '| users:', JSON.stringify(us.rows));
  await pool.end();
})().catch((e) => { console.error('SEED ERROR:', e.message); process.exit(1); });
