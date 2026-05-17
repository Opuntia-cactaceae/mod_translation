import { useEffect, useState, useRef, createContext, useContext, useCallback } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import GamePage from './pages/GamePage';
import TranslationJobs from './pages/TranslationJobs';
import TranslatedFiles from './pages/TranslatedFiles';
import OutputFileEditor from './pages/OutputFileEditor';
import Editor from './pages/Editor';
import { api, ApiError } from './api/client';

/* ------------------------------------------------------------------ */
/*  Toast context                                                      */
/* ------------------------------------------------------------------ */
export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

interface ToastCtx {
  toast: Toast | null;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export const ToastContext = createContext<ToastCtx>({
  toast: null,
  showToast: () => {},
});

export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------------ */
/*  NotFound                                                           */
/* ------------------------------------------------------------------ */
function NotFound() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Page Not Found</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>This page does not exist.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToast({ id, message, type });
    setToastKey(id);
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-title">Stellaris Translator</div>
          <div className="sidebar-nav">
            <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              Dashboard
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              Settings
            </NavLink>
            <div className="sidebar-group-label">Games</div>
            <NavLink to="/games/stellaris" className={({ isActive }) => `sidebar-link sidebar-link-nested ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-sub">Paradox Interactive</span>
              Stellaris
            </NavLink>
            <NavLink to="/games/generic" className={({ isActive }) => `sidebar-link sidebar-link-nested ${isActive ? 'active' : ''}`}>
              Other Game
            </NavLink>
            <NavLink to="/jobs" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              Translation Jobs
            </NavLink>
            <NavLink to="/editor" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              Editor / Trace
            </NavLink>
            <NavLink to="/translated-files" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              Translated Files
            </NavLink>
          </div>
        </nav>
        <main className="main-content">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/games/:gameId" element={<GamePage />} />
              <Route path="/jobs" element={<TranslationJobs />} />
              <Route path="/translated-files" element={<TranslatedFiles />} />
              <Route path="/translated-files/:outputFileId/editor" element={<OutputFileEditor />} />
              <Route path="/editor" element={<Editor />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </main>
        {toast && (
          <div key={toastKey} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export { api, ApiError };
