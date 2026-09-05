import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Edit2,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  RotateCcw,
  Sparkles,
  ListTodo,
  CalendarDays,
  Loader2,
  AlertCircle,
  CheckSquare,
  Mic,
  MicOff,
  Clock,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Undo2,
  Flame,
  Flag,
  ListPlus
} from 'lucide-react';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface UserInfo {
  id: string;
  email: string;
}

interface SubTask {
  id: string;
  text: string;
  is_completed: boolean;
}

interface TodoItem {
  id: string;
  user_id: string;
  date: string;
  task_text: string;
  is_completed: boolean;
  created_at: string;
  due_time?: string | null;
  priority?: string;
  sub_tasks?: SubTask[];
}

interface UndoAction {
  type: 'transfer' | 'bulk-transfer';
  todoId?: string;
  previousDate?: string;
  items?: { id: string; date: string }[];
  expiresAt: number;
}

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatHumanDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low: { label: 'Low', color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  normal: { label: 'Normal', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  high: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  urgent: { label: 'Urgent', color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
};

// ─── NLP DATE/TIME PARSER (HINDI + ENGLISH) ──────────────────────────────────

interface ParsedDateResult {
  cleanText: string;
  date: string | null;
  time: string | null;
}

function parseNaturalDateTime(input: string, baseDate: Date = new Date()): ParsedDateResult {
  let text = input.trim();
  let parsedDate: string | null = null;
  let parsedTime: string | null = null;

  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  // ── English Date Patterns ──
  const datePatterns: { regex: RegExp; resolver: (match: RegExpMatchArray) => Date }[] = [
    { regex: /\btoday\b/i, resolver: () => new Date(today) },
    { regex: /\btomorrow\b/i, resolver: () => { const d = new Date(today); d.setDate(d.getDate() + 1); return d; } },
    { regex: /\bday\s+after\s+tomorrow\b/i, resolver: () => { const d = new Date(today); d.setDate(d.getDate() + 2); return d; } },
    { regex: /\byesterday\b/i, resolver: () => { const d = new Date(today); d.setDate(d.getDate() - 1); return d; } },
    {
      regex: /\bin\s+(\d+)\s+days?\b/i,
      resolver: (m) => { const d = new Date(today); d.setDate(d.getDate() + parseInt(m[1])); return d; }
    },
    {
      regex: /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      resolver: (m) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const target = days.indexOf(m[1].toLowerCase());
        const d = new Date(today);
        const diff = (target - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return d;
      }
    },
    {
      regex: /\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      resolver: (m) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const target = days.indexOf(m[1].toLowerCase());
        const d = new Date(today);
        const diff = (target - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return d;
      }
    },
  ];

  // ── Hindi Date Patterns ──
  const hindiDatePatterns: { regex: RegExp; resolver: (match: RegExpMatchArray) => Date }[] = [
    { regex: /\bआज\b/, resolver: () => new Date(today) },
    { regex: /\bकल\b/, resolver: () => { const d = new Date(today); d.setDate(d.getDate() + 1); return d; } },
    { regex: /\bपरसों\b/, resolver: () => { const d = new Date(today); d.setDate(d.getDate() + 2); return d; } },
    { regex: /\bपरसो\b/, resolver: () => { const d = new Date(today); d.setDate(d.getDate() + 2); return d; } },
  ];

  // ── English Time Patterns ──
  const timePatterns: { regex: RegExp; resolver: (match: RegExpMatchArray) => string }[] = [
    {
      regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
      resolver: (m) => {
        let h = parseInt(m[1]);
        const min = m[2] ? parseInt(m[2]) : 0;
        if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    },
    {
      regex: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
      resolver: (m) => {
        let h = parseInt(m[1]);
        const min = m[2] ? parseInt(m[2]) : 0;
        if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    },
    {
      regex: /\bat\s+(\d{1,2}):(\d{2})\b/i,
      resolver: (m) => `${String(parseInt(m[1])).padStart(2, '0')}:${m[2]}`
    },
  ];

  // ── Hindi Time Patterns ──
  const hindiTimePatterns: { regex: RegExp; resolver: (match: RegExpMatchArray) => string }[] = [
    {
      // "शाम 5 बजे", "सुबह 8 बजे", "रात 9 बजे", "दोपहर 2 बजे"
      regex: /(सुबह|दोपहर|शाम|रात)\s+(\d{1,2})(?::(\d{2}))?\s*बजे/,
      resolver: (m) => {
        let h = parseInt(m[2]);
        const min = m[3] ? parseInt(m[3]) : 0;
        const period = m[1];
        if (period === 'शाम' && h < 12) h = h < 6 ? h + 12 : h + 12;
        if (period === 'रात' && h < 12) h += 12;
        if (period === 'दोपहर' && h < 12) h += 12;
        if (period === 'दोपहर' && h === 12) h = 12;
        if (h >= 24) h = h - 12; // safety
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    },
    {
      // "5 बजे"
      regex: /(\d{1,2})(?::(\d{2}))?\s*बजे/,
      resolver: (m) => {
        let h = parseInt(m[1]);
        const min = m[2] ? parseInt(m[2]) : 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    },
  ];

  // Process Hindi date patterns first (more specific)
  for (const pattern of hindiDatePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      parsedDate = getLocalDateString(pattern.resolver(match));
      text = text.replace(match[0], '').trim();
      break;
    }
  }

  // If no Hindi date found, try English
  if (!parsedDate) {
    for (const pattern of datePatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        parsedDate = getLocalDateString(pattern.resolver(match));
        text = text.replace(match[0], '').trim();
        break;
      }
    }
  }

  // Process Hindi time patterns first
  for (const pattern of hindiTimePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      parsedTime = pattern.resolver(match);
      text = text.replace(match[0], '').trim();
      break;
    }
  }

  // If no Hindi time found, try English
  if (!parsedTime) {
    for (const pattern of timePatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        parsedTime = pattern.resolver(match);
        text = text.replace(match[0], '').trim();
        break;
      }
    }
  }

  // Clean up extra spaces and connectors
  text = text.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '').trim();

  return { cleanText: text, date: parsedDate, time: parsedTime };
}

// ─── AUTH HELPER ─────────────────────────────────────────────────────────────

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('todo_auth_token');
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });
}

