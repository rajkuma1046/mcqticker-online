import React, { useState, useEffect, useCallback } from 'react';
import { db, type AttendanceClass, type AttendanceStudent, type AttendanceRecord } from '../db/index';

// ── Helpers ──────────────────────────────────────────────────────────────

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_CONFIG = {
  present: { label: 'P', color: 'bg-emerald-500 text-white', icon: '✓' },
  absent: { label: 'A', color: 'bg-red-500 text-white', icon: '✗' },
  late: { label: 'L', color: 'bg-amber-500 text-white', icon: '⏰' },
} as const;

// ── Component ────────────────────────────────────────────────────────────

export default function AttendanceCalendar() {
  // State
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [newClassName, setNewClassName] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [view, setView] = useState<'calendar' | 'roster'>('calendar');

  // Load classes on mount
  useEffect(() => {
    db.attendanceClasses.toArray().then(setClasses);
  }, []);

  // Load students & records when class is selected
  useEffect(() => {
    if (!selectedClassId) { setStudents([]); setRecords([]); return; }
    db.attendanceStudents.where('classId').equals(selectedClassId).toArray().then(s => {
      setStudents(s.sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0) || a.name.localeCompare(b.name)));
    });
    db.attendanceRecords.where('classId').equals(selectedClassId).toArray().then(setRecords);
  }, [selectedClassId]);

  // ── Class Management ──────────────────────────────────────────────────

  const addClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    const cls: AttendanceClass = { id: genId('class'), name, createdAt: new Date().toISOString() };
    await db.attendanceClasses.put(cls);
    setClasses(prev => [...prev, cls]);
    setSelectedClassId(cls.id);
    setNewClassName('');
  };

  const deleteClass = async (id: string) => {
    if (!confirm('Delete this class and all its students/attendance records? This cannot be undone.')) return;
    await db.attendanceClasses.delete(id);
    await db.attendanceStudents.where('classId').equals(id).delete();
    await db.attendanceRecords.where('classId').equals(id).delete();
    setClasses(prev => prev.filter(c => c.id !== id));
    if (selectedClassId === id) { setSelectedClassId(null); setStudents([]); setRecords([]); }
  };

  // ── Student Management ────────────────────────────────────────────────

  const addStudent = async () => {
    if (!selectedClassId) return;
    const name = newStudentName.trim() || `Student ${students.length + 1}`;
    const rollNo = students.length + 1;
    const student: AttendanceStudent = {
      id: genId('student'), classId: selectedClassId, name, rollNo, createdAt: new Date().toISOString(),
    };
    await db.attendanceStudents.put(student);
    setStudents(prev => [...prev, student].sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0)));
    setNewStudentName('');
  };

  const removeStudent = async (id: string) => {
    if (!confirm('Remove this student and their attendance records?')) return;
    await db.attendanceStudents.delete(id);
    await db.attendanceRecords.where('studentId').equals(id).delete();
    setStudents(prev => prev.filter(s => s.id !== id));
    setRecords(prev => prev.filter(r => r.studentId !== id));
  };

  // ── Attendance Marking ────────────────────────────────────────────────

  const cycleStatus = useCallback(async (studentId: string, date: string) => {
    if (!selectedClassId) return;
    const recId = `${selectedClassId}_${studentId}_${date}`;
    const existing = records.find(r => r.id === recId);
    const statusCycle: Array<AttendanceRecord['status'] | null> = [null, 'present', 'absent', 'late'];
    const currentIdx = existing ? statusCycle.indexOf(existing.status) : 0;
    const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];

    if (nextStatus === null) {
      await db.attendanceRecords.delete(recId);
      setRecords(prev => prev.filter(r => r.id !== recId));
    } else {
      const rec: AttendanceRecord = { id: recId, classId: selectedClassId, studentId, date, status: nextStatus };
      await db.attendanceRecords.put(rec);
      setRecords(prev => {
        const filtered = prev.filter(r => r.id !== recId);
        return [...filtered, rec];
      });
    }
  }, [selectedClassId, records]);

  // Mark all students for a specific date
  const markAllForDate = async (date: string, status: AttendanceRecord['status']) => {
    if (!selectedClassId) return;
    const newRecords: AttendanceRecord[] = students.map(s => ({
      id: `${selectedClassId}_${s.id}_${date}`,
      classId: selectedClassId,
      studentId: s.id,
      date,
      status,
    }));
    await db.attendanceRecords.bulkPut(newRecords);
    setRecords(prev => {
      const filtered = prev.filter(r => !newRecords.some(nr => nr.id === r.id));
      return [...filtered, ...newRecords];
    });
  };

  // ── Stats ─────────────────────────────────────────────────────────────

  const getMonthStats = () => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const monthRecords = records.filter(r => {
      const [y, m] = r.date.split('-').map(Number);
      return y === currentYear && m === currentMonth + 1;
    });
    const present = monthRecords.filter(r => r.status === 'present').length;
    const absent = monthRecords.filter(r => r.status === 'absent').length;
    const late = monthRecords.filter(r => r.status === 'late').length;
    const totalPossible = students.length * daysInMonth;
    const attendanceRate = totalPossible > 0 ? Math.round(((present + late) / totalPossible) * 100) : 0;
    return { present, absent, late, totalPossible, attendanceRate };
  };

  // ── CSV Export ─────────────────────────────────────────────────────────

  const exportCSV = () => {
    if (!selectedClassId || students.length === 0) return;
    const cls = classes.find(c => c.id === selectedClassId);
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const dates = Array.from({ length: daysInMonth }, (_, i) => formatDateKey(currentYear, currentMonth, i + 1));

    let csv = `Roll No,Student Name,${dates.map(d => d.split('-')[2]).join(',')},Present,Absent,Late\n`;

    students.forEach(s => {
      let present = 0, absent = 0, late = 0;
      const row = dates.map(date => {
        const rec = records.find(r => r.studentId === s.id && r.date === date);
        if (rec?.status === 'present') { present++; return 'P'; }
        if (rec?.status === 'absent') { absent++; return 'A'; }
        if (rec?.status === 'late') { late++; return 'L'; }
        return '';
      });
      csv += `${s.rollNo || ''},${s.name},${row.join(',')},${present},${absent},${late}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${cls?.name || 'class'}_${currentYear}-${String(currentMonth + 1).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── CSV Import ─────────────────────────────────────────────────────────

  const importCSV = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !selectedClassId) return;

      const text = await file.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) return;

      const headerCols = lines[0].split(',');
      // Find date columns (after "Student Name", before stats)
      const dateStartIdx = 2;
      const daysInMonth = getDaysInMonth(currentYear, currentMonth);
      const dateCols = headerCols.slice(dateStartIdx, dateStartIdx + daysInMonth);

      const newStudents: AttendanceStudent[] = [];
      const newRecords: AttendanceRecord[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 3) continue;

        const studentName = cols[1]?.trim() || `Student ${i}`;
        const rollNo = parseInt(cols[0]) || i;

        // Find existing student or create new
        let student = students.find(s => s.name === studentName || s.rollNo === rollNo);
        if (!student) {
          student = {
            id: genId('student'), classId: selectedClassId, name: studentName, rollNo, createdAt: new Date().toISOString(),
          };
          newStudents.push(student);
        }

        dateCols.forEach((_, dayIdx) => {
          const val = cols[dateStartIdx + dayIdx]?.trim().toUpperCase();
          if (val === 'P' || val === 'A' || val === 'L') {
            const date = formatDateKey(currentYear, currentMonth, dayIdx + 1);
            const status: AttendanceRecord['status'] = val === 'P' ? 'present' : val === 'A' ? 'absent' : 'late';
            newRecords.push({
              id: `${selectedClassId}_${student!.id}_${date}`,
              classId: selectedClassId,
              studentId: student!.id,
              date,
              status,
            });
          }
        });
      }

      if (newStudents.length > 0) await db.attendanceStudents.bulkPut(newStudents);
      if (newRecords.length > 0) await db.attendanceRecords.bulkPut(newRecords);

      // Refresh data
      const allStudents = await db.attendanceStudents.where('classId').equals(selectedClassId).toArray();
      setStudents(allStudents.sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0)));
      const allRecords = await db.attendanceRecords.where('classId').equals(selectedClassId).toArray();
      setRecords(allRecords);
      alert(`Imported ${newStudents.length} new students and ${newRecords.length} attendance records.`);
    };
    input.click();
  };

  // ── Calendar Grid ─────────────────────────────────────────────────────

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
  const monthName = new Date(currentYear, currentMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const stats = getMonthStats();

  const selectedClass = classes.find(c => c.id === selectedClassId);

  // ── RENDER ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Class Selection */}
      <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 space-y-4">
        <h3 className="font-display font-extrabold text-base text-text-light dark:text-text-dark flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-primary dark:text-brand-secondary">school</span>
          Select or Create Class
        </h3>

        {/* Existing classes */}
        {classes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {classes.map(cls => (
              <div key={cls.id} className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedClassId(cls.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    selectedClassId === cls.id
                      ? 'bg-brand-primary dark:bg-brand-secondary text-white dark:text-bg-dark shadow-md'
                      : 'bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-text-light dark:text-text-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover'
                  }`}
                >
                  {cls.name}
                </button>
                <button
                  onClick={() => deleteClass(cls.id)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-text-light-muted dark:text-text-dark-muted hover:text-wrong-red hover:bg-wrong-red/10 transition-colors cursor-pointer text-xs"
                  title="Delete class"
                >✗</button>
              </div>
            ))}
          </div>
        )}

        {/* New class input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newClassName}
            onChange={e => setNewClassName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addClass()}
            placeholder="e.g. 5th, 10th-A, Biology"
            className="flex-1 px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark text-sm placeholder-text-light-muted/50 dark:placeholder-text-dark-muted/50 focus:outline-none focus:ring-2 focus:ring-brand-primary dark:focus:ring-brand-secondary"
          />
          <button
            onClick={addClass}
            className="px-5 py-2.5 bg-brand-primary dark:bg-brand-secondary text-white dark:text-bg-dark font-bold text-sm rounded-xl hover:opacity-90 transition-all cursor-pointer shadow-md whitespace-nowrap"
          >
            + Create Class
          </button>
        </div>
      </div>

      {/* If a class is selected */}
      {selectedClassId && selectedClass && (
        <>
          {/* Tab Switcher */}
          <div className="flex gap-2">
            <button
              onClick={() => setView('calendar')}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl cursor-pointer transition-all ${
                view === 'calendar'
                  ? 'bg-brand-primary dark:bg-brand-secondary text-white dark:text-bg-dark shadow-md'
                  : 'bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-light dark:text-text-dark'
              }`}
            >
              📅 Calendar View
            </button>
            <button
              onClick={() => setView('roster')}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl cursor-pointer transition-all ${
                view === 'roster'
                  ? 'bg-brand-primary dark:bg-brand-secondary text-white dark:text-bg-dark shadow-md'
                  : 'bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-light dark:text-text-dark'
              }`}
            >
              👤 Manage Students
            </button>
          </div>

          {/* Roster View */}
          {view === 'roster' && (
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 space-y-4">
              <h3 className="font-display font-extrabold text-base text-text-light dark:text-text-dark">
                Students in "{selectedClass.name}"
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addStudent()}
                  placeholder="Student name (optional)"
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark text-sm placeholder-text-light-muted/50 dark:placeholder-text-dark-muted/50 focus:outline-none focus:ring-2 focus:ring-brand-primary dark:focus:ring-brand-secondary"
                />
                <button
                  onClick={addStudent}
                  className="px-5 py-2.5 bg-correct-green text-white font-bold text-sm rounded-xl hover:opacity-90 transition-all cursor-pointer shadow-md whitespace-nowrap"
                >
                  + Add Student
                </button>
              </div>
              {students.length === 0 ? (
                <p className="text-xs text-text-light-muted dark:text-text-dark-muted text-center py-6">No students added yet. Add students to start tracking attendance.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {students.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-bg-light dark:bg-bg-dark rounded-xl border border-border-light dark:border-border-dark">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-full bg-brand-primary/10 dark:bg-brand-secondary/10 flex items-center justify-center text-xxs font-bold text-brand-primary dark:text-brand-secondary">
                          {s.rollNo || i + 1}
                        </span>
                        <span className="text-sm font-bold text-text-light dark:text-text-dark">{s.name}</span>
                      </div>
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-xs text-text-light-muted dark:text-text-dark-muted hover:text-wrong-red font-bold cursor-pointer transition-colors"
                      >Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Calendar View */}
          {view === 'calendar' && (
            <div className="space-y-4">
              {/* Month Navigation & Stats */}
              <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <button onClick={() => {
                    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
                    else setCurrentMonth(m => m - 1);
                  }} className="w-9 h-9 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark flex items-center justify-center cursor-pointer hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors">
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  <h3 className="font-display font-extrabold text-lg text-text-light dark:text-text-dark">{monthName}</h3>
                  <button onClick={() => {
                    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
                    else setCurrentMonth(m => m + 1);
                  }} className="w-9 h-9 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark flex items-center justify-center cursor-pointer hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors">
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-center">
                    <span className="block text-[9px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">Present</span>
                    <span className="font-mono-custom font-black text-lg text-emerald-700 dark:text-emerald-300">{stats.present}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-center">
                    <span className="block text-[9px] uppercase tracking-wider font-bold text-red-600 dark:text-red-400">Absent</span>
                    <span className="font-mono-custom font-black text-lg text-red-700 dark:text-red-300">{stats.absent}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-center">
                    <span className="block text-[9px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400">Late</span>
                    <span className="font-mono-custom font-black text-lg text-amber-700 dark:text-amber-300">{stats.late}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-brand-primary/5 dark:bg-brand-secondary/5 border border-brand-primary/20 dark:border-brand-secondary/20 text-center">
                    <span className="block text-[9px] uppercase tracking-wider font-bold text-brand-primary dark:text-brand-secondary">Rate</span>
                    <span className="font-mono-custom font-black text-lg text-brand-primary dark:text-brand-secondary">{stats.attendanceRate}%</span>
                  </div>
                </div>

                {/* Export/Import */}
                <div className="flex gap-2">
                  <button onClick={exportCSV} className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-text-light dark:text-text-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer flex items-center justify-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">download</span>
                    Export CSV
                  </button>
                  <button onClick={importCSV} className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-text-light dark:text-text-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer flex items-center justify-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">download</span>
                    Import CSV
                  </button>
                </div>
              </div>

              {/* Attendance Table */}
              {students.length === 0 ? (
                <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-8 text-center">
                  <span className="text-3xl">👤</span>
                  <p className="text-sm font-bold text-text-light dark:text-text-dark mt-3">No Students Yet</p>
                  <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-1">
                    Switch to "Manage Students" tab to add students to this class.
                  </p>
                </div>
              ) : (
                <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse min-w-max">
                      <thead>
                        <tr className="bg-bg-light dark:bg-bg-dark">
                          <th className="sticky left-0 z-10 bg-bg-light dark:bg-bg-dark p-2 border-b border-r border-border-light dark:border-border-dark text-left font-bold text-text-light-muted dark:text-text-dark-muted w-32 min-w-[8rem]">
                            Student
                          </th>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const day = i + 1;
                            const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
                            const isSunday = dayOfWeek === 0;
                            return (
                              <th key={day} className={`p-1.5 border-b border-border-light dark:border-border-dark text-center min-w-[2rem] ${isSunday ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}>
                                <div className="text-[9px] text-text-light-muted dark:text-text-dark-muted">{WEEKDAYS[dayOfWeek]}</div>
                                <div className="font-mono-custom font-bold">{day}</div>
                              </th>
                            );
                          })}
                          <th className="p-2 border-b border-l border-border-light dark:border-border-dark text-center font-bold text-text-light-muted dark:text-text-dark-muted">%</th>
                        </tr>
                        {/* Mark All row */}
                        <tr className="bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark">
                          <td className="sticky left-0 z-10 bg-surface-light dark:bg-surface-dark p-1.5 border-r border-border-light dark:border-border-dark text-[9px] font-bold text-text-light-muted dark:text-text-dark-muted">
                            Mark All →
                          </td>
                          {Array.from({ length: daysInMonth }, (_, i) => {
                            const date = formatDateKey(currentYear, currentMonth, i + 1);
                            return (
                              <td key={i} className="p-0.5 text-center">
                                <button
                                  onClick={() => markAllForDate(date, 'present')}
                                  className="w-full h-6 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 cursor-pointer transition-colors border-0"
                                  title="Mark all present"
                                >P</button>
                              </td>
                            );
                          })}
                          <td className="p-1 border-l border-border-light dark:border-border-dark"></td>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map(student => {
                          const studentRecords = records.filter(r => r.studentId === student.id);
                          const monthPresentLate = studentRecords.filter(r => {
                            const [y, m] = r.date.split('-').map(Number);
                            return y === currentYear && m === currentMonth + 1 && (r.status === 'present' || r.status === 'late');
                          }).length;
                          const pct = daysInMonth > 0 ? Math.round((monthPresentLate / daysInMonth) * 100) : 0;

                          return (
                            <tr key={student.id} className="border-b border-border-light/50 dark:border-border-dark/50 hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors">
                              <td className="sticky left-0 z-10 bg-surface-light dark:bg-surface-dark p-2 border-r border-border-light dark:border-border-dark">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-brand-primary/10 dark:bg-brand-secondary/10 flex items-center justify-center text-[8px] font-bold text-brand-primary dark:text-brand-secondary flex-shrink-0">
                                    {student.rollNo || '?'}
                                  </span>
                                  <span className="font-bold text-text-light dark:text-text-dark truncate max-w-[5rem]">{student.name}</span>
                                </div>
                              </td>
                              {Array.from({ length: daysInMonth }, (_, i) => {
                                const day = i + 1;
                                const date = formatDateKey(currentYear, currentMonth, day);
                                const rec = studentRecords.find(r => r.date === date);
                                const isSunday = new Date(currentYear, currentMonth, day).getDay() === 0;

                                return (
                                  <td key={day} className={`p-0.5 text-center ${isSunday ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}>
                                    <button
                                      onClick={() => cycleStatus(student.id, date)}
                                      className={`w-full h-7 rounded text-[10px] font-bold cursor-pointer transition-all border-0 ${
                                        rec ? STATUS_CONFIG[rec.status].color : 'bg-transparent text-text-light-muted/30 dark:text-text-dark-muted/30 hover:bg-bg-light dark:hover:bg-bg-dark'
                                      }`}
                                      title={rec ? rec.status : 'Click to mark'}
                                    >
                                      {rec ? STATUS_CONFIG[rec.status].label : '·'}
                                    </button>
                                  </td>
                                );
                              })}
                              <td className="p-1.5 border-l border-border-light dark:border-border-dark text-center font-mono-custom font-bold">
                                <span className={pct >= 75 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
                                  {pct}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-4 text-xxs text-text-light-muted dark:text-text-dark-muted justify-center">
                <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-emerald-500 inline-block"></span> Present</span>
                <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-500 inline-block"></span> Absent</span>
                <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-500 inline-block"></span> Late</span>
                <span className="text-xxs">Click cell to cycle status</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* No class selected placeholder */}
      {!selectedClassId && (
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-10 text-center">
          <span className="text-4xl">🏫</span>
          <h3 className="text-base font-bold text-text-light dark:text-text-dark mt-3">Create or Select a Class</h3>
          <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-1 max-w-sm mx-auto">
            Create a class (e.g. "5th", "10th-A") above to get started with attendance tracking. All data is stored offline on your device.
          </p>
        </div>
      )}
    </div>
  );
}
