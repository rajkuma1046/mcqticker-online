import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, migrateFromLocalStorage, type ExerciseSession } from '../db/index';
import HistoryDashboard from './HistoryDashboard';

export default function DashboardContainer() {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [migrationTrigger, setMigrationTrigger] = useState<number>(0);

  // Automatically migrate localStorage on mount
  useEffect(() => {
    async function runMigration() {
      await migrateFromLocalStorage();
      // Trigger state reload after migration completes
      setMigrationTrigger((prev) => prev + 1);
    }
    runMigration();
  }, []);

  // Fetch sessions reactively from Dexie.js
  const sessions = useLiveQuery(
    async () => {
      const all = await db.sessions.toArray();
      // Sort newest sessions first
      return all.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    },
    [migrationTrigger]
  );

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid expanding card when clicking delete
    if (!confirm('Are you sure you want to delete this study session history?')) return;
    try {
      await db.sessions.delete(sessionId);
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleResetAllData = async () => {
    if (!confirm('WARNING: This will permanently delete ALL subjects, study sessions, and offline history! This cannot be undone.')) return;
    try {
      await db.sessions.clear();
      await db.activeSubjects.clear();
      sessionStorage.clear();
      setExpandedSessionId(null);
      alert('All offline tracker data wiped successfully.');
    } catch (err) {
      console.error('Failed to clear database:', err);
    }
  };

  const toggleExpandSession = (sessionId: string) => {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatDate = (isoStr: string) => {
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-8">
      {/* Welcome Header Hero */}
      <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-6 rounded-2xl shadow-custom flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-colors">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-text-light dark:text-text-dark">
            tap A B C D — MCQ Practice Tool
          </h2>
          <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-1 max-w-sm sm:max-w-md">
            Mark MCQ answers online without typing. Tick options, track your pacing, and analyse session logs — fully offline.
          </p>
        </div>

        <a
          href="/new-session"
          className="px-6 py-3.5 bg-brand-primary dark:bg-brand-secondary hover:opacity-95 text-white font-bold text-sm rounded-xl transition-all shadow-md decoration-none flex items-center gap-2 whitespace-nowrap self-stretch sm:self-auto justify-center cursor-pointer"
        >
          <span className="material-symbols-outlined text-base">bolt</span>
          Start Structured Session
        </a>
      </div>

      <div className="space-y-8 animate-fadeIn">
          {/* Analytics Charts Island */}
          <HistoryDashboard sessions={sessions || []} />

          {/* Session History List */}
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border-light dark:border-border-dark pb-3">
              <h3 className="font-display font-extrabold text-base text-text-light dark:text-text-dark">
                Session History Log ({sessions ? sessions.length : 0})
              </h3>
              {sessions && sessions.length > 0 && (
                <button
                  onClick={handleResetAllData}
                  className="px-3 py-1.5 rounded-lg border border-wrong-red bg-wrong-red-light/10 text-wrong-red hover:bg-wrong-red-light/20 text-xxs font-bold cursor-pointer transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">delete_sweep</span>
                  Reset All Data
                </button>
              )}
            </div>

            {!sessions ? (
              <div className="text-center py-10 text-xs text-text-light-muted dark:text-text-dark-muted">
                Loading database sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-16 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl">
                <span className="material-symbols-outlined text-5xl text-brand-primary dark:text-brand-secondary">menu_book</span>
                <h4 className="text-sm font-bold mt-3 text-text-light dark:text-text-dark">No sessions logged yet</h4>
                <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1">
                  Configure and start a new test above to track MCQ answering logs.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => {
                  const isExpanded = expandedSessionId === session.sessionId;
                  const hasMetrics = !!session.metrics;
                  const sessionAvgSec = hasMetrics
                    ? Math.round(session.metrics!.totalDurationSec / session.totalQuestions)
                    : 0;

                  return (
                    <div
                      key={session.sessionId}
                      onClick={() => toggleExpandSession(session.sessionId)}
                      className={`bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl shadow-custom overflow-hidden transition-all duration-200 cursor-pointer ${
                        isExpanded ? 'ring-1 ring-brand-primary/20 dark:ring-brand-secondary/35' : 'hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover'
                      }`}
                    >
                      {/* Card Header Summary */}
                      <div className="p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display font-extrabold text-base text-text-light dark:text-text-dark">
                              {session.subject}
                            </span>
                            <span className="text-xxs px-2 py-0.5 rounded-full font-mono-custom bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted">
                              {session.timerMode === 'timer_binding' ? 'Timer Binding' : 'Stopwatch'}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xxs text-text-light-muted dark:text-text-dark-muted">
                            <span>Topic: {session.topic}</span>
                            <span>•</span>
                            <span>{formatDate(session.startTime)}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-5">
                          <div className="flex items-center gap-4 text-center sm:text-right">
                            {hasMetrics && (
                              <>
                                <div>
                                  <span className="block text-[9px] uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">Accuracy</span>
                                  <span className="font-display font-black text-sm text-brand-primary dark:text-brand-secondary">
                                    {session.metrics!.accuracy}%
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[9px] uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">Speed</span>
                                  <span className="font-mono-custom font-bold text-xs">
                                    {sessionAvgSec}s/Q
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[9px] uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">Duration</span>
                                  <span className="font-mono-custom font-bold text-xs text-text-light dark:text-text-dark">
                                    {formatSeconds(session.metrics!.totalDurationSec)}
                                  </span>
                                </div>
                              </>
                            )}
                            <div>
                              <span className="block text-[9px] uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">Qs</span>
                              <span className="font-mono-custom font-bold text-xs text-text-light dark:text-text-dark">
                                {session.totalQuestions}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => handleDeleteSession(session.sessionId, e)}
                            title="Delete Session"
                            aria-label="Delete Session"
                            className="p-2 border border-border-light dark:border-border-dark rounded-xl bg-bg-light dark:bg-bg-dark text-text-light-muted dark:text-text-dark-muted hover:text-wrong-red hover:bg-wrong-red-light/10 transition-colors cursor-pointer flex items-center justify-center"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Expanded Detail Logs */}
                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-border-light dark:border-border-dark bg-bg-light/40 dark:bg-bg-dark/30 pt-4 space-y-4">
                          <div className="flex justify-between items-center text-xs border-b border-border-light dark:border-border-dark pb-2">
                            <span className="font-display font-bold">Answering Sheet Logs</span>
                            <span className="text-xxs text-text-light-muted dark:text-text-dark-muted font-mono-custom">
                              Click header again to collapse
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
                            {session.logs.map((log) => {
                              const isCorrect = log.status === 'correct';
                              const isWrong = log.status === 'incorrect';
                              const isSkipped = log.status === 'skipped';

                              // Check if time spent is > 2x target pace or session average
                              const threshold = (session.targetPaceSec || sessionAvgSec || 45) * 2;
                              const isSlow = log.timeTakenSeconds > threshold;

                              let badgeColor = 'bg-surface-light dark:bg-surface-dark border-border-light dark:border-border-dark';
                              let mark = '—';
                              let text = 'text-text-light dark:text-text-dark';

                              if (isCorrect) {
                                badgeColor = 'bg-correct-green-light dark:bg-correct-green-dark/35 border-correct-green';
                                mark = '✓';
                                text = 'text-correct-green-dark dark:text-correct-green';
                              } else if (isWrong) {
                                badgeColor = 'bg-wrong-red-light dark:bg-wrong-red-dark/35 border-wrong-red';
                                mark = '✗';
                                text = 'text-wrong-red-dark dark:text-wrong-red';
                              } else if (isSkipped) {
                                badgeColor = 'bg-skip-purple-light dark:bg-skip-purple-dark/25 border-skip-purple';
                                mark = '»';
                                text = 'text-skip-purple-dark dark:text-skip-purple';
                              }

                              return (
                                <div
                                  key={log.qNo}
                                  title={`Time spent: ${log.timeTakenSeconds}s\nSelected: ${log.userSelectedOption || 'None'}\nCorrect: ${log.correctOption || 'None'}`}
                                  className={`p-2 rounded-lg border flex flex-col justify-between items-center text-center font-mono-custom text-xxs transition-colors ${badgeColor}`}
                                >
                                  <div className="font-bold text-xxs opacity-75 text-text-light-muted dark:text-text-dark-muted">Q{log.qNo}</div>
                                  <div className={`text-sm font-black my-1 ${text}`}>
                                    {log.userSelectedOption || mark}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-xxs ${isSlow ? 'text-wrong-red font-bold animate-pulse' : 'opacity-60'}`}>
                                      {log.timeTakenSeconds}s {isSlow && '🐢'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