// ─── VOICE INPUT HOOK ─────────────────────────────────────────────────────────

function useVoiceInput(onNotification?: (msg: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const hasSpeech = typeof window !== 'undefined' && (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window));
    setIsSupported(!!hasSpeech);
  }, []);

  const startListening = useCallback((onResult: (transcript: string) => void) => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        onNotification?.('Microphone requires HTTPS or localhost. Once deployed, voice mic works automatically!');
      } else {
        onNotification?.('Speech recognition is not supported in this browser. Please use Chrome, Safari, or Edge.');
      }
      return;
    }

    // Stop any running instance cleanly
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      // Default to device language, or en-IN
      recognition.lang = navigator.language || 'en-IN';
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          onResult(transcript);
        }
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          onNotification?.('Microphone permission denied. Please allow microphone access in browser settings.');
        } else if (event.error === 'no-speech') {
          onNotification?.('No speech detected. Please speak closer to the microphone.');
        } else if (event.error === 'network') {
          onNotification?.('Voice recognition network error. Check your connection or HTTPS.');
        } else if (event.error !== 'aborted') {
          onNotification?.(`Speech error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      setIsListening(true);
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
      if (!window.isSecureContext) {
        onNotification?.('Microphone requires HTTPS or localhost. Once deployed, voice mic works automatically!');
      } else {
        onNotification?.('Unable to start microphone. Please check browser permissions.');
      }
    }
  }, [onNotification]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
  }, []);

  return { isListening, isSupported, startListening, stopListening };
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function TodoListPage() {
  // Auth state
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Todo state
  const todayStr = useMemo(() => getLocalDateString(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todosLoading, setTodosLoading] = useState<boolean>(false);
  const [taskInput, setTaskInput] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Input bar state
  const [inputPriority, setInputPriority] = useState<string>('normal');
  const [parsedDueDate, setParsedDueDate] = useState<string | null>(null);
  const [parsedDueTime, setParsedDueTime] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Calendar Modal state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [datesWithTasks, setDatesWithTasks] = useState<Set<string>>(new Set());

  // Overdue state
  const [overdueTodos, setOverdueTodos] = useState<TodoItem[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [transferringIds, setTransferringIds] = useState<Set<string>>(new Set());
  const [bulkTransferring, setBulkTransferring] = useState(false);

  // Sub-task state
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(new Set());
  const [subtaskInputs, setSubtaskInputs] = useState<Record<string, string>>({});

  // Undo toast state
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [undoDismissing, setUndoDismissing] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // General notification banner / toast state
  const [notification, setNotification] = useState<string | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = useCallback((msg: string) => {
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    setNotification(msg);
    notificationTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, 4500);
  }, []);

  // Error alert banner state
  const [pageError, setPageError] = useState<string | null>(null);

  // Voice input
  const { isListening, isSupported, startListening, stopListening } = useVoiceInput(showNotification);

  // Input ref
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── AUTH ─────────────────────────────────────────────────────────────

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    setAuthLoading(true);
    try {
      const res = await apiFetch('/api/auth/me');
      const data = await res.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
      } else {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('todo_auth_token');
        }
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check error:', err);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  // ─── FETCH TODOS ──────────────────────────────────────────────────────

  useEffect(() => {
    if (user) {
      fetchTodos(selectedDate);
      fetchDatesWithTasks();
      fetchOverdueTodos();
    }
  }, [user, selectedDate]);

  async function fetchTodos(dateStr: string) {
    setTodosLoading(true);
    setPageError(null);
    try {
      const res = await apiFetch(`/api/todos?date=${encodeURIComponent(dateStr)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.todos)) {
        setTodos(data.todos);
      } else if (data.error) {
        setPageError(data.error);
      }
    } catch (err) {
      console.error('Fetch todos error:', err);
      setPageError('Failed to load tasks. Please check your connection.');
    } finally {
      setTodosLoading(false);
    }
  }

  async function fetchDatesWithTasks() {
    try {
      const res = await apiFetch('/api/todos/dates');
      const data = await res.json();
      if (res.ok && Array.isArray(data.dates)) {
        setDatesWithTasks(new Set(data.dates));
      }
    } catch (err) {
      console.error('Fetch task dates error:', err);
    }
  }

  async function fetchOverdueTodos() {
    setOverdueLoading(true);
    try {
      const res = await apiFetch('/api/todos?overdue=true');
      const data = await res.json();
      if (res.ok && Array.isArray(data.todos)) {
        setOverdueTodos(data.todos);
      }
    } catch (err) {
      console.error('Fetch overdue error:', err);
    } finally {
      setOverdueLoading(false);
    }
  }

  // ─── AUTH HANDLERS ────────────────────────────────────────────────────

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Please fill in both email and password.');
      return;
    }

    setAuthSubmitting(true);
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed. Please try again.');
      } else if (data.user) {
        if (data.token && typeof window !== 'undefined') {
          localStorage.setItem('todo_auth_token', data.token);
        }
        setUser(data.user);
        setAuthEmail('');
        setAuthPassword('');
      }
    } catch (err) {
      console.error('Auth submit error:', err);
      setAuthError('Network error. Please try again.');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('todo_auth_token');
      }
      setUser(null);
      setTodos([]);
      setDatesWithTasks(new Set());
      setOverdueTodos([]);
    }
  }

  // ─── ADD TODO ─────────────────────────────────────────────────────────

  async function handleAddTodo(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!taskInput.trim() || addingTask) return;

    // Parse NLP from input
    const parsed = parseNaturalDateTime(taskInput);
    const finalText = parsed.cleanText || taskInput.trim();
    const finalDate = parsed.date || parsedDueDate || selectedDate;
    const finalTime = parsed.time || parsedDueTime || null;

    if (!finalText) return;

    setTaskInput('');
    setParsedDueDate(null);
    setParsedDueTime(null);
    setInputPriority('normal');
    setAddingTask(true);

    const tempId = 'temp_' + Date.now();
    const tempTodo: TodoItem = {
      id: tempId,
      user_id: user?.id || '',
      date: finalDate,
      task_text: finalText,
      is_completed: false,
      created_at: new Date().toISOString(),
      due_time: finalTime,
      priority: inputPriority,
      sub_tasks: [],
    };

    // Only add to visible list if the task date matches selected date
    if (finalDate === selectedDate) {
      setTodos(prev => [...prev, tempTodo]);
    }
    setDatesWithTasks(prev => new Set(prev).add(finalDate));

    try {
      const res = await apiFetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: finalDate,
          task_text: finalText,
          due_time: finalTime,
          priority: inputPriority,
          sub_tasks: [],
        }),
      });
      const data = await res.json();
      if (res.ok && data.todo) {
        if (finalDate === selectedDate) {
          setTodos(prev => prev.map(item => (item.id === tempId ? data.todo : item)));
        }
      } else {
        if (finalDate === selectedDate) {
          setTodos(prev => prev.filter(item => item.id !== tempId));
        }
        setPageError(data.error || 'Failed to add task.');
      }
    } catch (err) {
      console.error('Add todo error:', err);
      if (finalDate === selectedDate) {
        setTodos(prev => prev.filter(item => item.id !== tempId));
      }
      setPageError('Failed to add task. Please check your connection.');
    } finally {
      setAddingTask(false);
    }
  }

  // ─── TOGGLE COMPLETE ──────────────────────────────────────────────────

  async function handleToggleComplete(todo: TodoItem) {
    const nextCompleted = !todo.is_completed;
    setTodos(prev =>
      prev.map(item => (item.id === todo.id ? { ...item, is_completed: nextCompleted } : item))
    );

    try {
      const res = await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: nextCompleted }),
      });
      if (!res.ok) {
        setTodos(prev =>
          prev.map(item => (item.id === todo.id ? { ...item, is_completed: todo.is_completed } : item))
        );
      }
    } catch (err) {
      console.error('Toggle complete error:', err);
      setTodos(prev =>
        prev.map(item => (item.id === todo.id ? { ...item, is_completed: todo.is_completed } : item))
      );
    }
  }

  // ─── EDIT ─────────────────────────────────────────────────────────────

  function startEditing(todo: TodoItem) {
    setEditingId(todo.id);
    setEditingText(todo.task_text);
  }

  async function saveEditing(todo: TodoItem) {
    if (!editingText.trim()) return;
    const newText = editingText.trim();
    setEditingId(null);

    if (newText === todo.task_text) return;

    setTodos(prev =>
      prev.map(item => (item.id === todo.id ? { ...item, task_text: newText } : item))
    );

    try {
      const res = await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_text: newText }),
      });
      if (!res.ok) {
        setTodos(prev =>
          prev.map(item => (item.id === todo.id ? { ...item, task_text: todo.task_text } : item))
        );
      }
    } catch (err) {
      console.error('Save edit error:', err);
      setTodos(prev =>
        prev.map(item => (item.id === todo.id ? { ...item, task_text: todo.task_text } : item))
      );
    }
  }

  // ─── DELETE ───────────────────────────────────────────────────────────

  async function handleDeleteTodo(id: string) {
    const previousTodos = [...todos];
    const updatedTodos = todos.filter(item => item.id !== id);
    setTodos(updatedTodos);

    if (updatedTodos.length === 0) {
      const newDates = new Set(datesWithTasks);
      newDates.delete(selectedDate);
      setDatesWithTasks(newDates);
    }

    try {
      const res = await apiFetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setTodos(previousTodos);
      }
    } catch (err) {
      console.error('Delete todo error:', err);
      setTodos(previousTodos);
    }
  }

  // ─── TRANSFER TO TODAY (Single) ───────────────────────────────────────

  async function handleTransferToToday(todo: TodoItem) {
    const previousDate = todo.date;
    setTransferringIds(prev => new Set(prev).add(todo.id));

    // Optimistic update
    setOverdueTodos(prev => prev.filter(t => t.id !== todo.id));
    if (selectedDate === todayStr) {
      setTodos(prev => [...prev, { ...todo, date: todayStr }]);
    }

    try {
      const res = await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayStr }),
      });

      if (res.ok) {
        // Show undo toast
        showUndoToast({
          type: 'transfer',
          todoId: todo.id,
          previousDate,
          expiresAt: Date.now() + 5000,
        });
        fetchDatesWithTasks();
      } else {
        // Revert
        setOverdueTodos(prev => [...prev, todo]);
        if (selectedDate === todayStr) {
          setTodos(prev => prev.filter(t => t.id !== todo.id));
        }
      }
    } catch (err) {
      console.error('Transfer error:', err);
      setOverdueTodos(prev => [...prev, todo]);
      if (selectedDate === todayStr) {
        setTodos(prev => prev.filter(t => t.id !== todo.id));
      }
    } finally {
      setTransferringIds(prev => {
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
    }
  }

  // ─── BULK TRANSFER ALL OVERDUE ────────────────────────────────────────

  async function handleBulkTransfer() {
    if (overdueTodos.length === 0 || bulkTransferring) return;

    setBulkTransferring(true);
    const previousOverdue = [...overdueTodos];
    const itemsForUndo = overdueTodos.map(t => ({ id: t.id, date: t.date }));

    // Optimistic update
    setOverdueTodos([]);
    if (selectedDate === todayStr) {
      setTodos(prev => [...prev, ...previousOverdue.map(t => ({ ...t, date: todayStr }))]);
    }

    try {
      const res = await apiFetch('/api/todos/bulk-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: todayStr }),
      });

      if (res.ok) {
        showUndoToast({
          type: 'bulk-transfer',
          items: itemsForUndo,
          expiresAt: Date.now() + 5000,
        });
        fetchDatesWithTasks();
      } else {
        // Revert
        setOverdueTodos(previousOverdue);
        if (selectedDate === todayStr) {
          setTodos(prev => prev.filter(t => !itemsForUndo.find(u => u.id === t.id)));
        }
      }
    } catch (err) {
      console.error('Bulk transfer error:', err);
      setOverdueTodos(previousOverdue);
      if (selectedDate === todayStr) {
        setTodos(prev => prev.filter(t => !itemsForUndo.find(u => u.id === t.id)));
      }
    } finally {
      setBulkTransferring(false);
    }
  }

  // ─── UNDO TOAST SYSTEM ────────────────────────────────────────────────

  function showUndoToast(action: UndoAction) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoAction(action);
    setUndoDismissing(false);

    undoTimerRef.current = setTimeout(() => {
      setUndoDismissing(true);
      setTimeout(() => setUndoAction(null), 300);
    }, 5000);
  }

  async function handleUndo() {
    if (!undoAction) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    if (undoAction.type === 'transfer' && undoAction.todoId && undoAction.previousDate) {
      try {
        await apiFetch(`/api/todos/${undoAction.todoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: undoAction.previousDate }),
        });
        fetchTodos(selectedDate);
        fetchOverdueTodos();
        fetchDatesWithTasks();
      } catch (err) {
        console.error('Undo error:', err);
      }
    } else if (undoAction.type === 'bulk-transfer' && undoAction.items) {
      try {
        for (const item of undoAction.items) {
          await apiFetch(`/api/todos/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: item.date }),
          });
        }
        fetchTodos(selectedDate);
        fetchOverdueTodos();
        fetchDatesWithTasks();
      } catch (err) {
        console.error('Bulk undo error:', err);
      }
    }

    setUndoAction(null);
    setUndoDismissing(false);
  }

  // ─── SUB-TASK HANDLERS ────────────────────────────────────────────────

  function toggleSubtaskExpanded(todoId: string) {
    setExpandedSubtasks(prev => {
      const next = new Set(prev);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });
  }

  async function addSubtask(todo: TodoItem) {
    const text = (subtaskInputs[todo.id] || '').trim();
    if (!text) return;
    const currentSubs = todo.sub_tasks || [];
    if (currentSubs.length >= 5) return;

    const newSub: SubTask = { id: 'sub_' + Date.now(), text, is_completed: false };
    const updatedSubs = [...currentSubs, newSub];

    // Optimistic update
    setTodos(prev =>
      prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: updatedSubs } : t))
    );
    setSubtaskInputs(prev => ({ ...prev, [todo.id]: '' }));

    try {
      await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_tasks: updatedSubs }),
      });
    } catch (err) {
      console.error('Add subtask error:', err);
      setTodos(prev =>
        prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: currentSubs } : t))
      );
    }
  }

  async function toggleSubtask(todo: TodoItem, subId: string) {
    const currentSubs = todo.sub_tasks || [];
    const updatedSubs = currentSubs.map(s =>
      s.id === subId ? { ...s, is_completed: !s.is_completed } : s
    );

    setTodos(prev =>
      prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: updatedSubs } : t))
    );

    try {
      await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_tasks: updatedSubs }),
      });
    } catch (err) {
      console.error('Toggle subtask error:', err);
      setTodos(prev =>
        prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: currentSubs } : t))
      );
    }
  }

  async function deleteSubtask(todo: TodoItem, subId: string) {
    const currentSubs = todo.sub_tasks || [];
    const updatedSubs = currentSubs.filter(s => s.id !== subId);

    setTodos(prev =>
      prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: updatedSubs } : t))
    );

    try {
      await apiFetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_tasks: updatedSubs }),
      });
    } catch (err) {
      console.error('Delete subtask error:', err);
      setTodos(prev =>
        prev.map(t => (t.id === todo.id ? { ...t, sub_tasks: currentSubs } : t))
      );
    }
  }

  // ─── VOICE INPUT HANDLER ──────────────────────────────────────────────

  function handleVoiceInput() {
    if (isListening) {
      stopListening();
      return;
    }

    startListening((transcript: string) => {
      const parsed = parseNaturalDateTime(transcript);
      setTaskInput(parsed.cleanText || transcript);
      if (parsed.date) setParsedDueDate(parsed.date);
      if (parsed.time) setParsedDueTime(parsed.time);
      inputRef.current?.focus();
    });
  }

  // ─── COMPUTED VALUES ──────────────────────────────────────────────────

  const filteredTodos = useMemo(() => {
    return todos.filter(todo => {
      if (filter === 'active') return !todo.is_completed;
      if (filter === 'completed') return todo.is_completed;
      return true;
    });
  }, [todos, filter]);

  const completedCount = useMemo(() => todos.filter(t => t.is_completed).length, [todos]);
  const totalCount = todos.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Calendar Helpers
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const startingDayOfWeek = firstDayOfMonth.getDay();
    const totalDays = lastDayOfMonth.getDate();

    const daysArr: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const pDay = prevMonthLastDay - i;
      const pDate = new Date(year, month - 1, pDay);
      daysArr.push({
        dateStr: getLocalDateString(pDate),
        dayNum: pDay,
        isCurrentMonth: false,
      });
    }

    for (let day = 1; day <= totalDays; day++) {
      const cDate = new Date(year, month, day);
      daysArr.push({
        dateStr: getLocalDateString(cDate),
        dayNum: day,
        isCurrentMonth: true,
      });
    }

    const remainingSlots = (42 - daysArr.length) % 7;
    for (let day = 1; day <= remainingSlots; day++) {
      const nDate = new Date(year, month + 1, day);
      daysArr.push({
        dateStr: getLocalDateString(nDate),
        dayNum: day,
        isCurrentMonth: false,
      });
    }

    return daysArr;
  }, [calendarMonth]);

  // ─── LOADING ──────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center min-h-[60vh] bg-slate-50 dark:bg-slate-950 gap-3">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          Loading your task workspace...
        </p>
      </div>
    );
  }

  // ─── UNAUTHENTICATED VIEW ─────────────────────────────────────────────

  if (!user) {
    return (
      <div className="flex-1 w-full flex items-center justify-center p-4 sm:p-8 bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/40">
        <div className="w-full max-w-md mx-auto animate-fadeIn">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white mb-4 shadow-lg shadow-indigo-500/25">
              <ListTodo className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white mb-2">
              Study Task Planner
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Sign in to manage your daily targets, view calendar task history, and sync across devices.
            </p>
          </div>

          {/* Auth Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-slate-200/50 dark:shadow-none">
            {/* Tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-xl p-1 mb-6 border border-slate-200/60 dark:border-slate-700/50">
              <button
                type="button"
                onClick={() => { setAuthMode('login'); setAuthError(null); }}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-md'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode('register'); setAuthError(null); }}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                  authMode === 'register'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-md'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Error Banner */}
            {authError && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-2.5 text-rose-600 dark:text-rose-400 text-xs sm:text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="student@example.com"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  className="w-full px-4 py-3 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  className="w-full px-4 py-3 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  At least 6 characters.
                </p>
              </div>

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full py-3.5 px-4 mt-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {authSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>{authMode === 'login' ? 'Sign In to Workspace' : 'Create Free Account'}</span>
                )}
              </button>
            </form>

            <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-5">
              Secure Cloudflare D1 Backend • No email verification step needed
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── AUTHENTICATED FULL-VIEW MAIN WORKSPACE ───────────────────────────

  const isToday = selectedDate === todayStr;

  return (
    <div className="flex-1 w-full flex flex-col min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 sm:px-6 lg:px-8 py-3 sm:py-6 lg:py-8 animate-fadeIn">
      {/* Workspace Header Bar */}
      <div className="w-full max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20">
            <ListTodo className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                To-Do Workspace
              </h1>
              {isToday && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  Today
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-500 dark:text-slate-400">
              {formatHumanDate(selectedDate)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Prominent History / Calendar Button */}
          <button
            type="button"
            onClick={() => setIsCalendarOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-extrabold text-xs sm:text-sm shadow-lg shadow-indigo-500/25 dark:shadow-indigo-950/50 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
            aria-label="Open History Calendar"
          >
            <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>History / Calendar</span>
            {datesWithTasks.size > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs font-black bg-white/20 rounded-full">
                {datesWithTasks.size}
              </span>
            )}
          </button>

          {/* User Account & Logout */}
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-800">
            <div className="hidden md:flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-xl shadow-xs">
              <User className="w-4 h-4 text-indigo-500" />
              <span className="truncate max-w-[160px]">{user.email}</span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="p-2.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Full-Width & Viewport Workspace Container */}
      <div className="flex-1 w-full max-w-6xl mx-auto bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-3 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none flex flex-col transition-all pb-28">

        {/* Non-Today Date Alert Banner */}
        {!isToday && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2.5">
              <Calendar className="w-5 h-5 text-amber-500 shrink-0" />
              <span>You are viewing tasks for historical date: <strong>{formatHumanDate(selectedDate)}</strong></span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 font-extrabold text-xs text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Today</span>
            </button>
          </div>
        )}

        {/* Error Notification */}
        {pageError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3 text-rose-600 dark:text-rose-400 text-xs sm:text-sm">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <span className="flex-1 font-semibold">{pageError}</span>
            <button type="button" onClick={() => setPageError(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── OVERDUE TASKS PANEL ── */}
        {isToday && overdueTodos.length > 0 && (
          <div className="mb-6 animate-overdue-expand">
            <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-r from-rose-500/5 via-amber-500/5 to-orange-500/5 dark:from-rose-500/10 dark:via-amber-500/5 dark:to-orange-500/5 overflow-hidden">
              {/* Overdue Header */}
              <button
                type="button"
                onClick={() => setOverdueExpanded(!overdueExpanded)}
                className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-rose-500/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-500/15 text-rose-500">
                    <Flame className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-extrabold text-rose-700 dark:text-rose-300">
                      Overdue Tasks
                    </h3>
                    <p className="text-xs text-rose-600/70 dark:text-rose-400/70">
                      {overdueTodos.length} task{overdueTodos.length > 1 ? 's' : ''} past due date
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    {overdueTodos.length}
                  </span>
                  {overdueExpanded ? <ChevronUp className="w-4 h-4 text-rose-400" /> : <ChevronDown className="w-4 h-4 text-rose-400" />}
                </div>
              </button>

              {/* Overdue Tasks List */}
              {overdueExpanded && (
                <div className="px-4 pb-4 space-y-2">
                  {/* Bulk Transfer Button */}
                  <button
                    type="button"
                    onClick={handleBulkTransfer}
                    disabled={bulkTransferring}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs shadow-lg shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-50 mb-3"
                  >
                    {bulkTransferring ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )}
                    <span>Transfer All to Today</span>
                  </button>

                  {overdueTodos.map(todo => (
                    <div
                      key={todo.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-rose-500/10"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {todo.task_text}
                        </p>
                        <p className="text-xs text-rose-500/80 font-medium">
                          Due: {formatShortDate(todo.date)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTransferToToday(todo)}
                        disabled={transferringIds.has(todo.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        {transferringIds.has(todo.id) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5" />
                        )}
                        <span>Today</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats & Progress Section */}
        {totalCount > 0 && (
          <div className="mb-6 bg-slate-50/80 dark:bg-slate-800/40 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                <span>Task Completion Progress</span>
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {completedCount} of {totalCount} Completed ({progressPercent}%)
              </span>
            </div>

            {/* Progress Bar Track */}
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700/60 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Filter Pill Tabs */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 dark:border-slate-700/50">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    filter === 'all'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  All Tasks ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('active')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    filter === 'active'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Pending ({totalCount - completedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('completed')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    filter === 'completed'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Completed ({completedCount})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Task Items List */}
        <div className="flex-1 flex flex-col">
          {todosLoading ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
              <p className="text-sm font-semibold">Loading tasks...</p>
            </div>
          ) : filteredTodos.length === 0 ? (
            <div className="flex-1 py-16 px-4 flex flex-col items-center justify-center text-center bg-slate-50/50 dark:bg-slate-800/20 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3">
                <CheckSquare className="w-7 h-7" />
              </div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 mb-1">
                {filter === 'completed'
                  ? 'No completed tasks yet for this date.'
                  : filter === 'active'
                  ? 'All pending tasks completed! Great work.'
                  : 'No tasks added for this day yet.'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                {filter === 'all' && 'Use the input bar below to add tasks. Try voice input with Hindi or English!'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTodos.map(todo => {
                const isEditing = editingId === todo.id;
                const subs = todo.sub_tasks || [];
                const subCompleted = subs.filter(s => s.is_completed).length;
                const isSubExpanded = expandedSubtasks.has(todo.id);
                const priorityCfg = PRIORITY_CONFIG[todo.priority || 'normal'];

                return (
                  <div
                    key={todo.id}
                    className={`group rounded-2xl border transition-all duration-200 ${
                      todo.is_completed
                        ? 'bg-slate-50/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60 opacity-75'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 dark:hover:border-indigo-400/40 shadow-xs'
                    }`}
                  >
                    {/* Main Task Row */}
                    <div className="flex items-start justify-between gap-3 p-4">
                      {/* Checkbox & Task Text */}
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleComplete(todo)}
                          className="mt-0.5 text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-transform active:scale-95 cursor-pointer shrink-0"
                          aria-label={todo.is_completed ? 'Mark as incomplete' : 'Mark as completed'}
                        >
                          {todo.is_completed ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-500 fill-emerald-500/10" />
                          ) : (
                            <Circle className="w-6 h-6" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              value={editingText}
                              onChange={e => setEditingText(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEditing(todo);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="w-full px-3 py-1.5 text-sm sm:text-base rounded-xl bg-slate-50 dark:bg-slate-800 border border-indigo-500 text-slate-900 dark:text-white focus:outline-none"
                            />
                          ) : (
                            <span
                              onDoubleClick={() => startEditing(todo)}
                              className={`text-sm sm:text-base font-semibold leading-relaxed break-words whitespace-normal cursor-pointer select-none ${
                                todo.is_completed
                                  ? 'line-through text-slate-400 dark:text-slate-500'
                                  : 'text-slate-800 dark:text-slate-100'
                              }`}
                              title="Double-click to edit"
                            >
                              {todo.task_text}
                            </span>
                          )}

                          {/* Meta chips row */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {todo.due_time && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold">
                                <Clock className="w-3 h-3" />
                                {todo.due_time}
                              </span>
                            )}
                            {todo.priority && todo.priority !== 'normal' && priorityCfg && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${priorityCfg.bg} ${priorityCfg.color} text-xs font-bold border ${priorityCfg.border}`}>
                                <Flag className="w-3 h-3" />
                                {priorityCfg.label}
                              </span>
                            )}
                            {subs.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleSubtaskExpanded(todo.id)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-bold cursor-pointer hover:bg-violet-500/20 transition-colors"
                              >
                                <ListPlus className="w-3 h-3" />
                                {subCompleted}/{subs.length}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEditing(todo)}
                              className="p-2 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-xl transition-colors cursor-pointer"
                              title="Save changes"
                            >
                              <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleSubtaskExpanded(todo.id)}
                              className="p-2 text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Sub-tasks"
                              aria-label="Toggle sub-tasks"
                            >
                              <ListPlus className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditing(todo)}
                              className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Edit task"
                              aria-label="Edit task"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTodo(todo.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Delete task"
                              aria-label="Delete task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* ── SUB-TASKS SECTION ── */}
                    {isSubExpanded && (
                      <div className="animate-subtask-expand border-t border-slate-200/60 dark:border-slate-800/60">
                        <div className="px-4 py-3 space-y-2">
                          {/* Sub-task progress bar */}
                          {subs.length > 0 && (
                            <div className="mb-2">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
                                <span>Sub-tasks</span>
                                <span className="text-violet-600 dark:text-violet-400">
                                  {subCompleted}/{subs.length} — {subs.length > 0 ? Math.round((subCompleted / subs.length) * 100) : 0}%
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                                  style={{ width: `${subs.length > 0 ? (subCompleted / subs.length) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Existing sub-tasks */}
                          {subs.map(sub => (
                            <div key={sub.id} className="flex items-center gap-2.5 group/sub">
                              <button
                                type="button"
                                onClick={() => toggleSubtask(todo, sub.id)}
                                className="text-slate-400 hover:text-violet-500 transition-colors cursor-pointer shrink-0"
                              >
                                {sub.is_completed ? (
                                  <CheckCircle2 className="w-4 h-4 text-violet-500 fill-violet-500/10" />
                                ) : (
                                  <Circle className="w-4 h-4" />
                                )}
                              </button>
                              <span className={`flex-1 text-xs sm:text-sm font-medium ${
                                sub.is_completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'
                              }`}>
                                {sub.text}
                              </span>
                              <button
                                type="button"
                                onClick={() => deleteSubtask(todo, sub.id)}
                                className="opacity-0 group-hover/sub:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-all cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          {/* Add sub-task input */}
                          {subs.length < 5 && (
                            <div className="flex items-center gap-2 pt-1">
                              <input
                                type="text"
                                placeholder={`Add sub-task (${5 - subs.length} remaining)...`}
                                value={subtaskInputs[todo.id] || ''}
                                onChange={e => setSubtaskInputs(prev => ({ ...prev, [todo.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') addSubtask(todo); }}
                                className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-violet-500 focus:outline-none transition-all"
                              />
                              <button
                                type="button"
                                onClick={() => addSubtask(todo)}
                                disabled={!(subtaskInputs[todo.id] || '').trim()}
                                className="p-1.5 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors cursor-pointer disabled:opacity-30"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          )}

                          {subs.length >= 5 && (
                            <p className="text-xs text-slate-400 italic pt-1">Maximum 5 sub-tasks reached</p>
                          )}
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

      {/* ── FLOATING BOTTOM INPUT BAR ── */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[96%] sm:w-auto sm:min-w-[480px] sm:max-w-[680px] animate-dock-enter safe-area-bottom">
        <form
          onSubmit={handleAddTodo}
          className="flex items-center gap-2 p-2 sm:p-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-2xl shadow-slate-900/10 dark:shadow-black/30"
        >
          {/* Mic Button */}
          <button
            type="button"
            onClick={handleVoiceInput}
            className={`p-2.5 rounded-xl transition-all cursor-pointer shrink-0 ${
              isListening
                ? 'bg-rose-500 text-white animate-mic-pulse shadow-lg shadow-rose-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
            title={isListening ? 'Stop listening' : 'Voice input (Hindi & English)'}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          >
            {isListening ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>

          {/* Text Input */}
          <input
            ref={inputRef}
            type="text"
            placeholder={isListening ? 'Listening... बोलिए 🎙️' : `Add task for ${isToday ? 'Today' : formatShortDate(selectedDate)}...`}
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-xl bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />

          {/* Quick Chips */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            {/* Priority Chip */}
            <button
              type="button"
              onClick={() => {
                const priorities = ['normal', 'low', 'high', 'urgent'];
                const idx = priorities.indexOf(inputPriority);
                setInputPriority(priorities[(idx + 1) % priorities.length]);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                PRIORITY_CONFIG[inputPriority].bg
              } ${PRIORITY_CONFIG[inputPriority].color} ${PRIORITY_CONFIG[inputPriority].border}`}
              title="Cycle priority"
            >
              <Flag className="w-3.5 h-3.5" />
            </button>

            {/* NLP parsed date chip */}
            {(parsedDueDate || parsedDueTime) && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                {parsedDueDate && <span>{formatShortDate(parsedDueDate)}</span>}
                {parsedDueTime && <span>{parsedDueTime}</span>}
                <button
                  type="button"
                  onClick={() => { setParsedDueDate(null); setParsedDueTime(null); }}
                  className="ml-0.5 cursor-pointer hover:text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Add Button */}
          <button
            type="submit"
            disabled={!taskInput.trim() || addingTask}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md transition-all duration-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
          >
            {addingTask ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Add</span>
              </>
            )}
          </button>
        </form>

        {/* Voice listening indicator */}
        {isListening && (
          <div className="mt-2 text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              Listening... Hindi & English supported
            </span>
          </div>
        )}
      </div>

      {/* ── NOTIFICATION TOAST ── */}
      {notification && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[65] animate-toast-in max-w-[92vw] sm:max-w-md w-max pointer-events-auto">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs sm:text-sm font-semibold shadow-2xl border border-slate-700/60 backdrop-blur-xl">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="leading-snug">{notification}</span>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="ml-2 p-1 text-slate-400 hover:text-white cursor-pointer rounded-md hover:bg-white/10"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── UNDO TOAST ── */}
      {undoAction && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] ${undoDismissing ? 'animate-toast-out' : 'animate-toast-in'}`}>
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-800 dark:bg-slate-700 text-white shadow-2xl shadow-black/20 backdrop-blur-xl">
            <Undo2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-sm font-semibold">
              {undoAction.type === 'transfer' ? 'Task transferred to today' : `${undoAction.items?.length} tasks transferred`}
            </span>
            <button
              type="button"
              onClick={handleUndo}
              className="px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); setUndoAction(null); }}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── HISTORY & CALENDAR MODAL ── */}
      {isCalendarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <CalendarDays className="w-6 h-6 text-indigo-500" />
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Task History Calendar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCalendarOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Month Selector */}
            <div className="flex items-center justify-between mb-5">
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))
                }
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <span className="text-base font-black text-slate-900 dark:text-white">
                {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>

              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))
                }
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Next month"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <span key={day} className="text-xs font-black uppercase tracking-wider text-slate-400">
                  {day}
                </span>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map(({ dateStr, dayNum, isCurrentMonth }) => {
                const isSelected = dateStr === selectedDate;
                const isCurrentToday = dateStr === todayStr;
                const hasSavedTasks = datesWithTasks.has(dateStr);

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => {
                      setSelectedDate(dateStr);
                      setIsCalendarOpen(false);
                    }}
                    className={`relative aspect-square flex flex-col items-center justify-center rounded-2xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                      !isCurrentMonth
                        ? 'opacity-25 text-slate-400'
                        : isSelected
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30'
                        : isCurrentToday
                        ? 'border-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{dayNum}</span>

                    {/* Task Indicator Dot */}
                    {hasSavedTasks && (
                      <span
                        className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-indigo-500'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-2 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                <span>Saved tasks on date</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(todayStr);
                  setCalendarMonth(new Date());
                  setIsCalendarOpen(false);
                }}
                className="font-extrabold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                Jump to Today
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
