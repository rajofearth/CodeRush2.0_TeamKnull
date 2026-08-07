// EduERP — data layer. Plain localStorage, zero dependencies.
// Collections: users, students, faculty, courses, attendance, fees.
(function () {
  'use strict';

  const DB_KEY = 'eduerp_db_v1';
  const SEED_KEY = 'eduerp_seeded_v1';

  const uid = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  // date helper: today minus N days, as YYYY-MM-DD
  const d = (offset) => {
    const t = new Date();
    t.setDate(t.getDate() - offset);
    return t.toISOString().slice(0, 10);
  };

  const seed = () => ({
    users: [
      { id: uid(), username: 'admin', password: 'admin123', name: 'System Administrator', role: 'admin' },
      { id: uid(), username: 'faculty', password: 'faculty123', name: 'Dr. S. Raman', role: 'faculty' },
    ],
    students: [
      { id: uid(), rollNo: '2021CS001', name: 'Arjun Mehta',   email: 'arjun@college.edu',  phone: '9812340001', dept: 'CSE', year: 4, sem: 8, totalFee: 50000 },
      { id: uid(), rollNo: '2021CS002', name: 'Priya Sharma',  email: 'priya@college.edu',  phone: '9812340002', dept: 'CSE', year: 4, sem: 8, totalFee: 50000 },
      { id: uid(), rollNo: '2022CS014', name: 'Rahul Verma',   email: 'rahul@college.edu',  phone: '9812340003', dept: 'CSE', year: 3, sem: 6, totalFee: 50000 },
      { id: uid(), rollNo: '2022EC011', name: 'Sneha Patel',   email: 'sneha@college.edu',  phone: '9812340004', dept: 'ECE', year: 3, sem: 6, totalFee: 50000 },
      { id: uid(), rollNo: '2022EC022', name: 'Vikram Singh',  email: 'vikram@college.edu', phone: '9812340005', dept: 'ECE', year: 3, sem: 6, totalFee: 50000 },
      { id: uid(), rollNo: '2023ME007', name: 'Ananya Iyer',   email: 'ananya@college.edu', phone: '9812340006', dept: 'ME',  year: 2, sem: 4, totalFee: 50000 },
      { id: uid(), rollNo: '2023ME018', name: 'Karthik Rao',   email: 'karthik@college.edu',phone: '9812340007', dept: 'ME',  year: 2, sem: 4, totalFee: 50000 },
      { id: uid(), rollNo: '2024CE005', name: 'Divya Nair',    email: 'divya@college.edu',  phone: '9812340008', dept: 'CE',  year: 1, sem: 2, totalFee: 50000 },
    ],
    faculty: [
      { id: uid(), empId: 'FAC001', name: 'Dr. S. Raman',     email: 's.raman@college.edu',    phone: '9822000001', dept: 'CSE', designation: 'Professor' },
      { id: uid(), empId: 'FAC002', name: 'Dr. L. Gupta',     email: 'l.gupta@college.edu',     phone: '9822000002', dept: 'ECE', designation: 'Associate Professor' },
      { id: uid(), empId: 'FAC003', name: 'Prof. M. Desai',   email: 'm.desai@college.edu',     phone: '9822000003', dept: 'ME',  designation: 'Assistant Professor' },
      { id: uid(), empId: 'FAC004', name: 'Dr. P. Joshi',     email: 'p.joshi@college.edu',     phone: '9822000004', dept: 'CE',  designation: 'Professor' },
    ],
    courses: [
      { id: uid(), code: 'CS301', name: 'Data Structures',          dept: 'CSE', credits: 4, facultyId: null, studentIds: ['2021CS001', '2021CS002', '2022CS014'] },
      { id: uid(), code: 'CS401', name: 'Operating Systems',        dept: 'CSE', credits: 4, facultyId: null, studentIds: ['2021CS001', '2021CS002'] },
      { id: uid(), code: 'EC301', name: 'Digital Signal Processing',dept: 'ECE', credits: 3, facultyId: null, studentIds: ['2022EC011', '2022EC022'] },
      { id: uid(), code: 'ME302', name: 'Thermodynamics',           dept: 'ME',  credits: 3, facultyId: null, studentIds: ['2023ME007', '2023ME018'] },
      { id: uid(), code: 'CE201', name: 'Surveying',                dept: 'CE',  credits: 3, facultyId: null, studentIds: ['2024CE005'] },
      { id: uid(), code: 'CS201', name: 'OOP with Java',            dept: 'CSE', credits: 4, facultyId: null, studentIds: ['2022CS014', '2021CS001', '2021CS002'] },
    ],
    attendance: [
      { id: uid(), courseCode: 'CS301', date: d(6), records: { '2021CS001': 'P', '2021CS002': 'P', '2022CS014': 'A' } },
      { id: uid(), courseCode: 'CS301', date: d(4), records: { '2021CS001': 'P', '2021CS002': 'P', '2022CS014': 'A' } },
      { id: uid(), courseCode: 'CS301', date: d(2), records: { '2021CS001': 'P', '2021CS002': 'A', '2022CS014': 'P' } },
      { id: uid(), courseCode: 'EC301', date: d(5), records: { '2022EC011': 'P', '2022EC022': 'A' } },
      { id: uid(), courseCode: 'CS201', date: d(3), records: { '2022CS014': 'P', '2021CS001': 'P', '2021CS002': 'P' } },
    ],
    fees: [
      { id: uid(), rollNo: '2021CS001', amount: 25000, date: '2025-01-05', method: 'UPI',   note: 'Sem 1 installment' },
      { id: uid(), rollNo: '2021CS001', amount: 25000, date: '2025-02-10', method: 'Card',  note: 'Sem 2 installment' },
      { id: uid(), rollNo: '2021CS002', amount: 50000, date: '2025-01-08', method: 'Bank Transfer', note: 'Full year' },
      { id: uid(), rollNo: '2022CS014', amount: 20000, date: '2025-01-12', method: 'Cash',  note: 'Partial' },
      { id: uid(), rollNo: '2022EC011', amount: 50000, date: '2025-01-15', method: 'UPI',   note: 'Full year' },
      { id: uid(), rollNo: '2022EC022', amount: 15000, date: '2025-02-01', method: 'Card',  note: 'Partial' },
      { id: uid(), rollNo: '2023ME007', amount: 25000, date: '2025-01-20', method: 'UPI',   note: 'Half year' },
      { id: uid(), rollNo: '2024CE005', amount: 10000, date: '2025-02-05', method: 'Cash',  note: 'Registration' },
    ],
  });

  let db = null;

  function load() {
    if (!localStorage.getItem(SEED_KEY)) {
      const s = seed();
      localStorage.setItem(DB_KEY, JSON.stringify(s));
      localStorage.setItem(SEED_KEY, '1');
      return s;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(DB_KEY));
      if (parsed && parsed.users && parsed.students) return parsed;
    } catch (_) { /* fall through to reseed */ }
    const s = seed();
    localStorage.setItem(DB_KEY, JSON.stringify(s));
    return s;
  }

  function save() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  window.EduStore = {
    uid,

    init() { db = db || load(); return this; },

    all(name) { return db[name]; },
    find(name, id) { return db[name].find((x) => x.id === id); },
    where(name, fn) { return db[name].filter(fn); },

    add(name, item) {
      item.id = item.id || uid();
      db[name].push(item);
      save();
      return item;
    },
    update(name, id, patch) {
      const i = db[name].findIndex((x) => x.id === id);
      if (i < 0) return null;
      db[name][i] = Object.assign({}, db[name][i], patch);
      save();
      return db[name][i];
    },
    remove(name, id) {
      db[name] = db[name].filter((x) => x.id !== id);
      save();
    },

    upsertAttendance(courseCode, date, records) {
      const i = db.attendance.findIndex((a) => a.courseCode === courseCode && a.date === date);
      if (i >= 0) db.attendance[i].records = records;
      else db.attendance.push({ id: uid(), courseCode, date, records });
      save();
    },

    reset() {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(SEED_KEY);
      db = seed();
      save();
    },
  };
})();
