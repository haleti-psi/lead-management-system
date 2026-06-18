/* Local-demo lead seed: wipe existing leads, create ~30 realistic leads via the
   API, then SQL-spread stage/owner/date + add stage-history, tasks, consents.
   Throwaway. Run: node apps/api/_seed_leads.cjs */
const { Pool } = require('pg');
const ORG = '00000000-0000-0000-0000-000000000001';
const SYS = '00000000-0000-0000-0000-000000000000';
const BM  = '00000000-0000-0000-0000-0000000000e2';
const RM  = '00000000-0000-0000-0000-0000000000e1';
const TEAM = '00000000-0000-0000-0000-0000000000c3';
const API = 'http://localhost:8080';

// name, mobile, product, source, amount, ctype, stage, owner, daysAgo
const R = (name, mobile, product, source, amount, ctype, stage, owner, daysAgo) =>
  ({ name, mobile, product, source, amount, ctype, stage, owner, daysAgo });
const LEADS = [
  R('Priya Sharma','9876500001','CV','Website',1200000,'business','qualified',RM,12),
  R('Rajesh Kumar','9876500002','CAR','Referral',850000,'individual','contacted',RM,9),
  R('Anita Desai','9876500003','TW','Branch',95000,'individual','captured',BM,0),
  R('Vikram Singh','9876500004','TRACTOR','Telecalling',650000,'individual','documents_pending',RM,18),
  R('Sunita Patel','9876500005','CE','Field',2500000,'business','kyc_in_progress',BM,22),
  R('Arjun Mehta','9876500006','CV','Website',1500000,'business','assigned',RM,3),
  R('Kavya Reddy','9876500007','CAR','Referral',780000,'individual','contacted',BM,7),
  R('Rohan Gupta','9876500008','TW','Website',88000,'individual','captured',BM,1),
  R('Deepa Nair','9876500009','TRACTOR','Field',720000,'individual','eligibility_requested',RM,25),
  R('Sanjay Verma','9876500010','CE','Branch',3200000,'business','ready_for_handoff',BM,28),
  R('Meera Iyer','9876500011','CV','Telecalling',1100000,'business','qualified',BM,11),
  R('Karthik Rao','9876500012','CAR','Website',920000,'individual','assigned',RM,4),
  R('Pooja Joshi','9876500013','TW','Referral',76000,'individual','captured',RM,0),
  R('Amit Shah','9876500014','TRACTOR','Branch',680000,'individual','contacted',BM,6),
  R('Neha Kapoor','9876500015','CE','Field',2800000,'business','kyc_in_progress',BM,20),
  R('Vivek Menon','9876500016','CV','Website',1350000,'business','documents_pending',RM,16),
  R('Shreya Das','9876500017','CAR','Telecalling',810000,'individual','assigned',BM,2),
  R('Manish Agarwal','9876500018','TW','Branch',91000,'individual','dormant',BM,35),
  R('Divya Pillai','9876500019','TRACTOR','Referral',640000,'individual','contacted',RM,8),
  R('Rahul Saxena','9876500020','CE','Website',3500000,'business','handed_off',BM,30),
  R('Anjali Bose','9876500021','CV','Field',1250000,'business','qualified',RM,13),
  R('Suresh Babu','9876500022','CAR','Branch',870000,'individual','captured',BM,1),
  R('Lakshmi Menon','9876500023','TW','Website',84000,'individual','assigned',RM,3),
  R('Gaurav Malhotra','9876500024','TRACTOR','Telecalling',700000,'individual','documents_pending',BM,17),
  R('Ritu Singh','9876500025','CE','Referral',2600000,'business','eligibility_requested',BM,24),
  R('Nikhil Jain','9876500026','CV','Website',1450000,'business','rejected',RM,14),
  R('Tara Krishnan','9876500027','CAR','Field',830000,'individual','contacted',BM,5),
  R('Aditya Roy','9876500028','TW','Branch',79000,'individual','captured',BM,0),
  R('Sneha Pillai','9876500029','CV','Website',500000,'business','consent_pending',RM,2),
  R('Harish Kumar','9876500030','TRACTOR','Referral',350000,'individual','assigned',BM,4),
];

const MAIN = ['captured','assigned','contacted','qualified','documents_pending','kyc_in_progress','eligibility_requested','ready_for_handoff','handed_off'];
function journey(stage) {
  if (stage === 'consent_pending') return ['captured','consent_pending'];
  if (stage === 'rejected') return ['captured','assigned','contacted','rejected'];
  if (stage === 'dormant') return ['captured','assigned','contacted','dormant'];
  const i = MAIN.indexOf(stage);
  return i >= 0 ? MAIN.slice(0, i + 1) : ['captured'];
}
const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, '.');
const daysFromNow = (d) => new Date(Date.now() - d * 86400000);

