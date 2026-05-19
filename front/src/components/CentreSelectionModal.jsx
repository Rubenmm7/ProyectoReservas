import { apiFetch } from '../utils/http';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { persistSession, getStoredLoginAt } from '../utils/session';
import { normalizeSearchText } from '../utils/reservationsViewHelpers';

const searchIcon = (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
    <path
      d="M21 21l-4.3-4.3m1.8-5.2a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CentreSelectionModal = ({ open, user, refreshCurrentUser }) => {
  const [centres, setCentres] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCentreId, setSelectedCentreId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const searchInputRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusables = panelRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) {
        return;
      }

      const focusableElements = Array.from(focusables);
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const loadCentres = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await apiFetch('/api/dashboard/centres');
        const data = await response.json().catch(() => []);

        if (!response.ok) {
          throw new Error(data.error || 'No se pudieron cargar los centros');
        }

        setCentres(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        setError(fetchError.message || 'No se pudieron cargar los centros');
      } finally {
        setLoading(false);
      }
    };

    loadCentres();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
  }, [open]);

  const filteredCentres = useMemo(() => {
    const query = normalizeSearchText(searchTerm);
    if (!query) return centres;

    return centres.filter((centre) => {
      const values = normalizeSearchText(
        [centre.nombre, centre.localidad, centre.provincia, centre.direccion]
          .filter(Boolean)
          .join(' ')
      );
      return values.includes(query);
    });
  }, [centres, searchTerm]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!selectedCentreId) {
      setError('Selecciona un centro para continuar');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await apiFetch('/api/auth/select-centre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: selectedCentreId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo guardar el centro seleccionado');
      }

      persistSession({
        user: data.user,
        centres: data.user?.centres || [],
        loginAt: getStoredLoginAt() ?? Date.now(),
      });
      window.dispatchEvent(new Event('session-auth-changed'));
      await refreshCurrentUser?.();
      toast.success('Centro seleccionado correctamente');
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el centro seleccionado');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xl" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="centre-selection-title"
        aria-describedby="centre-selection-desc"
        ref={panelRef}
        className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#171321] text-white shadow-2xl"
      >
        <div className="border-b border-white/10 bg-gradient-to-r from-[#1f1830] to-[#15111d] px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-pink-300/80">Centros</p>
          <h2 id="centre-selection-title" className="mt-2 text-2xl font-black">
            Elige tu centro de trabajo
          </h2>
          <p id="centre-selection-desc" className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Es la primera vez que accedes con Microsoft 365. Antes de continuar, selecciona un solo centro para terminar de configurar tu cuenta.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#201b2e] p-5 sm:p-6">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              {searchIcon}
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, provincia, localidad..."
              className="w-full rounded-2xl border border-slate-600/60 bg-[#120f1a] py-3 pl-12 pr-4 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-pink-400/70 focus:ring-2 focus:ring-pink-500/20"
            />
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-3xl border border-slate-700/80 bg-[#202a3a]">
            <div className="grid grid-cols-12 gap-3 border-b border-white/10 px-5 py-4 text-xs font-bold uppercase tracking-wide text-slate-400">
              <div className="col-span-6 sm:col-span-5">Nombre</div>
              <div className="col-span-3 sm:col-span-3">Localidad</div>
              <div className="col-span-3 sm:col-span-3">Provincia</div>
              <div className="col-span-0 sm:col-span-1 text-right">Elegir</div>
            </div>

            <div className="max-h-[52vh] overflow-y-auto">
              {loading ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">Cargando centros...</div>
              ) : filteredCentres.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">
                  No se encontraron centros con esa búsqueda
                </div>
              ) : (
                filteredCentres.map((centre) => {
                  const isSelected = String(selectedCentreId) === String(centre.id);
                  return (
                    <button
                      key={centre.id}
                      type="button"
                      onClick={() => setSelectedCentreId(centre.id)}
                      className={`grid w-full grid-cols-12 gap-3 border-b border-white/5 px-5 py-4 text-left transition-colors last:border-b-0 ${isSelected ? 'bg-pink-500/15' : 'hover:bg-white/5'
                        }`}
                    >
                      <div className="col-span-6 sm:col-span-5">
                        <div className="font-semibold text-white">{centre.nombre}</div>
                      </div>
                      <div className="col-span-3 sm:col-span-3 text-sm text-slate-300">
                        {centre.localidad || '-'}
                      </div>
                      <div className="col-span-3 sm:col-span-3 text-sm text-slate-300">
                        {centre.provincia || '-'}
                      </div>
                      <div className="col-span-12 mt-2 flex items-center justify-between sm:col-span-1 sm:mt-0 sm:justify-end">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${isSelected ? 'bg-pink-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                          {isSelected ? 'Seleccionado' : 'Elegir'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end">
            <button
              type="submit"
              disabled={submitting || !selectedCentreId || loading}
              className="inline-flex min-w-44 items-center justify-center rounded-2xl bg-[#E5007D] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-pink-500/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Guardando...' : `Confirmar centro${user?.username ? ` de ${user.username}` : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CentreSelectionModal;
