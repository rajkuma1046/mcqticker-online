import React, { useState, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ExerciseSession } from '../db/index';

// Register all Chart.js components
Chart.register(...registerables);

interface HistoryDashboardProps {
  sessions: ExerciseSession[];
}

export default function HistoryDashboard({ sessions }: HistoryDashboardProps) {
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [sinkholes, setSinkholes] = useState<Array<{
    subject: string;
    topic: string;
    qNo: number;
    time: number;
    target: number;
    date: string;
  }>>([]);

  const barChartRef = useRef<HTMLCanvasElement | null>(null);
  const lineChartRef = useRef<HTMLCanvasElement | null>(null);
  const barChartInstance = useRef<Chart | null>(null);
  const lineChartInstance = useRef<Chart | null>(null);

  // Extract list of unique subjects
  const subjects = Array.from(new Set(sessions.map((s) => s.subject)));

  // Filter sessions based on selected subject
  const filteredSessions = selectedSubject === 'all'
    ? sessions
    : sessions.filter((s) => s.subject === selectedSubject);

  // Sort chronologically for trendlines
  const chronologicalSessions = [...filteredSessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  // Compute High-Level Metrics
  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalDurationSec = 0;
  let correctTimeTotal = 0;
  let correctTimeCount = 0;
  let wrongTimeTotal = 0;
  let wrongTimeCount = 0;
  let skippedTimeTotal = 0;
  let skippedTimeCount = 0;

  filteredSessions.forEach((session) => {
    session.logs.forEach((log) => {
      totalDurationSec += log.timeTakenSeconds;
      if (log.status === 'correct') {
        totalCorrect++;
        totalAttempted++;
        correctTimeTotal += log.timeTakenSeconds;
        correctTimeCount++;
      } else if (log.status === 'incorrect') {
        totalAttempted++;
        wrongTimeTotal += log.timeTakenSeconds;
        wrongTimeCount++;
      } else if (log.status === 'skipped') {
        skippedTimeTotal += log.timeTakenSeconds;
        skippedTimeCount++;
      }
    });
  });

  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const avgTimeCorrect = correctTimeCount > 0 ? Math.round(correctTimeTotal / correctTimeCount) : 0;
  const avgTimeWrong = wrongTimeCount > 0 ? Math.round(wrongTimeTotal / wrongTimeCount) : 0;
  const avgTimeSkipped = skippedTimeCount > 0 ? Math.round(skippedTimeTotal / skippedTimeCount) : 0;

  // Calculate "Sinkholes" Metric
  // Spend over 2x their target pace (or 2x overall session avg pace) and got it wrong
  useEffect(() => {
    const list: typeof sinkholes = [];
    
    filteredSessions.forEach((session) => {
      const sessionAvg = session.metrics 
        ? Math.round(session.metrics.totalDurationSec / session.totalQuestions)
        : 45;
      
      const targetPace = session.targetPaceSec || sessionAvg || 45;
      const threshold = targetPace * 2;

      session.logs.forEach((log) => {
        if (log.status === 'incorrect' && log.timeTakenSeconds > threshold) {
          list.push({
            subject: session.subject,
            topic: session.topic,
            qNo: log.qNo,
            time: log.timeTakenSeconds,
            target: targetPace,
            date: new Date(session.startTime).toLocaleDateString(),
          });
        }
      });
    });

    // Sort sinkholes by worst time overflow
    list.sort((a, b) => b.time / b.target - a.time / a.target);
    setSinkholes(list.slice(0, 5)); // Show top 5 worst sinkholes
  }, [selectedSubject, sessions]);

  // Render Pacing Bar Chart and Trendline Charts
  useEffect(() => {
    // 1. Destroy old instances
    if (barChartInstance.current) {
      barChartInstance.current.destroy();
    }
    if (lineChartInstance.current) {
      lineChartInstance.current.destroy();
    }

    // Colors adjusted for light/dark mode checks
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#2c2925' : '#ddd8cc';
    const textColor = isDark ? '#9c958d' : '#6b6560';

    // RENDER BAR CHART (Pacing)
    if (barChartRef.current && filteredSessions.length > 0) {
      const ctx = barChartRef.current.getContext('2d');
      if (ctx) {
        barChartInstance.current = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['Correct', 'Wrong / Incorrect', 'Skipped'],
            datasets: [
              {
                label: 'Avg Time Spent (Seconds)',
                data: [avgTimeCorrect, avgTimeWrong, avgTimeSkipped],
                backgroundColor: [
                  'rgba(45, 106, 79, 0.75)',  // green
                  'rgba(153, 27, 27, 0.75)',  // red
                  'rgba(90, 78, 107, 0.75)',  // purple
                ],
                borderColor: [
                  '#2d6a4f',
                  '#991b1b',
                  '#5a4e6b',
                ],
                borderWidth: 1.5,
                borderRadius: 8,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: textColor, font: { family: 'DM Sans' } },
              },
              y: {
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: 'DM Sans' } },
                border: { dash: [4, 4] },
              },
            },
          },
        });
      }
    }

    // RENDER LINE CHART (Trends)
    if (lineChartRef.current && chronologicalSessions.length > 0) {
      const ctx = lineChartRef.current.getContext('2d');
      if (ctx) {
        const labels = chronologicalSessions.map(
          (s) => `${s.topic.slice(0, 10)}... (${new Date(s.startTime).toLocaleDateString(undefined, {month: 'numeric', day: 'numeric'})})`
        );
        const accuracyData = chronologicalSessions.map((s) => s.metrics?.accuracy ?? 0);
        const speedData = chronologicalSessions.map((s) => {
          if (!s.metrics) return 0;
          return Math.round(s.metrics.totalDurationSec / s.totalQuestions);
        });

        // Compute Moving Average for Accuracy
        const movingAvgAccuracy = accuracyData.map((val, idx, arr) => {
          const start = Math.max(0, idx - 2); // 3-point moving average
          const slice = arr.slice(start, idx + 1);
          const sum = slice.reduce((a, b) => a + b, 0);
          return Math.round(sum / slice.length);
        });

        lineChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Accuracy (%)',
                data: accuracyData,
                borderColor: '#e07a5f',
                backgroundColor: 'rgba(224, 122, 95, 0.15)',
                yAxisID: 'yAccuracy',
                tension: 0.3,
                fill: true,
                borderWidth: 2.5,
              },
              {
                label: 'Baseline (Moving Avg)',
                data: movingAvgAccuracy,
                borderColor: '#fbbf24',
                borderDash: [5, 5],
                yAxisID: 'yAccuracy',
                tension: 0.3,
                fill: false,
                borderWidth: 1.5,
              },
              {
                label: 'Speed (Sec/Q)',
                data: speedData,
                borderColor: '#60a5fa',
                backgroundColor: 'transparent',
                yAxisID: 'ySpeed',
                tension: 0.3,
                borderWidth: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: { color: textColor, font: { family: 'DM Sans', size: 11 } },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: textColor, font: { family: 'DM Sans' } },
              },
              yAccuracy: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Accuracy (%)', color: '#e07a5f' },
                grid: { color: gridColor },
                ticks: { color: textColor },
                min: 0,
                max: 100,
              },
              ySpeed: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Speed (seconds/Q)', color: '#60a5fa' },
                grid: { display: false },
                ticks: { color: textColor },
                min: 0,
              },
            },
          },
        });
      }
    }
  }, [selectedSubject, sessions]);

  // Time Formatter
  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Subject Filter & Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark p-4 rounded-2xl shadow-custom transition-colors">
        <h3 className="font-display font-extrabold text-base text-text-light dark:text-text-dark">
          Analytics Summary
        </h3>

        <div class="flex items-center gap-2">
          <label htmlFor="subject-filter" className="text-xs font-bold text-text-light-muted dark:text-text-dark-muted whitespace-nowrap">
            Filter by Subject:
          </label>
          <select
            id="subject-filter"
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary dark:focus:ring-brand-secondary"
          >
            <option value="all">All Subjects ({sessions.length} sessions)</option>
            {subjects.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-16 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl">
          <span className="text-4xl">📊</span>
          <h4 className="text-sm font-bold mt-3 text-text-light dark:text-text-dark">No Stats Available Yet</h4>
          <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1 max-w-xs mx-auto">
            Your statistics dashboard will update as soon as you complete and grade your first quiz session.
          </p>
        </div>
      ) : (
        <>
          {/* Metrics Panel Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Accuracy */}
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom flex flex-col justify-between transition-colors">
              <span className="text-xxs font-bold uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">
                Avg Accuracy
              </span>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-3xl font-black font-display text-brand-primary dark:text-brand-secondary">
                  {overallAccuracy}%
                </span>
              </div>
              <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1.5 border-t border-border-light dark:border-border-dark pt-1.5">
                Total graded answers: {totalAttempted}
              </p>
            </div>

            {/* Total Study Time */}
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom flex flex-col justify-between transition-colors">
              <span className="text-xxs font-bold uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">
                Total Practice Time
              </span>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-3xl font-black font-display text-text-light dark:text-text-dark">
                  {formatSeconds(totalDurationSec)}
                </span>
              </div>
              <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1.5 border-t border-border-light dark:border-border-dark pt-1.5">
                Across {filteredSessions.length} sessions
              </p>
            </div>

            {/* Overall Speed */}
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom flex flex-col justify-between transition-colors">
              <span className="text-xxs font-bold uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">
                Average Speed
              </span>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-3xl font-black font-display text-brand-primary dark:text-brand-secondary">
                  {totalAttempted > 0 ? Math.round(totalDurationSec / totalAttempted) : 0}s
                </span>
                <span className="text-xs text-text-light-muted dark:text-text-dark-muted">/ question</span>
              </div>
              <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-1.5 border-t border-border-light dark:border-border-dark pt-1.5">
                Target pace: ~45s
              </p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chart 1: Pacing Analysis */}
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom flex flex-col transition-colors">
              <h4 className="font-display font-extrabold text-xs text-text-light dark:text-text-dark border-b border-border-light dark:border-border-dark pb-2 mb-4">
                Pacing Analytics (Avg Time per Outcome)
              </h4>
              <div className="h-64 w-full relative">
                <canvas ref={barChartRef}></canvas>
              </div>
            </div>

            {/* Chart 2: Historical Trends */}
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom flex flex-col transition-colors">
              <h4 className="font-display font-extrabold text-xs text-text-light dark:text-text-dark border-b border-border-light dark:border-border-dark pb-2 mb-4">
                Progressive Trendlines & Baselines
              </h4>
              <div className="h-64 w-full relative">
                <canvas ref={lineChartRef}></canvas>
              </div>
            </div>
          </div>

          {/* Sinkholes Metric */}
          <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-2xl p-5 shadow-custom transition-colors">
            <div className="border-b border-border-light dark:border-border-dark pb-2 mb-4">
              <h4 className="font-display font-extrabold text-xs text-wrong-red flex items-center gap-1.5">
                <span>⚠️</span> The Pacing "Sinkhole" Metric (Top Time Wasters)
              </h4>
              <p className="text-xxs text-text-light-muted dark:text-text-dark-muted mt-0.5">
                Highlights questions where you spent over 2x your target pace, but still got the answer wrong.
              </p>
            </div>

            {sinkholes.length === 0 ? (
              <div className="text-center py-4 text-xs font-semibold text-correct-green">
                🎉 Excellent! No pacing sinkholes found. You're moving at a balanced speed.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xxs font-mono-custom border-collapse">
                  <thead>
                    <tr className="border-b border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted uppercase font-bold">
                      <th className="py-2 px-3">Subject / Topic</th>
                      <th className="py-2 px-3 text-center">Q#</th>
                      <th className="py-2 px-3 text-center">Time Spent</th>
                      <th className="py-2 px-3 text-center">Target Pace</th>
                      <th className="py-2 px-3 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light dark:divide-border-dark text-text-light dark:text-text-dark">
                    {sinkholes.map((sink, idx) => (
                      <tr key={idx} className="hover:bg-bg-light dark:hover:bg-bg-dark/50">
                        <td className="py-3 px-3 font-sans font-bold">
                          {sink.subject}
                          <span className="block text-xxs font-normal text-text-light-muted dark:text-text-dark-muted font-sans mt-0.5">
                            {sink.topic}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center text-wrong-red font-bold">Q{sink.qNo}</td>
                        <td className="py-3 px-3 text-center font-bold text-wrong-red bg-wrong-red-light/10 dark:bg-wrong-red-dark/15">
                          {sink.time}s
                        </td>
                        <td className="py-3 px-3 text-center text-text-light-muted dark:text-text-dark-muted">{sink.target}s</td>
                        <td className="py-3 px-3 text-right text-text-light-muted dark:text-text-dark-muted">{sink.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
