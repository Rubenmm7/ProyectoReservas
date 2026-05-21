import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';

const roleLabel = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  empleado: 'Empleado',
  gestor: 'Gestor',
};

const Perfil = () => {
  const navigate = useNavigate();
  const { currentUser } = useCurrentUser();

  const centresText = useMemo(() => {
    if (currentUser?.role === 'admin') return 'Global';
    const centres = Array.isArray(currentUser?.centres) ? currentUser.centres : [];
    return centres.map((centre) => centre.nombre).filter(Boolean).join(', ') || 'Sin centro asignado';
  }, [currentUser]);

  return (
    <div className="min-h-screen bg-[#EEEBE7] flex flex-col items-center justify-center p-4 sm:p-8 animate-fade-in transition-colors duration-300 dark:bg-black">
      <div className="max-w-2xl w-full">
        <div className="glass-card-solid rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-6 sm:px-8 py-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Mi perfil</h1>
            <button
              onClick={() => navigate('/inicio')}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 transition-colors"
            >
              Volver
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[#E5007D] dark:bg-white/20 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-pink-500/30 border-2 border-white/40">
                {(currentUser.username?.[0] ?? 'U').toUpperCase()}
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-800 dark:text-white">{currentUser.username ?? 'Usuario'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Usuario</p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{currentUser.username ?? '-'}</p>
              </div>
              <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Centro</p>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{centresText}</span>
              </div>
            </div>

            {currentUser.role === 'empleado' && (
              <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
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
