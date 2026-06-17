import React, { useState, useEffect, useRef } from 'react';
import { db, calculateSessionMetrics, type ExerciseSession } from '../db/index';

interface SessionConfig {
  subject: string;
  topic: string;
  totalQuestions: number;
  timerMode: 'stopwatch' | 'timer_binding';
  targetPaceSec?: number;
}

const getOptionBadgeStyle = (option?: string) => {
  if (option === 'A') {
    return 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-400 font-extrabold';
  }
  if (option === 'B') {
    return 'bg-blue-100 dark:bg-blue-950/60 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-400 font-extrabold';
  }
  if (option === 'C') {
    return 'bg-amber-100 dark:bg-amber-950/60 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-400 font-extrabold';
  }
  if (option === 'D') {
    return 'bg-purple-100 dark:bg-purple-950/60 border-purple-400 dark:border-purple-600 text-purple-800 dark:text-purple-400 font-extrabold';
  }
  return 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-extrabold';
};

export default function TactileTimer() {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [currentQ, setCurrentQ] = useState<number>(1);
  const [logs, setLogs] = useState<ExerciseSession['logs']>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // New States for expanded Answer Log grading and Review Mode
  const [isReviewMode, setIsReviewMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'focus' | 'log'>('focus');

  // Undo/Redo States
  const [history, setHistory] = useState<Array<{ logs: ExerciseSession['logs'], currentQ: number }>>([]);
  const [future, setFuture] = useState<Array<{ logs: ExerciseSession['logs'], currentQ: number }>>([]);

  // References for the timer interval and precise timing
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedRef = useRef<number>(0);
  const pausedAtRef = useRef<number | null>(null);
  const pauseAccumRef = useRef<number>(0);

  // Load configuration and cached session state on mount
  useEffect(() => {
    const configStr = sessionStorage.getItem('active_session_config');
    if (!configStr) {
      return;
    }
    const parsedConfig = JSON.parse(configStr) as SessionConfig;
    setConfig(parsedConfig);

    // Initialize logs array based on total questions (0 = unlimited)
    const cachedLogs = sessionStorage.getItem('active_session_logs');
    if (cachedLogs) {
      setLogs(JSON.parse(cachedLogs));
    } else {
      const isUnlimited = parsedConfig.totalQuestions === 0;
      const initialLogs: ExerciseSession['logs'] = Array.from({ length: isUnlimited ? 1 : parsedConfig.totalQuestions }, (_, i) => ({
        qNo: i + 1,
        status: 'skipped',
        timeTakenSeconds: 0,
      }));
      setLogs(initialLogs);
    }

    // Restore page state if present
    const cachedState = sessionStorage.getItem('active_session_state');
    const cachedHistory = sessionStorage.getItem('active_session_history');
    const cachedFuture = sessionStorage.getItem('active_session_future');

    if (cachedHistory) setHistory(JSON.parse(cachedHistory));
    if (cachedFuture) setFuture(JSON.parse(cachedFuture));

    if (cachedState) {
      const state = JSON.parse(cachedState);
      setCurrentQ(state.currentQ);
      setIsPaused(state.isPaused);
      setElapsedTime(state.elapsedTime);
      elapsedRef.current = state.elapsedTime;
      pauseAccumRef.current = state.pauseAccum || 0;
      
      if (state.isPaused) {
        pausedAtRef.current = state.pausedAt || Date.now();
      } else {
        startTimeRef.current = Date.now() - (state.elapsedTime * 1000) - (state.pauseAccum * 1000);
      }
    } else {
      resetTimer();
    }
  }, []);

  // Save state to sessionStorage when variables change
  useEffect(() => {
    if (!config) return;
    sessionStorage.setItem('active_session_logs', JSON.stringify(logs));
    sessionStorage.setItem('active_session_history', JSON.stringify(history));
    sessionStorage.setItem('active_session_future', JSON.stringify(future));
    sessionStorage.setItem(
      'active_session_state',
      JSON.stringify({
        currentQ,
        isPaused,
        elapsedTime,
        pauseAccum: pauseAccumRef.current,
        pausedAt: pausedAtRef.current,
      })
    );
  }, [logs, currentQ, isPaused, elapsedTime, history, future, config]);

  // Audio generation using Web Audio API
  const playTactileBeep = (freq: number, duration: number, volume = 0.04) => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
      
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // AudioContext is blocked
    }
  };

  // Reset timer variables for the current question
  const resetTimer = () => {
    startTimeRef.current = Date.now();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    elapsedRef.current = 0;
    setElapsedTime(0);
  };

  // Push current state to undo history stack
  const pushToHistory = () => {
    setHistory((prev) => [...prev, { logs: JSON.parse(JSON.stringify(logs)), currentQ }]);
    setFuture([]); // Clear redo stack on new action
  };

  // Timer Tick implementation
  useEffect(() => {
    if (isPaused || isReviewMode || !config) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      let accum = pauseAccumRef.current;
      if (pausedAtRef.current) {
        accum += (Date.now() - pausedAtRef.current) / 1000;
      }
      const rawElapsed = (Date.now() - startTimeRef.current) / 1000 - accum;
      const elapsed = Math.max(0, rawElapsed);
      
      elapsedRef.current = elapsed;
      setElapsedTime(elapsed);

      // Timer Binding limits warnings
      if (config.timerMode === 'timer_binding' && config.targetPaceSec) {
        const remaining = config.targetPaceSec - elapsed;
        if (remaining <= 5 && remaining > 0) {
          playTactileBeep(900, 0.05, 0.05);
        } else if (remaining <= 0) {
          playTactileBeep(400, 0.2, 0.08);
          logQuestionAnswer(undefined, 'skipped', Math.round(elapsed));
        }
      }
    }, 100);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isPaused, isReviewMode, config, currentQ]);

  // Pause and Resume control
  const togglePause = () => {
    if (isReviewMode) return;
    setIsPaused((prev) => {
      const next = !prev;
      if (next) {
        pausedAtRef.current = Date.now();
        playTactileBeep(500, 0.1, 0.05);
      } else {
        if (pausedAtRef.current) {
          pauseAccumRef.current += (Date.now() - pausedAtRef.current) / 1000;
        }
        pausedAtRef.current = null;
        startTimeRef.current = Date.now() - (elapsedRef.current * 1000) - (pauseAccumRef.current * 1000);
        playTactileBeep(700, 0.08, 0.05);
      }
      return next;
    });
  };

  // Main function to record answer and advance question
  const logQuestionAnswer = (
    selectedOption?: string,
    directStatus?: 'correct' | 'incorrect' | 'skipped',
    customDuration?: number
  ) => {
    pushToHistory();
    const duration = customDuration !== undefined ? customDuration : Math.round(elapsedRef.current);
    
    // Play feedback beep
    if (directStatus === 'correct') {
      playTactileBeep(880, 0.1, 0.06);
    } else if (directStatus === 'incorrect') {
      playTactileBeep(330, 0.12, 0.06);
    } else {
      playTactileBeep(600, 0.06, 0.04);
    }

    setLogs((prevLogs) => {
      const newLogs = [...prevLogs];
      const index = currentQ - 1;
      
      if (newLogs[index]) {
        const correctOpt = newLogs[index].correctOption;
        let nextStatus: 'correct' | 'incorrect' | 'skipped' = directStatus || 'incorrect';
        
        if (!directStatus) {
          if (selectedOption) {
            nextStatus = correctOpt ? (selectedOption === correctOpt ? 'correct' : 'incorrect') : 'incorrect';
          } else {
            nextStatus = 'skipped';
          }
        }

        newLogs[index] = {
          qNo: currentQ,
          userSelectedOption: selectedOption || newLogs[index].userSelectedOption,
          correctOption: correctOpt,
          status: nextStatus,
          timeTakenSeconds: duration,
        };
      }
      return newLogs;
    });

    // Advance to next question
    const isUnlimited = config.totalQuestions === 0;
    if (isUnlimited || currentQ < config.totalQuestions) {
      const nextQ = currentQ + 1;
      setCurrentQ(nextQ);
      
      // Grow logs array dynamically if unlimited
      if (isUnlimited) {
        setLogs((prev) => {
          if (nextQ > prev.length) {
            return [
              ...prev,
              {
                qNo: nextQ,
                status: 'skipped',
                timeTakenSeconds: 0,
              }
            ];
          }
          return prev;
        });
      }
      resetTimer();
    } else {
      playTactileBeep(1200, 0.25, 0.08); // Success chime
      setIsReviewMode(true);
      setIsPaused(true);
    }
  };

  // Jump to specific question
  const jumpToQuestion = (qNo: number) => {
    if (qNo < 1 || (config && config.totalQuestions !== 0 && qNo > config.totalQuestions)) return;
    pushToHistory();
    setCurrentQ(qNo);
    resetTimer();
  };

  // Undo implementation
  const handleUndo = () => {
    if (history.length === 0) return;
    setFuture((prev) => [...prev, { logs: JSON.parse(JSON.stringify(logs)), currentQ }]);
    
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    
    setLogs(prev.logs);
    setCurrentQ(prev.currentQ);
    resetTimer();
    playTactileBeep(500, 0.08, 0.05);
  };

  // Redo implementation
  const handleRedo = () => {
    if (future.length === 0) return;
    setHistory((prev) => [...prev, { logs: JSON.parse(JSON.stringify(logs)), currentQ }]);
    
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    
    setLogs(next.logs);
    setCurrentQ(next.currentQ);
    resetTimer();
    playTactileBeep(700, 0.08, 0.05);
  };

  // Live marking of answers in Answer Log
  const handleLiveMark = (qNo: number, targetStatus: 'correct' | 'incorrect') => {
    pushToHistory();
    setLogs((prevLogs) => {
      const next = [...prevLogs];
      const idx = qNo - 1;
      if (next[idx]) {
        const log = next[idx];
        const userSel = log.userSelectedOption || 'A';
        const isCurrentlyCorrect = log.status === 'correct';
        const isCurrentlyWrong = log.status === 'incorrect' && log.correctOption !== undefined && log.correctOption !== log.userSelectedOption;

        let nextStatus: 'correct' | 'incorrect' | 'skipped' = 'incorrect';
        let nextCorrOption: string | undefined = undefined;

        if (targetStatus === 'correct') {
          if (isCurrentlyCorrect) {
            nextStatus = 'incorrect';
            nextCorrOption = undefined;
          } else {
            nextStatus = 'correct';
            nextCorrOption = userSel;
            playTactileBeep(880, 0.08, 0.05);
          }
        } else {
          if (isCurrentlyWrong) {
            nextStatus = 'incorrect';
            nextCorrOption = undefined;
          } else {
            nextStatus = 'incorrect';
            nextCorrOption = userSel === 'A' ? 'B' : 'A';
            playTactileBeep(330, 0.1, 0.05);
          }
        }

        next[idx] = {
          ...log,
          status: nextStatus,
          correctOption: nextCorrOption,
        };
      }
      return next;
    });
  };

  // Set correct key from expanded Answer Log
  const handleCorrectKeySelect = (qNo: number, opt: string | null) => {
    pushToHistory();
    setLogs((prevLogs) => {
      const next = [...prevLogs];
      const idx = qNo - 1;
      if (next[idx]) {
        const log = next[idx];
        const userSel = log.userSelectedOption;
        
        let nextStatus: 'correct' | 'incorrect' | 'skipped' = 'incorrect';
        if (!userSel) {
          nextStatus = 'skipped';
        } else if (opt) {
          nextStatus = userSel === opt ? 'correct' : 'incorrect';
        }

        next[idx] = {
          ...log,
          correctOption: opt || undefined,
          status: nextStatus,
        };

        if (opt) {
          if (userSel === opt) {
            playTactileBeep(880, 0.08, 0.05);
          } else {
            playTactileBeep(330, 0.1, 0.05);
          }
        }
      }
      return next;
    });
  };

  // Set user selected option directly from Answer Log card
  const handleUserKeySelect = (qNo: number, opt: string | null) => {
    pushToHistory();
    setLogs((prevLogs) => {
      const next = [...prevLogs];
      const idx = qNo - 1;
      if (next[idx]) {
        const log = next[idx];
        const correctOpt = log.correctOption;
        
        let nextStatus: 'correct' | 'incorrect' | 'skipped' = 'skipped';
        if (opt) {
          if (correctOpt) {
            nextStatus = opt === correctOpt ? 'correct' : 'incorrect';
          }
        }

        next[idx] = {
          ...log,
          userSelectedOption: opt || undefined,
          status: nextStatus,
          timeTakenSeconds: log.timeTakenSeconds || 1, // ensure it has a duration
        };

        playTactileBeep(600, 0.06, 0.04);
      }
      return next;
    });
  };

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (isReviewMode) return;

      const key = e.key.toLowerCase();

      // Spacebar or 'p' toggles pause
      if (e.code === 'Space' || key === ' ' || key === 'p') {
        e.preventDefault();
        togglePause();
        return;
      }

      // Escape resets the current question timer
      if (key === 'escape') {
        e.preventDefault();
        resetTimer();
        playTactileBeep(600, 0.08, 0.05);
        return;
      }

      // Undo shortcut
      if (key === 'u' || (e.ctrlKey && key === 'z')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo shortcut
      if (key === 'r' || (e.ctrlKey && key === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Block answering if paused
      if (isPaused) return;

      // Skip shortcut
      if (key === 's' || e.key === 'ArrowRight') {
        e.preventDefault();
        logQuestionAnswer(undefined, 'skipped');
      } 
      // Option Selection Shortcuts (A-D)
      else if (['a', 'b', 'c', 'd'].includes(key)) {
        e.preventDefault();
        logQuestionAnswer(key.toUpperCase());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaused, isReviewMode, currentQ, logs, history, future, config]);

  // Finish active session and go to review mode
  const finishSession = () => {
    setIsReviewMode(true);
    setIsPaused(true);
  };

  // Compile final results and save to IndexedDB
  const handleSaveSession = async () => {
    if (!config) return;

    // Final evaluation loop to ensure correctOption & status match
    const finalizedLogs = logs.map((log) => {
      const corr = log.correctOption;
      const userSel = log.userSelectedOption;
      
      let finalStatus: 'correct' | 'incorrect' | 'skipped' = log.status;
      if (!userSel) {
        finalStatus = 'skipped';
      } else if (corr) {
        finalStatus = userSel === corr ? 'correct' : 'incorrect';
      }

      return {
        qNo: log.qNo,
        userSelectedOption: userSel,
        correctOption: corr || undefined,
        status: finalStatus,
        timeTakenSeconds: log.timeTakenSeconds,
      };
    });

    const metrics = calculateSessionMetrics(finalizedLogs);
    const totalDuration = metrics.totalDurationSec;
    const startTime = new Date(Date.now() - totalDuration * 1000).toISOString();
    const endTime = new Date().toISOString();

    const session = {
      sessionId: `mcq_practice_${Date.now()}`,
      subject: config.subject,
      topic: config.topic,
      startTime,
      endTime,
      totalQuestions: config.totalQuestions === 0 ? finalizedLogs.length : config.totalQuestions,
      timerMode: config.timerMode,
      targetPaceSec: config.targetPaceSec,
      metrics,
      logs: finalizedLogs,
    };

    try {
      await db.sessions.put(session);
      
      // Clean up sessionStorage
      sessionStorage.removeItem('active_session_config');
      sessionStorage.removeItem('active_session_logs');
      sessionStorage.removeItem('active_session_state');
      
      // Navigate to home dashboard
      window.location.href = '/';
    } catch (err) {
      console.error('Failed to save session to IndexedDB:', err);
      alert('Error saving test logs to offline database.');
    }
  };

  if (!config) {
    return (
      <div className="text-center py-16">
        <span className="text-4xl">⚠️</span>
        <h2 className="text-xl font-bold mt-4">No Active Session Found</h2>
        <p className="text-text-light-muted dark:text-text-dark-muted mt-2">
          Please set up a new test session before launching.
        </p>
        <a
          href="/new-session"
          className="inline-block mt-6 px-6 py-3 bg-brand-primary dark:bg-brand-secondary text-white font-bold rounded-xl transition-all decoration-none shadow-md"
        >
          Configure Session
        </a>
      </div>
    );
  }

  // Timer Calculations
  const displayTime = () => {
    if (config.timerMode === 'timer_binding' && config.targetPaceSec) {
      const remaining = Math.max(0, config.targetPaceSec - elapsedTime);
      return `${Math.ceil(remaining)}s`;
    }
    const m = Math.floor(elapsedTime / 60);
    const s = Math.floor(elapsedTime % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatSeconds = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const targetPace = config.targetPaceSec || 45;
  const strokeDash = 2 * Math.PI * 48; // Accurate circumference for radius 48 is ~301.59
  const remainingFraction = config.timerMode === 'timer_binding' ? Math.max(0, targetPace - elapsedTime) / targetPace : 0;
  const strokeOffset = strokeDash - remainingFraction * strokeDash;
  const isTimeLow = config.timerMode === 'timer_binding' && (targetPace - elapsedTime) <= 10;

  // Answer Log calculation
  const answeredLogs = logs.filter((log) => log.timeTakenSeconds > 0 || log.userSelectedOption !== undefined);
  const totalTime = answeredLogs.reduce((acc, curr) => acc + curr.timeTakenSeconds, 0);
  const liveAvg = answeredLogs.length > 0 ? Math.round(totalTime / answeredLogs.length) : 0;

  // Render Full Review Mode
  if (isReviewMode) {
    const correctCount = logs.filter((log) => log.status === 'correct').length;
    const wrongCount = logs.filter((log) => log.status === 'incorrect' && log.userSelectedOption !== undefined).length;
    const skippedCount = logs.filter((log) => !log.userSelectedOption).length;
    const accuracy = answeredLogs.length > 0 ? Math.round((correctCount / answeredLogs.length) * 100) : 0;

    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
        {/* Review Banner / Stats summary */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-6 rounded-2xl shadow-custom flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-colors">
          <div>
            <span className="text-xxs font-bold uppercase tracking-wider text-brand-primary dark:text-brand-secondary">
              Grading & Verification (Review Mode)
            </span>
            <h2 className="font-display font-extrabold text-2xl mt-1 text-text-light dark:text-text-dark">
              {config.topic}
            </h2>
            <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-0.5">
              Subject: {config.subject} · {config.totalQuestions === 0 ? 'Free Flow Practice' : `Total ${config.totalQuestions} questions`}
            </p>
          </div>

          <div className="flex gap-4 text-center">
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Accuracy</span>
              <span className="font-display font-black text-xl sm:text-2xl text-brand-primary dark:text-brand-secondary">
                {accuracy}%
              </span>
            </div>
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Correct</span>
              <span className="font-display font-black text-xl sm:text-2xl text-correct-green">
                {correctCount}
              </span>
            </div>
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Wrong</span>
              <span className="font-display font-black text-xl sm:text-2xl text-wrong-red">
                {wrongCount}
              </span>
            </div>
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Skipped</span>
              <span className="font-display font-black text-xl sm:text-2xl text-skip-purple">
                {skippedCount}
              </span>
            </div>
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Avg Time</span>
              <span className="font-mono-custom font-extrabold text-xl sm:text-2xl text-brand-primary dark:text-brand-secondary">
                {formatSeconds(liveAvg)}
              </span>
            </div>
            <div>
              <span className="block text-xxs uppercase font-bold tracking-wider text-text-light-muted dark:text-text-dark-muted">Total Time</span>
              <span className="font-mono-custom font-extrabold text-xl sm:text-2xl text-text-light dark:text-text-dark">
                {formatSeconds(totalTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Expanded Grading Sheet Table Grid */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-custom space-y-6 transition-colors">
          <div className="border-b border-border-light dark:border-border-dark pb-4 flex justify-between items-center">
            <h3 className="font-display font-black text-lg text-text-light dark:text-text-dark uppercase tracking-wider flex items-center gap-2">
              📝 Live Answer Log
            </h3>
            <span className="text-xxs text-text-light-muted dark:text-text-dark-muted font-mono-custom">
              Review your answers, select Correct Keys, or override ticks manually
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {logs.map((log) => {
              const qNo = log.qNo;
              const userAns = log.userSelectedOption;
              const correctKey = log.correctOption || '';
              const isCorrect = correctKey && userAns === correctKey;
              const isWrong = correctKey && userAns && userAns !== correctKey;
              const isSkipped = !userAns;
              const isSlow = log.timeTakenSeconds > 240 || (config.targetPaceSec && log.timeTakenSeconds > config.targetPaceSec * 2);

              let cellBg = 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark';
              let statusTextColor = 'text-text-light dark:text-text-dark';

              if (isCorrect) {
                cellBg = 'bg-correct-green-light dark:bg-correct-green-dark/25 border-correct-green';
                statusTextColor = 'text-correct-green-dark dark:text-correct-green';
              } else if (isWrong) {
                cellBg = 'bg-wrong-red-light dark:bg-wrong-red-dark/25 border-wrong-red';
                statusTextColor = 'text-wrong-red-dark dark:text-wrong-red';
              } else if (isSkipped) {
                cellBg = 'bg-skip-purple-light dark:bg-skip-purple-dark/20 border-skip-purple';
                statusTextColor = 'text-skip-purple-dark dark:text-skip-purple';
              }

              return (
                <div
                  key={qNo}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 shadow-sm transition-all duration-300 ${cellBg}`}
                >
                  {/* Header Row */}
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-custom text-base font-black text-text-light dark:text-text-dark">Q{qNo}</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-md font-mono-custom border shadow-sm ${getOptionBadgeStyle(userAns)}`}>
                        {userAns || 'SKIPPED'}
                      </span>
                    </div>
                    <span className="text-xs font-mono-custom text-text-light-muted dark:text-text-dark-muted whitespace-nowrap">
                      ⏱️ {log.timeTakenSeconds > 0 ? formatSeconds(log.timeTakenSeconds) : '—'} {isSlow && '🐢'}
                    </span>
                  </div>

                  {/* Correct Key Select & Manual Ticks Single Row */}
                  <div className="flex items-center justify-between pt-2 border-t border-border-light dark:border-border-dark/30">
                    <button
                      onClick={() => handleLiveMark(qNo, 'correct')}
                      className={`w-12 h-10 rounded-xl flex items-center justify-center text-sm font-bold border cursor-pointer transition-all ${
                        isCorrect
                          ? 'bg-correct-green text-white border-correct-green shadow-sm'
                          : 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark hover:border-correct-green text-correct-green'
                      }`}
                      title="Mark Correct"
                    >
                      ✓
                    </button>

                    <button
                      onClick={() => handleLiveMark(qNo, 'incorrect')}
                      className={`w-12 h-10 rounded-xl flex items-center justify-center text-sm font-bold border cursor-pointer transition-all ${
                        isWrong
                          ? 'bg-wrong-red text-white border-wrong-red shadow-sm'
                          : 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark hover:border-wrong-red text-wrong-red'
                      }`}
                      title="Mark Wrong"
                    >
                      ✗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Row */}
          <div className="border-t border-border-light dark:border-border-dark pt-5 flex flex-col sm:flex-row gap-3 justify-between">
            <button
              onClick={() => {
                setIsReviewMode(false);
                setIsPaused(false);
              }}
              className="px-6 py-3 border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark font-bold rounded-xl text-center hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-all text-sm cursor-pointer"
            >
              ↩ Resume Practice Session
            </button>
            <button
              onClick={handleSaveSession}
              className="px-8 py-3 bg-brand-primary dark:bg-brand-secondary hover:opacity-95 text-white font-bold rounded-xl transition-all shadow-md cursor-pointer text-sm"
            >
              Save Session & View Dashboard ➔
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Mobile-Only Tabs Header */}
      <div className="flex md:hidden border border-border-light dark:border-border-dark rounded-xl bg-surface-light dark:bg-surface-dark p-1 shadow-custom">
        <button
          onClick={() => setActiveTab('focus')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'focus'
              ? 'bg-brand-primary dark:bg-brand-secondary text-white shadow-xs'
              : 'text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark'
          }`}
        >
          ⏱️ Focus Timer
        </button>
        <button
          onClick={() => setActiveTab('log')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'log'
              ? 'bg-brand-primary dark:bg-brand-secondary text-white shadow-xs'
              : 'text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark'
          }`}
        >
          📝 Live Answer Log ({answeredLogs.length})
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-stretch">
        {/* Left Column: Timer & Controls (Sidebar Focus) */}
        <div className={`w-full md:w-80 flex flex-col gap-6 ${activeTab === 'focus' ? 'flex' : 'hidden md:flex'}`}>
        
        {/* Main Answering / Focus Column */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-custom flex flex-col justify-between items-center relative min-h-[500px]">
          {/* Top Info Header */}
          <div className="w-full flex justify-between items-center border-b border-border-light dark:border-border-dark pb-3 mb-3">
            <div>
              <h2 className="text-md font-bold truncate max-w-[150px] text-brand-primary dark:text-brand-secondary">
                {config.topic}
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                title={soundEnabled ? "Mute sounds" : "Enable ticking sounds"}
                className="p-1.5 rounded-lg border border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted hover:bg-bg-light dark:hover:bg-bg-dark transition-colors cursor-pointer text-xs"
              >
                {soundEnabled ? '🔊' : '🔇'}
              </button>
              <span className="px-2 py-0.5 rounded-full text-xxs font-bold bg-brand-primary/10 dark:bg-brand-secondary/10 text-brand-primary dark:text-brand-secondary uppercase tracking-wider font-mono-custom">
                {config.timerMode === 'timer_binding' ? 'Binding' : 'Stopwatch'}
              </span>
            </div>
          </div>

          {/* Big Focus Screen */}
          <div className="flex-1 flex flex-col items-center justify-center py-2 w-full">
            {/* Timer Display */}
            <div className="relative flex items-center justify-center w-28 h-28 mb-3">
              {config.timerMode === 'timer_binding' ? (
                <>
                  <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 112 112">
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      className="stroke-border-light dark:stroke-border-dark fill-none"
                      strokeWidth="6"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      className={`fill-none transition-all duration-100 ${
                        isTimeLow 
                          ? 'stroke-wrong-red animate-pulse-ring' 
                          : 'stroke-correct-green dark:stroke-brand-secondary'
                      }`}
                      strokeWidth="6"
                      strokeDasharray={strokeDash}
                      strokeDashoffset={strokeOffset}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className={`text-xl sm:text-2xl font-extrabold font-mono-custom ${isTimeLow ? 'text-wrong-red' : 'text-text-light dark:text-text-dark'}`}>
                    {displayTime()}
                  </div>
                </>
              ) : (
                <div className="w-full h-full rounded-full border-4 border-border-light dark:border-border-dark flex flex-col items-center justify-center bg-bg-light dark:bg-bg-dark shadow-inner">
                  <span className="text-xxs uppercase tracking-widest text-text-light-muted dark:text-text-dark-muted">Time</span>
                  <span className={`text-xl sm:text-2xl font-extrabold font-mono-custom mt-0.5 ${isPaused ? 'text-amber-orange' : 'text-brand-primary dark:text-brand-secondary'}`}>
                    {displayTime()}
                  </span>
                </div>
              )}
            </div>

            {/* Question Indicator */}
            <div className="text-center">
              <span className="text-xxs uppercase font-bold tracking-widest text-text-light-muted dark:text-text-dark-muted">Current</span>
              <h3 className="font-display font-black text-2xl sm:text-3xl text-text-light dark:text-text-dark select-none">
                Q{currentQ}
              </h3>
              <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-0.5">
                {config.totalQuestions === 0 ? 'Free Flow Practice' : `out of ${config.totalQuestions} questions`}
              </p>
            </div>
          </div>

          {/* Answering Panel */}
          <div className="w-full space-y-3">
            {isPaused && (
              <div className="py-1.5 px-3 rounded-lg text-center text-xs font-semibold bg-amber-orange-light dark:bg-amber-orange-dark/20 text-amber-orange border border-amber-orange animate-pulse">
                Session Paused
              </div>
            )}

            {/* Jump Question */}
            <div className="flex items-center gap-2 p-2 bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark rounded-xl">
              <input
                type="number"
                id="start-q-input"
                min={1}
                placeholder="JUMP TO QUES. NO."
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark text-xxs font-bold tracking-wider focus:outline-none placeholder-text-light-muted/50 dark:placeholder-text-dark-muted/50"
              />
              <button
                onClick={() => {
                  const input = document.getElementById('start-q-input') as HTMLInputElement;
                  const val = parseInt(input?.value, 10);
                  if (val >= 1 && (config.totalQuestions === 0 || val <= config.totalQuestions)) {
                    jumpToQuestion(val);
                    input.value = '';
                  }
                }}
                className="px-4 py-1.5 bg-brand-primary dark:bg-brand-secondary text-white rounded-lg text-xs font-bold cursor-pointer transition-all active:scale-[0.97]"
              >
                GO
              </button>
            </div>

            {/* Option Selection Matrix */}
            <div className="grid grid-cols-2 gap-3">
              {['A', 'B', 'C', 'D'].map((opt) => {
                let hoverColor = '';
                if (opt === 'A') hoverColor = 'hover:border-emerald-500 hover:text-emerald-600 hover:shadow-sm hover:shadow-emerald-500/10 dark:hover:border-emerald-400 dark:hover:text-emerald-400';
                else if (opt === 'B') hoverColor = 'hover:border-blue-500 hover:text-blue-600 hover:shadow-sm hover:shadow-blue-500/10 dark:hover:border-blue-400 dark:hover:text-blue-400';
                else if (opt === 'C') hoverColor = 'hover:border-amber-orange hover:text-amber-orange hover:shadow-sm hover:shadow-amber-orange/10 dark:hover:border-amber-orange dark:hover:text-amber-orange';
                else if (opt === 'D') hoverColor = 'hover:border-purple-500 hover:text-purple-600 hover:shadow-sm hover:shadow-purple-500/10 dark:hover:border-purple-400 dark:hover:text-purple-400';

                return (
                  <button
                    key={opt}
                    disabled={isPaused}
                    onClick={() => logQuestionAnswer(opt)}
                    className={`py-3.5 sm:py-5 rounded-2xl border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark font-display font-extrabold text-text-light dark:text-text-dark active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer flex flex-col items-center justify-center ${hoverColor}`}
                  >
                    <span className="text-2xl sm:text-3xl font-black">{opt}</span>
                    <span className="hidden md:block text-xs font-normal font-mono-custom text-text-light-muted dark:text-text-dark-muted mt-1">Key {opt}</span>
                  </button>
                );
              })}
            </div>

            {/* Action Row */}
            <div className="flex gap-2">
              <button
                onClick={() => logQuestionAnswer(undefined, 'skipped')}
                disabled={isPaused}
                className="flex-1 py-2 text-xxs font-bold rounded-xl border border-dashed border-purple-400 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/35 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/20 transition-all cursor-pointer"
              >
                Skip (S)
              </button>
              <button
                onClick={() => {
                  resetTimer();
                  playTactileBeep(600, 0.08, 0.05);
                }}
                className="flex-1 py-2 text-xxs font-bold rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-all cursor-pointer"
              >
                Reset (Esc)
              </button>
              <button
                onClick={togglePause}
                className={`flex-1 py-2 text-xxs font-bold rounded-xl border cursor-pointer ${
                  isPaused
                    ? 'bg-amber-orange text-white border-amber-orange shadow-md shadow-amber-orange/15'
                    : 'bg-surface-light dark:bg-surface-dark border-border-light dark:border-border-dark text-text-light dark:text-text-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover'
                }`}
              >
                {isPaused ? 'Resume (P)' : 'Pause (P)'}
              </button>
            </div>

            {/* Undo / Redo */}
            <div className="flex gap-2">
              <button
                onClick={handleUndo}
                disabled={history.length === 0}
                className="flex-1 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-xs font-bold text-text-light dark:text-text-dark hover:border-brand-primary dark:hover:border-brand-secondary hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover active:scale-[0.97] transition-all disabled:opacity-30 cursor-pointer"
              >
                ↩ Undo (U)
              </button>
              <button
                onClick={handleRedo}
                disabled={future.length === 0}
                className="flex-1 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-xs font-bold text-text-light dark:text-text-dark hover:border-brand-primary dark:hover:border-brand-secondary hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover active:scale-[0.97] transition-all disabled:opacity-30 cursor-pointer"
              >
                ↪ Redo (R)
              </button>
            </div>

            {/* Finish Session */}
            <button
              onClick={finishSession}
              className="w-full py-3 bg-gradient-to-r from-correct-green to-emerald-600 hover:brightness-105 text-white font-extrabold rounded-xl shadow-md transition-all active:scale-[0.98] cursor-pointer text-xs uppercase tracking-wide"
            >
              🏁 Finish Session
            </button>
          </div>
        </div>

        {/* Question Matrix */}
        <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-4 shadow-custom flex flex-col">
          <h3 className="font-display font-extrabold text-xs uppercase tracking-wider text-text-light dark:text-text-dark border-b border-border-light dark:border-border-dark pb-2 mb-2">
            Question Matrix
          </h3>
          <div className="grid grid-cols-5 gap-1.5 overflow-y-auto max-h-[140px] pr-1">
            {logs.map((log, index) => {
              const qNumber = index + 1;
              const isCurrent = qNumber === currentQ;
              const isAnswered = log.userSelectedOption !== undefined;
              const isSkipped = log.status === 'skipped';
              const isCorrectDirect = log.status === 'correct';
              const isWrongDirect = log.status === 'incorrect' && log.timeTakenSeconds > 0 && !isAnswered;

              let cellBg = 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted';
              if (isCurrent) {
                cellBg = 'bg-brand-primary/10 dark:bg-brand-secondary/15 border-brand-primary dark:border-brand-secondary text-brand-primary dark:text-brand-secondary ring-2 ring-brand-primary/25 dark:ring-brand-secondary/25';
              } else if (isCorrectDirect) {
                cellBg = 'bg-correct-green-light dark:bg-correct-green-dark/30 border-correct-green text-correct-green';
              } else if (isWrongDirect) {
                cellBg = 'bg-wrong-red-light dark:bg-wrong-red-dark/30 border-wrong-red text-wrong-red';
              } else if (isAnswered) {
                cellBg = 'bg-amber-orange-light dark:bg-amber-orange-dark/30 border-amber-orange text-amber-orange';
              } else if (isSkipped && log.timeTakenSeconds > 0) {
                cellBg = 'bg-skip-purple-light dark:bg-skip-purple-dark/30 border-skip-purple text-skip-purple';
              }

              return (
                <button
                  key={qNumber}
                  onClick={() => jumpToQuestion(qNumber)}
                  className={`h-9 rounded-lg border font-mono-custom text-xxs font-bold transition-all active:scale-[0.93] flex flex-col items-center justify-center cursor-pointer ${cellBg}`}
                >
                  <span>{qNumber}</span>
                  <span className="text-3xs opacity-75">
                    {log.userSelectedOption || (isCorrectDirect ? '✓' : isWrongDirect ? '✗' : isSkipped && log.timeTakenSeconds > 0 ? '»' : '—')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Shortcuts Legend */}
        <div className="hidden md:block p-3.5 bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark rounded-xl space-y-2 text-xs font-mono-custom text-text-light-muted dark:text-text-dark-muted leading-relaxed">
          <div className="font-bold text-text-light dark:text-text-dark border-b border-border-light dark:border-border-dark pb-1 mb-1 text-[10px] uppercase tracking-wider">
            Shortcuts
          </div>
          <div className="flex justify-between items-center">
            <span>Answers:</span>
            <span className="flex gap-1">
              {['A', 'B', 'C', 'D'].map((k) => (
                <kbd key={k} className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">{k}</kbd>
              ))}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Skip:</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">S</kbd>
              <span className="text-text-light-muted dark:text-text-dark-muted">/</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">➔</kbd>
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Undo / Redo:</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">U</kbd>
              <span className="text-text-light-muted dark:text-text-dark-muted">/</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">R</kbd>
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Reset:</span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark rounded shadow-xs text-text-light dark:text-text-dark font-bold">Esc</kbd>
          </div>
          <div className="flex justify-between items-center">
            <span>Pause:</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/25 rounded shadow-xs text-amber-800 dark:text-amber-orange font-bold">Space</kbd>
              <span className="text-text-light-muted dark:text-text-dark-muted">/</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/25 rounded shadow-xs text-amber-800 dark:text-amber-orange font-bold">P</kbd>
            </span>
          </div>
        </div>
      </div>

      {/* Right Column: Broad & Main-Focused Live Answer Log */}
      <div className={`flex-1 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-6 shadow-custom flex flex-col min-h-[500px] ${activeTab === 'log' ? 'flex' : 'hidden md:flex'}`}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-border-light dark:border-border-dark pb-4 mb-4">
          <div>
            <h3 className="font-display font-black text-lg text-text-light dark:text-text-dark uppercase tracking-wider flex items-center gap-2">
              📝 Live Answer Log
            </h3>
            <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-0.5">
              Review, mark, and check your options directly below
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold font-mono-custom bg-brand-primary/10 dark:bg-brand-secondary/15 text-brand-primary dark:text-brand-secondary px-3 py-1 rounded-full">
              Avg Pace: {formatSeconds(liveAvg)}
            </span>
          </div>
        </div>

        {/* Scrollable Answer Log List */}
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {logs.map((log) => {
              const isSlow = log.timeTakenSeconds > 240 || (config.targetPaceSec && log.timeTakenSeconds > config.targetPaceSec * 2);
              const isCorrect = log.status === 'correct';
              const isWrong = log.status === 'incorrect' && log.correctOption !== undefined && log.correctOption !== log.userSelectedOption;
              const isSkipped = log.status === 'skipped';
              const isCurrent = log.qNo === currentQ;

              let cardBg = 'bg-bg-light/40 dark:bg-bg-dark/40 border-border-light dark:border-border-dark';
              let statusBorder = 'border-l-4 border-l-border-light dark:border-l-border-dark';
              
              if (isCorrect) {
                cardBg = 'bg-correct-green-light dark:bg-correct-green-dark/15 border-correct-green/35';
                statusBorder = 'border-l-4 border-l-correct-green';
              } else if (isWrong) {
                cardBg = 'bg-wrong-red-light dark:bg-wrong-red-dark/15 border-wrong-red/35';
                statusBorder = 'border-l-4 border-l-wrong-red';
              } else if (isSkipped && log.timeTakenSeconds > 0) {
                cardBg = 'bg-skip-purple-light dark:bg-skip-purple-dark/15 border-skip-purple/35';
                statusBorder = 'border-l-4 border-l-skip-purple';
              }

              const activeRing = isCurrent 
                ? 'ring-2 ring-brand-primary dark:ring-brand-secondary border-transparent shadow-md shadow-brand-primary/5 dark:shadow-brand-secondary/5 animate-pulse-subtle' 
                : 'hover:border-border-light/80 dark:hover:border-border-dark/60';

              return (
                <div
                  key={log.qNo}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition-all ${cardBg} ${statusBorder} ${activeRing}`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-custom text-base font-black text-text-light dark:text-text-dark">Q{log.qNo}</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-md font-mono-custom border shadow-sm ${getOptionBadgeStyle(log.userSelectedOption)}`}>
                        {log.userSelectedOption || 'SKIPPED'}
                      </span>
                    </div>
                    <span className="text-xs font-mono-custom text-text-light-muted dark:text-text-dark-muted whitespace-nowrap">
                      ⏱️ {log.timeTakenSeconds > 0 ? formatSeconds(log.timeTakenSeconds) : '—'} {isSlow && '🐢'}
                    </span>
                  </div>

                  {/* Tick on left, Cross on right */}
                  <div className="flex items-center justify-between pt-2 border-t border-border-light dark:border-border-dark/40">
                    <button
                      onClick={() => handleLiveMark(log.qNo, 'correct')}
                      className={`w-12 h-10 rounded-xl flex items-center justify-center text-sm font-bold border cursor-pointer transition-all ${
                        isCorrect
                          ? 'bg-correct-green text-white border-correct-green shadow-sm'
                          : 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark hover:border-correct-green text-correct-green'
                      }`}
                      title="Mark Correct"
                    >
                      ✓
                    </button>

                    <button
                      onClick={() => handleLiveMark(log.qNo, 'incorrect')}
                      className={`w-12 h-10 rounded-xl flex items-center justify-center text-sm font-bold border cursor-pointer transition-all ${
                        isWrong
                          ? 'bg-wrong-red text-white border-wrong-red shadow-sm'
                          : 'bg-bg-light dark:bg-bg-dark border-border-light dark:border-border-dark hover:border-wrong-red text-wrong-red'
                      }`}
                      title="Mark Wrong"
                    >
                      ✗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
