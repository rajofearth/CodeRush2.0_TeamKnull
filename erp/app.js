// EduERP — application logic (vanilla JS, zero deps).
(function () {
  'use strict';

  const Store = window.EduStore.init();
  const DEPTS = ['CSE', 'ECE', 'ME', 'CE'];

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const state = {
    user: null,
    view: 'dashboard',
    search: '',
    att: { markCourse: null, markDate: today(), records: {}, reportCourse: null },
  };

  const paidFor = (rollNo) => Store.where('fees', (f) => f.rollNo === rollNo).reduce((s, f) => s + f.amount, 0);
  const attendanceStats = (courseCode) => {
    const course = Store.all('courses').find((c) => c.code === courseCode);
    const sessions = Store.where('attendance', (a) => a.courseCode === courseCode);
    const per = {};
    (course ? course.studentIds : []).forEach((r) => { per[r] = { p: 0, t: 0 }; });
    sessions.forEach((s) => {
      Object.entries(s.records || {}).forEach(([roll, v]) => {
        if (per[roll]) { per[roll].t += 1; if (v === 'P') per[roll].p += 1; }
      });
    });
    return { sessions, per };
  };

  /* ---------------- auth / roles ---------------- */
  const Auth = {
    login(username, password) {
      const u = Store.where('users', (x) => x.username === username && x.password === password)[0];
      if (!u) return null;
      localStorage.setItem('eduerp_session', u.id);
      return u;
    },
    current() {
      const id = localStorage.getItem('eduerp_session');
      return id ? Store.find('users', id) : null;
    },
    logout() { localStorage.removeItem('eduerp_session'); },
  };

  const can = (action) => {
    if (state.user && state.user.role === 'admin') return true;
    return action === 'manage-attendance'; // faculty: attendance only
  };

  /* ---------------- shell ---------------- */
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    state.user = Auth.current();
    $('#user-name').textContent = state.user.name;
    $('#user-role').textContent = state.user.role;
    if (!location.hash) location.hash = '#/dashboard';
    route();
  }

  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }

  /* ---------------- routing ---------------- */
  const TITLES = {
    dashboard: 'Dashboard', students: 'Students', faculty: 'Faculty',
    courses: 'Courses', attendance: 'Attendance', fees: 'Fees',
  };

  function route() {
    if (!Auth.current()) return showLogin();
    state.user = Auth.current();
    let view = (location.hash || '').replace('#/', '') || 'dashboard';
    if (!TITLES[view]) view = 'dashboard';
    // role-gate: faculty cannot open admin views
    if (state.user.role !== 'admin' && (view === 'faculty' || view === 'fees')) view = 'dashboard';
    state.view = view;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
    $('#view-title').textContent = TITLES[view];
    $('#topbar-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    renderView(view);
  }

  function renderView(view) {
    const v = $('#view');
    v.innerHTML = '';
    const node = document.createElement('div');
    node.innerHTML = VIEWS[view]();
    v.appendChild(node);
  }

  /* ---------------- views ---------------- */
  const VIEWS = {
    dashboard() {
      const students = Store.all('students');
      const faculty = Store.all('faculty');
      const courses = Store.all('courses');
      const fees = Store.all('fees');
      const paid = fees.reduce((s, f) => s + f.amount, 0);
      const totalDue = students.reduce((s, st) => s + st.totalFee, 0);
      const pending = totalDue - paid;

      // low attendance alerts
      const low = [];
      courses.forEach((c) => {
        const { per } = attendanceStats(c.code);
        Object.entries(per).forEach(([roll, v]) => {
          if (v.t >= 2) {
            const pct = (v.p / v.t) * 100;
            if (pct < 75) {
              const st = students.find((s) => s.rollNo === roll);
              low.push({ name: st ? st.name : roll, roll, course: c.code, pct });
            }
          }
        });
      });

      const recent = [...fees].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
      const recentRows = recent.map((f) => {
        const st = students.find((s) => s.rollNo === f.rollNo);
        return `<tr><td>${esc(f.rollNo)}</td><td>${esc(st ? st.name : '—')}</td><td>${fmt(f.amount)}</td><td>${fmtDate(f.date)}</td><td>${esc(f.method)}</td></tr>`;
      }).join('');

      return `
        <div class="stats">
          <div class="stat accent"><div class="val">${students.length}</div><div class="lbl">Students</div></div>
          <div class="stat blue"><div class="val">${faculty.length}</div><div class="lbl">Faculty</div></div>
          <div class="stat"><div class="val">${courses.length}</div><div class="lbl">Courses</div></div>
          <div class="stat warn"><div class="val">${fmt(paid)}</div><div class="lbl">Fees collected</div></div>
          <div class="stat danger"><div class="val">${fmt(pending)}</div><div class="lbl">Fees pending</div></div>
        </div>

        ${low.length ? `<div class="alert warn"><span>⚠️</span><div><span class="t">Low attendance (&lt;75%)</span><br/>${low.map((l) => `${esc(l.name)} (${l.roll}) — ${esc(l.course)} — ${Math.round(l.pct)}%`).join('<br/>')}</div></div>` : ''}

        <div class="card">
          <h3>Recent payments</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Roll no</th><th>Student</th><th>Amount</th><th>Date</th><th>Method</th></tr></thead>
              <tbody>${recentRows || '<tr><td colspan="5" class="empty">No payments yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>Quick actions</h3>
          <div class="toolbar">
            ${can('manage-students') ? '<button class="btn primary" data-action="add-student">+ Add student</button>' : ''}
            ${can('manage-courses') ? '<button class="btn" data-action="add-course">+ Add course</button>' : ''}
            <button class="btn" data-action="go-attendance">Mark attendance</button>
            ${can('manage-fees') ? '<button class="btn" data-action="go-fees">Record payment</button>' : ''}
          </div>
        </div>`;
    },

    students() {
      const rows = Store.all('students').map((s) => `
        <tr>
          <td><code>${esc(s.rollNo)}</code></td>
          <td>${esc(s.name)}</td>
          <td>${esc(s.dept)}</td>
          <td>Year ${s.year} · Sem ${s.sem}</td>
          <td>${esc(s.email)}<span class="sub">${esc(s.phone)}</span></td>
          <td>${fmt(s.totalFee)}</td>
          <td>
            <div class="row-actions">
              ${can('manage-students') ? `
                <button class="btn small" data-action="edit-student" data-id="${s.id}">Edit</button>
                <button class="btn small danger" data-action="delete-student" data-id="${s.id}">Delete</button>` : ''}
            </div>
          </td>
        </tr>`).join('');

      return `
        <div class="toolbar">
          <input class="search" data-search placeholder="🔍 Search by name, roll no, dept…" />
          ${can('manage-students') ? '<button class="btn primary" data-action="add-student">+ Add student</button>' : ''}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Roll no</th><th>Name</th><th>Dept</th><th>Year / Sem</th><th>Contact</th><th>Total fee</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty">No students yet</td></tr>'}</tbody>
          </table>
        </div>`;
    },

    faculty() {
      const rows = Store.all('faculty').map((f) => `
        <tr>
          <td><code>${esc(f.empId)}</code></td>
          <td>${esc(f.name)}</td>
          <td>${esc(f.dept)}</td>
          <td>${esc(f.designation)}</td>
          <td>${esc(f.email)}<span class="sub">${esc(f.phone)}</span></td>
          <td>
            <div class="row-actions">
              <button class="btn small" data-action="edit-faculty" data-id="${f.id}">Edit</button>
              <button class="btn small danger" data-action="delete-faculty" data-id="${f.id}">Delete</button>
            </div>
          </td>
        </tr>`).join('');

      return `
        <div class="toolbar">
          <input class="search" data-search placeholder="🔍 Search faculty…" />
          <button class="btn primary" data-action="add-faculty">+ Add faculty</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Emp ID</th><th>Name</th><th>Dept</th><th>Designation</th><th>Contact</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty">No faculty yet</td></tr>'}</tbody>
          </table>
        </div>`;
    },

    courses() {
      const facName = (id) => { const f = Store.find('faculty', id); return f ? f.name : '—'; };
      const rows = Store.all('courses').map((c) => `
        <tr>
          <td><code>${esc(c.code)}</code></td>
          <td>${esc(c.name)}</td>
          <td>${esc(c.dept)}</td>
          <td>${c.credits}</td>
          <td>${esc(facName(c.facultyId))}</td>
          <td>${c.studentIds.length}</td>
          <td>
            <div class="row-actions">
              ${can('manage-courses') ? `
                <button class="btn small" data-action="course-students" data-id="${c.id}">Students</button>
                <button class="btn small" data-action="edit-course" data-id="${c.id}">Edit</button>
                <button class="btn small danger" data-action="delete-course" data-id="${c.id}">Delete</button>` : ''}
            </div>
          </td>
        </tr>`).join('');

      return `
        <div class="toolbar">
          <input class="search" data-search placeholder="🔍 Search courses…" />
          ${can('manage-courses') ? '<button class="btn primary" data-action="add-course">+ Add course</button>' : ''}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Dept</th><th>Credits</th><th>Faculty</th><th>Students</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty">No courses yet</td></tr>'}</tbody>
          </table>
        </div>`;
    },

    attendance() {
      const courses = Store.all('courses');
      if (!state.att.markCourse && courses.length) state.att.markCourse = courses[0].code;
      if (!state.att.reportCourse && courses.length) state.att.reportCourse = courses[0].code;

      const courseOpts = (sel) => courses.map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('');

      // load current marking records
      state.att.records = loadMarking(state.att.markCourse, state.att.markDate);

      const course = courses.find((c) => c.code === state.att.markCourse);
      const enrolled = course ? course.studentIds : [];
      const stByRoll = Object.fromEntries(Store.all('students').map((s) => [s.rollNo, s]));
      const markRows = enrolled.map((roll) => {
        const st = stByRoll[roll];
        const val = state.att.records[roll] || 'P';
        return `<tr>
          <td><code>${esc(roll)}</code></td>
          <td>${esc(st ? st.name : roll)}</td>
          <td><div class="pa">
            <button class="${val === 'P' ? 'on-p' : ''}" data-action="pa-toggle" data-roll="${esc(roll)}" data-val="P">P</button>
            <button class="${val === 'A' ? 'on-a' : ''}" data-action="pa-toggle" data-roll="${esc(roll)}" data-val="A">A</button>
          </div></td>
        </tr>`;
      }).join('');

      // report for chosen course
      let reportHtml = '<div class="empty">Pick a course to see the report.</div>';
      if (state.att.reportCourse) {
        const { sessions, per } = attendanceStats(state.att.reportCourse);
        const sessionRows = sessions.slice().sort((a, b) => b.date.localeCompare(a.date)).map((s) => {
          const recs = Object.values(s.records || {});
          const p = recs.filter((v) => v === 'P').length;
          const pct = recs.length ? Math.round((p / recs.length) * 100) : 0;
          return `<tr><td>${fmtDate(s.date)}</td><td>${p} / ${recs.length}</td><td><span class="pill ${pct >= 75 ? 'ok' : 'bad'}">${pct}%</span></td></tr>`;
        }).join('');
        const studRows = Object.entries(per).map(([roll, v]) => {
          const st = stByRoll[roll];
          const pct = v.t ? Math.round((v.p / v.t) * 100) : 0;
          return `<tr><td><code>${esc(roll)}</code></td><td>${esc(st ? st.name : roll)}</td><td>${v.p} / ${v.t}</td><td><span class="pill ${pct >= 75 ? 'ok' : 'bad'}">${pct}%</span></td></tr>`;
        }).join('');
        reportHtml = `
          <div class="card"><h3>Sessions — ${esc(state.att.reportCourse)}</h3>
            <div class="table-wrap"><table><thead><tr><th>Date</th><th>Present</th><th>Rate</th></tr></thead>
            <tbody>${sessionRows || '<tr><td colspan="3" class="empty">No sessions recorded yet</td></tr>'}</tbody></table></div>
          </div>
          <div class="card"><h3>Per-student summary — ${esc(state.att.reportCourse)}</h3>
            <div class="table-wrap"><table><thead><tr><th>Roll no</th><th>Student</th><th>Present</th><th>Rate</th></tr></thead>
            <tbody>${studRows || '<tr><td colspan="4" class="empty">No students enrolled</td></tr>'}</tbody></table></div>
          </div>`;
      }

      return `
        <div class="card">
          <h3>Mark attendance</h3>
          <div class="toolbar">
            <label class="fld"><span>Course</span>
              <select id="att-course" style="width:240px">${courseOpts(state.att.markCourse)}</select>
            </label>
            <label class="fld"><span>Date</span>
              <input id="att-date" type="date" value="${state.att.markDate}" style="width:170px" />
            </label>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Roll no</th><th>Student</th><th>Present / Absent</th></tr></thead>
              <tbody>${markRows || '<tr><td colspan="3" class="empty">No students enrolled in this course</td></tr>'}</tbody>
            </table>
          </div>
          <div class="toolbar mt">
            <button class="btn primary" data-action="att-save">💾 Save attendance</button>
            <span style="color:var(--dim);font-size:.78rem">${enrolled.length} students · ${fmtDate(state.att.markDate)}</span>
          </div>
        </div>

        <div class="card">
          <h3>Attendance report</h3>
          <div class="toolbar">
            <label class="fld"><span>Course</span>
              <select id="att-report" style="width:240px">${courseOpts(state.att.reportCourse)}</select>
            </label>
          </div>
          <div id="report-area">${reportHtml}</div>
        </div>`;
    },

    fees() {
      const rows = Store.all('students').map((s) => {
        const paid = paidFor(s.rollNo);
        const bal = s.totalFee - paid;
        return `<tr>
          <td><code>${esc(s.rollNo)}</code></td>
          <td>${esc(s.name)}<span class="sub">${esc(s.dept)}</span></td>
          <td>${fmt(s.totalFee)}</td>
          <td><span class="pill ${paid >= s.totalFee ? 'ok' : 'info'}">${fmt(paid)}</span></td>
          <td><span class="pill ${bal > 0 ? 'bad' : 'ok'}">${fmt(bal)}</span></td>
          <td>
            <div class="row-actions">
              <button class="btn small" data-action="fee-pay" data-roll="${esc(s.rollNo)}">+ Payment</button>
              <button class="btn small" data-action="fee-ledger" data-roll="${esc(s.rollNo)}">Ledger</button>
            </div>
          </td>
        </tr>`;
      }).join('');

      const totalPaid = Store.all('fees').reduce((s, f) => s + f.amount, 0);
      const totalDue = Store.all('students').reduce((s, st) => s + st.totalFee, 0);

      return `
        <div class="stats">
          <div class="stat accent"><div class="val">${fmt(totalPaid)}</div><div class="lbl">Collected</div></div>
          <div class="stat danger"><div class="val">${fmt(totalDue - totalPaid)}</div><div class="lbl">Outstanding</div></div>
        </div>
        <div class="toolbar"><input class="search" data-search placeholder="🔍 Search by roll no or name…" /></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Roll no</th><th>Student</th><th>Total fee</th><th>Paid</th><th>Balance</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty">No students yet</td></tr>'}</tbody>
          </table>
        </div>`;
    },
  };

  /* ---------------- attendance marking ---------------- */
  function loadMarking(courseCode, date) {
    const existing = Store.where('attendance', (a) => a.courseCode === courseCode && a.date === date)[0];
    if (existing) return Object.assign({}, existing.records);
    const course = Store.all('courses').find((c) => c.code === courseCode);
    const rec = {};
    (course ? course.studentIds : []).forEach((r) => { rec[r] = 'P'; });
    return rec;
  }

  /* ---------------- modal helpers ---------------- */
  function openModal(title, bodyHtml, onSubmit, submitLabel) {
    $('#modal').classList.remove('hidden');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    const footer = $('#modal-footer');
    footer.innerHTML = `<button class="btn ghost" data-action="modal-cancel">Cancel</button>` +
      (onSubmit ? `<button type="submit" form="modal-form" class="btn primary">${submitLabel || 'Save'}</button>` : '');
    if (onSubmit) {
      const form = $('#modal-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        onSubmit(data);
      });
    }
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal-body').innerHTML = '';
    $('#modal-footer').innerHTML = '';
  }

  function confirmModal(title, msg, onYes) {
    $('#modal').classList.remove('hidden');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = `<p>${msg}</p>`;
    $('#modal-footer').innerHTML = `
      <button class="btn ghost" data-action="modal-cancel">Cancel</button>
      <button class="btn danger" id="confirm-yes">Yes, confirm</button>`;
    $('#confirm-yes').addEventListener('click', () => { closeModal(); onYes(); });
  }

  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- forms ---------------- */
  function studentForm(s) {
    s = s || {};
    return `
      <form id="modal-form" class="form-grid">
        <label class="fld"><span>Roll no *</span><input name="rollNo" required value="${esc(s.rollNo || '')}" placeholder="2025CS001" /></label>
        <label class="fld"><span>Full name *</span><input name="name" required value="${esc(s.name || '')}" /></label>
        <label class="fld"><span>Email</span><input name="email" type="email" value="${esc(s.email || '')}" /></label>
        <label class="fld"><span>Phone</span><input name="phone" value="${esc(s.phone || '')}" /></label>
        <label class="fld"><span>Department *</span>
          <select name="dept" required>${DEPTS.map((d) => `<option ${s.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>Year *</span>
          <select name="year" required>${[1, 2, 3, 4].map((y) => `<option value="${y}" ${s.year == y ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>Semester *</span>
          <select name="sem" required>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${s.sem == n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>Total fee (₹)</span><input name="totalFee" type="number" min="0" step="500" value="${s.totalFee || 50000}" /></label>
      </form>`;
  }

  function facultyForm(f) {
    f = f || {};
    return `
      <form id="modal-form" class="form-grid">
        <label class="fld"><span>Emp ID *</span><input name="empId" required value="${esc(f.empId || '')}" placeholder="FAC005" /></label>
        <label class="fld"><span>Full name *</span><input name="name" required value="${esc(f.name || '')}" /></label>
        <label class="fld"><span>Email</span><input name="email" type="email" value="${esc(f.email || '')}" /></label>
        <label class="fld"><span>Phone</span><input name="phone" value="${esc(f.phone || '')}" /></label>
        <label class="fld"><span>Department *</span>
          <select name="dept" required>${DEPTS.map((d) => `<option ${f.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>Designation *</span>
          <select name="designation" required>
            ${['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer', 'HOD'].map((x) => `<option ${f.designation === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </label>
      </form>`;
  }

  function courseForm(c) {
    c = c || {};
    const facOpts = Store.all('faculty').map((f) => `<option value="${f.id}" ${c.facultyId === f.id ? 'selected' : ''}>${esc(f.name)} (${esc(f.empId)})</option>`).join('');
    return `
      <form id="modal-form" class="form-grid">
        <label class="fld"><span>Course code *</span><input name="code" required value="${esc(c.code || '')}" placeholder="CS401" /></label>
        <label class="fld"><span>Course name *</span><input name="name" required value="${esc(c.name || '')}" /></label>
        <label class="fld"><span>Department *</span>
          <select name="dept" required>${DEPTS.map((d) => `<option ${c.dept === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>Credits *</span>
          <select name="credits" required>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${c.credits == n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label class="fld full"><span>Faculty</span><select name="facultyId"><option value="">— none —</option>${facOpts}</select></label>
      </form>`;
  }

  /* ---------------- actions ---------------- */
  const ACTIONS = {
    'modal-cancel': () => closeModal(),

    logout() {
      Auth.logout();
      closeModal();
      showLogin();
      location.hash = '';
    },

    'reset-data'() {
      confirmModal('Reset demo data', 'This wipes all changes and restores the seeded demo dataset. Continue?', () => {
        Store.reset();
        state.user = Auth.current();
        if (state.user && state.user.role !== 'admin') {
          Auth.logout();
          showLogin();
          location.hash = '';
        } else {
          route();
        }
        toast('Demo data restored');
      });
    },

    'add-student'() {
      if (!can('manage-students')) return;
      openModal('Add student', studentForm(), (data) => {
        if (Store.where('students', (s) => s.rollNo === data.rollNo.trim()).length) return toast('Roll no already exists', true);
        Store.add('students', { rollNo: data.rollNo.trim(), name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), dept: data.dept, year: +data.year, sem: +data.sem, totalFee: +data.totalFee || 50000 });
        closeModal(); route(); toast('Student added');
      }, 'Add student');
    },

    'edit-student'(el) {
      if (!can('manage-students')) return;
      const s = Store.find('students', el.dataset.id);
      if (!s) return;
      openModal('Edit student', studentForm(s), (data) => {
        const dup = Store.where('students', (x) => x.rollNo === data.rollNo.trim() && x.id !== s.id).length;
        if (dup) return toast('Roll no already exists', true);
        Store.update('students', s.id, { rollNo: data.rollNo.trim(), name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), dept: data.dept, year: +data.year, sem: +data.sem, totalFee: +data.totalFee || 50000 });
        closeModal(); route(); toast('Student updated');
      });
    },

    'delete-student'(el) {
      if (!can('manage-students')) return;
      const s = Store.find('students', el.dataset.id);
      if (!s) return;
      confirmModal('Delete student', `Delete <strong>${esc(s.name)}</strong> (${esc(s.rollNo)})? This also removes them from courses.`, () => {
        Store.all('courses').forEach((c) => {
          c.studentIds = c.studentIds.filter((r) => r !== s.rollNo);
          Store.update('courses', c.id, { studentIds: c.studentIds });
        });
        Store.remove('students', s.id);
        route(); toast('Student deleted');
      });
    },

    'add-faculty'() {
      if (!can('manage-faculty')) return;
      openModal('Add faculty', facultyForm(), (data) => {
        if (Store.where('faculty', (f) => f.empId === data.empId.trim()).length) return toast('Emp ID already exists', true);
        Store.add('faculty', { empId: data.empId.trim(), name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), dept: data.dept, designation: data.designation });
        closeModal(); route(); toast('Faculty added');
      }, 'Add faculty');
    },

    'edit-faculty'(el) {
      if (!can('manage-faculty')) return;
      const f = Store.find('faculty', el.dataset.id);
      if (!f) return;
      openModal('Edit faculty', facultyForm(f), (data) => {
        const dup = Store.where('faculty', (x) => x.empId === data.empId.trim() && x.id !== f.id).length;
        if (dup) return toast('Emp ID already exists', true);
        Store.update('faculty', f.id, { empId: data.empId.trim(), name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), dept: data.dept, designation: data.designation });
        closeModal(); route(); toast('Faculty updated');
      });
    },

    'delete-faculty'(el) {
      if (!can('manage-faculty')) return;
      const f = Store.find('faculty', el.dataset.id);
      if (!f) return;
      confirmModal('Delete faculty', `Delete <strong>${esc(f.name)}</strong>?`, () => {
        Store.remove('faculty', f.id);
        route(); toast('Faculty deleted');
      });
    },

    'add-course'() {
      if (!can('manage-courses')) return;
      openModal('Add course', courseForm(), (data) => {
        if (Store.where('courses', (c) => c.code === data.code.trim().toUpperCase()).length) return toast('Course code already exists', true);
        Store.add('courses', { code: data.code.trim().toUpperCase(), name: data.name.trim(), dept: data.dept, credits: +data.credits, facultyId: data.facultyId || null, studentIds: [] });
        closeModal(); route(); toast('Course added');
      }, 'Add course');
    },

    'edit-course'(el) {
      if (!can('manage-courses')) return;
      const c = Store.find('courses', el.dataset.id);
      if (!c) return;
      openModal('Edit course', courseForm(c), (data) => {
        const dup = Store.where('courses', (x) => x.code === data.code.trim().toUpperCase() && x.id !== c.id).length;
        if (dup) return toast('Course code already exists', true);
        Store.update('courses', c.id, { code: data.code.trim().toUpperCase(), name: data.name.trim(), dept: data.dept, credits: +data.credits, facultyId: data.facultyId || null });
        closeModal(); route(); toast('Course updated');
      });
    },

    'delete-course'(el) {
      if (!can('manage-courses')) return;
      const c = Store.find('courses', el.dataset.id);
      if (!c) return;
      confirmModal('Delete course', `Delete <strong>${esc(c.code)} — ${esc(c.name)}</strong>?`, () => {
        Store.remove('courses', c.id);
        route(); toast('Course deleted');
      });
    },

    'course-students'(el) {
      if (!can('manage-courses')) return;
      const c = Store.find('courses', el.dataset.id);
      if (!c) return;
      const checks = Store.all('students').map((s) => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px dashed var(--border)">
          <input type="checkbox" name="stu" value="${esc(s.rollNo)}" style="width:auto" ${c.studentIds.includes(s.rollNo) ? 'checked' : ''} />
          <span><code>${esc(s.rollNo)}</code> — ${esc(s.name)} <span class="sub">${esc(s.dept)}</span></span>
        </label>`).join('');
      openModal(`Enrolled students — ${esc(c.code)}`,
        `<form id="modal-form">${checks || '<p class="empty">No students in the system yet.</p>'}</form>`,
        (data) => {
          const stu = data.stu || [];
          Store.update('courses', c.id, { studentIds: Array.isArray(stu) ? stu : [stu] });
          closeModal(); route(); toast('Enrollment updated');
        }, 'Save enrollment');
    },

    'pa-toggle'(el) {
      const roll = el.dataset.roll;
      state.att.records[roll] = el.dataset.val;
      renderView('attendance'); // re-render toggles; selects preserved via state
    },

    'att-save'() {
      if (!state.att.markCourse) return toast('No course selected', true);
      Store.upsertAttendance(state.att.markCourse, state.att.markDate, state.att.records);
      toast(`Attendance saved for ${state.att.markCourse} · ${state.att.markDate}`);
    },

    'fee-pay'(el) {
      if (!can('manage-fees')) return;
      const st = Store.all('students').find((s) => s.rollNo === el.dataset.roll);
      if (!st) return;
      const bal = st.totalFee - paidFor(st.rollNo);
      openModal(`Record payment — ${esc(st.name)} (${esc(st.rollNo)})`, `
        <p style="color:var(--dim);margin-bottom:14px">Outstanding balance: <strong style="color:var(--warn)">${fmt(bal)}</strong></p>
        <form id="modal-form" class="form-grid">
          <label class="fld"><span>Amount (₹) *</span><input name="amount" type="number" min="1" step="100" required placeholder="10000" /></label>
          <label class="fld"><span>Date *</span><input name="date" type="date" required value="${today()}" /></label>
          <label class="fld"><span>Method *</span>
            <select name="method" required>${['UPI', 'Card', 'Cash', 'Bank Transfer', 'Cheque'].map((m) => `<option>${m}</option>`).join('')}</select>
          </label>
          <label class="fld full"><span>Note</span><input name="note" placeholder="Sem 1 installment…" /></label>
        </form>`,
        (data) => {
          const amount = +data.amount;
          if (!amount || amount <= 0) return toast('Enter a valid amount', true);
          Store.add('fees', { rollNo: st.rollNo, amount, date: data.date, method: data.method, note: data.note.trim() });
          closeModal(); route(); toast(`Payment of ${fmt(amount)} recorded`);
        }, 'Record payment');
    },

    'fee-ledger'(el) {
      const st = Store.all('students').find((s) => s.rollNo === el.dataset.roll);
      if (!st) return;
      const payments = Store.where('fees', (f) => f.rollNo === st.rollNo).sort((a, b) => b.date.localeCompare(a.date));
      const paid = payments.reduce((s, f) => s + f.amount, 0);
      const bal = st.totalFee - paid;
      const rows = payments.map((f) => `
        <div class="ledger-row">
          <span>${fmtDate(f.date)} · ${esc(f.method)}${f.note ? ' · ' + esc(f.note) : ''}</span>
          <span class="amt" style="color:var(--accent)">+${fmt(f.amount)}</span>
        </div>`).join('') || '<p class="empty">No payments yet</p>';
      openModal(`Fee ledger — ${esc(st.name)} (${esc(st.rollNo)})`, `
        <div style="display:flex;gap:10px;margin-bottom:14px">
          <span class="pill info">Total: ${fmt(st.totalFee)}</span>
          <span class="pill ok">Paid: ${fmt(paid)}</span>
          <span class="pill ${bal > 0 ? 'bad' : 'ok'}">Balance: ${fmt(bal)}</span>
        </div>
        <div>${rows}</div>`);
    },

    'go-attendance'() { location.hash = '#/attendance'; },
    'go-fees'() { location.hash = '#/fees'; },
  };

  /* ---------------- global events (delegation) ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el);
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#view tbody tr').forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'att-course') {
      state.att.markCourse = e.target.value;
      state.att.records = loadMarking(state.att.markCourse, state.att.markDate);
      renderView('attendance');
    } else if (e.target.id === 'att-date') {
      state.att.markDate = e.target.value;
      state.att.records = loadMarking(state.att.markCourse, state.att.markDate);
      renderView('attendance');
    } else if (e.target.id === 'att-report') {
      state.att.reportCourse = e.target.value;
      renderView('attendance');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  });

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const user = Auth.login(fd.get('username').trim(), fd.get('password'));
    if (!user) {
      $('#login-error').textContent = 'Invalid username or password';
      return;
    }
    $('#login-error').textContent = '';
    showApp();
  });

  window.addEventListener('hashchange', () => { if (Auth.current()) route(); });

  /* ---------------- boot ---------------- */
  showLogin();
  if (Auth.current()) showApp();
})();
