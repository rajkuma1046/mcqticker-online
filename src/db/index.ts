import Dexie, { type Table } from 'dexie';

export interface ExerciseSession {
  sessionId: string;          // Format: subject_timestamp (primary key)
  subject: string;            // e.g., "Mathematics", "English"
  topic: string;              // e.g., "Geometry", "Idioms"
  startTime: string;          // ISO Date String
  endTime?: string;           // ISO Date String
  totalQuestions: number;     // Number of questions in session
  targetPaceSec?: number;     // Target seconds per question
  timerMode: 'stopwatch' | 'timer_binding';
  
  metrics?: {
    accuracy: number;         // Percentage (0-100)
    totalDurationSec: number;
    avgTimeCorrectSec: number;
    avgTimeWrongSec: number;
    avgTimeSkippedSec: number;
  };
  
  logs: Array<{
    qNo: number;
    userSelectedOption?: string; // "A", "B", "C", "D"
    correctOption?: string;      // Populated via manual checker or OCR
    status: 'correct' | 'incorrect' | 'skipped';
    timeTakenSeconds: number;
  }>;
}

class MCQTrackerDB extends Dexie {
  sessions!: Table<ExerciseSession>;
  activeSubjects!: Table<{
    name: string;
    currentQ: number;
    answers: Record<string, { opt: string; time: string; raw: number }>;
    marks: Record<string, string>;
    paused: boolean;
    pauseAccum: number;
    pausedAt: number | null;
    startTime: number;
    history?: Array<{ answers: Record<string, { opt: string; time: string; raw: number }>; currentQ: number }>;
    future?: Array<{ answers: Record<string, { opt: string; time: string; raw: number }>; currentQ: number }>;
  }>;

  constructor() {
    super('MCQTrackerDB');
    this.version(2).stores({
      sessions: 'sessionId, subject, topic, startTime',
      activeSubjects: 'name'
    });
  }
}

export const db = new MCQTrackerDB();

// Helper to calculate summary metrics for a session
export function calculateSessionMetrics(
  logs: ExerciseSession['logs']
): NonNullable<ExerciseSession['metrics']> {
  let totalDurationSec = 0;
  let correctCount = 0;
  let attemptedCount = 0;
  
  let correctTimeTotal = 0;
  let correctTimeCount = 0;
  let wrongTimeTotal = 0;
  let wrongTimeCount = 0;
  let skippedTimeTotal = 0;
  let skippedTimeCount = 0;

  logs.forEach((log) => {
    totalDurationSec += log.timeTakenSeconds;
    
    if (log.status === 'correct') {
      correctCount++;
      attemptedCount++;
      correctTimeTotal += log.timeTakenSeconds;
      correctTimeCount++;
    } else if (log.status === 'incorrect') {
      attemptedCount++;
      wrongTimeTotal += log.timeTakenSeconds;
      wrongTimeCount++;
    } else if (log.status === 'skipped') {
      skippedTimeTotal += log.timeTakenSeconds;
      skippedTimeCount++;
    }
  });

  const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0;
  const avgTimeCorrectSec = correctTimeCount > 0 ? Math.round(correctTimeTotal / correctTimeCount) : 0;
  const avgTimeWrongSec = wrongTimeCount > 0 ? Math.round(wrongTimeTotal / wrongTimeCount) : 0;
  const avgTimeSkippedSec = skippedTimeCount > 0 ? Math.round(skippedTimeTotal / skippedTimeCount) : 0;

  return {
    accuracy,
    totalDurationSec,
    avgTimeCorrectSec,
    avgTimeWrongSec,
    avgTimeSkippedSec,
  };
}

// Migrate data from localStorage (old schema) to Dexie.js (new schema)
export async function migrateFromLocalStorage() {
  if (typeof window === 'undefined') return;

  const keys = Object.keys(localStorage).filter(
    (k) => k.startsWith('mq_') && !k.startsWith('mq_marks_')
  );

  if (keys.length === 0) return;

  for (const k of keys) {
    const subject = k.replace('mq_', '');
    try {
      const answersRaw = localStorage.getItem(k);
      const marksRaw = localStorage.getItem('mq_marks_' + subject);
      
      if (!answersRaw) continue;
      
      const answers = JSON.parse(answersRaw) as Record<string, { opt: string; time: string; raw: number }>;
      const marks = marksRaw ? (JSON.parse(marksRaw) as Record<string, string>) : {};
      
      const qNumbers = Object.keys(answers).map(Number).sort((a, b) => a - b);
      if (qNumbers.length === 0) continue;

      const logs: ExerciseSession['logs'] = qNumbers.map((qNo) => {
        const ans = answers[qNo.toString()];
        const isSkip = ans.opt === 'skipped';
        const mark = marks[qNo.toString()] || null;
        
        let status: 'correct' | 'incorrect' | 'skipped' = 'incorrect';
        if (isSkip) {
          status = 'skipped';
        } else if (mark === 'tick') {
          status = 'correct';
        } else if (mark === 'cross') {
          status = 'incorrect';
        } else {
          // If no mark is available, default to incorrect (since it was not marked correct)
          status = 'incorrect';
        }

        const userSelectedOption = isSkip ? undefined : ans.opt.toUpperCase();
        const correctOption = status === 'correct' ? userSelectedOption : undefined;

        return {
          qNo,
          userSelectedOption,
          correctOption,
          status,
          timeTakenSeconds: ans.raw || 0,
        };
      });

      const metrics = calculateSessionMetrics(logs);
      const startTime = new Date(Date.now() - metrics.totalDurationSec * 1000).toISOString();
      const endTime = new Date().toISOString();

      const session: ExerciseSession = {
        sessionId: `${subject.replace(/\s+/g, '_')}_${Date.now()}`,
        subject,
        topic: 'Migrated Data',
        startTime,
        endTime,
        totalQuestions: logs.length,
        timerMode: 'stopwatch',
        metrics,
        logs,
      };

      // Store in Dexie
      await db.sessions.put(session);
      
      // Remove old localStorage keys
      localStorage.removeItem(k);
      localStorage.removeItem('mq_marks_' + subject);
      console.log(`Migrated subject "${subject}" to IndexedDB successfully.`);
    } catch (err) {
      console.error(`Error migrating localStorage key "${k}":`, err);
    }
  }
}
