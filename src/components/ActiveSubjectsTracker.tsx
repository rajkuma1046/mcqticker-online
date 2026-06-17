import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, calculateSessionMetrics } from '../db/index';

export default function ActiveSubjectsTracker() {
  const [newSubjectName, setNewSubjectName] = useState('');
  const [tickTrigger, setTickTrigger] = useState(0);
  const [flashedButtons, setFlashedButtons] = useState<Record<string, string | null>>({}); // subjectName -> option

  // Tick the timer in-memory to avoid continuous DB writes
  useEffect(() => {
    const interval = setInterval(() => {
      setTickTrigger((prev) => prev + 1);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Fetch active subjects from Dexie
  const activeSubjects = useLiveQuery(() => db.activeSubjects.toArray()) || [];

  // Autocomplete suggestions based on past sessions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    async function loadSuggestions() {
      try {
        const sessions = await db.sessions.toArray();
        const names = Array.from(new Set(sessions.map((s) => s.subject)));
        setSuggestions(names);
      } catch (err) {
        console.error(err);
      }
    }
    loadSuggestions();
  }, []);

  const handleAddSubject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = newSubjectName.trim();
    if (!name) return;

    const exists = await db.activeSubjects.get(name);
    if (exists) {
      alert('Subject already exists');
      return;
    }

    await db.activeSubjects.put({
      name,
      currentQ: 1,
      answers: {},
      marks: {},
      paused: false,
      pauseAccum: 0,
      pausedAt: null,
      startTime: Date.now(),
      history: [],
      future: [],
    });
    setNewSubjectName('');
  };

  const handleResetAll = async () => {
    if (!confirm('Reset ALL active subjects? This will wipe their current timers and answer logs.')) return;
    await db.activeSubjects.clear();
  };

  const togglePause = async (name: string) => {
    const subject = await db.activeSubjects.get(name);
    if (!subject) return;

    if (!subject.paused) {
      // Pause
      await db.activeSubjects.update(name, {
        paused: true,
        pausedAt: Date.now(),
      });
    } else {
      // Resume
      const pauseDuration = subject.pausedAt ? (Date.now() - subject.pausedAt) / 1000 : 0;
      await db.activeSubjects.update(name, {
        paused: false,
        pausedAt: null,
        pauseAccum: (subject.pauseAccum || 0) + pauseDuration,
      });
    }
  };

  const getElapsed = (subject: any) => {
    let accum = subject.pauseAccum || 0;
    if (subject.paused && subject.pausedAt) {
      accum += (Date.now() - subject.pausedAt) / 1000;
    }
    const raw = (Date.now() - subject.startTime) / 1000 - accum;
    return Math.max(0, raw);
  };

  const formatSeconds = (sec: number) => {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const saveOption = async (name: string, opt: string) => {
    const s = await db.activeSubjects.get(name);
    if (!s) return;

    if (s.paused) {
      alert('Resume the timer first!');
      return;
    }

    const raw = getElapsed(s);
    const formatted = formatSeconds(raw);

    // Save current state to history stack
    const history = s.history || [];
    const snapshot = { answers: { ...s.answers }, currentQ: s.currentQ };

    const updatedAnswers = {
      ...s.answers,
      [s.currentQ]: { opt, time: formatted, raw: Math.max(0, raw) },
    };

    const nextQ = s.currentQ + 1;

    // Flash button state
    setFlashedButtons((prev) => ({ ...prev, [name]: opt }));
    setTimeout(() => {
      setFlashedButtons((prev) => ({ ...prev, [name]: null }));
    }, 200);

    await db.activeSubjects.update(name, {
      answers: updatedAnswers,
      currentQ: nextQ,
      startTime: Date.now(),
      pauseAccum: 0,
      pausedAt: null,
      history: [...history, snapshot],
      future: [],
    });
  };

  const skipQuestion = (name: string) => {
    saveOption(name, 'skipped');
  };

  const handleSetStartQ = async (name: string, qVal: number) => {
    if (!qVal || qVal < 1) return;
    const s = await db.activeSubjects.get(name);
    if (!s) return;

    const history = s.history || [];
    const snapshot = { answers: { ...s.answers }, currentQ: s.currentQ };

    await db.activeSubjects.update(name, {
      currentQ: qVal,
      startTime: Date.now(),
      pauseAccum: 0,
      pausedAt: null,
      history: [...history, snapshot],
      future: [],
    });
  };

  const setMark = async (name: string, q: string, mark: 'tick' | 'cross') => {
    const s = await db.activeSubjects.get(name);
    if (!s) return;

    const updatedMarks = { ...s.marks };
    if (updatedMarks[q] === mark) {
      delete updatedMarks[q];
    } else {
      updatedMarks[q] = mark;
    }

    await db.activeSubjects.update(name, {
      marks: updatedMarks,
    });
  };

  const handleUndo = async (name: string) => {
    const s = await db.activeSubjects.get(name);
    if (!s) return;

    const history = s.history || [];
    if (history.length === 0) return;

    const prev = history[history.length - 1];
    const nextHistory = history.slice(0, -1);
    const future = s.future || [];
    const snapshot = { answers: { ...s.answers }, currentQ: s.currentQ };

    await db.activeSubjects.update(name, {
      answers: prev.answers,
      currentQ: prev.currentQ,
      startTime: Date.now(),
      pauseAccum: 0,
      pausedAt: null,
      history: nextHistory,
      future: [...future, snapshot],
    });
  };

  const handleRedo = async (name: string) => {
    const s = await db.activeSubjects.get(name);
    if (!s) return;

    const future = s.future || [];
    if (future.length === 0) return;

    const next = future[future.length - 1];
    const nextFuture = future.slice(0, -1);
    const history = s.history || [];
    const snapshot = { answers: { ...s.answers }, currentQ: s.currentQ };

    await db.activeSubjects.update(name, {
      answers: next.answers,
      currentQ: next.currentQ,
      startTime: Date.now(),
      pauseAccum: 0,
      pausedAt: null,
      history: [...history, snapshot],
      future: nextFuture,
    });
  };

  const resetSubject = async (name: string) => {
    if (!confirm(`Reset all answers and timer for "${name}"?`)) return;
    await db.activeSubjects.update(name, {
      currentQ: 1,
      answers: {},
      marks: {},
      paused: false,
      pauseAccum: 0,
      pausedAt: null,
      startTime: Date.now(),
      history: [],
      future: [],
    });
  };

  const deleteSubjectCard = async (name: string) => {
    if (!confirm(`Remove "${name}" tracker card? This will delete its unsaved logs.`)) return;
    await db.activeSubjects.delete(name);
  };

  const saveToHistory = async (subject: any) => {
    const qCount = Object.keys(subject.answers).length;
    if (qCount === 0) {
      alert('Cannot save an empty session to history. Record some answers first.');
      return;
    }

    if (!confirm(`Save "${subject.name}" session to History and archive this card?`)) return;

    const logs = Object.entries(subject.answers).map(([qStr, ans]: [string, any]) => {
      const qNo = parseInt(qStr, 10);
      const mark = subject.marks[qNo.toString()];
      const isSkip = ans.opt === 'skipped';

      let status: 'correct' | 'incorrect' | 'skipped' = 'incorrect';
      if (isSkip) {
        status = 'skipped';
      } else if (mark === 'tick') {
        status = 'correct';
      } else if (mark === 'cross') {
        status = 'incorrect';
      }

      return {
        qNo,
        userSelectedOption: isSkip ? undefined : ans.opt.toUpperCase(),
        correctOption: status === 'correct' ? (isSkip ? undefined : ans.opt.toUpperCase()) : (status === 'incorrect' ? (ans.opt.toUpperCase() === 'A' ? 'B' : 'A') : undefined),
        status,
        timeTakenSeconds: ans.raw || 0,
      };
    });

    const metrics = calculateSessionMetrics(logs);
    const startTime = new Date(subject.startTime).toISOString();
    const endTime = new Date().toISOString();

    const session = {
      sessionId: `${subject.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
      subject: subject.name,
      topic: 'Quick Practice',
      startTime,
      endTime,
      totalQuestions: logs.length,
      timerMode: 'stopwatch' as const,
      metrics,
      logs,
    };

    try {
      await db.sessions.put(session);
      await db.activeSubjects.delete(subject.name);
      alert(`Session for "${subject.name}" saved to history successfully!`);
    } catch (err) {
      console.error(err);
      alert('Error saving session to history.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action row */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center bg-surface-light dark:bg-surface-dark p-4 rounded-2xl border border-border-light dark:border-border-dark transition-colors">
        <form onSubmit={handleAddSubject} className="flex-1 flex gap-2">
          <input
            type="text"
            placeholder="Subject name..."
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            list="subject-options"
            className="flex-1 px-4 py-2.5 rounded-xl border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary dark:focus:ring-brand-secondary transition-all"
          />
          <datalist id="subject-options">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="submit"
            className="px-5 py-2.5 bg-brand-primary dark:bg-brand-secondary text-white font-bold rounded-xl text-sm hover:opacity-90 active:scale-97 cursor-pointer transition-all whitespace-nowrap"
          >
            + Add Subject
          </button>
        </form>

        {activeSubjects.length > 0 && (
          <button
            onClick={handleResetAll}
            className="px-4 py-2.5 border border-wrong-red bg-wrong-red-light/10 text-wrong-red text-sm font-bold rounded-xl hover:bg-wrong-red-light/20 active:scale-97 cursor-pointer transition-all"
          >
            🗑️ Reset ALL Data
          </button>
        )}
      </div>

      {activeSubjects.length === 0 ? (
        <div className="text-center py-16 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl">
          <span className="text-4xl">📖</span>
          <h4 className="text-sm font-bold mt-3 text-text-light dark:text-text-dark">No active subjects</h4>
          <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1">
            Add a subject above to start tracking your MCQ timers and answers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {activeSubjects.map((subject) => {
            const elapsed = getElapsed(subject);
            const formattedTime = formatSeconds(elapsed);

            // Compute answered counts and average
            const answeredList = Object.entries(subject.answers);
            const answeredCount = answeredList.length;
            const totalSec = answeredList.reduce((acc, [, val]: [any, any]) => acc + (val.raw || 0), 0);
            const avgSec = answeredCount > 0 ? totalSec / answeredCount : 0;

            const isFlashed = flashedButtons[subject.name] || null;

            return (
              <div
                key={subject.name}
                className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl overflow-hidden shadow-custom flex flex-col justify-between transition-colors"
              >
                {/* Subject Header */}
                <div className="bg-brand-primary dark:bg-brand-dark px-4 py-3.5 flex justify-between items-center text-white">
                  <div>
                    <h3 className="font-sans font-bold text-sm leading-tight truncate max-w-[180px]">
                      {subject.name}
                    </h3>
                    <span className="text-[10px] opacity-75 font-mono-custom">
                      Q answered: {answeredCount} · Avg: {avgSec > 0 ? formatSeconds(avgSec) : '—'}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => deleteSubjectCard(subject.name)}
                      title="Remove card"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white cursor-pointer transition-colors text-xs"
                    >
                      ❌
                    </button>
                  </div>
                </div>

                {/* Subject Body */}
                <div className="p-4 space-y-4">
                  {/* Pause Banner */}
                  {subject.paused && (
                    <div className="py-2 px-3 text-center text-xxs font-semibold bg-amber-orange-light dark:bg-amber-orange-dark/20 text-amber-orange border border-amber-orange rounded-xl animate-pulse">
                      ⏸️ PAUSED — timer stopped. Resume when ready.
                    </div>
                  )}

                  {/* Timer Row */}
                  <div className="flex items-center justify-between p-3 bg-bg-light dark:bg-bg-dark rounded-xl border border-border-light dark:border-border-dark">
                    <div>
                      <div className="text-[10px] text-text-light-muted dark:text-text-dark-muted font-semibold uppercase tracking-wider">
                        Time on current Q
                      </div>
                      <div className={`text-xl font-bold font-mono-custom mt-0.5 ${subject.paused ? 'text-amber-orange' : 'text-brand-primary dark:text-brand-secondary'}`}>
                        {formattedTime}
                      </div>
                    </div>
                    <button
                      onClick={() => togglePause(subject.name)}
                      className={`px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-all active:scale-95 cursor-pointer flex items-center gap-1 ${
                        subject.paused
                          ? 'bg-amber-orange-light dark:bg-amber-orange-dark/20 text-amber-orange border-amber-orange'
                          : 'bg-brand-light dark:bg-brand-dark text-brand-primary dark:text-brand-secondary border-brand-primary/20 dark:border-brand-secondary/20 hover:opacity-90'
                      }`}
                    >
                      {subject.paused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                  </div>

                  {/* Start Q# Set Row */}
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Q#"
                      id={`startq-input-${subject.name}`}
                      min="1"
                      className="w-20 px-3 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark text-xs font-mono-custom text-center focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                    <button
                      onClick={() => {
                        const el = document.getElementById(`startq-input-${subject.name}`) as HTMLInputElement;
                        const val = parseInt(el?.value, 10);
                        if (val >= 1) {
                          handleSetStartQ(subject.name, val);
                          el.value = '';
                        }
                      }}
                      className="flex-1 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover text-text-light dark:text-text-dark text-xs font-bold transition-all cursor-pointer"
                    >
                      Set start Q#
                    </button>
                  </div>

                  {/* Current Question Number Display */}
                  <div className="text-center py-1 border-b border-border-light dark:border-b-border-dark/50">
                    <div className="text-2xl font-bold font-sans text-brand-primary dark:text-brand-secondary">
                      Q {subject.currentQ}
                    </div>
                    <div className="text-[10px] text-text-light-muted dark:text-text-dark-muted">Current question</div>
                  </div>

                  {/* Options Grid (A, B, C, D) */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {['a', 'b', 'c', 'd'].map((opt) => {
                      let btnColor = 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark text-text-light dark:text-text-dark';
                      const isOptionFlashed = isFlashed === opt;
                      if (isOptionFlashed) {
                        if (opt === 'a') btnColor = 'bg-correct-green-light border-correct-green text-correct-green';
                        else if (opt === 'b') btnColor = 'bg-blue-200 dark:bg-blue-950 border-blue-500 text-blue-500';
                        else if (opt === 'c') btnColor = 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-500';
                        else if (opt === 'd') btnColor = 'bg-purple-100 dark:bg-purple-950 border-purple-500 text-purple-500';
                      }

                      return (
                        <button
                          key={opt}
                          onClick={() => saveOption(subject.name, opt)}
                          disabled={subject.paused}
                          className={`py-3.5 rounded-xl border flex flex-col items-center justify-center cursor-pointer active:scale-95 disabled:opacity-50 transition-all ${btnColor}`}
                        >
                          <span className="font-sans font-bold text-base uppercase leading-none">{opt}</span>
                          <span className="text-[9px] font-mono-custom text-text-light-muted dark:text-text-dark-muted mt-0.5">
                            Q{subject.currentQ}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Skip button */}
                  <button
                    onClick={() => skipQuestion(subject.name)}
                    disabled={subject.paused}
                    className="w-full py-2 bg-skip-purple-light/10 text-skip-purple border border-dashed border-skip-purple rounded-xl text-xs font-bold hover:bg-skip-purple-light/20 active:scale-97 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    ⏭ Skip this question
                  </button>

                  {/* Undo / Redo Row */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUndo(subject.name)}
                      disabled={!subject.history || subject.history.length === 0}
                      className="flex-1 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light-muted dark:text-text-dark-muted text-xs font-bold hover:border-brand-primary active:scale-97 disabled:opacity-40 cursor-pointer transition-all"
                    >
                      ↩ Undo
                    </button>
                    <button
                      onClick={() => handleRedo(subject.name)}
                      disabled={!subject.future || subject.future.length === 0}
                      className="flex-1 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light-muted dark:text-text-dark-muted text-xs font-bold hover:border-brand-primary active:scale-97 disabled:opacity-40 cursor-pointer transition-all"
                    >
                      ↪ Redo
                    </button>
                  </div>

                  {/* Scrollable Answer Log */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-text-light-muted dark:text-text-dark-muted uppercase tracking-wider text-[10px]">
                        Answer log
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-brand-primary/10 dark:bg-brand-secondary/15 text-brand-primary dark:text-brand-secondary text-[9px] font-mono-custom">
                        Avg: {avgSec > 0 ? formatSeconds(avgSec) : '—'}
                      </span>
                    </div>

                    <div className="max-h-48 overflow-y-auto border border-border-light dark:border-border-dark rounded-xl bg-bg-light/40 dark:bg-bg-dark/40 p-2 space-y-1.5">
                      {answeredCount === 0 ? (
                        <div className="text-center py-6 text-xxs text-text-light-muted dark:text-text-dark-muted italic">
                          No answers recorded yet.
                        </div>
                      ) : (
                        [...answeredList].reverse().map(([qStr, data]: [string, any]) => {
                          const qNo = parseInt(qStr, 10);
                          const isSlow = data.raw > 240;
                          const isSkip = data.opt === 'skipped';
                          const mark = subject.marks[qStr] || null;

                          let badgeColor = 'bg-surface-light dark:bg-surface-dark border-border-light dark:border-border-dark';
                          let markText = 'text-text-light dark:text-text-dark';

                          if (mark === 'tick') {
                            badgeColor = 'bg-correct-green-light dark:bg-correct-green-dark/30 border-correct-green';
                            markText = 'text-correct-green-dark dark:text-correct-green font-bold';
                          } else if (mark === 'cross') {
                            badgeColor = 'bg-wrong-red-light dark:bg-wrong-red-dark/30 border-wrong-red';
                            markText = 'text-wrong-red-dark dark:text-wrong-red font-bold';
                          } else if (isSlow) {
                            badgeColor = 'bg-wrong-red-light/10 border-wrong-red/40';
                          }

                          let optColor = 'text-text-light-muted dark:text-text-dark-muted';
                          if (!isSkip) {
                            if (data.opt === 'a') optColor = 'text-correct-green font-bold';
                            else if (data.opt === 'b') optColor = 'text-blue-500 font-bold';
                            else if (data.opt === 'c') optColor = 'text-amber-500 font-bold';
                            else if (data.opt === 'd') optColor = 'text-purple-500 font-bold';
                          }

                          return (
                            <div
                              key={qStr}
                              className={`flex items-center gap-2 p-2 rounded-lg border text-xxs font-mono-custom transition-all ${badgeColor}`}
                            >
                              <span className="font-bold opacity-60">Q{qStr}</span>
                              <span className={optColor}>
                                {isSkip ? '⏭' : data.opt.toUpperCase()}
                              </span>
                              <span className={`text-[10px] ml-auto opacity-75 ${isSlow ? 'text-wrong-red font-bold animate-pulse' : ''}`}>
                                {data.time} {isSlow && '🐢'}
                              </span>

                              {/* Live marks checkboxes */}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => setMark(subject.name, qStr, 'tick')}
                                  title="Mark correct"
                                  className={`w-6 h-6 rounded flex items-center justify-center text-[10px] border cursor-pointer transition-all ${
                                    mark === 'tick'
                                      ? 'bg-correct-green text-white border-correct-green'
                                      : 'bg-white dark:bg-black border-border-light dark:border-border-dark hover:border-correct-green'
                                  }`}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={() => setMark(subject.name, qStr, 'cross')}
                                  title="Mark wrong"
                                  className={`w-6 h-6 rounded flex items-center justify-center text-[10px] border cursor-pointer transition-all ${
                                    mark === 'cross'
                                      ? 'bg-wrong-red text-white border-wrong-red'
                                      : 'bg-white dark:bg-black border-border-light dark:border-border-dark hover:border-wrong-red'
                                  }`}
                                >
                                  ✗
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div className="flex gap-2.5 pt-2 border-t border-border-light dark:border-border-dark/40">
                    <button
                      onClick={() => resetSubject(subject.name)}
                      className="flex-1 py-2 rounded-xl border border-wrong-red bg-wrong-red-light/10 text-wrong-red text-xxs font-bold hover:bg-wrong-red-light/20 active:scale-97 cursor-pointer transition-all"
                    >
                      🗑️ Reset
                    </button>

                    <button
                      onClick={() => saveToHistory(subject)}
                      disabled={answeredCount === 0}
                      className="flex-1 py-2 bg-correct-green text-white text-xxs font-bold rounded-xl hover:opacity-90 active:scale-97 disabled:opacity-40 cursor-pointer transition-all"
                    >
                      💾 Save & Archive
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