(async () => {
  const pool = new Pool({ connectionString: 'postgresql://app:app@localhost:55432/lms_dev' });

  // 1) login
  const lr = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bm', password: 'Demo@12345' }) });
  const token = (await lr.json()).data.access_token;
  if (!token) throw new Error('login failed');

  // 2) clean slate (clear RESTRICT children first, then cascade the rest)
  await pool.query('DELETE FROM data_sharing_logs');
  await pool.query('DELETE FROM consent_records');
  const del = await pool.query('DELETE FROM leads');
  console.log(`wiped ${del.rowCount} existing leads (+ cascade children)`);

  // 3) create via API
  const made = [];
  for (let i = 0; i < LEADS.length; i++) {
    const L = LEADS[i];
    const body = { product_code: L.product, identity: { name: L.name, mobile: L.mobile, email: `${slug(L.name)}@demo.local` }, source: { source: L.source }, branch_code: 'B1', requested_amount: L.amount, customer_type: L.ctype };
    const r = await fetch(`${API}/api/v1/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `seed-${i}-${L.mobile}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 201 && j.data && j.data.lead_id) made.push({ id: j.data.lead_id, L });
    else console.log('  create fail', L.name, r.status, JSON.stringify(j.error || '').slice(0, 100));
  }
  console.log(`created ${made.length}/${LEADS.length} leads via API`);

  // 4) spread stage / owner / date / sla + child rows
  const PRIO = ['low', 'normal', 'high'];
  let nTasks = 0, nConsents = 0, nHist = 0;
  for (let i = 0; i < made.length; i++) {
    const { id, L } = made[i];
    const createdAt = daysFromNow(L.daysAgo);
    const owner = L.owner;
    let sla = null;
    if (['assigned', 'contacted'].includes(L.stage)) sla = (i % 2 ? daysFromNow(-2) : daysFromNow(1)); // some breached (past), some future
    const losId = L.stage === 'handed_off' ? `LOS-APP-${100000 + i}` : null;
    await pool.query(
      `UPDATE leads SET stage=$2, owner_id=$3, team_id=$4, priority=$5, created_at=$6, updated_at=now(), updated_by=$7, sla_first_contact_due_at=$8, los_application_id=$9 WHERE lead_id=$1`,
      [id, L.stage, owner, TEAM, PRIO[i % 3], createdAt, owner, sla, losId],
    );

    // stage_history journey
    const path = journey(L.stage);
    for (let s = 0; s < path.length; s++) {
      const ts = new Date(createdAt.getTime() + s * 36 * 3600000); // ~1.5 days apart
      await pool.query(
        `INSERT INTO stage_history (lead_id, from_stage, to_stage, actor_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, s === 0 ? null : path[s - 1], path[s], s === 0 ? SYS : owner, ts > new Date() ? new Date() : ts],
      ).then(() => nHist++).catch((e) => { if (i === 0 && s === 0) console.log('  stage_history skip:', e.message.slice(0, 80)); });
    }

    // a task for mid-funnel leads
    const taskType = { assigned: 'call', contacted: 'call', qualified: 'callback', documents_pending: 'doc_request', kyc_in_progress: 'kyc_appt' }[L.stage];
    if (taskType) {
      const overdue = i % 3 === 0;
      await pool.query(
        `INSERT INTO tasks (lead_id, type, status, owner_id, due_at, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [id, taskType, overdue ? 'overdue' : 'open', owner, overdue ? daysFromNow(1) : daysFromNow(-2), owner],
      ).then(() => nTasks++).catch((e) => { if (i === 0) console.log('  task skip:', e.message.slice(0, 80)); });
    }

    // consents for qualified+ leads
    if (MAIN.indexOf(L.stage) >= MAIN.indexOf('qualified') || ['eligibility_requested', 'ready_for_handoff', 'handed_off'].includes(L.stage)) {
      for (const purpose of ['lead_contact', 'product_eligibility']) {
        await pool.query(
          `INSERT INTO consent_records (lead_id, purpose, state, channel, notice_version, consent_text_version, actor) VALUES ($1,$2,'granted',$3,'v1.0','v1.0',$4)`,
          [id, purpose, L.source === 'Website' ? 'website' : 'manual', owner === RM ? 'rm' : 'rm'],
        ).then(() => nConsents++).catch((e) => { if (i === 0) console.log('  consent skip:', e.message.slice(0, 80)); });
      }
    }
  }

  // 5) verify
  const stages = await pool.query('SELECT stage, count(*)::int n FROM leads GROUP BY stage ORDER BY n DESC');
  const owners = await pool.query(`SELECT CASE owner_id WHEN '${BM}' THEN 'bm' WHEN '${RM}' THEN 'rm' ELSE 'other' END o, count(*)::int n FROM leads GROUP BY 1 ORDER BY n DESC`);
  const tot = await pool.query('SELECT (SELECT count(*) FROM leads) leads, (SELECT count(*) FROM tasks) tasks, (SELECT count(*) FROM consent_records) consents, (SELECT count(*) FROM stage_history) hist');
  console.log('\nSTAGES:', stages.rows.map(r => `${r.stage}=${r.n}`).join(', '));
  console.log('OWNERS:', owners.rows.map(r => `${r.o}=${r.n}`).join(', '));
  console.log('TOTALS:', JSON.stringify(tot.rows[0]), `| tasks+${nTasks} consents+${nConsents} hist+${nHist}`);
  await pool.end();
})().catch((e) => { console.error('SEED ERROR:', e.message); process.exit(1); });
