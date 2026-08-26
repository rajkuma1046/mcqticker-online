import React, { useState, useEffect, useMemo } from 'react';
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
  Filter,
  CheckSquare
} from 'lucide-react';

interface UserInfo {
  id: string;
  email: string;
}

interface TodoItem {
  id: string;
  user_id: string;
  date: string;
  task_text: string;
  is_completed: boolean;
  created_at: string;
}

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

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Calendar Modal state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [datesWithTasks, setDatesWithTasks] = useState<Set<string>>(new Set());

  // Error alert banner state
  const [pageError, setPageError] = useState<string | null>(null);

  // 1. Check Auth Status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check error:', err);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  // 2. Fetch Todos when user or selectedDate changes
  useEffect(() => {
    if (user) {
      fetchTodos(selectedDate);
      fetchDatesWithTasks();
    }
  }, [user, selectedDate]);

  async function fetchTodos(dateStr: string) {
    setTodosLoading(true);
    setPageError(null);
    try {
      const res = await fetch(`/api/todos?date=${encodeURIComponent(dateStr)}`);
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
      const res = await fetch('/api/todos/dates');
      const data = await res.json();
      if (res.ok && Array.isArray(data.dates)) {
        setDatesWithTasks(new Set(data.dates));
      }
    } catch (err) {
      console.error('Fetch task dates error:', err);
    }
  }

  // Handle Login & Register
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
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed. Please try again.');
      } else if (data.user) {
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

  // Handle Logout
  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setTodos([]);
      setDatesWithTasks(new Set());
    }
  }

  // Handle Add Todo
  async function handleAddTodo(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!taskInput.trim() || addingTask) return;

    const textToAdd = taskInput.trim();
    setTaskInput('');
    setAddingTask(true);

    const tempId = 'temp_' + Date.now();
    const tempTodo: TodoItem = {
      id: tempId,
      user_id: user?.id || '',
      date: selectedDate,
      task_text: textToAdd,
      is_completed: false,
      created_at: new Date().toISOString(),
    };
    setTodos(prev => [...prev, tempTodo]);
    setDatesWithTasks(prev => new Set(prev).add(selectedDate));

    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, task_text: textToAdd }),
      });
      const data = await res.json();
      if (res.ok && data.todo) {
        setTodos(prev => prev.map(item => (item.id === tempId ? data.todo : item)));
      } else {
        setTodos(prev => prev.filter(item => item.id !== tempId));
        setPageError(data.error || 'Failed to add task.');
      }
    } catch (err) {
      console.error('Add todo error:', err);
      setTodos(prev => prev.filter(item => item.id !== tempId));
      setPageError('Failed to add task. Please check your connection.');
    } finally {
      setAddingTask(false);
    }
  }

  // Handle Toggle Completion
  async function handleToggleComplete(todo: TodoItem) {
    const nextCompleted = !todo.is_completed;
    setTodos(prev =>
      prev.map(item => (item.id === todo.id ? { ...item, is_completed: nextCompleted } : item))
    );

    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
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

  // Handle Edit Start
  function startEditing(todo: TodoItem) {
    setEditingId(todo.id);
    setEditingText(todo.task_text);
  }

  // Handle Edit Save
  async function saveEditing(todo: TodoItem) {
    if (!editingText.trim()) return;
    const newText = editingText.trim();
    setEditingId(null);

    if (newText === todo.task_text) return;

    setTodos(prev =>
      prev.map(item => (item.id === todo.id ? { ...item, task_text: newText } : item))
    );

    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
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

  // Handle Delete Todo
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
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setTodos(previousTodos);
      }
    } catch (err) {
      console.error('Delete todo error:', err);
      setTodos(previousTodos);
    }
  }

  // Filtered Todos
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

  // Loading skeleton screen
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

  // ── UNAUTHENTICATED VIEW ──
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

  // ── AUTHENTICATED FULL-VIEW MAIN WORKSPACE ──
  const isToday = selectedDate === todayStr;

  return (
    <div className="flex-1 w-full flex flex-col min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 sm:p-6 lg:p-8 animate-fadeIn">
      {/* Workspace Header Bar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 mb-6">
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
      <div className="flex-1 w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-4 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none flex flex-col transition-all">

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

        {/* Quick Add Task Input Box */}
        <form onSubmit={handleAddTodo} className="mb-6">
          <div className="relative flex items-center shadow-xs">
            <input
              type="text"
              placeholder={`Add a new task for ${isToday ? 'Today' : selectedDate}... (Press Enter to add)`}
              value={taskInput}
              onChange={e => setTaskInput(e.target.value)}
              className="w-full pl-5 pr-28 py-3.5 text-sm sm:text-base rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!taskInput.trim() || addingTask}
              className="absolute right-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md transition-all duration-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              {addingTask ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Add Task</span>
                </>
              )}
            </button>
          </div>
        </form>

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
              <div className="flex items-center gap-2">
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

        {/* Task Items List (Full Width & No Truncation) */}
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
                {filter === 'all' && 'Type your target task in the input box above and press Enter to keep your daily study schedule organized.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTodos.map(todo => {
                const isEditing = editingId === todo.id;

                return (
                  <div
                    key={todo.id}
                    className={`group flex items-start justify-between gap-4 p-4 rounded-2xl border transition-all duration-200 ${
                      todo.is_completed
                        ? 'bg-slate-50/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60 opacity-75'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 dark:hover:border-indigo-400/40 shadow-xs'
                    }`}
                  >
                    {/* Checkbox & Full Wrapped Task Text */}
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
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── HISTORY & CALENDAR MODAL ── */}
      {isCalendarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 overflow-hidden">
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
