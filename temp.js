
    /* ── DATA STORE ── */
    let SESSIONS = {};
    let activeSubject = null;
    let timerInterval = null;
    let currentUser = null;
    let cloudSaveTimer = null;
    let authMode = 'login';

    const SCHEMES = {
      'ssc_t1': { name: 'SSC Tier-1 (+2 / -0.5)', pos: 2, neg: 0.5 },
      'ssc_t2': { name: 'SSC Tier-2 (+3 / -1.0)', pos: 3, neg: 1.0 },
      'upsc':   { name: 'UPSC (+2 / -0.66)', pos: 2, neg: 0.66 },
      'bank':   { name: 'Banking (+1 / -0.25)', pos: 1, neg: 0.25 },
      'none':   { name: 'Standard (+1 / 0)', pos: 1, neg: 0 }
    };

    /* ── STORAGE: LOCAL + CLOUD SYNC ── */
    function loadLocalSessions() {
      const raw = localStorage.getItem('mcq_all_sessions');
      if (raw) {
        try { SESSIONS = JSON.parse(raw); } catch (e) { SESSIONS = {}; }
      } else {
        // Migrate old individual keys if present
        SESSIONS = {};
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('mq_') && !k.startsWith('mq_marks_') && !k.startsWith('mq_meta_') && k !== 'mq_dark' && k !== 'mcq_theme') {
            const name = k.replace('mq_', '');
            const answers = JSON.parse(localStorage.getItem(k) || '{}');
            const marks = JSON.parse(localStorage.getItem('mq_marks_' + name) || '{}');
            SESSIONS[name] = {
              name,
              currentQ: Object.keys(answers).length ? Math.max(...Object.keys(answers).map(Number)) + 1 : 1,
              answers,
              marks,
              scheme: 'ssc_t1',
              undoStack: [],
              redoStack: []
            };
          }
        });
        saveLocalOnly();
      }
    }

    function saveLocalOnly() {
      localStorage.setItem('mcq_all_sessions', JSON.stringify(SESSIONS));
    }

    async function loadAllSessions() {
      loadLocalSessions();
      if (!currentUser) return;

      try {
        const res = await fetch('/api/mcq-sessions');
        if (res.ok) {
          const data = await res.json();
          const cloud = data.sessions || {};
          const local = { ...SESSIONS };

          if (Object.keys(cloud).length > 0) {
            // Merge: local unique sessions preserved, cloud wins for conflicts
            SESSIONS = { ...local, ...cloud };
            saveLocalOnly();
            // If local had unique sessions not in cloud, push merged data
            const localOnlyKeys = Object.keys(local).filter(k => !cloud[k]);
            if (localOnlyKeys.length > 0) cloudSaveNow();
          } else if (Object.keys(local).length > 0) {
            // Cloud is empty but local has data — push to cloud
            cloudSaveNow();
          }
        }
      } catch (e) {
        console.error('Cloud load failed, using local data:', e);
      }
    }

    function saveAllSessions() {
      saveLocalOnly();
      if (currentUser) debouncedCloudSave();
    }

    /* ── THEME ── */
    function toggleTheme() {
      document.body.classList.toggle('light');
      localStorage.setItem('mcq_theme', document.body.classList.contains('light') ? 'light' : 'dark');
    }
    if (localStorage.getItem('mcq_theme') === 'light') document.body.classList.add('light');

    /* ── HOME SCREEN METRICS ── */
    function renderHomeScreen() {
      let totalQ = 0, totalCorrect = 0, totalWrong = 0, totalTimeSec = 0;

      Object.values(SESSIONS).forEach(s => {
        Object.entries(s.answers || {}).forEach(([q, d]) => {
          totalQ++;
          totalTimeSec += d.raw || 0;
          if (s.marks && s.marks[q] === 'tick') totalCorrect++;
          if (s.marks && s.marks[q] === 'cross') totalWrong++;
        });
      });

      const evaluated = totalCorrect + totalWrong;
      const accuracy = evaluated > 0 ? ((totalCorrect / evaluated) * 100).toFixed(1) + '%' : '—';
      const avgTimeSec = totalQ > 0 ? totalTimeSec / totalQ : 0;

      document.getElementById('g-total-q').textContent = totalQ;
      document.getElementById('g-accuracy').textContent = accuracy;
      document.getElementById('g-total-correct').textContent = totalCorrect;
      document.getElementById('g-total-wrong').textContent = totalWrong;
      document.getElementById('g-total-time').textContent = fmtTime(totalTimeSec);
      document.getElementById('g-avg-time').textContent = fmtTime(avgTimeSec);

      // Render Sessions List
      const list = document.getElementById('sessions-list');
      list.innerHTML = '';
      const names = Object.keys(SESSIONS);

      if (!names.length) {
        list.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text3);">No active practice sessions. Add one above!</div>`;
        return;
      }

      names.forEach(name => {
        const s = SESSIONS[name];
        const count = Object.keys(s.answers || {}).length;
        let c = 0, w = 0;
        Object.keys(s.marks || {}).forEach(k => {
          if (s.marks[k] === 'tick') c++;
          if (s.marks[k] === 'cross') w++;
        });
        const acc = (c + w) > 0 ? Math.round((c / (c + w)) * 100) + '%' : '—';

        const card = document.createElement('div');
        card.className = 'session-card';
        card.innerHTML = `
          <div class="session-info">
            <h4>${escHtml(name)}</h4>
            <div class="session-meta">Q Answered: ${count} · Acc: ${acc} · Next: Q${s.currentQ || (count + 1)}</div>
          </div>
          <div class="session-btns">
            <button class="btn-resume" onclick="openSession('${escHtml(name)}')">Practice ▶</button>
            <button class="btn-del-sm" onclick="deleteSession('${escHtml(name)}')">✕</button>
          </div>
        `;
        list.appendChild(card);
      });
    }

    function createNewSession() {
      const inp = document.getElementById('home-new-subject');
      const name = inp.value.trim();
      if (!name) return showToast('Please enter a session name');
      if (SESSIONS[name]) return showToast('Session already exists');

      SESSIONS[name] = {
        name,
        currentQ: 1,
        answers: {},
        marks: {},
        scheme: 'ssc_t1',
        undoStack: [],
        redoStack: []
      };
      saveAllSessions();
      inp.value = '';
      openSession(name);
    }

    function deleteSession(name) {
      if (!confirm(`Delete session "${name}" and all answers?`)) return;
      delete SESSIONS[name];
      saveAllSessions();
      renderHomeScreen();
      showToast('Session deleted');
    }

    /* ── SESSION VIEW NAVIGATION ── */
    function openSession(name) {
      activeSubject = name;
      const s = SESSIONS[name];

      // Session timer is PAUSED BY DEFAULT when loaded
      s.paused = true;
      s.pausedAt = Date.now();
      s.startTime = Date.now();
      s.pauseAccum = 0;

      document.getElementById('view-home').classList.remove('active');
      document.getElementById('view-session').classList.add('active');

      document.getElementById('p-subject-name').textContent = name;
      document.getElementById('p-scheme-sel').value = s.scheme || 'ssc_t1';

      // Set pause UI
      const pauseBtn = document.getElementById('p-pause-btn');
      const pauseBanner = document.getElementById('p-pause-banner');
      const timerVal = document.getElementById('p-timer-val');

      pauseBtn.textContent = '▶ Resume';
      pauseBtn.classList.add('paused');
      pauseBanner.classList.add('visible');
      timerVal.textContent = '0:00';
      timerVal.className = 'timer-val paused';

      clearInterval(timerInterval);
      timerInterval = setInterval(tickSessionTimer, 300);

      renderSessionOpts();
      renderSessionLog();
      updateSessionScorecard();
    }

    function showHomeView() {
      clearInterval(timerInterval);
      activeSubject = null;
      document.getElementById('view-session').classList.remove('active');
      document.getElementById('view-home').classList.add('active');
      renderHomeScreen();
    }

    /* ── SESSION TIMER ── */
    function tickSessionTimer() {
      if (!activeSubject || !SESSIONS[activeSubject]) return;
      const s = SESSIONS[activeSubject];
      if (s.paused) return;

      const elapsed = (Date.now() - s.startTime) / 1000 - s.pauseAccum;
      const sec = Math.max(0, elapsed);
      const timerEl = document.getElementById('p-timer-val');
      if (timerEl) timerEl.textContent = fmtTime(sec);
    }

    function toggleCurrentPause() {
      if (!activeSubject) return;
      const s = SESSIONS[activeSubject];
      const btn = document.getElementById('p-pause-btn');
      const banner = document.getElementById('p-pause-banner');
      const timerEl = document.getElementById('p-timer-val');

      if (!s.paused) {
        // Pause
        s.paused = true;
        s.pausedAt = Date.now();
        btn.textContent = '▶ Resume';
        btn.classList.add('paused');
        banner.classList.add('visible');
        timerEl.classList.add('paused');
      } else {
        // Resume
        const duration = (Date.now() - s.pausedAt) / 1000;
        s.pauseAccum += duration;
        s.paused = false;
        s.pausedAt = null;
        btn.textContent = '⏸ Pause';
        btn.classList.remove('paused');
        banner.classList.remove('visible');
        timerEl.classList.remove('paused');
      }
    }

    function getCurrentElapsedSec() {
      const s = SESSIONS[activeSubject];
      let accum = s.pauseAccum;
      if (s.paused && s.pausedAt) {
        accum += (Date.now() - s.pausedAt) / 1000;
      }
      return Math.max(0, (Date.now() - s.startTime) / 1000 - accum);
    }

    /* ── SAVE ANSWERS ── */
    function saveAnswer(opt) {
      if (!activeSubject) return;
      const s = SESSIONS[activeSubject];
      if (s.paused) {
        // Automatically resume or alert
        toggleCurrentPause();
      }

      if (navigator.vibrate) navigator.vibrate(20);

      const rawSec = getCurrentElapsedSec();
      const prevAns = s.answers[s.currentQ] ? { ...s.answers[s.currentQ] } : null;

      s.undoStack.push({
        q: s.currentQ,
        prevAnswer: prevAns,
        newAnswer: { opt, time: fmtTime(rawSec), raw: rawSec },
        nextQ: s.currentQ + 1
      });
      s.redoStack = [];

      s.answers[s.currentQ] = { opt, time: fmtTime(rawSec), raw: rawSec };
      s.currentQ++;

      // Reset question timer
      s.startTime = Date.now();
      s.pauseAccum = 0;

      saveAllSessions();
      renderSessionOpts();
      renderSessionLog();
      updateSessionScorecard();
    }

    function skipCurrentQuestion() { saveAnswer('skipped'); }

    /* ── RENDER OPTIONS ── */
    function renderSessionOpts() {
      const s = SESSIONS[activeSubject];
      document.getElementById('p-qnum').textContent = 'Q ' + s.currentQ;
      document.getElementById('p-startq').value = s.currentQ;

      const grid = document.getElementById('p-opts-grid');
      grid.innerHTML = '';
      const letters = ['a', 'b', 'c', 'd'];
      letters.forEach((l, i) => {
        const btn = document.createElement('button');
        btn.className = 'opt-btn';
        btn.dataset.letter = l;
        btn.innerHTML = `<span>${l.toUpperCase()}</span><span class="opt-hint">${i+1}</span>`;
        btn.onclick = () => saveAnswer(l);
        grid.appendChild(btn);
      });
    }

    /* ── RENDER LOG LIST WITH CATEGORIES ── */
    function renderSessionLog() {
      const s = SESSIONS[activeSubject];
      const list = document.getElementById('p-log-list');
      const avgEl = document.getElementById('p-avg-pace');
      list.innerHTML = '';

      const entries = Object.entries(s.answers || {}).sort((a,b) => Number(a[0]) - Number(b[0]));
      let totalTime = 0, count = 0;

      [...entries].reverse().forEach(([q, data]) => {
        const isSkip = data.opt === 'skipped';
        const isOvertime = data.raw > 240; // > 4 mins
        const mark = s.marks[q] || null;

        let statusClass = '';
        if (isSkip) {
          statusClass = ' status-skip';
        } else if (mark === 'tick') {
          statusClass = ' status-correct';
        } else if (mark === 'cross') {
          statusClass = ' status-wrong';
        }
        if (isOvertime) statusClass += ' status-overtime';

        const item = document.createElement('div');
        item.className = 'log-item' + statusClass;

        const optDisplay = isSkip ? 'SKIP' : data.opt.toUpperCase();
        const optClass = isSkip ? 'skip' : data.opt;

        // Requirement 1: Disable / Hide correct & wrong for skipped questions
        let markHTML = '';
        if (!isSkip) {
          markHTML = `
            <div class="log-mark">
              <button class="mark-btn ${mark==='tick'?'active-tick':''}" onclick="setQuestionMark('${q}', 'tick')" title="Mark Correct">✅</button>
              <button class="mark-btn ${mark==='cross'?'active-cross':''}" onclick="setQuestionMark('${q}', 'cross')" title="Mark Wrong">❌</button>
            </div>
          `;
        } else {
          markHTML = `<span style="font-size:0.75rem; color:var(--skip); font-weight:700;">[SKIPPED]</span>`;
        }

        item.innerHTML = `
          <span class="log-qnum">Q${q}</span>
          <span class="log-opt ${optClass}">${optDisplay}</span>
          <span class="log-time">
            ${data.time}
            ${isOvertime ? '<span class="overtime-tag">⏱️ >4m</span>' : ''}
          </span>
          ${markHTML}
        `;
        list.appendChild(item);
        totalTime += data.raw || 0;
        count++;
      });

      avgEl.textContent = count ? 'Avg: ' + fmtTime(totalTime / count) : 'Avg: —';
    }

    function setQuestionMark(q, mark) {
      const s = SESSIONS[activeSubject];
      if (!s.marks) s.marks = {};
      if (s.marks[q] === mark) {
        delete s.marks[q];
      } else {
        s.marks[q] = mark;
      }
      saveAllSessions();
      renderSessionLog();
      updateSessionScorecard();
    }

    function updateSessionScorecard() {
      const s = SESSIONS[activeSubject];
      const scheme = SCHEMES[s.scheme || 'ssc_t1'];

      let correct = 0, wrong = 0;
      Object.keys(s.marks || {}).forEach(q => {
        if (s.marks[q] === 'tick') correct++;
        if (s.marks[q] === 'cross') wrong++;
      });

      const score = (correct * scheme.pos) - (wrong * scheme.neg);
      const evaluated = correct + wrong;
      const acc = evaluated > 0 ? ((correct / evaluated) * 100).toFixed(1) + '%' : '—';

      document.getElementById('sc-score').textContent = (score % 1 === 0 ? score : score.toFixed(2));
      document.getElementById('sc-acc').textContent = acc;
      document.getElementById('sc-correct').textContent = correct;
      document.getElementById('sc-wrong').textContent = wrong;
    }

    /* ── UNDO / REDO ── */
    function undoAnswer() {
      const s = SESSIONS[activeSubject];
      if (!s.undoStack || !s.undoStack.length) return showToast('Nothing to undo');
      const action = s.undoStack.pop();
      s.redoStack.push(action);

      if (action.prevAnswer) {
        s.answers[action.q] = action.prevAnswer;
      } else {
        delete s.answers[action.q];
      }
      s.currentQ = action.q;
      
      // RESTORE TIMER FIX
      const prevTime = action.newAnswer.raw || 0;
      s.startTime = Date.now() - (prevTime * 1000);
      s.pauseAccum = 0;
      s.paused = true;
      s.pausedAt = Date.now();

      const btn = document.getElementById('p-pause-btn');
      const banner = document.getElementById('p-pause-banner');
      const timerEl = document.getElementById('p-timer-val');
      
      if(btn) {
         btn.textContent = '▶ Resume';
         btn.classList.add('paused');
      }
      if(banner) banner.classList.add('visible');
      if(timerEl) {
         timerEl.textContent = fmtTime(prevTime);
         timerEl.classList.add('paused');
      }

      saveAllSessions();
      renderSessionOpts();
      renderSessionLog();
      updateSessionScorecard();
      
      showToast(`Restored Q${s.currentQ}. Timer paused at ${fmtTime(prevTime)}.`);
    }

    function redoAnswer() {
      const s = SESSIONS[activeSubject];
      if (!s.redoStack || !s.redoStack.length) return showToast('Nothing to redo');
      const action = s.redoStack.pop();
      s.undoStack.push(action);

      s.answers[action.q] = action.newAnswer;
      s.currentQ = action.nextQ;
      
      // RESET TIMER FIX
      s.startTime = Date.now();
      s.pauseAccum = 0;
      s.paused = true;
      s.pausedAt = Date.now();

      const btn = document.getElementById('p-pause-btn');
      const banner = document.getElementById('p-pause-banner');
      const timerEl = document.getElementById('p-timer-val');
      
      if(btn) {
         btn.textContent = '▶ Resume';
         btn.classList.add('paused');
      }
      if(banner) banner.classList.add('visible');
      if(timerEl) {
         timerEl.textContent = '0:00';
         timerEl.classList.add('paused');
      }

      saveAllSessions();
      renderSessionOpts();
      renderSessionLog();
      updateSessionScorecard();
    }

    function changeMarkingScheme(val) {
      SESSIONS[activeSubject].scheme = val;
      saveAllSessions();
      updateSessionScorecard();
    }

    function setStartQuestion(val) {
      const q = parseInt(val);
      if (!q || q < 1) return;
      SESSIONS[activeSubject].currentQ = q;
      SESSIONS[activeSubject].startTime = Date.now();
      SESSIONS[activeSubject].pauseAccum = 0;
      saveAllSessions();
      renderSessionOpts();
    }

    function resetCurrentSessionAnswers() {
      if (!confirm(`Reset all answers for "${activeSubject}"?`)) return;
      const s = SESSIONS[activeSubject];
      s.answers = {}; s.marks = {}; s.undoStack = []; s.redoStack = [];
      s.currentQ = 1;
      saveAllSessions();
      renderSessionOpts();
      renderSessionLog();
      updateSessionScorecard();
      showToast('Session reset');
    }

    /* ── FULL BACKUP EXPORT & IMPORT (JSON) ── */
    function exportFullBackup() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(SESSIONS, null, 2));
      const a = document.createElement('a');
      a.setAttribute("href", dataStr);
      a.setAttribute("download", `MCQ_Tracker_Backup_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Full backup downloaded!');
    }

    function importFullBackup(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        try {
          const parsed = JSON.parse(event.target.result);
          if (typeof parsed !== 'object') throw new Error('Invalid format');
          SESSIONS = parsed;
          saveAllSessions();
          renderHomeScreen();
          showToast('Data imported successfully!');
        } catch (err) {
          alert('Failed to import JSON: Invalid backup file.');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }

    /* ── CLOUD SYNC ── */
    function debouncedCloudSave() {
      clearTimeout(cloudSaveTimer);
      showSyncStatus('syncing');
      cloudSaveTimer = setTimeout(cloudSaveNow, 600);
    }

    async function cloudSaveNow() {
      if (!currentUser) return;
      showSyncStatus('syncing');
      try {
        const res = await fetch('/api/mcq-sessions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessions: SESSIONS })
        });
        if (res.ok) {
          showSyncStatus('synced');
        } else {
          console.error('Cloud save failed:', await res.text());
          showSyncStatus('');
        }
      } catch (e) {
        console.error('Cloud save error:', e);
        showSyncStatus('');
      }
    }

    function showSyncStatus(status) {
      const el = document.getElementById('sync-indicator');
      if (!el) return;
      el.className = 'sync-indicator';
      if (status === 'syncing') {
        el.textContent = '☁️';
        el.classList.add('syncing');
      } else if (status === 'synced') {
        el.textContent = '✅';
        el.classList.add('synced');
        setTimeout(() => { el.className = 'sync-indicator'; }, 1500);
      }
    }

    /* ── AUTH FUNCTIONS ── */
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.authenticated && data.user) {
          currentUser = data.user;
          return true;
        }
      } catch (e) {
        console.error('Auth check error:', e);
      }
      currentUser = null;
      return false;
    }

    function toggleAuthMode() {
      authMode = authMode === 'login' ? 'register' : 'login';
      document.getElementById('auth-subtitle').textContent =
        authMode === 'login'
          ? 'Sign in to sync your progress across devices'
          : 'Create a free account to save your data';
      document.getElementById('auth-btn-label').textContent =
        authMode === 'login' ? 'Sign In' : 'Create Account';
      document.getElementById('auth-mode-text').textContent =
        authMode === 'login' ? "Don't have an account?" : 'Already have an account?';
      document.getElementById('auth-mode-btn').textContent =
        authMode === 'login' ? 'Create Account' : 'Sign In';
      document.getElementById('auth-error').textContent = '';
      document.getElementById('auth-error').classList.remove('shake');
    }

    async function handleAuthSubmit(e) {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errEl = document.getElementById('auth-error');
      const btn = document.getElementById('auth-submit-btn');

      if (!email || !password) {
        errEl.textContent = 'Please fill in both fields.';
        errEl.classList.remove('shake');
        void errEl.offsetWidth;
        errEl.classList.add('shake');
        return;
      }
      if (password.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        errEl.classList.remove('shake');
        void errEl.offsetWidth;
        errEl.classList.add('shake');
        return;
      }

      btn.classList.add('loading');
      btn.disabled = true;
      errEl.textContent = '';

      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || 'Authentication failed. Please try again.';
          errEl.classList.remove('shake');
          void errEl.offsetWidth;
          errEl.classList.add('shake');
        } else if (data.user) {
          currentUser = data.user;

          // Show success animation
          document.getElementById('auth-form').style.display = 'none';
          document.querySelector('.auth-mode-switch').style.display = 'none';
          document.getElementById('auth-subtitle').textContent = 'Welcome back!';
          const successEl = document.getElementById('auth-success');
          successEl.style.display = 'block';

          // Load data from cloud and render
          await loadAllSessions();
          renderHomeScreen();

          setTimeout(() => {
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('logout-btn').style.display = '';
          }, 800);
        }
      } catch (err) {
        errEl.textContent = 'Network error. Please check your connection.';
        errEl.classList.remove('shake');
        void errEl.offsetWidth;
        errEl.classList.add('shake');
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    }

    async function handleLogout() {
      if (!confirm('Log out? Your data is saved in the cloud.')) return;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { console.error('Logout error:', e); }

      currentUser = null;
      SESSIONS = {};
      document.getElementById('logout-btn').style.display = 'none';

      // Reset and show auth overlay
      const overlay = document.getElementById('auth-overlay');
      overlay.classList.remove('hidden');
      document.getElementById('auth-form').style.display = '';
      document.querySelector('.auth-mode-switch').style.display = '';
      document.getElementById('auth-success').style.display = 'none';
      document.getElementById('auth-subtitle').textContent = 'Sign in to sync your progress across devices';
      document.getElementById('auth-email').value = '';
      document.getElementById('auth-password').value = '';
      document.getElementById('auth-error').textContent = '';

      renderHomeScreen();
      showToast('Logged out successfully');
    }

    /* ── EXPORT CSV & COPY SUMMARY ── */
    function copyCurrentSummary() {
      const s = SESSIONS[activeSubject];
      let correct = 0, wrong = 0, skipped = 0, totalTime = 0, count = 0;

      Object.entries(s.answers || {}).forEach(([q, d]) => {
        if (d.opt === 'skipped') skipped++;
        if (s.marks && s.marks[q] === 'tick') correct++;
        if (s.marks && s.marks[q] === 'cross') wrong++;
        totalTime += d.raw || 0;
        count++;
      });

      const scheme = SCHEMES[s.scheme || 'ssc_t1'];
      const score = (correct * scheme.pos) - (wrong * scheme.neg);
      const acc = (correct + wrong) > 0 ? ((correct / (correct + wrong)) * 100).toFixed(1) + '%' : 'N/A';
      const avg = count ? fmtTime(totalTime / count) : '0:00';

      const summary = `📊 *MCQ Practice Summary: ${activeSubject}*\n` +
        `• Questions Attempted: ${count} (Skipped: ${skipped})\n` +
        `• Correct: ${correct} | Wrong: ${wrong}\n` +
        `• Accuracy: ${acc}\n` +
        `• Score: ${score} (${scheme.name})\n` +
        `• Total Time: ${fmtTime(totalTime)} (Avg: ${avg}/Q)`;

      navigator.clipboard.writeText(summary).then(() => showToast('Summary copied!'));
    }

    function exportCurrentCSV() {
      const s = SESSIONS[activeSubject];
      let csv = 'Question,Option,Time_Formatted,Time_Seconds,Status\n';
      Object.entries(s.answers || {}).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([q, d]) => {
        let status = 'Unmarked';
        if (s.marks && s.marks[q] === 'tick') status = 'Correct';
        if (s.marks && s.marks[q] === 'cross') status = 'Wrong';
        if (d.opt === 'skipped') status = 'Skipped';
        csv += `${q},${d.opt.toUpperCase()},${d.time},${(d.raw || 0).toFixed(1)},${status}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeSubject.replace(/\s+/g, '_')}_Log.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    /* ── UTILS ── */
    function fmtTime(sec) {
      sec = Math.max(0, Math.floor(sec));
      const m = Math.floor(sec / 60), s = sec % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function escHtml(s) {
      return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.style.opacity = '0', 2200);
    }

    /* ── KEYBOARD SHORTCUTS ── */
    window.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (!activeSubject) return;

      const key = e.key.toLowerCase();
      if (key === 'a' || key === '1') { e.preventDefault(); saveAnswer('a'); }
      else if (key === 'b' || key === '2') { e.preventDefault(); saveAnswer('b'); }
      else if (key === 'c' || key === '3') { e.preventDefault(); saveAnswer('c'); }
      else if (key === 'd' || key === '4') { e.preventDefault(); saveAnswer('d'); }
      else if (key === 's') { e.preventDefault(); skipCurrentQuestion(); }
      else if (key === ' ' || e.code === 'Space') { e.preventDefault(); toggleCurrentPause(); }
      else if ((e.ctrlKey && key === 'z') || key === 'z') { e.preventDefault(); undoAnswer(); }
      else if ((e.ctrlKey && key === 'y') || key === 'y') { e.preventDefault(); redoAnswer(); }
      else if (key === 'escape') { e.preventDefault(); showHomeView(); }
    });

    /* ── INIT ── */
    window.addEventListener('DOMContentLoaded', async () => {
      const isAuthed = await checkAuth();

      if (isAuthed) {
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('logout-btn').style.display = '';
        await loadAllSessions();
      } else {
        // Show auth overlay (visible by default), load local for fallback
        loadLocalSessions();
      }
      renderHomeScreen();
    });
  