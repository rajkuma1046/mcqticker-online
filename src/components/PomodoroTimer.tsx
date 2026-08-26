import React, { useState, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

// --- TYPE DEFINITIONS ---
interface SubTask {
  id: string;
  text: string;
  completed: boolean;
}

interface Task {
  id: string;
  title: string;
  notes: string;
  estPomodoros: number;
  completedPomodoros: number;
  completed: boolean;
  subtasks: SubTask[];
}

interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string
  type: 'focus' | 'short_break' | 'long_break';
  durationMinutes: number;
  taskId?: string;
  taskTitle?: string;
}

// --- SYNTHESIZED SOUND SYSTEM (Web Audio API) ---
let audioCtx: AudioContext | null = null;
let ambientSource: AudioBufferSourceNode | null = null;
let ambientGain: GainNode | null = null;
let tickingInterval: number | null = null;
let birdTimer: number | null = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

const playSynthAlarm = (type: string, volume: number) => {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(volume, now);
  masterGain.connect(ctx.destination);

  if (type === 'beep') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'retro') {
    const duration = 1.0;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(10, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(150, now);
    
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.frequency.setValueAtTime(650, now);
    
    const gate = ctx.createGain();
    gate.gain.setValueAtTime(1, now);
    for (let t = 0.1; t < duration; t += 0.2) {
      gate.gain.setValueAtTime(0, now + t);
      gate.gain.setValueAtTime(1, now + t + 0.1);
    }
    
    osc.connect(gate);
    gate.connect(masterGain);
    
    lfo.start(now);
    osc.start(now);
    lfo.stop(now + duration);
    osc.stop(now + duration);
  } else if (type === 'bell') {
    const duration = 1.5;
    const freqs = [440, 554, 659, 880];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      
      oscGain.gain.setValueAtTime(0.25, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration / (idx + 1));
      
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + duration);
    });
  } else if (type === 'chime') {
    const duration = 2.0;
    const freqs = [329.63, 440.00, 523.25, 659.25];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.1);
      
      oscGain.gain.setValueAtTime(0, now);
      oscGain.gain.linearRampToValueAtTime(0.2, now + idx * 0.1 + 0.05);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + duration);
    });
  }
};

const startTickingSound = (volume: number) => {
  stopTickingSound();
  tickingInterval = window.setInterval(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1000, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.012);
    
    gain.gain.setValueAtTime(volume * 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.015);
  }, 1000);
};

const stopTickingSound = () => {
  if (tickingInterval) {
    window.clearInterval(tickingInterval);
    tickingInterval = null;
  }
};

const startSynthAmbient = (type: string, volume: number) => {
  stopSynthAmbient();
  const ctx = getAudioContext();
  if (!ctx || type === 'none') return;

  const now = ctx.currentTime;
  ambientGain = ctx.createGain();
  ambientGain.gain.setValueAtTime(volume, now);
  ambientGain.connect(ctx.destination);

  const bufferSize = 2 * ctx.sampleRate;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = ctx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;

  if (type === 'white_noise') {
    whiteNoise.connect(ambientGain);
    whiteNoise.start(now);
    ambientSource = whiteNoise;
  } else if (type === 'rain') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(750, now);
    filter.Q.setValueAtTime(1.0, now);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1200, now);

    whiteNoise.connect(filter);
    filter.connect(lowpass);
    lowpass.connect(ambientGain);
    whiteNoise.start(now);
    ambientSource = whiteNoise;
  } else if (type === 'cafe') {
    const brownBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const brownOut = brownBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      brownOut[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = brownOut[i];
      brownOut[i] *= 3.5;
    }
    const brownNoise = ctx.createBufferSource();
    brownNoise.buffer = brownBuffer;
    brownNoise.loop = true;

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.15, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.12, now);
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.7, now);

    lfo.connect(lfoGain);
    lfoGain.connect(gainNode.gain);
    brownNoise.connect(gainNode);
    gainNode.connect(ambientGain);

    lfo.start(now);
    brownNoise.start(now);
    
    ambientSource = brownNoise;
  } else if (type === 'forest') {
    const rustleBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const rOut = rustleBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      rOut[i] = (lastOut + (0.04 * white)) / 1.04;
      lastOut = rOut[i];
      rOut[i] *= 2.5;
    }
    const rustle = ctx.createBufferSource();
    rustle.buffer = rustleBuffer;
    rustle.loop = true;

    const rFilter = ctx.createBiquadFilter();
    rFilter.type = 'bandpass';
    rFilter.frequency.setValueAtTime(1000, now);
    rFilter.Q.setValueAtTime(0.6, now);

    rustle.connect(rFilter);
    rFilter.connect(ambientGain);
    rustle.start(now);

    const playChirp = () => {
      const birdCtx = getAudioContext();
      if (!birdCtx || !ambientGain) return;
      const bTime = birdCtx.currentTime;
      
      const chirpOsc = birdCtx.createOscillator();
      const chirpGain = birdCtx.createGain();
      chirpOsc.type = 'sine';
      chirpOsc.frequency.setValueAtTime(2800, bTime);
      chirpOsc.frequency.exponentialRampToValueAtTime(3800, bTime + 0.08);
      chirpOsc.frequency.exponentialRampToValueAtTime(2600, bTime + 0.16);

      chirpGain.gain.setValueAtTime(0.001, bTime);
      chirpGain.gain.linearRampToValueAtTime(0.03, bTime + 0.04);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, bTime + 0.2);

      chirpOsc.connect(chirpGain);
      chirpGain.connect(ambientGain);
      chirpOsc.start(bTime);
      chirpOsc.stop(bTime + 0.25);
    };

    birdTimer = window.setInterval(() => {
      if (Math.random() > 0.45) {
        playChirp();
      }
    }, 4500);

    ambientSource = {
      stop: () => {
        rustle.stop();
        if (birdTimer) window.clearInterval(birdTimer);
      }
    } as any;
  }
};

const stopSynthAmbient = () => {
  if (ambientSource) {
    try {
      ambientSource.stop();
    } catch (e) {}
    ambientSource = null;
  }
  if (birdTimer) {
    window.clearInterval(birdTimer);
    birdTimer = null;
  }
};

const updateSynthAmbientVolume = (volume: number) => {
  if (ambientGain) {
    const ctx = getAudioContext();
    const now = ctx ? ctx.currentTime : 0;
    ambientGain.gain.setValueAtTime(volume, now);
  }
};

// --- DESIGN TOKENS ---
const accentColors = {
  rust: {
    name: 'Warm Rust',
    primary: 'bg-brand-primary text-white hover:opacity-90',
    secondary: '#e07a5f',
    textColor: 'text-brand-secondary',
    border: 'border-brand-primary/20 dark:border-brand-secondary/20',
    bg: 'bg-brand-primary/10 dark:bg-brand-secondary/10',
    ring: '#e07a5f',
    animated: false,
  },
  blue: {
    name: 'Ocean Blue',
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: '#3b82f6',
    textColor: 'text-blue-500',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/10',
    ring: '#3b82f6',
    animated: false,
  },
  green: {
    name: 'Forest Green',
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    secondary: '#10b981',
    textColor: 'text-emerald-500',
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/10',
    ring: '#10b981',
    animated: false,
  },
  orange: {
    name: 'Sunset Orange',
    primary: 'bg-amber-600 text-white hover:bg-amber-700',
    secondary: '#f59e0b',
    textColor: 'text-amber-500',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/10',
    ring: '#f59e0b',
    animated: false,
  },
  purple: {
    name: 'Plum Purple',
    primary: 'bg-purple-600 text-white hover:bg-purple-700',
    secondary: '#8b5cf6',
    textColor: 'text-purple-500',
    border: 'border-purple-500/20',
    bg: 'bg-purple-500/10',
    ring: '#8b5cf6',
    animated: false,
  },
  // ── Animated Gradient Themes (soothing, slow-cycling) ──
  aurora: {
    name: '🌅 Aurora',
    primary: 'btn-aurora',
    secondary: '#a855f7',
    textColor: 'text-purple-400',
    border: 'border-purple-400/20',
    bg: 'bg-purple-400/10',
    ring: 'url(#grad-aurora)',
    animated: true,
    gradId: 'grad-aurora',
    stopClass1: 'aurora-stop-1',
    stopClass2: 'aurora-stop-2',
  },
  ember: {
    name: '🔥 Ember',
    primary: 'btn-ember',
    secondary: '#f97316',
    textColor: 'text-orange-400',
    border: 'border-orange-400/20',
    bg: 'bg-orange-400/10',
    ring: 'url(#grad-ember)',
    animated: true,
    gradId: 'grad-ember',
    stopClass1: 'ember-stop-1',
    stopClass2: 'ember-stop-2',
  },
  ocean: {
    name: '🌊 Ocean',
    primary: 'btn-ocean',
    secondary: '#06b6d4',
    textColor: 'text-cyan-400',
    border: 'border-cyan-400/20',
    bg: 'bg-cyan-400/10',
    ring: 'url(#grad-ocean)',
    animated: true,
    gradId: 'grad-ocean',
    stopClass1: 'ocean-stop-1',
    stopClass2: 'ocean-stop-2',
  },
};

