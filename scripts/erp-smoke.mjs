const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = globalThis;
await import('../erp/store.js');

const S = window.EduStore.init();
console.log('seeded -> users:', S.all('users').length, '| students:', S.all('students').length, '| faculty:', S.all('faculty').length, '| courses:', S.all('courses').length, '| attendance:', S.all('attendance').length, '| fees:', S.all('fees').length);

const st = S.add('students', { rollNo: 'T1', name: 'Test', dept: 'CSE', year: 1, sem: 1, totalFee: 50000 });
console.log('added student id:', !!st.id, '| count now:', S.all('students').length);
S.update('students', st.id, { name: 'Test2' });
console.log('updated name:', S.find('students', st.id).name);
S.remove('students', st.id);
console.log('removed, count:', S.all('students').length);

S.upsertAttendance('CS301', '2025-06-01', { '2021CS001': 'P', '2021CS002': 'A' });
const rec = S.where('attendance', (a) => a.courseCode === 'CS301' && a.date === '2025-06-01')[0];
console.log('attendance upserted:', rec.records['2021CS001'], rec.records['2021CS002']);
S.upsertAttendance('CS301', '2025-06-01', { '2021CS001': 'A' });
console.log('attendance re-upsert same day -> CS301/2025-06-01 records:', S.where('attendance', (a) => a.courseCode === 'CS301' && a.date === '2025-06-01').length, 'session(s)');
S.reset();
console.log('after reset, students:', S.all('students').length);
console.log('SMOKE OK');
