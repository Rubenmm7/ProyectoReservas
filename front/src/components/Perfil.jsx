import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';

const Perfil = () => {
  const navigate = useNavigate();
  const { currentUser } = useCurrentUser();
  const profileEmail = currentUser.email ?? currentUser.username ?? 'Usuario';
  const userInitial = (currentUser.username?.[0] ?? currentUser.email?.[0] ?? 'U').toUpperCase();

  const centresText = useMemo(() => {
    if (currentUser?.role === 'admin') return 'Global';
    const centres = Array.isArray(currentUser?.centres) ? currentUser.centres : [];
    return centres.map((centre) => centre.nombre).filter(Boolean).join(', ') || 'Sin centro asignado';
  }, [currentUser]);

  return (
    <div className="min-h-screen bg-[#EEEBE7] flex flex-col items-center justify-center p-3 sm:p-8 animate-fade-in transition-colors duration-300 dark:bg-black">
      <div className="max-w-2xl w-full">
        <div className="glass-card-solid rounded-[28px] shadow-2xl overflow-hidden">
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
            <h1 className="text-[1.7rem] sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight">Mi perfil</h1>
            <button
              onClick={() => navigate('/inicio')}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 transition-colors shrink-0"
            >
              Volver
            </button>
          </div>

          <div className="p-5 sm:p-8 space-y-5 sm:space-y-6">
            <div className="rounded-3xl border border-[#E5007D]/15 bg-slate-950/5 dark:bg-white/5 p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-[#E5007D] dark:bg-white/20 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-pink-500/30 border-2 border-white/40 shrink-0">
                  {userInitial}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">USUARIO</p>
                  <p className="text-[1.05rem] sm:text-xl font-semibold text-slate-800 dark:text-white break-all sm:truncate">
                    {profileEmail}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/90 dark:bg-slate-800 p-4 sm:p-5 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Centro</p>
                <span className="text-sm sm:text-base font-medium text-slate-700 dark:text-slate-200">
                  {centresText}
                </span>
              </div>
            </div>

            {(currentUser.role === 'empleado' || currentUser.role === 'gestor') && (
              <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/90 dark:bg-slate-800 p-4 sm:p-5 shadow-sm">
                <p className="text-sm sm:text-[0.95rem] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Si necesitas cambiar datos del perfil, contacta con un administrador.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Perfil;