// Phase visual config
const phaseVisuals: Record<string, { emoji: string; label: string; sublabel: string; bg: string }> = {
  focus:       { emoji: '🧠', label: 'Focus Session',  sublabel: 'Get Work Done',   bg: 'from-brand-secondary/10' },
  short_break: { emoji: '☕', label: 'Short Break',    sublabel: 'Relax & Refresh',  bg: 'from-emerald-500/10' },
  long_break:  { emoji: '🌿', label: 'Long Break',     sublabel: 'Rest & Recharge',  bg: 'from-blue-500/10' },
};

export default function PomodoroTimer() {
  // --- PERSISTED SETTINGS STATE ---
  const [durationFocus, setDurationFocus] = useState(25);
  const [durationShort, setDurationShort] = useState(5);
  const [durationLong, setDurationLong] = useState(15);
  const [longBreakInterval, setLongBreakInterval] = useState(4);
  const [autoStartBreaks, setAutoStartBreaks] = useState(false);
  const [autoStartFocus, setAutoStartFocus] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const [alertScope, setAlertScope] = useState<'both' | 'focus' | 'breaks' | 'none'>('both');
  const [alarmSound, setAlarmSound] = useState('chime');
  const [isTicking, setIsTicking] = useState(false);
  const [ambientSound, setAmbientSound] = useState<'none' | 'rain' | 'white_noise' | 'cafe' | 'forest'>('none');
  const [ambientVolume, setAmbientVolume] = useState(0.3);
  const [accentColor, setAccentColor] = useState<keyof typeof accentColors>('rust');
  const [baseFontSize, setBaseFontSize] = useState(18);
  const [webhookUrl, setWebhookUrl] = useState('');

  // --- DRAG-TO-SET TIMER STATE ---
  const [isDragging, setIsDragging] = useState(false);
  const [dragMinutes, setDragMinutes] = useState<number | null>(null);
  const ringRef = useRef<SVGSVGElement | null>(null);

  // --- LIVE TIMER STATE ---
  const [currentPhase, setCurrentPhase] = useState<'focus' | 'short_break' | 'long_break'>('focus');
  const [timerState, setTimerState] = useState<'idle' | 'running' | 'paused'>('idle');
  const [timeRemaining, setTimeRemaining] = useState(25 * 60);
  const [totalDuration, setTotalDuration] = useState(25 * 60);
  const [focusSessionsCompleted, setFocusSessionsCompleted] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // --- PERSISTED LIST & STATS DATA ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'stats' | 'settings'>('tasks');
  const [zenMode, setZenMode] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // --- COMPONENT REFS ---
  const endTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);

  // --- LOAD INITIAL CONFIG ---
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Load Settings
    const storedSettings = localStorage.getItem('pomodoro_settings');
    if (storedSettings) {
      try {
        const s = JSON.parse(storedSettings);
        if (s.durationFocus) setDurationFocus(Math.min(60, s.durationFocus));
        if (s.durationShort) setDurationShort(Math.min(60, s.durationShort));
        if (s.durationLong) setDurationLong(Math.min(60, s.durationLong));
        if (s.longBreakInterval) setLongBreakInterval(s.longBreakInterval);
        if (s.autoStartBreaks !== undefined) setAutoStartBreaks(s.autoStartBreaks);
        if (s.autoStartFocus !== undefined) setAutoStartFocus(s.autoStartFocus);
        if (s.volume !== undefined) setVolume(s.volume);
        if (s.isMuted !== undefined) setIsMuted(s.isMuted);
        if (s.alertScope) setAlertScope(s.alertScope);
        if (s.alarmSound) setAlarmSound(s.alarmSound);
        if (s.isTicking !== undefined) setIsTicking(s.isTicking);
        if (s.ambientSound) setAmbientSound(s.ambientSound);
        if (s.ambientVolume !== undefined) setAmbientVolume(s.ambientVolume);
        if (s.accentColor) setAccentColor(s.accentColor);
        if (s.baseFontSize) setBaseFontSize(s.baseFontSize);
        if (s.webhookUrl !== undefined) setWebhookUrl(s.webhookUrl);
        
        // Update timer values
        const initialSecs = s.durationFocus * 60;
        setTimeRemaining(initialSecs);
        setTotalDuration(initialSecs);
      } catch (e) {
        console.error('Error loading Pomodoro settings:', e);
      }
    }

    // Load Tasks
    const storedTasks = localStorage.getItem('pomodoro_tasks');
    if (storedTasks) {
      try {
        setTasks(JSON.parse(storedTasks));
      } catch (e) {
        console.error('Error loading Pomodoro tasks:', e);
      }
    }

    // Load History
    const storedHistory = localStorage.getItem('pomodoro_history');
    if (storedHistory) {
      try {
        setHistory(JSON.parse(storedHistory));
      } catch (e) {
        console.error('Error loading Pomodoro history:', e);
      }
    }

    // Request Notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // --- PERSIST DATA SIDE EFFECTS ---
  const saveSettings = (updatedFields: Record<string, any>) => {
    const currentSettings = {
      durationFocus,
      durationShort,
      durationLong,
      longBreakInterval,
      autoStartBreaks,
      autoStartFocus,
      volume,
      isMuted,
      alertScope,
      alarmSound,
      isTicking,
      ambientSound,
      ambientVolume,
      accentColor,
      baseFontSize,
      webhookUrl,
      ...updatedFields,
    };
    localStorage.setItem('pomodoro_settings', JSON.stringify(currentSettings));
  };

  useEffect(() => {
    if (tasks.length > 0) {
      localStorage.setItem('pomodoro_tasks', JSON.stringify(tasks));
    } else {
      localStorage.removeItem('pomodoro_tasks');
    }
  }, [tasks]);

  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem('pomodoro_history', JSON.stringify(history));
    } else {
      localStorage.removeItem('pomodoro_history');
    }
  }, [history]);

  // --- RE-CALCULATE TIMER LENGTH ON DURATION SETTINGS CHANGE ---
  useEffect(() => {
    if (timerState === 'idle') {
      const minutes = currentPhase === 'focus' 
        ? durationFocus 
        : currentPhase === 'short_break' 
          ? durationShort 
          : durationLong;
      setTimeRemaining(minutes * 60);
      setTotalDuration(minutes * 60);
    }
  }, [durationFocus, durationShort, durationLong, currentPhase, timerState]);

  // --- BROWSER DOCUMENT TITLE UPDATE ---
  useEffect(() => {
    const min = Math.floor(timeRemaining / 60);
    const sec = timeRemaining % 60;
    const formatted = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    const phaseLabel = currentPhase === 'focus' 
      ? 'Focus' 
      : currentPhase === 'short_break' 
        ? 'Short Break' 
        : 'Long Break';

    if (timerState === 'running') {
      document.title = `⏱️ ${formatted} - ${phaseLabel} | Pomodoro Timer`;
    } else if (timerState === 'paused') {
      document.title = `⏸️ ${formatted} - Paused | Pomodoro Timer`;
    } else {
      document.title = `Pomodoro Timer — tap A B C D`;
    }
  }, [timeRemaining, currentPhase, timerState]);

  // --- MAIN TIMER ENGINE EFFECT ---
  useEffect(() => {
    if (timerState !== 'running') {
      stopTickingSound();
      stopSynthAmbient();
      return;
    }

    // Trigger synthesizers
    if (isTicking && !isMuted) {
      startTickingSound(volume);
    } else {
      stopTickingSound();
    }

    if (ambientSound !== 'none' && !isMuted) {
      startSynthAmbient(ambientSound, ambientVolume);
    } else {
      stopSynthAmbient();
    }

    const checkTime = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.round((endTimeRef.current - now) / 1000));
      
      if (remaining <= 0) {
        setTimeRemaining(0);
        handlePhaseComplete();
      } else {
        setTimeRemaining(remaining);
      }
    };

    // Run interval
    timerIntervalRef.current = window.setInterval(checkTime, 250);

    return () => {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
      }
    };
  }, [timerState, currentPhase, isTicking, ambientSound, volume, ambientVolume, isMuted]);

  // --- CORE ENGINE TRIGGERS ---
  const startTimer = (customTime?: number) => {
    getAudioContext();
    const duration = typeof customTime === 'number' ? customTime : timeRemaining;
    endTimeRef.current = Date.now() + duration * 1000;
    setTimerState('running');
  };

  const pauseTimer = () => {
    setTimerState('paused');
    stopTickingSound();
    stopSynthAmbient();
  };

  const resetTimer = () => {
    setTimerState('idle');
    stopTickingSound();
    stopSynthAmbient();
    const minutes = currentPhase === 'focus' 
      ? durationFocus 
      : currentPhase === 'short_break' 
        ? durationShort 
        : durationLong;
    setTimeRemaining(minutes * 60);
    setTotalDuration(minutes * 60);
  };

  const skipPhase = () => {
    setTimerState('idle');
    stopTickingSound();
    stopSynthAmbient();
    moveToNextPhase();
  };

  const moveToNextPhase = (customPhase?: typeof currentPhase, isManual = false) => {
    let nextPhase = customPhase;
    
    if (!nextPhase) {
      if (currentPhase === 'focus') {
        const nextCount = focusSessionsCompleted + 1;
        setFocusSessionsCompleted(nextCount);
        if (nextCount > 0 && nextCount % longBreakInterval === 0) {
          nextPhase = 'long_break';
        } else {
          nextPhase = 'short_break';
        }
      } else {
        nextPhase = 'focus';
      }
    }

    setCurrentPhase(nextPhase);
    const minutes = nextPhase === 'focus' 
      ? durationFocus 
      : nextPhase === 'short_break' 
        ? durationShort 
        : durationLong;

    const nextSeconds = minutes * 60;
    setTimeRemaining(nextSeconds);
    setTotalDuration(nextSeconds);

    // Auto start triggers (only for automatic phase switches, not manual tab clicks)
    if (!isManual) {
      if (nextPhase === 'focus' && autoStartFocus) {
        setTimeout(() => startTimer(nextSeconds), 200);
      } else if (nextPhase !== 'focus' && autoStartBreaks) {
        setTimeout(() => startTimer(nextSeconds), 200);
      }
    }
  };

  const handlePhaseComplete = () => {
    setTimerState('idle');
    stopTickingSound();
    stopSynthAmbient();

    const endedPhase = currentPhase;

    // 1. Play Alarm
    const shouldAlarm = isMuted ? false 
      : alertScope === 'both' ? true
      : alertScope === 'focus' && endedPhase === 'focus' ? true
      : alertScope === 'breaks' && endedPhase !== 'focus' ? true 
      : false;

    if (shouldAlarm) {
      playSynthAlarm(alarmSound, volume);
    }

    // 2. Browser Push Notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const message = endedPhase === 'focus' 
        ? 'Focus session complete! Time to take a break.' 
        : 'Break ended! Ready to focus?';
      
      new Notification('Pomodoro Timer', {
        body: message,
        icon: '/web-app-manifest-192x192.png'
      });
    }

    // 3. Log History & Increments if Focus ended
    if (endedPhase === 'focus') {
      const activeTask = tasks.find(t => t.id === activeTaskId);
      
      const newEntry: HistoryEntry = {
        id: `h_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'focus',
        durationMinutes: durationFocus,
        taskId: activeTaskId || undefined,
        taskTitle: activeTask?.title || undefined
      };

      setHistory(prev => [newEntry, ...prev]);

      // Log Focus completed against active task
      if (activeTaskId) {
        setTasks(prevTasks => prevTasks.map(t => {
          if (t.id === activeTaskId) {
            const nextCompleted = t.completedPomodoros + 1;
            return { 
              ...t, 
              completedPomodoros: nextCompleted
            };
          }
          return t;
        }));
      }

      // Webhook Integration
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'pomodoro_focus_completed',
            timestamp: newEntry.timestamp,
            duration: durationFocus,
            task: activeTask ? { id: activeTask.id, title: activeTask.title } : null
          })
        }).catch(err => console.error('Webhook execution failed:', err));
      }
    }

    // Move to next phase
    moveToNextPhase();
  };

  // --- STATS VIEW CALCULATIONS ---
  const todayStr = new Date().toISOString().split('T')[0];

  const getTodayMinutes = () => {
    return history
      .filter(h => h.timestamp.startsWith(todayStr) && h.type === 'focus')
      .reduce((acc, h) => acc + h.durationMinutes, 0);
  };

  const getTodaySessions = () => {
    return history.filter(h => h.timestamp.startsWith(todayStr) && h.type === 'focus').length;
  };

  const getWeeklyMinutes = () => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return history
      .filter(h => new Date(h.timestamp) >= oneWeekAgo && h.type === 'focus')
      .reduce((acc, h) => acc + h.durationMinutes, 0);
  };

  // Compute Streak
  const getStreakCount = () => {
    if (history.length === 0) return 0;
    
    // Extract unique dates with focus history
    const uniqueDates = Array.from(new Set(
      history
        .filter(h => h.type === 'focus')
        .map(h => h.timestamp.split('T')[0])
    )).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // descending (newest first)

    if (uniqueDates.length === 0) return 0;

    let streak = 0;
    let expectedDate = new Date(); // Start from today
    
    // Helper to check if dates match ignoring timezone shifts
    const formatCompare = (d: Date) => d.toISOString().split('T')[0];

    const todayString = formatCompare(expectedDate);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = formatCompare(yesterday);

    // If today is not in uniqueDates and yesterday is not in uniqueDates, streak is broken (0)
    if (!uniqueDates.includes(todayString) && !uniqueDates.includes(yesterdayString)) {
      return 0;
    }

    // Set starting check date based on whether user practiced today
    if (!uniqueDates.includes(todayString) && uniqueDates.includes(yesterdayString)) {
      expectedDate = yesterday;
    }

    for (let i = 0; i < uniqueDates.length; i++) {
      const targetStr = formatCompare(expectedDate);
      if (uniqueDates.includes(targetStr)) {
        streak++;
        expectedDate.setDate(expectedDate.getDate() - 1);
      } else {
        break; // Streak interrupted
      }
    }

    return streak;
  };

  // --- CHART RENDER ---
  useEffect(() => {
    if (!chartRef.current || activeTab !== 'stats') return;

    // Generate past 7 days dates array
    const labels: string[] = [];
    const focusMinutes: number[] = [];
    const sessionsCount: number[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const [_, m, day] = dateStr.split('-');
      labels.push(`${day}/${m}`);

      const mins = history
        .filter(h => h.timestamp.startsWith(dateStr) && h.type === 'focus')
        .reduce((acc, h) => acc + h.durationMinutes, 0);
      focusMinutes.push(mins);

      const count = history.filter(h => h.timestamp.startsWith(dateStr) && h.type === 'focus').length;
      sessionsCount.push(count);
    }

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e8e5df' : '#1a1814';
    const gridColor = isDark ? '#2c2925' : '#ddd8cc';
    const activeAccent = accentColors[accentColor];

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');
    if (ctx) {
      chartInstance.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Focus Minutes',
              data: focusMinutes,
              backgroundColor: activeAccent.secondary,
              borderRadius: 6,
              yAxisID: 'yMinutes',
              barPercentage: 0.55
            },
            {
              label: 'Completed Sessions',
              data: sessionsCount,
              backgroundColor: '#fbbf24',
              borderRadius: 6,
              yAxisID: 'yCount',
              barPercentage: 0.55
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { color: textColor, font: { family: 'Roboto', size: 10 } }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: 'Roboto', size: 10 } }
            },
            yMinutes: {
              type: 'linear',
              position: 'left',
              grid: { color: gridColor },
              ticks: { color: textColor, font: { size: 9 } },
              title: { display: true, text: 'Mins', color: textColor, font: { size: 10 } }
            },
            yCount: {
              type: 'linear',
              position: 'right',
              grid: { display: false },
              ticks: { color: textColor, stepSize: 1, font: { size: 9 } },
              title: { display: true, text: 'Sessions', color: textColor, font: { size: 10 } }
            }
          }
        }
      });
    }

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [history, activeTab, accentColor]);

  // --- KEYBOARD SHORTCUTS ENGINE ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === 'INPUT' || 
        el.tagName === 'TEXTAREA' || 
        el.tagName === 'SELECT' || 
        el.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        if (timerState === 'running') pauseTimer();
        else startTimer();
      } else if (key === 'r') {
        resetTimer();
      } else if (key === 's') {
        skipPhase();
      } else if (key === 'n') {
        e.preventDefault();
        setActiveTab('tasks');
        setTimeout(() => {
          document.getElementById('task-title-input')?.focus();
        }, 80);
      } else if (key === '?') {
        setShowShortcutsModal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timerState, timeRemaining, currentPhase, tasks, activeTaskId]);

  // --- TASK LIST OPERATIONS ---
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskEst, setTaskEst] = useState(2);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    if (editingTaskId) {
      setTasks(prev => prev.map(t => t.id === editingTaskId ? {
        ...t,
        title: taskTitle.trim(),
        notes: taskNotes.trim(),
        estPomodoros: taskEst
      } : t));
      setEditingTaskId(null);
    } else {
      const newTask: Task = {
        id: `t_${Date.now()}`,
        title: taskTitle.trim(),
        notes: taskNotes.trim(),
        estPomodoros: taskEst,
        completedPomodoros: 0,
        completed: false,
        subtasks: []
      };
      setTasks(prev => [...prev, newTask]);
      
      if (!activeTaskId) {
        setActiveTaskId(newTask.id);
      }
    }

    setTaskTitle('');
    setTaskNotes('');
    setTaskEst(2);
  };

  const handleEditTask = (t: Task) => {
    setEditingTaskId(t.id);
    setTaskTitle(t.title);
    setTaskNotes(t.notes);
    setTaskEst(t.estPomodoros);
    setActiveTab('tasks');
  };

  const handleDeleteTask = (id: string) => {
    if (confirm('Delete this task? This cannot be undone.')) {
      setTasks(prev => prev.filter(t => t.id !== id));
      if (activeTaskId === id) {
        setActiveTaskId(null);
      }
    }
  };

  const handleToggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleAddSubTask = (taskId: string, text: string) => {
    if (!text.trim()) return;
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          subtasks: [...t.subtasks, { id: `st_${Date.now()}`, text: text.trim(), completed: false }]
        };
      }
      return t;
    }));
  };

  const handleToggleSubTask = (taskId: string, subTaskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          subtasks: t.subtasks.map(st => st.id === subTaskId ? { ...st, completed: !st.completed } : st)
        };
      }
      return t;
    }));
  };

  const handleDeleteSubTask = (taskId: string, subTaskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          subtasks: t.subtasks.filter(st => st.id !== subTaskId)
        };
      }
      return t;
    }));
  };

  // Drag and Drop (HTML5 Native)
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const items = [...tasks];
    const dragged = items[dragItem.current];
    items.splice(dragItem.current, 1);
    items.splice(dragOverItem.current, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    setTasks(items);
  };

  // --- TIME ESTIMATION PROJECTIONS ---
  const activeTasks = tasks.filter(t => !t.completed);
  const totalRemainingEst = activeTasks.reduce((acc, t) => {
    const rem = t.estPomodoros - t.completedPomodoros;
    return acc + (rem > 0 ? rem : 0);
  }, 0);

  const getEstimatedFinishTime = () => {
    if (totalRemainingEst === 0) return 'No tasks remaining';
    const totalFocusSecs = totalRemainingEst * durationFocus * 60;
    
    const totalShortBreaks = totalRemainingEst - 1;
    const totalBreakSecs = totalShortBreaks > 0 ? totalShortBreaks * durationShort * 60 : 0;
    
    const finishDate = new Date(Date.now() + (totalFocusSecs + totalBreakSecs) * 1000);
    return finishDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // --- DATA TRANSFER & SETTINGS UTILITIES ---
  const handleExportData = () => {
    const dataStr = JSON.stringify({
      settings: {
        durationFocus, durationShort, durationLong, longBreakInterval,
        autoStartBreaks, autoStartFocus, volume, isMuted, alertScope,
        alarmSound, isTicking, ambientSound, ambientVolume, accentColor,
        baseFontSize, webhookUrl
      },
      tasks,
      history
    }, null, 2);
    
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `pomodoro_data_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed.settings) {
            const s = parsed.settings;
            if (s.durationFocus) setDurationFocus(Math.min(60, s.durationFocus));
            if (s.durationShort) setDurationShort(Math.min(60, s.durationShort));
            if (s.durationLong) setDurationLong(Math.min(60, s.durationLong));
            if (s.longBreakInterval) setLongBreakInterval(s.longBreakInterval);
            if (s.autoStartBreaks !== undefined) setAutoStartBreaks(s.autoStartBreaks);
            if (s.autoStartFocus !== undefined) setAutoStartFocus(s.autoStartFocus);
            if (s.volume !== undefined) setVolume(s.volume);
            if (s.isMuted !== undefined) setIsMuted(s.isMuted);
            if (s.alertScope) setAlertScope(s.alertScope);
            if (s.alarmSound) setAlarmSound(s.alarmSound);
            if (s.isTicking !== undefined) setIsTicking(s.isTicking);
            if (s.ambientSound) setAmbientSound(s.ambientSound);
            if (s.ambientVolume !== undefined) setAmbientVolume(s.ambientVolume);
            if (s.accentColor) setAccentColor(s.accentColor);
            if (s.baseFontSize) setBaseFontSize(s.baseFontSize);
            if (s.webhookUrl !== undefined) setWebhookUrl(s.webhookUrl);
            saveSettings(s);
          }
          if (parsed.tasks) setTasks(parsed.tasks);
          if (parsed.history) setHistory(parsed.history);
          alert('Config and data imported successfully!');
        } catch (err) {
          alert('Invalid file format. Please check the json file.');
        }
      };
    }
  };

  // --- CIRCULAR DRAG-TO-SET TIMER ---
  // Converts a pointer position relative to the ring center into a minute value (1-60).
  const getMinutesFromPointer = (e: React.PointerEvent<SVGSVGElement> | PointerEvent): number => {
    if (!ringRef.current) return 0;
    const rect = ringRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // Angle from 12-o'clock, clockwise (0 = top)
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    // Map 0–360° to 1–60 minutes
    const minutes = Math.max(1, Math.min(60, Math.round((angle / 360) * 60) || 1));
    return minutes;
  };

  const handleRingPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (timerState !== 'idle') return; // only allow when idle
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const mins = getMinutesFromPointer(e);
    setDragMinutes(mins);
  };

  const handleRingPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const mins = getMinutesFromPointer(e);
    setDragMinutes(mins);
  };

  const handleRingPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    const mins = getMinutesFromPointer(e);
    // Apply to the current phase duration
    if (currentPhase === 'focus') {
      setDurationFocus(mins);
      saveSettings({ durationFocus: mins });
    } else if (currentPhase === 'short_break') {
      setDurationShort(mins);
      saveSettings({ durationShort: mins });
    } else {
      setDurationLong(mins);
      saveSettings({ durationLong: mins });
    }
    setTimeRemaining(mins * 60);
    setTotalDuration(mins * 60);
    setDragMinutes(null);
  };

  const handleResetAllData = () => {
    if (confirm('Are you absolutely sure you want to delete all configuration, tasks, and history? This cannot be undone.')) {
      localStorage.removeItem('pomodoro_settings');
      localStorage.removeItem('pomodoro_tasks');
      localStorage.removeItem('pomodoro_history');
      
      setDurationFocus(25);
      setDurationShort(5);
      setDurationLong(15);
      setLongBreakInterval(4);
      setAutoStartBreaks(false);
      setAutoStartFocus(false);
      setVolume(0.5);
      setIsMuted(false);
      setAlertScope('both');
      setAlarmSound('chime');
      setIsTicking(false);
      setAmbientSound('none');
      setAmbientVolume(0.3);
      setAccentColor('rust');
      setBaseFontSize(18);
      setWebhookUrl('');
      
      setTasks([]);
      setHistory([]);
      setCurrentPhase('focus');
      setTimerState('idle');
      setTimeRemaining(25 * 60);
      setFocusSessionsCompleted(0);
      setActiveTaskId(null);
      alert('All Pomodoro data has been reset.');
    }
  };

  const handleTestAlarm = () => {
    playSynthAlarm(alarmSound, volume);
  };

  const forceAudioUnlock = () => {
    getAudioContext();
  };

  const getPlantEmoji = () => {
    const count = getTodaySessions();
    if (count === 0) return { emoji: '🌱', label: 'Sprout (0 sessions completed today)' };
    if (count <= 2) return { emoji: '🌿', label: 'Herb Vine (1-2 sessions today)' };
    if (count <= 4) return { emoji: '🪴', label: 'Potted Leaf (3-4 sessions today)' };
    if (count <= 6) return { emoji: '🌸', label: 'Blossom Bloom (5-6 sessions today)' };
    return { emoji: '🌳', label: 'Mighty Oak (7+ sessions today! Incredible!)' };
  };

  const formatDigitalTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const theme = accentColors[accentColor];
  const [subTaskInputs, setSubTaskInputs] = useState<Record<string, string>>({});

  // Compute current duration setting based on active phase
  const currentDurationSetting = currentPhase === 'focus' 
    ? durationFocus 
    : currentPhase === 'short_break' 
      ? durationShort 
      : durationLong;

  // Compute the displayed time and progress for the ring (scaled to 60 mins max for clock-face visual representation)
  const displayMinutes = isDragging && dragMinutes !== null 
    ? dragMinutes 
    : timerState === 'idle' 
      ? currentDurationSetting 
      : Math.ceil(timeRemaining / 60);

  const displayProgress = isDragging && dragMinutes !== null
    ? (dragMinutes / 60) * 100
    : timerState === 'idle'
      ? (currentDurationSetting / 60) * 100
      : (timeRemaining / 3600) * 100;
  const phaseVis = phaseVisuals[currentPhase];

  // Helper: build the SVG gradient defs for animated themes
  const renderGradDefs = () => {
    if (!(theme as any).animated) return null;
    const t = theme as any;
    return (
      <defs>
        <linearGradient id={t.gradId} x1="0%" y1="0%" x2="100%" y2="100%" gradientUnits="userSpaceOnUse">
          <stop offset="0%" className={t.stopClass1} />
          <stop offset="100%" className={t.stopClass2} />
        </linearGradient>
      </defs>
    );
  };

  return (
    <div 
      className="pomodoro-container max-w-6xl mx-auto px-2 md:px-4 py-4 transition-all"
      style={{ fontSize: `${baseFontSize}px` }}
      onClick={forceAudioUnlock}
    >
      {/* ZEN MODE SHELL OVERLAY */}
      {zenMode && (
        <div className="fixed inset-0 z-100 bg-bg-light dark:bg-bg-dark flex flex-col items-center justify-center p-6 transition-colors duration-300">
          <div className="absolute top-6 right-6 flex items-center gap-2">
            <button 
              onClick={() => setZenMode(false)}
              className="px-4 py-2 bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-xl text-xs font-bold hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">visibility</span>
              Exit Zen Mode
            </button>
          </div>

          <div className="text-center space-y-8 animate-fadeIn">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark shadow-sm">
              <span className={`w-2.5 h-2.5 rounded-full ${
                currentPhase === 'focus' ? 'bg-brand-secondary' : 'bg-emerald-500'
              }`}></span>
              <span className="text-xs font-bold uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">
                {currentPhase === 'focus' ? 'Focus Session' : currentPhase === 'short_break' ? 'Short Break' : 'Long Break'}
              </span>
            </div>

            <div className="relative w-80 h-80 mx-auto flex items-center justify-center select-none">
              <svg className="w-full h-full transform -rotate-90">
                <circle 
                  cx="160" cy="160" r="140" 
                  className="stroke-border-light dark:stroke-border-dark fill-transparent"
                  strokeWidth="8"
                />
                <circle 
                  cx="160" cy="160" r="140" 
                  className="fill-transparent transition-all duration-300 ease-linear"
                  stroke={theme.ring}
                  strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 140 * (displayProgress / 100)} ${2 * Math.PI * 140 * (1 - displayProgress / 100)}`}
                  strokeDashoffset={0}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="font-mono-custom font-black text-6xl text-text-light dark:text-text-dark leading-none">
                  {formatDigitalTime(timeRemaining)}
                </span>
                {activeTaskId && tasks.find(t => t.id === activeTaskId) && (
                  <span className="text-xs font-medium text-text-light-muted dark:text-text-dark-muted mt-4 max-w-[200px] truncate">
                    🎯 {tasks.find(t => t.id === activeTaskId)?.title}
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-center items-center gap-4">
              <button 
                onClick={resetTimer}
                className="w-12 h-12 flex items-center justify-center rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-all cursor-pointer"
                title="Reset Session (R)"
              >
                <span className="material-symbols-outlined text-lg">replay</span>
              </button>
              <button 
                onClick={timerState === 'running' ? pauseTimer : startTimer}
                className={`w-18 h-18 flex items-center justify-center rounded-3xl text-white font-bold transition-all shadow-md cursor-pointer ${
                  timerState === 'running' ? 'bg-amber-500 hover:bg-amber-600' : theme.primary
                }`}
                title={timerState === 'running' ? 'Pause (Space)' : 'Start (Space)'}
              >
                <span className="material-symbols-outlined text-2xl select-none">
                  {timerState === 'running' ? 'pause' : 'play_arrow'}
                </span>
              </button>
              <button 
                onClick={skipPhase}
                className="w-12 h-12 flex items-center justify-center rounded-2xl bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-all cursor-pointer"
                title="Skip Phase (S)"
              >
                <span className="material-symbols-outlined text-lg">skip_next</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STANDARD MULTI-PANEL VIEW */}
      {!zenMode && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
          {/* LEFT SIDE: TIMER (7 columns) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className={`bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-3xl p-6 shadow-custom-md flex flex-col items-center justify-center relative transition-colors duration-300 bg-gradient-to-b ${phaseVis.bg} to-transparent`}>
              
              {/* Header row */}
              <div className="w-full flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <span className="text-2xl" role="img" aria-label={phaseVis.label}>{phaseVis.emoji}</span>
                  <div>
                    <div className="text-sm font-extrabold text-text-light dark:text-text-dark leading-tight">{phaseVis.label}</div>
                    <div className="text-xxs font-medium text-text-light-muted dark:text-text-dark-muted">{phaseVis.sublabel}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowShortcutsModal(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-light dark:bg-bg-dark hover:opacity-80 transition-all border border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted cursor-pointer"
                    title="Keyboard Shortcuts"
                  >
                    <span className="material-symbols-outlined text-sm">help</span>
                  </button>
                  <button 
                    onClick={() => setZenMode(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-light dark:bg-bg-dark hover:opacity-80 transition-all border border-border-light dark:border-border-dark text-text-light-muted dark:text-text-dark-muted cursor-pointer"
                    title="Zen Mode"
                  >
                    <span className="material-symbols-outlined text-sm">fullscreen</span>
                  </button>
                </div>
              </div>

              {/* Phase selector tabs */}
              <div className="flex bg-bg-light dark:bg-bg-dark p-1 rounded-2xl border border-border-light dark:border-border-dark mb-6 select-none w-full">
                {(['focus', 'short_break', 'long_break'] as const).map(phase => {
                  const pv = phaseVisuals[phase];
                  return (
                    <button
                      key={phase}
                      onClick={() => moveToNextPhase(phase, true)}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        currentPhase === phase 
                          ? 'bg-surface-light dark:bg-surface-dark text-brand-primary dark:text-brand-secondary shadow-sm' 
                          : 'text-text-light-muted dark:text-text-dark-muted hover:opacity-90'
                      }`}
                    >
                      <span>{pv.emoji}</span>
                      <span className="hidden sm:inline">{phase === 'focus' ? 'Focus' : phase === 'short_break' ? 'Short' : 'Long'}</span>
                    </button>
                  );
                })}
              </div>

              {/* ── Circular Ring Timer (drag to set when idle) ── */}
              <div className="relative w-72 h-72 flex items-center justify-center mb-6 select-none">
                <svg
                  ref={ringRef}
                  className={`w-full h-full transform -rotate-90 ${
                    timerState === 'idle' ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                  onPointerDown={handleRingPointerDown}
                  onPointerMove={handleRingPointerMove}
                  onPointerUp={handleRingPointerUp}
                  onPointerLeave={handleRingPointerUp}
                >
                  {renderGradDefs()}
                  {/* Track ring */}
                  <circle 
                    cx="144" cy="144" r="128" 
                    className="stroke-border-light dark:stroke-border-dark fill-transparent"
                    strokeWidth="10"
                  />
                  {/* Progress ring */}
                  <circle 
                    cx="144" cy="144" r="128" 
                    className="fill-transparent transition-all duration-300 ease-linear"
                    stroke={(theme as any).ring}
                    strokeWidth="10"
                    strokeDasharray={`${2 * Math.PI * 128 * (displayProgress / 100)} ${2 * Math.PI * 128 * (1 - displayProgress / 100)}`}
                    strokeDashoffset={0}
                    strokeLinecap="round"
                  />
                  {/* Drag handle dot — shown only when idle */}
                  {timerState === 'idle' && (() => {
                    const angle = (displayProgress / 100) * 360;
                    const rad = angle * (Math.PI / 180);
                    const hx = 144 + 128 * Math.cos(rad);
                    const hy = 144 + 128 * Math.sin(rad);
                    return (
                      <circle
                        cx={hx} cy={hy} r="9"
                        fill={(theme as any).animated ? (theme as any).secondary : (theme as any).ring}
                        className={isDragging ? '' : 'timer-handle-pulse'}
                        stroke="white"
                        strokeWidth="2"
                      />
                    );
                  })()}
                </svg>
                
                {/* Center display */}
                <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-mono-custom font-black text-6xl text-text-light dark:text-text-dark leading-none">
                    {isDragging && dragMinutes !== null
                      ? `${dragMinutes}:00`
                      : formatDigitalTime(timeRemaining)}
                  </span>
                  {isDragging ? (
                    <span className="text-xs font-bold text-text-light-muted dark:text-text-dark-muted mt-2 animate-pulse">
                      Drag to set · {displayMinutes} min
                    </span>
                  ) : (
                    <span className="text-xs font-bold uppercase tracking-widest text-text-light-muted dark:text-text-dark-muted mt-2">
                      {phaseVis.sublabel}
                    </span>
                  )}
                  {/* Idle hint */}
                  {timerState === 'idle' && !isDragging && (
                    <span className="text-[10px] text-text-light-muted/50 dark:text-text-dark-muted/50 mt-1">
                      ↻ drag ring to set time
                    </span>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4 mb-5">
                <button 
                  onClick={resetTimer}
                  className="w-12 h-12 flex items-center justify-center rounded-2xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer"
                  title="Reset (R)"
                >
                  <span className="material-symbols-outlined text-lg">replay</span>
                </button>

                <button 
                  onClick={timerState === 'running' ? pauseTimer : startTimer}
                  className={`w-32 py-3.5 flex items-center justify-center gap-2 rounded-2xl font-black text-sm shadow-custom transition-all cursor-pointer ${
                    timerState === 'running' 
                      ? 'bg-amber-500 text-white hover:opacity-90' 
                      : (theme as any).primary
                  }`}
                  title={timerState === 'running' ? 'Pause (Space)' : 'Start (Space)'}
                >
                  <span className="material-symbols-outlined text-base">
                    {timerState === 'running' ? 'pause' : 'play_arrow'}
                  </span>
                  {timerState === 'running' ? 'PAUSE' : 'START'}
                </button>

                <button 
                  onClick={skipPhase}
                  className="w-12 h-12 flex items-center justify-center rounded-2xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors cursor-pointer"
                  title="Skip Phase (S)"
                >
                  <span className="material-symbols-outlined text-lg">skip_next</span>
                </button>
              </div>

              {/* Bottom info strip */}
              <div className="w-full pt-4 border-t border-border-light dark:border-border-dark flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-1.5 text-text-light-muted dark:text-text-dark-muted">
                  <span className="material-symbols-outlined text-sm">task_alt</span>
                  <span>Active Task:</span>
                  {activeTaskId && tasks.find(t => t.id === activeTaskId) ? (
                    <span className="font-bold text-text-light dark:text-text-dark truncate max-w-[200px]">
                      {tasks.find(t => t.id === activeTaskId)?.title}
                    </span>
                  ) : (
                    <span className="italic">None Selected</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark select-none" title={getPlantEmoji().label}>
                  <span className="text-sm">{getPlantEmoji().emoji}</span>
                  <span className="font-semibold text-text-light-muted dark:text-text-dark-muted">Streak: {getStreakCount()}d</span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-brand-primary/5 to-brand-secondary/5 border border-brand-primary/10 dark:border-brand-secondary/10 p-5 rounded-2xl space-y-2 text-xxs text-text-light-muted dark:text-text-dark-muted">
              <div className="font-bold text-text-light dark:text-text-dark flex items-center gap-1">
                <span className="material-symbols-outlined text-brand-secondary text-sm">bolt</span>
                How to use Pomodoro
              </div>
              <ol className="list-decimal pl-4 space-y-1 leading-relaxed">
                <li>Choose a task from your task list or create a new one.</li>
                <li>Set the task as active.</li>
                <li>Click <strong>Start</strong> to trigger focus ticking. Focus entirely on that task until the timer alarm rings.</li>
                <li>Take a short 5-minute break. Stretch or drink water.</li>
                <li>Every 4 focus sessions, reward yourself with a longer 15-minute break.</li>
              </ol>
            </div>
          </div>

          {/* RIGHT SIDE: UTILITIES DRAWER (5 columns) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-3xl shadow-custom-md overflow-hidden transition-colors duration-300">
              <div className="flex border-b border-border-light dark:border-border-dark bg-bg-light/35 dark:bg-bg-dark/35 select-none">
                <button 
                  onClick={() => setActiveTab('tasks')}
                  className={`flex-1 py-3 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'tasks' 
                      ? 'bg-surface-light dark:bg-surface-dark border-b-2 border-brand-primary dark:border-brand-secondary text-text-light dark:text-text-dark' 
                      : 'text-text-light-muted dark:text-text-dark-muted hover:bg-bg-light/50 dark:hover:bg-bg-dark/50'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">task_alt</span>
                  Tasks
                </button>
                <button 
                  onClick={() => setActiveTab('stats')}
                  className={`flex-1 py-3 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'stats' 
                      ? 'bg-surface-light dark:bg-surface-dark border-b-2 border-brand-primary dark:border-brand-secondary text-text-light dark:text-text-dark' 
                      : 'text-text-light-muted dark:text-text-dark-muted hover:bg-bg-light/50 dark:hover:bg-bg-dark/50'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">bar_chart</span>
                  Stats
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className={`flex-1 py-3 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'settings' 
                      ? 'bg-surface-light dark:bg-surface-dark border-b-2 border-brand-primary dark:border-brand-secondary text-text-light dark:text-text-dark' 
                      : 'text-text-light-muted dark:text-text-dark-muted hover:bg-bg-light/50 dark:hover:bg-bg-dark/50'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">settings</span>
                  Settings
                </button>
              </div>

              <div className="p-5 min-h-[350px]">
                
                {/* 1. TASKS TAB */}
                {activeTab === 'tasks' && (
                  <div className="space-y-4">
                    <form onSubmit={handleCreateTask} className="space-y-3 bg-bg-light/40 dark:bg-bg-dark/40 p-4 rounded-2xl border border-border-light dark:border-border-dark">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-wider text-text-light-muted dark:text-text-dark-muted">
                          {editingTaskId ? 'Edit Task ✍️' : 'Add New Task 📝'}
                        </span>
                        {editingTaskId && (
                          <button 
                            type="button" 
                            onClick={() => {
                              setEditingTaskId(null);
                              setTaskTitle('');
                              setTaskNotes('');
                              setTaskEst(2);
                            }}
                            className="text-xxs text-wrong-red hover:underline cursor-pointer"
                          >
                            Cancel Edit
                          </button>
                        )}
                      </div>
                      
                      <input 
                        id="task-title-input"
                        type="text" 
                        placeholder="What are you working on?" 
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        required
                        className="w-full text-xs px-3.5 py-2 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark focus:outline-none focus:ring-1 focus:ring-brand-primary dark:focus:ring-brand-secondary"
                      />

                      <textarea 
                        placeholder="Add optional notes..." 
                        value={taskNotes}
                        onChange={(e) => setTaskNotes(e.target.value)}
                        className="w-full text-xs px-3.5 py-2 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark focus:outline-none focus:ring-1 focus:ring-brand-primary dark:focus:ring-brand-secondary h-14 resize-none"
                      />

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <label className="text-xxs text-text-light-muted dark:text-text-dark-muted">Est. Pomodoros:</label>
                          <select 
                            value={taskEst} 
                            onChange={(e) => setTaskEst(parseInt(e.target.value))}
                            className="text-xs px-2 py-1 rounded-lg border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark"
                          >
                            {[1,2,3,4,5,6,7,8,9,10,12,15].map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>
                        <button 
                          type="submit" 
                          className={`px-4 py-1.5 rounded-lg text-xxs font-bold cursor-pointer ${theme.primary}`}
                        >
                          {editingTaskId ? 'Save Task' : 'Add Task'}
                        </button>
                      </div>
                    </form>

                    {activeTasks.length > 0 && (
                      <div className="bg-brand-primary/5 dark:bg-brand-secondary/5 border border-brand-primary/10 dark:border-brand-secondary/10 rounded-xl p-3 flex justify-between items-center text-xxs text-text-light-muted dark:text-text-dark-muted">
                        <span>Est. Remaining Pomos: <strong>{totalRemainingEst}</strong></span>
                        <span>Projected Finish: <strong className="text-text-light dark:text-text-dark">{getEstimatedFinishTime()}</strong></span>
                      </div>
                    )}

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {tasks.filter(t => !t.completed).map((t, idx) => {
                        const subTaskInputVal = subTaskInputs[t.id] || '';
                        return (
                          <div 
                            key={t.id}
                            draggable
                            onDragStart={() => { dragItem.current = idx; }}
                            onDragEnter={() => { dragOverItem.current = idx; }}
                            onDragEnd={handleSort}
                            onDragOver={(e) => e.preventDefault()}
                            className={`p-3 rounded-xl border flex flex-col gap-2 transition-all group ${
                              activeTaskId === t.id 
                                ? `bg-surface-light dark:bg-surface-dark ${theme.border} border-l-4 border-l-brand-secondary` 
                                : 'bg-surface-light/60 dark:bg-surface-dark/60 border-border-light dark:border-border-dark hover:bg-surface-light dark:hover:bg-surface-dark'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <button 
                                  onClick={() => handleToggleTask(t.id)}
                                  className="w-4 h-4 flex items-center justify-center rounded border border-border-light dark:border-border-dark hover:border-brand-secondary transition-colors cursor-pointer"
                                  title="Complete Task"
                                >
                                  <span className="material-symbols-outlined text-[10px] text-transparent hover:text-text-light-muted dark:hover:text-text-dark-muted">check</span>
                                </button>
                                
                                <div className="flex-1 min-w-0">
                                  <p 
                                    onClick={() => setActiveTaskId(t.id)}
                                    className="text-xs font-bold text-text-light dark:text-text-dark truncate cursor-pointer hover:underline"
                                    title="Click to activate"
                                  >
                                    {t.title}
                                  </p>
                                  {t.notes && <p className="text-[10px] text-text-light-muted dark:text-text-dark-muted line-clamp-1">{t.notes}</p>}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 select-none">
                                <span className="text-xxs font-mono-custom bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark px-1.5 py-0.5 rounded text-text-light-muted dark:text-text-dark-muted">
                                  {t.completedPomodoros}/{t.estPomodoros} 🍅
                                </span>
                                <button 
                                  onClick={() => handleEditTask(t)}
                                  className="text-text-light-muted hover:text-brand-secondary transition-colors opacity-0 group-hover:opacity-100 p-0.5 cursor-pointer"
                                  title="Edit"
                                >
                                  <span className="material-symbols-outlined text-xs">edit</span>
                                </button>
                                <button 
                                  onClick={() => handleDeleteTask(t.id)}
                                  className="text-text-light-muted hover:text-wrong-red transition-colors opacity-0 group-hover:opacity-100 p-0.5 cursor-pointer"
                                  title="Delete"
                                >
                                  <span className="material-symbols-outlined text-xs">delete</span>
                                </button>
                                <span className="material-symbols-outlined text-xs text-text-light-muted/40 cursor-grab select-none">drag_indicator</span>
                              </div>
                            </div>

                            <div className="pl-6 border-t border-border-light/40 dark:border-border-dark/40 pt-2 space-y-1.5">
                              {t.subtasks.map(st => (
                                <div key={st.id} className="flex items-center justify-between text-xxs group/sub">
                                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                    <input 
                                      type="checkbox" 
                                      checked={st.completed}
                                      onChange={() => handleToggleSubTask(t.id, st.id)}
                                      className="w-3 h-3 text-brand-secondary border-border-light dark:border-border-dark rounded focus:ring-0"
                                    />
                                    <span className={st.completed ? 'line-through text-text-light-muted dark:text-text-dark-muted' : 'text-text-light dark:text-text-dark'}>
                                      {st.text}
                                    </span>
                                  </label>
                                  <button 
                                    onClick={() => handleDeleteSubTask(t.id, st.id)}
                                    className="text-text-light-muted hover:text-wrong-red transition-colors opacity-0 group-hover/sub:opacity-100 p-0.5 cursor-pointer"
                                  >
                                    <span className="material-symbols-outlined text-[10px]">close</span>
                                  </button>
                                </div>
                              ))}
                              
                              <div className="flex gap-2 pt-0.5">
                                <input 
                                  type="text" 
                                  placeholder="Add subtask..."
                                  value={subTaskInputVal}
                                  onChange={(e) => setSubTaskInputs(prev => ({ ...prev, [t.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddSubTask(t.id, subTaskInputVal);
                                      setSubTaskInputs(prev => ({ ...prev, [t.id]: '' }));
                                    }
                                  }}
                                  className="w-full text-[10px] px-2 py-1 rounded bg-bg-light/40 dark:bg-bg-dark/40 border border-border-light dark:border-border-dark text-text-light dark:text-text-dark focus:outline-none"
                                />
                                <button 
                                  type="button"
                                  onClick={() => {
                                    handleAddSubTask(t.id, subTaskInputVal);
                                    setSubTaskInputs(prev => ({ ...prev, [t.id]: '' }));
                                  }}
                                  className="px-2 text-[10px] font-bold border border-border-light dark:border-border-dark hover:bg-bg-light dark:hover:bg-bg-dark rounded text-text-light-muted dark:text-text-dark-muted cursor-pointer"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {tasks.filter(t => !t.completed).length === 0 && (
                        <p className="text-center italic text-xxs text-text-light-muted dark:text-text-dark-muted py-6">
                          No active tasks. Add one to get started!
                        </p>
                      )}
                    </div>

                    {tasks.filter(t => t.completed).length > 0 && (
                      <details className="border-t border-border-light dark:border-border-dark pt-3 group">
                        <summary className="text-xxs font-black text-text-light-muted dark:text-text-dark-muted uppercase cursor-pointer select-none flex items-center justify-between hover:text-text-light dark:hover:text-text-dark">
                          <span>Completed Tasks ({tasks.filter(t => t.completed).length})</span>
                          <span className="material-symbols-outlined text-xs transition-transform group-open:rotate-180">keyboard_arrow_down</span>
                        </summary>
                        <div className="space-y-1.5 mt-2 max-h-[160px] overflow-y-auto">
                          {tasks.filter(t => t.completed).map(t => (
                            <div key={t.id} className="p-2.5 rounded-lg bg-bg-light/20 dark:bg-bg-dark/20 border border-border-light/50 dark:border-border-dark/50 flex justify-between items-center text-xxs text-text-light-muted dark:text-text-dark-muted">
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => handleToggleTask(t.id)}
                                  className="w-3.5 h-3.5 flex items-center justify-center rounded border border-brand-secondary bg-brand-secondary/15 cursor-pointer text-brand-secondary"
                                >
                                  <span className="material-symbols-outlined text-[9px] font-bold">check</span>
                                </button>
                                <span className="line-through">{t.title}</span>
                              </div>
                              <div className="flex items-center gap-2 font-mono-custom">
                                <span>{t.completedPomodoros} 🍅</span>
                                <button onClick={() => handleDeleteTask(t.id)} className="hover:text-wrong-red cursor-pointer">
                                  <span className="material-symbols-outlined text-xs">delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* 2. STATS TAB */}
                {activeTab === 'stats' && (
                  <div className="space-y-5 animate-fadeIn">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-bg-light/40 dark:bg-bg-dark/40 border border-border-light dark:border-border-dark p-2 rounded-xl">
                        <p className="text-xxs text-text-light-muted dark:text-text-dark-muted">Today's Focus</p>
                        <p className="text-sm font-black text-text-light dark:text-text-dark mt-1 font-mono-custom">{getTodayMinutes()}m</p>
                        <p className="text-[9px] text-text-light-muted dark:text-text-dark-muted mt-0.5">{getTodaySessions()} pomos</p>
                      </div>
                      <div className="bg-bg-light/40 dark:bg-bg-dark/40 border border-border-light dark:border-border-dark p-2 rounded-xl">
                        <p className="text-xxs text-text-light-muted dark:text-text-dark-muted">Weekly</p>
                        <p className="text-sm font-black text-text-light dark:text-text-dark mt-1 font-mono-custom">{getWeeklyMinutes()}m</p>
                        <p className="text-[9px] text-text-light-muted dark:text-text-dark-muted mt-0.5">last 7 days</p>
                      </div>
                      <div className="bg-bg-light/40 dark:bg-bg-dark/40 border border-border-light dark:border-border-dark p-2 rounded-xl">
                        <p className="text-xxs text-text-light-muted dark:text-text-dark-muted">Streak</p>
                        <p className="text-sm font-black text-brand-secondary mt-1 font-mono-custom">🔥 {getStreakCount()}d</p>
                        <p className="text-[9px] text-text-light-muted dark:text-text-dark-muted mt-0.5">consecutive</p>
                      </div>
                    </div>

                    <div className="bg-bg-light/20 dark:bg-bg-dark/20 border border-border-light dark:border-border-dark rounded-2xl p-3 h-52 relative">
                      <canvas ref={chartRef}></canvas>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={handleExportData}
                        className="flex-1 py-2 text-xxs font-bold rounded-lg border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark hover:bg-surface-light-hover dark:hover:bg-surface-dark-hover transition-colors text-text-light dark:text-text-dark flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-xs">download</span>
                        Export Data
                      </button>
                      <button 
                        onClick={handleResetAllData}
                        className="py-2 px-3 text-xxs font-bold rounded-lg border border-wrong-red/35 bg-wrong-red/5 hover:bg-wrong-red/10 transition-colors text-wrong-red flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-xs">delete</span>
                        Reset Data
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. SETTINGS TAB */}
                {activeTab === 'settings' && (
                  <div className="space-y-4 text-xxs animate-fadeIn">
                    <div className="space-y-2">
                      <span className="font-bold text-text-light dark:text-text-dark uppercase tracking-wider block">Timer Lengths (minutes)</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-text-light-muted dark:text-text-dark-muted mb-0.5 block">Focus</label>
                          <input 
                            type="number" 
                            min="1" max="60" 
                            value={durationFocus}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(60, parseInt(e.target.value) || 25));
                              setDurationFocus(val);
                              saveSettings({ durationFocus: val });
                            }}
                            className="w-full px-2 py-1 rounded border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                          />
                        </div>
                        <div>
                          <label className="text-text-light-muted dark:text-text-dark-muted mb-0.5 block">Short Break</label>
                          <input 
                            type="number" 
                            min="1" max="60" 
                            value={durationShort}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(60, parseInt(e.target.value) || 5));
                              setDurationShort(val);
                              saveSettings({ durationShort: val });
                            }}
                            className="w-full px-2 py-1 rounded border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                          />
                        </div>
                        <div>
                          <label className="text-text-light-muted dark:text-text-dark-muted mb-0.5 block">Long Break</label>
                          <input 
                            type="number" 
                            min="1" max="60" 
                            value={durationLong}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(60, parseInt(e.target.value) || 15));
                              setDurationLong(val);
                              saveSettings({ durationLong: val });
                            }}
                            className="w-full px-2 py-1 rounded border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center py-1">
                      <span className="text-text-light-muted dark:text-text-dark-muted">Long Break Interval (sessions):</span>
                      <input 
                        type="number" 
                        min="1" max="12" 
                        value={longBreakInterval}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(12, parseInt(e.target.value) || 4));
                          setLongBreakInterval(val);
                          saveSettings({ longBreakInterval: val });
                        }}
                        className="w-12 px-2 py-0.5 text-center rounded border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                      />
                    </div>

                    <div className="space-y-1.5 pt-1 border-t border-border-light/40 dark:border-border-dark/40">
                      <label className="flex items-center justify-between cursor-pointer py-0.5 select-none">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Auto-start Breaks</span>
                        <input 
                          type="checkbox" 
                          checked={autoStartBreaks}
                          onChange={(e) => {
                            setAutoStartBreaks(e.target.checked);
                            saveSettings({ autoStartBreaks: e.target.checked });
                          }}
                          className="w-3.5 h-3.5 text-brand-secondary border-border-light dark:border-border-dark rounded focus:ring-0"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer py-0.5 select-none">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Auto-start Next Focus Session</span>
                        <input 
                          type="checkbox" 
                          checked={autoStartFocus}
                          onChange={(e) => {
                            setAutoStartFocus(e.target.checked);
                            saveSettings({ autoStartFocus: e.target.checked });
                          }}
                          className="w-3.5 h-3.5 text-brand-secondary border-border-light dark:border-border-dark rounded focus:ring-0"
                        />
                      </label>
                    </div>

                    <div className="space-y-2 border-t border-border-light/40 dark:border-border-dark/40 pt-2">
                      <span className="font-bold text-text-light dark:text-text-dark uppercase tracking-wider block">Sound & Alerts</span>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Alert Scope:</span>
                        <select 
                          value={alertScope}
                          onChange={(e) => {
                            const val = e.target.value as any;
                            setAlertScope(val);
                            saveSettings({ alertScope: val });
                          }}
                          className="px-2 py-0.5 border border-border-light dark:border-border-dark rounded bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                        >
                          <option value="both">Both Focus & Breaks</option>
                          <option value="focus">Focus Only</option>
                          <option value="breaks">Breaks Only</option>
                          <option value="none">None (Silent)</option>
                        </select>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Alarm Sound:</span>
                        <div className="flex gap-2">
                          <select 
                            value={alarmSound}
                            onChange={(e) => {
                              setAlarmSound(e.target.value);
                              saveSettings({ alarmSound: e.target.value });
                            }}
                            className="px-2 py-0.5 border border-border-light dark:border-border-dark rounded bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                          >
                            <option value="chime">Warm Chime 🔔</option>
                            <option value="bell">Brass Bell 🛎️</option>
                            <option value="beep">Digital Beep 🎛️</option>
                            <option value="retro">Retro Siren 🚨</option>
                          </select>
                          <button 
                            type="button" 
                            onClick={handleTestAlarm}
                            className="px-2 border border-border-light dark:border-border-dark rounded bg-bg-light dark:bg-bg-dark hover:opacity-85 text-[10px] cursor-pointer"
                          >
                            Test
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center gap-4">
                        <div className="flex items-center gap-1 text-text-light-muted dark:text-text-dark-muted select-none">
                          <span 
                            onClick={() => {
                              setIsMuted(prev => {
                                saveSettings({ isMuted: !prev });
                                return !prev;
                              });
                            }}
                            className="material-symbols-outlined text-sm cursor-pointer hover:text-brand-secondary"
                          >
                            {isMuted || volume === 0 ? 'volume_off' : 'volume_up'}
                          </span>
                          <span>Volume:</span>
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.05"
                          value={volume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setVolume(val);
                            saveSettings({ volume: val });
                          }}
                          className="w-28 accent-brand-secondary"
                        />
                      </div>

                      <label className="flex items-center justify-between cursor-pointer py-0.5 select-none">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Ticking during Focus</span>
                        <input 
                          type="checkbox" 
                          checked={isTicking}
                          onChange={(e) => {
                            setIsTicking(e.target.checked);
                            saveSettings({ isTicking: e.target.checked });
                          }}
                          className="w-3.5 h-3.5 text-brand-secondary border-border-light dark:border-border-dark rounded focus:ring-0"
                        />
                      </label>

                      <div className="flex justify-between items-center border-t border-border-light/30 dark:border-border-dark/30 pt-2">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Ambient Sound:</span>
                        <select 
                          value={ambientSound}
                          onChange={(e) => {
                            const val = e.target.value as any;
                            setAmbientSound(val);
                            saveSettings({ ambientSound: val });
                          }}
                          className="px-2 py-0.5 border border-border-light dark:border-border-dark rounded bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                        >
                          <option value="none">None (Ambient Off)</option>
                          <option value="rain">Gentle Rain 🌧️</option>
                          <option value="white_noise">White Noise 🔕</option>
                          <option value="cafe">Café Murmur ☕</option>
                          <option value="forest">Forest Breeze 🌳</option>
                        </select>
                      </div>

                      {ambientSound !== 'none' && (
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-text-light-muted dark:text-text-dark-muted">Ambient Vol:</span>
                          <input 
                            type="range" min="0" max="1" step="0.05"
                            value={ambientVolume}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setAmbientVolume(val);
                              saveSettings({ ambientVolume: val });
                              updateSynthAmbientVolume(val);
                            }}
                            className="w-28 accent-brand-secondary"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 border-t border-border-light/40 dark:border-border-dark/40 pt-2">
                      <span className="font-bold text-text-light dark:text-text-dark uppercase tracking-wider block">Customization</span>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Accent Theme:</span>
                        <select 
                          value={accentColor}
                          onChange={(e) => {
                            const val = e.target.value as keyof typeof accentColors;
                            setAccentColor(val);
                            saveSettings({ accentColor: val });
                          }}
                          className="px-2 py-0.5 border border-border-light dark:border-border-dark rounded bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark"
                        >
                          {Object.entries(accentColors).map(([k, v]) => (
                            <option key={k} value={k}>{v.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex justify-between items-center gap-4">
                        <span className="text-text-light-muted dark:text-text-dark-muted">Adjust Font Size:</span>
                        <div className="flex items-center gap-2">
                          <input 
                            type="range" min="12" max="22" step="1"
                            value={baseFontSize}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setBaseFontSize(val);
                              saveSettings({ baseFontSize: val });
                            }}
                            className="w-20 accent-brand-secondary"
                          />
                          <span className="font-mono-custom w-8 text-right text-text-light-muted dark:text-text-dark-muted">{baseFontSize}px</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-border-light/40 dark:border-border-dark/40 pt-2">
                      <span className="font-bold text-text-light dark:text-text-dark uppercase tracking-wider block">Integrations</span>
                      <label className="text-text-light-muted dark:text-text-dark-muted mb-0.5 block">POST Webhook URL (on completion):</label>
                      <input 
                        type="url" 
                        placeholder="https://yourserver.com/webhook"
                        value={webhookUrl}
                        onChange={(e) => {
                          setWebhookUrl(e.target.value);
                          saveSettings({ webhookUrl: e.target.value });
                        }}
                        className="w-full px-2.5 py-1 rounded border border-border-light dark:border-border-dark bg-bg-light dark:bg-bg-dark text-text-light dark:text-text-dark focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2 border-t border-border-light/40 dark:border-border-dark/40 pt-2">
                      <span className="font-bold text-text-light dark:text-text-dark uppercase tracking-wider block">Import Backup JSON</span>
                      <input 
                        type="file" 
                        accept=".json"
                        onChange={handleImportData}
                        className="text-[10px] w-full file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-semibold file:bg-bg-light dark:file:bg-bg-dark file:text-text-light-muted dark:file:text-text-dark-muted hover:file:opacity-90 cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KEYBOARD SHORTCUTS DISCOVERABILITY HELP MODAL */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-110 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-3xl p-6 max-w-sm w-full shadow-custom-md animate-fadeIn text-xs space-y-4">
            <div className="flex justify-between items-center border-b border-border-light dark:border-border-dark pb-2.5">
              <span className="font-display font-extrabold text-sm text-text-light dark:text-text-dark flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">keyboard</span>
                Keyboard Shortcuts
              </span>
              <button 
                onClick={() => setShowShortcutsModal(false)}
                className="text-text-light-muted hover:text-text-light dark:hover:text-text-dark cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="space-y-2.5 py-1">
              <div className="flex justify-between items-center">
                <span className="text-text-light-muted dark:text-text-dark-muted font-medium">Start / Pause Timer</span>
                <kbd className="px-2 py-1 rounded bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark font-mono-custom font-bold">Space</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-light-muted dark:text-text-dark-muted font-medium">Skip Current Phase</span>
                <kbd className="px-2 py-1 rounded bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark font-mono-custom font-bold">S</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-light-muted dark:text-text-dark-muted font-medium">Reset Countdown</span>
                <kbd className="px-2 py-1 rounded bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark font-mono-custom font-bold">R</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-light-muted dark:text-text-dark-muted font-medium">Create New Task</span>
                <kbd className="px-2 py-1 rounded bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark font-mono-custom font-bold">N</kbd>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-light-muted dark:text-text-dark-muted font-medium">Toggle Shortcuts Help</span>
                <kbd className="px-2 py-1 rounded bg-bg-light dark:bg-bg-dark border border-border-light dark:border-border-dark font-mono-custom font-bold">?</kbd>
              </div>
            </div>
            
            <p className="text-[10px] text-text-light-muted dark:text-text-dark-muted italic leading-relaxed pt-1.5 border-t border-border-light/40 dark:border-border-dark/40">
              * Shortcuts are disabled while typing in input boxes or notes to prevent accidental actions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
