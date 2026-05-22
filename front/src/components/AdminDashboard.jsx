import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAngleLeft, faAngleRight, faHouse, faCar, faBars, faSquareCheck, faUser, faFile, faHistory, faWrench, faBuilding, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faCalendarDays, faCalendarAlt, faClock } from '@fortawesome/free-regular-svg-icons';
import macrosadLogo from '../assets/isotipo-petalos.svg';
import { Toaster, toast } from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useSocket } from '../hooks/useSocket';
import { useReservationRealtimeNotifications } from '../hooks/useReservationRealtimeNotifications';
import { getStoredDarkMode, persistAndApplyTheme } from '../utils/theme';
import { getDesiredReservationStatusForTime, planReservationTimeBasedUpdates } from '../utils/reservationAutoStatus';
import { formatLocalDateTime, parseMySqlDateTime, toLocalInputDateTime } from '../utils/dateTime';
import { hasValidDeliveryKilometers } from '../utils/delivery';
import { normalizeSearchText } from '../utils/reservationsViewHelpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import CentreSelectionModal from './CentreSelectionModal';

// ── Lazy-loaded views (code splitting) ──
const VehiclesView = lazy(() => import('./VehiclesView'));
const ReservationsView = lazy(() => import('./ReservationsView'));
const UsersView = lazy(() => import('./UsersView'));
const ValidationsView = lazy(() => import('./ValidationsView'));
const AuditLogView = lazy(() => import('./AuditLogView'));
const CentersView = lazy(() => import('./CentersView'));

// ── Spinner de carga para Suspense ──
const ViewLoader = () => (
  <div className="flex-1 flex items-center justify-center min-h-[200px]">
    <div className="w-7 h-7 border-[3px] border-[#E5007D] border-t-transparent rounded-full animate-spin" />
  </div>
);

// ── Helpers ──

const SizedChart = ({ height = 240, className = '', children }) => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth);
  });
  return (
    <div ref={ref} style={{ width: '100%', height }} className={className}>
      {width > 0 && React.cloneElement(children, { width, height })}
    </div>
  );
};

const STATUS_RESERVATION = {
  aprobada: 'bg-green-100 text-black border border-green-200 dark:bg-green-500/20 dark:text-white/90 dark:border-green-500/30',
  activa: 'bg-blue-100 text-black border border-blue-200 dark:bg-blue-500/20 dark:text-white/90 dark:border-blue-500/30',
  finalizada: 'bg-violet-100 text-black border border-violet-200 dark:bg-violet-500/20 dark:text-white/90 dark:border-violet-500/30',
  rechazada: 'bg-red-100 text-black border border-red-200 dark:bg-red-500/20 dark:text-white/90 dark:border-red-500/30',
  pendiente: 'bg-amber-100 text-black border border-amber-200 dark:bg-amber-500/20 dark:text-white/90 dark:border-amber-500/30',
  fecha: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const formatDate = (value) => {
  const formatted = formatLocalDateTime(value);
  return formatted ? formatted.split(',')[0] : '';
};

const getUserCentreText = (user) => {
  if (user?.role === 'admin') return 'Global';
  const centres = Array.isArray(user?.centres) ? user.centres : [];
  const text = centres.map((centre) => centre?.nombre).filter(Boolean).join(', ');
  return text || 'Sin centro asignado';
};

const formatVehicleLabel = (vehicle = {}, includePlate = true) => {
  const brand = String(vehicle?.brand ?? '').trim();
  const model = String(vehicle?.model ?? '').trim();
  const plate = String(vehicle?.license_plate ?? '').trim();
  const name = [brand, model].filter(Boolean).join(' ') || model || brand || 'Vehículo';
  return includePlate && plate ? `${name} (${plate})` : name;
};

const getReservationEffectiveStatusForTime = (reservation, now = new Date()) => {
  return getDesiredReservationStatusForTime(reservation, now) ?? String(reservation?.status ?? '').toLowerCase();
};

const hasDeliveryBeenSubmitted = (reservation, submittedDeliveryIds = []) => {
  if (!reservation) return false;
  // Consideramos entregada si está en el array de entregas validadas O si tiene km_entrega (la entrega se guardó)
  if (Array.isArray(submittedDeliveryIds) && submittedDeliveryIds.some((id) => String(id) === String(reservation.id))) return true;
  if (hasValidDeliveryKilometers(reservation)) return true;
  return false;
};

const shouldKeepReservationVisibleForDelivery = (reservation, submittedDeliveryIds = []) => {
  const status = String(reservation?.status ?? '').toLowerCase();
  if (status !== 'finalizada') return false;

  if (hasDeliveryBeenSubmitted(reservation, submittedDeliveryIds)) return false;
  return true;
};

const getEmployeeVisibleReservations = (allReservations, userId, submittedDeliveryIds = []) => (
  (Array.isArray(allReservations) ? allReservations : []).filter((reservation) => {
    if (String(reservation.user_id) !== String(userId)) return false;

    // Mostrar todas las reservas del empleado (el backend ya filtra las finalizadas a 10 días)
    return true;
  })
);

// ── Vista Inicio ──
const formatDateTime = (value) => formatLocalDateTime(value);

const toMySqlDateTime = (value) => toLocalInputDateTime(value);

const findActiveReservationForUser = (allReservations, userId, submittedDeliveryIds = []) => {
  if (!Array.isArray(allReservations) || !userId) return null;
  const now = new Date();

  const candidates = allReservations
    .filter((reservation) => String(reservation.user_id) === String(userId))
    .map((reservation) => ({
      reservation,
      effectiveStatus: getReservationEffectiveStatusForTime(reservation, now),
    }))
    .filter(({ effectiveStatus }) => ['aprobada', 'activa', 'finalizada'].includes(effectiveStatus))
    .filter(({ reservation }) => !hasDeliveryBeenSubmitted(reservation, submittedDeliveryIds))
    .filter(({ reservation, effectiveStatus }) => {
      const start = parseMySqlDateTime(reservation.start_time);
      const end = parseMySqlDateTime(reservation.end_time);

      // Mostrar el formulario si está ACTIVA (durante el período) O FINALIZADA (para rellenar entrega)
      if (effectiveStatus === 'activa') {
        return start <= now && now <= end;
      }

      if (effectiveStatus === 'finalizada') {
        // Solo mostrar si terminó hace menos de 10 días (evita reservas antiguas sin km_entrega)
        if (!end) return false;
        const diffDays = (now.getTime() - end.getTime()) / (1000 * 3600 * 24);
        return diffDays <= 10;
      }

      return false;
    })
    .sort((a, b) => (parseMySqlDateTime(b.reservation.start_time)?.getTime() ?? 0) - (parseMySqlDateTime(a.reservation.start_time)?.getTime() ?? 0));

  const winner = candidates[0];
  if (!winner) return null;

  return {
    ...winner.reservation,
    status: winner.effectiveStatus,
  };
};

const compressImageForDelivery = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1000;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

const useIsDesktopForCard = () => {
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= 768 && !('ontouchstart' in window)
  );
  useEffect(() => {
    const handle = () => setIsDesktop(window.innerWidth >= 768 && !('ontouchstart' in window));
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);
  return isDesktop;
};

const ActiveReservationCard = ({
  reservation,
  onDeliver,
  isSubmitting = false,
  vehicle: propVehicle,
}) => {
  const [vehicle, setVehicle] = useState(propVehicle || null);
  const [kmInitial, setKmInitial] = useState(0);
  const [kmEntrega, setKmEntrega] = useState('');
  const [informeEntrega, setInformeEntrega] = useState('');
  const [estadoEntrega, setEstadoEntrega] = useState('No');
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [fotoContador, setFotoContador] = useState(null);
  const statusDropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const isDesktop = useIsDesktopForCard();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setIsStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchVehicle = async () => {
      if (reservation?.vehicle_id) {
        try {
          const res = await apiFetch(`/api/dashboard/vehicles`);
          if (res.ok) {
            const vehicles = await res.json();
            const found = vehicles.find(v => String(v.id) === String(reservation.vehicle_id));
            if (found) {
              setVehicle(found);
              setKmInitial(found.kilometers || 0);
            }
          }
        } catch (err) {
          console.error('Error fetching vehicle for card:', err);
        }
      }
    };

    if (!propVehicle) {
      fetchVehicle();
    } else {
      setVehicle(propVehicle);
      setKmInitial(propVehicle.kilometers || 0);
    }

    setKmEntrega('');
    setInformeEntrega('');
    setEstadoEntrega('No');
    setFotoContador(null);
  }, [reservation?.id, propVehicle]);

  if (!reservation) return null;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForDelivery(file);
      setFotoContador(compressed);
    } catch {
      toast.error('Error al procesar la imagen.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const parsedKm = Number.parseInt(kmEntrega, 10);

    if (Number.isNaN(parsedKm)) {
      toast.error('Introduce un kilometraje valido.');
      return;
    }

    if (parsedKm < kmInitial) {
      toast.error(`Los kilómetros no pueden ser inferiores a los iniciales (${kmInitial} km).`);
      return;
    }

    if (!fotoContador) {
      toast.error('La foto del cuentakilómetros es obligatoria.');
      return;
    }

    onDeliver?.({
      reservation,
      kmEntrega: parsedKm,
      estadoEntrega,
      informeEntrega: informeEntrega.trim(),
      fotoContador,
    });
  };

  return (
    <div className="glass-card-solid rounded-2xl shadow-sm p-5 sm:p-8 flex-none">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">
            {'Formulario de entrega del vehículo'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {formatVehicleLabel(reservation)}
          </p>
        </div>
        <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_RESERVATION[reservation.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
          {reservation.status}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 text-xs sm:text-sm">
        <div className="rounded-xl bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-3 text-slate-600 dark:text-slate-300">
          <p className="font-semibold uppercase tracking-wide text-[10px] text-slate-400 dark:text-slate-500">Inicio</p>
          <p className="font-semibold mt-1">{formatDateTime(reservation.start_time)}</p>
        </div>
        <div className="rounded-xl bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-3 text-slate-600 dark:text-slate-300">
          <p className="font-semibold uppercase tracking-wide text-[10px] text-slate-400 dark:text-slate-500">Fin</p>
          <p className="font-semibold mt-1">{formatDateTime(reservation.end_time)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="km-entrega" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Kilómetros actuales
          </label>
          <input
            id="km-entrega"
            type="number"
            min={kmInitial}
            step="1"
            required
            value={kmEntrega}
            onChange={(e) => setKmEntrega(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            placeholder={`Mínimo: ${kmInitial}`}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            ¿Hubo algún inconveniente con su reserva?
          </label>
          <div className="relative" ref={statusDropdownRef}>
            <button
              type="button"
              onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
              className={`w-full px-4 py-2.5 rounded-xl border transition-all flex justify-between items-center outline-none focus:ring-2 focus:ring-primary/20
                ${estadoEntrega
                  ? 'bg-white dark:bg-slate-800 dark:border-slate-600 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100'
                }`}
            >
              <span className="text-sm font-semibold capitalize">
                {estadoEntrega || 'Seleccionar estado...'}
              </span>
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isStatusDropdownOpen && (
              <div className="absolute z-50 mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-1">
                  {['No', 'Si'].map((option) => (
                    <div
                      key={option}
                      onClick={() => {
                        setEstadoEntrega(option);
                        setIsStatusDropdownOpen(false);
                      }}
                      className={`px-4 py-2.5 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-0.5 capitalize
                        ${estadoEntrega === option
                          ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                        }`}
                    >
                      <span>{option}</span>
                      {estadoEntrega === option && (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="informe-entrega" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Anotaciones de entrega
          </label>
          <textarea
            id="informe-entrega"
            rows={4}
            maxLength={255}
            value={informeEntrega}
            onChange={(e) => setInformeEntrega(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none min-h-[110px] whitespace-pre-line break-words overflow-y-auto"
            placeholder="Observaciones de la entrega... (máx. 255 caracteres)"
          />
        </div>

        {/* Foto del cuentakilómetros */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Foto del cuentakilómetros{' '}
            <span className="text-red-500 font-bold">*</span>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleFileChange}
          />

          {fotoContador ? (
            <div className="w-full max-w-sm space-y-2">
              <img
                src={fotoContador}
                alt="Foto del cuentakilómetros"
                className="w-full h-32 rounded-xl object-contain bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 shadow-sm"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-start gap-2 px-4 text-left"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Cambiar foto
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 hover:border-primary hover:text-primary dark:hover:border-primary dark:hover:text-primary transition-colors flex flex-col items-center justify-center gap-2 px-4 text-center"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm font-semibold">Tomar foto del cuentakilómetros</span>
            </button>
          )}

          {isDesktop && (
            <div className="mt-3 flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
              <div className="shrink-0 bg-white dark:bg-white rounded-xl p-1.5 shadow-sm">
                <QRCodeSVG value={window.location.href} size={88} />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ¿En un ordenador?
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Escanea este código QR con tu móvil para abrir el formulario y hacer la foto al cuentakilómetros directamente desde la cámara.
                </p>
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-primary text-white font-semibold hover:brightness-90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-md shadow-primary/30"
        >
          {isSubmitting ? 'Enviando...' : 'Finalizar entrega'}
        </button>
      </form>
    </div>
  );
};

const HomeView = ({
  stats,
  reservations,
  loading,
  user,
  activeReservation,
  onDeliverActiveReservation,
  deliveringActiveReservation,
  onViewReason,
  submittedDeliveryIds = [],
  onTotalVehiclesClick,
  onValidationsClick,
  onWorkshopReportsClick,
  onExpiredDocumentsClick,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [mailTestLoading, setMailTestLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const itemsPerPage = 8;

  useEffect(() => {
    const checkDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const isAdmin = user.role === 'admin' || user.role === 'supervisor';
  let displayedReservations = isAdmin ? reservations : getEmployeeVisibleReservations(reservations, user.id, submittedDeliveryIds);

  // Aplicar búsqueda global, solo para administradores
  if (searchTerm.trim() !== '') {
    const query = normalizeSearchText(searchTerm);
    displayedReservations = displayedReservations.filter(r =>
      normalizeSearchText(r.username).includes(query) ||
      normalizeSearchText(r.model).includes(query) ||
      normalizeSearchText(r.license_plate).includes(query) ||
      r.id.toString().includes(query) ||
      normalizeSearchText(r.status).includes(query)
    );
  }

  // Calculate chart data for admins
  const vehicleUsageData = useMemo(() => {
    if (!isAdmin || !reservations.length) return [];
    const usage = {};
    reservations.forEach(r => {
      const model = r.model || 'Desconocido';
      usage[model] = (usage[model] || 0) + 1;
    });
    return Object.entries(usage)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [reservations, isAdmin]);

  const statusData = useMemo(() => {
    if (!isAdmin || !reservations.length) return [];
    const counts = {};
    reservations.forEach(r => {
      const status = r.status || 'desconocido';
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [reservations, isAdmin]);

  const COLORS = ['#E5007D', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

  // Paginación
  const totalPages = Math.ceil(displayedReservations.length / itemsPerPage);
  const paginatedReservations = displayedReservations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const fillerRowsCount = Math.max(0, itemsPerPage - paginatedReservations.length);

  const handleSendMailTest = async () => {
    if (mailTestLoading) return;

    setMailTestLoading(true);
    try {
      const response = await apiFetch('/api/dashboard/mailing/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo enviar el correo de prueba');
      }

      const recipientText = data.recipient ? ` a ${data.recipient}` : '';
      toast.success(`Correo de prueba preparado${recipientText}`);
    } catch (error) {
      toast.error(error.message || 'No se pudo enviar el correo de prueba');
    } finally {
      setMailTestLoading(false);
    }
  };

  return (
    <div className="animate-fade-in flex flex-col gap-6 flex-1 min-h-0">

      {/* Formulario de entrega para admin/supervisor al inicio */}
      {(user.role === 'admin' || user.role === 'supervisor') && activeReservation && (
        <ActiveReservationCard
          reservation={activeReservation}
          onDeliver={onDeliverActiveReservation}
          isSubmitting={deliveringActiveReservation}
        />
      )}

      {/* Solo mostrar estadísticas si es admin o supervisor */}
      {(user.role === 'admin' || user.role === 'supervisor') && (
        <>
          <div className="select-none grid grid-cols-1 md:grid-cols-4 gap-6 shrink-0">
            <StatCard
              title="Total de vehículos"
              value={stats.totalVehiculos}
              color="secondary"
              icon={<FontAwesomeIcon icon={faCar} />}
              onClick={stats.totalVehiculos > 0 ? onTotalVehiclesClick : undefined}
            />
            <StatCard
              title="Validaciones pendientes"
              value={stats.vehiculosPendientesValidacion}
              color="secondary"
              icon={<FontAwesomeIcon icon={faSquareCheck} />}
              onClick={stats.vehiculosPendientesValidacion > 0 ? onValidationsClick : undefined}
            />
            <StatCard
              title="Partes de taller desactualizados"
              value={stats.partesTallerDesactualizados}
              color={stats.partesTallerDesactualizados > 0 ? "amber-500" : "secondary"}
              icon={<FontAwesomeIcon icon={faWrench} />}
              onClick={stats.partesTallerDesactualizados > 0 ? onWorkshopReportsClick : undefined}
            />
            <StatCard
              title="Documentos expirados"
              value={stats.documentosExpirados}
              color={stats.documentosExpirados > 0 ? "red-500" : "secondary"}
              icon={
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              onClick={stats.documentosExpirados > 0 ? onExpiredDocumentsClick : undefined}
            />
          </div>

          {/* Gráficos y Estadísticas — ocultos si hay formulario de entrega activo */}
          {!activeReservation && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 shrink-0">
            <div className="glass-card-solid rounded-2xl shadow-sm p-6 h-[320px] flex flex-col">
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-4">Vehículos más solicitados</h3>
              <SizedChart height={240} className="-ml-4">
                <BarChart
                  data={vehicleUsageData}
                  layout="vertical"
                  margin={{ top: 0, right: 20, left: 20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={darkMode ? "#334155" : "#cbd5e1"} opacity={darkMode ? 0.6 : 0.4} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fill: darkMode ? '#cbd5e1' : '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip
                    cursor={{ fill: darkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)' }}
                    contentStyle={{ borderRadius: '12px', border: darkMode ? '1px solid #334155' : '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: darkMode ? '#1e293b' : '#ffffff', color: darkMode ? '#f8fafc' : '#0f172a' }}
                    labelStyle={{ color: darkMode ? '#f8fafc' : '#0f172a' }}
                    itemStyle={{ color: darkMode ? '#f8fafc' : '#0f172a' }}
                  />
                  <Bar dataKey="value" name="Reservas" radius={[0, 6, 6, 0]} barSize={24}>
                    {vehicleUsageData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </SizedChart>
            </div>

            <div className="glass-card-solid rounded-2xl shadow-sm p-6 h-[320px] flex flex-col">
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-4">Distribución de estados de reservas</h3>
              <SizedChart height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={95}
                    paddingAngle={5}
                    dataKey="value"
                    nameKey="name"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ borderRadius: '12px', border: darkMode ? '1px solid #334155' : '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: darkMode ? '#1e293b' : '#ffffff', color:'#f8fafc'}}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '13px', paddingTop: '10px', color: darkMode ? '#cbd5e1' : '#475569' }} />
                </PieChart>
              </SizedChart>
            </div>
          </div>}
        </>
      )}

      {(user.role === 'empleado' || user.role === 'gestor') && activeReservation && (
        <ActiveReservationCard
          reservation={activeReservation}
          onDeliver={onDeliverActiveReservation}
          isSubmitting={deliveringActiveReservation}
        />
      )}

      <div className={`glass-card-solid rounded-2xl shadow-sm p-6 flex flex-col transition-all hover:shadow-md ${activeReservation ? 'flex-1 min-h-0' : 'shrink-0 min-h-[280px]'}`}>
        <div className="select-none flex flex-col gap-4 mb-6 shrink-0">
          {/* Primera línea: Título a la izquierda + Contador a la derecha */}
          <div className="flex items-center justify-between">
            <h2 className="select-none text-lg font-bold text-slate-800 dark:text-white">
              {isAdmin ? 'Últimas reservas' : 'Mis reservas'}
            </h2>
            <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap w-fit">
              {displayedReservations.length} Registros
            </span>
          </div>

          {/* Segunda línea: Buscador */}
          <div className="relative flex-1 max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Buscar reservas..."
              aria-label="Buscar reservas"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-center italic text-sm">
            Cargando reservas...
          </div>
        ) : displayedReservations.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-center italic text-sm">
            No hay reservas registradas
          </div>
        ) : (
          <div className={`${activeReservation ? 'flex-1 min-h-0' : 'flex-none h-[32rem]'} flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden`}>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
              <table className="w-full text-sm text-left relative">
                <thead className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                  <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider font-semibold">
                    {isAdmin && <th className="pb-3 px-4 text-center">Usuario</th>}
                    <th className="pb-3 px-4 text-center">Vehículo</th>
                    <th className="pb-3 px-4 text-center">Matrícula</th>
                    <th className="pb-3 px-4 text-center">Inicio</th>
                    <th className="pb-3 px-4 text-center">Fin</th>
                    <th className="pb-3 px-4 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReservations.map((r) => (
                    <tr key={r.id} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                      {isAdmin && (
                        <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                          <span
                            className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                            title={r.username}
                          >
                            {r.username}
                          </span>
                        </td>
                      )}
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                        <span
                          className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                          title={r.model}
                        >
                          {r.model}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">{r.license_plate}</td>

                      <td className="py-3 px-4 text-center">
                        <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_RESERVATION.fecha ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {formatDateTime(r.start_time)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_RESERVATION.fecha ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {formatDateTime(r.end_time)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_RESERVATION[r.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                            {r.status}
                          </span>
                          {r.status === 'rechazada' && r.motivo_rechazo && (
                            <div className="w-full max-w-[180px]">
                              <button
                                type="button"
                                onClick={() => onViewReason({
                                  title: 'Motivo de rechazo',
                                  reason: r.motivo_rechazo
                                })}
                                className="text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1 mx-auto transition-colors"
                                title="Ver motivo de rechazo"
                              >
                                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Ver motivo
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {Array.from({ length: fillerRowsCount }).map((_, index) => (
                    <tr
                      key={`reservation-filler-${index}`}
                      aria-hidden="true"
                      className="select-none pointer-events-none border-b border-transparent bg-transparent text-transparent"
                    >
                      {isAdmin && <td className="px-4 py-3 bg-transparent">&nbsp;</td>}
                      <td className="px-4 py-3 bg-transparent">&nbsp;</td>
                      <td className="px-4 py-3 bg-transparent">&nbsp;</td>
                      <td className="px-4 py-3 bg-transparent">&nbsp;</td>
                      <td className="px-4 py-3 bg-transparent">&nbsp;</td>
                      <td className="px-4 py-3 bg-transparent">&nbsp;</td>
                    </tr>
                  ))}

                </tbody>
              </table>
            </div>

            {/* PAGINACIÓN ESCRITORIO */}
            {totalPages > 1 && (
              <div className="select-none flex items-center justify-between px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 rounded-b-2xl shrink-0">
                <div className="select-none text-xs text-slate-500 dark:text-slate-400">
                  Página <span className="font-semibold text-slate-700 dark:text-slate-200">{currentPage}</span> de {totalPages}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    aria-label="Anterior"
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <FontAwesomeIcon icon={faAngleLeft} className="text-xs" />
                  </button>

                  <div className="flex items-center gap-0.5">
                    {[...Array(totalPages)].map((_, i) => {
                      const page = i + 1;
                      if (totalPages > 5 && Math.abs(page - currentPage) > 1 && page !== 1 && page !== totalPages) {
                        if (page === 2 || page === totalPages - 1) return <span key={page} className="px-1 text-slate-400">...</span>;
                        return null;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`select-none w-7 h-7 rounded-md text-xs font-bold transition-all ${currentPage === page
                            ? 'bg-primary text-white shadow-md shadow-primary/30'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                        >
                          {page}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Siguiente"
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <FontAwesomeIcon icon={faAngleRight} className="text-xs" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Mobile Header ──
const MobileHeader = ({ onMenuClick, logo, userInitial, onThemeToggle, darkMode, onLogoClick, onUserMenuToggle, showMenuButton }) => (
  <header className="select-none h-16 glass-card-solid flex items-center justify-between px-4 shadow-sm flex-shrink-0 z-[60] relative">
    {showMenuButton ? (
      <button onClick={onMenuClick} aria-label="Abrir menú de navegación" className="p-2 text-black/80 dark:text-white">
        <FontAwesomeIcon icon={faBars} className="text-xl" />
      </button>
    ) : (
      <div
        role="button"
        tabIndex={0}
        aria-label="Cambiar tema claro/oscuro"
        onClick={onThemeToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onThemeToggle(); }}
        className="cursor-pointer p-2 text-black/70 dark:text-amber-400 flex-shrink-0 relative group isolate"
      >
        <div className={`transition-all duration-500 transform ${darkMode ? 'rotate-[360deg] scale-100 opacity-100' : 'rotate-0 scale-0 opacity-0'} absolute inset-0 flex items-center justify-center`}>
          {/* Sol Premium */}
          <svg className="w-6 h-6 sun-icon-inner shadow-amber-500/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
            {[...Array(8)].map((_, i) => (
              <line key={i} x1="12" y1="1" x2="12" y2="3" transform={`rotate(${i * 45} 12 12)`} className="text-amber-500" />
            ))}
          </svg>
        </div>
        <div className={`transition-all duration-500 transform ${!darkMode ? 'rotate-0 scale-100 opacity-100' : 'rotate-[-90deg] scale-0 opacity-0'} flex items-center justify-center`}>
          {/* Luna Premium */}
          <svg className="w-6 h-6 moon-icon-inner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="none" opacity="0.85" />
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </div>
      </div>
    )}

    <div
      onClick={onLogoClick}
      className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 justify-center cursor-pointer hover:scale-105 active:scale-95 transition-transform"
    >
      <img src={logo} alt="Macrosad" width="128" height="32" className="h-8 w-auto" />
    </div>
    <div className="flex items-center gap-2">
      {/* Si mostramos el menú, el toggle del tema va a la derecha. Si no en la izquierda */}
      {showMenuButton && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Cambiar tema claro/oscuro"
          onClick={onThemeToggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onThemeToggle(); }}
          className="cursor-pointer p-2 text-black/70 dark:text-amber-400 relative group isolate"
        >
          <div className={`transition-all duration-500 transform ${darkMode ? 'rotate-[360deg] scale-100 opacity-100' : 'rotate-0 scale-0 opacity-0'} absolute inset-0 flex items-center justify-center`}>
            {/* Sol Premium Small */}
            <svg className="w-5 h-5 sun-icon-inner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
              {[...Array(8)].map((_, i) => (
                <line key={i} x1="12" y1="1" x2="12" y2="3" transform={`rotate(${i * 45} 12 12)`} className="text-amber-500" />
              ))}
            </svg>
          </div>
          <div className={`transition-all duration-500 transform ${!darkMode ? 'rotate-0 scale-100 opacity-100' : 'rotate-[-90deg] scale-0 opacity-0'} flex items-center justify-center`}>
            {/* Luna Premium Small */}
            <svg className="w-5 h-5 moon-icon-inner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="none" opacity="0.85" />
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </div>
        </div>
      )}

      <button
        onClick={onUserMenuToggle}
        aria-label="Menú de usuario"
        className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md shadow-primary/40"
      >
        {userInitial}
      </button>
    </div>
  </header>
);

// ── Pagina de inicio de movil ──
const STATUS_DOT = {
  aprobada: 'bg-green-500',
  activa: 'bg-blue-500',
  finalizada: 'bg-violet-500',
  rechazada: 'bg-red-500',
  pendiente: 'bg-amber-500',
};

const MobileHomeView = ({
  reservations,
  loading,
  onCreateRes,
  user,
  onEdit,
  onDelete,
  activeReservation,
  onDeliverActiveReservation,
  deliveringActiveReservation,
  onViewReason,
  submittedDeliveryIds = [],
}) => {
  const isAdmin = user.role === 'admin' || user.role === 'supervisor';
  const [visibleItems, setVisibleItems] = useState(10);
  const scrollObserverRef = useRef(null);
  const [viewMode, setViewMode] = useState('table');
  const [calendarDate, setCalendarDate] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleItems((prev) => prev + 10);
        }
      },
      { threshold: 0.1 }
    );

    if (scrollObserverRef.current) {
      observer.observe(scrollObserverRef.current);
    }

    return () => observer.disconnect();
  }, [reservations]);

  const displayedReservations = isAdmin ? reservations : getEmployeeVisibleReservations(reservations, user.id, submittedDeliveryIds);
  const paginatedReservations = displayedReservations.slice(0, visibleItems);

  // ── Calendar helpers ──
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstWeekday = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  // shift to Mon-first: (0→6, 1→0, 2→1, …)
  const startOffset = (firstWeekday + 6) % 7;
  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAY_LABELS = ['L','M','X','J','V','S','D'];
  const today = new Date(); today.setHours(0,0,0,0);

  const resCoversDay = (r, dayDate) => {
    const start = parseMySqlDateTime(r.start_time) ?? new Date(r.start_time);
    const end   = parseMySqlDateTime(r.end_time)   ?? new Date(r.end_time);
    const dayStart = new Date(dayDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(dayDate); dayEnd.setHours(23, 59, 59, 999);
    return start <= dayEnd && end >= dayStart;
  };

  const dayResMap = useMemo(() => {
    const map = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(calYear, calMonth, d);
      map[d] = displayedReservations.filter(r => resCoversDay(r, date));
    }
    return map;
  }, [displayedReservations, calYear, calMonth, daysInMonth]);

  const selectedDayRes = selectedDay ? (dayResMap[selectedDay] ?? []) : [];

  const prevMonth = () => {
    setCalendarDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; });
    setSelectedDay(null);
  };
  const nextMonth = () => {
    setCalendarDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; });
    setSelectedDay(null);
  };

  // Build grid cells: blanks + days
  const totalCells = startOffset + daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  const mobileCalCells = (() => {
    const cells = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push(new Date(calYear, calMonth, -(startOffset - i - 1)));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(calYear, calMonth, d));
    }
    while (cells.length % 7 !== 0) {
      cells.push(new Date(calYear, calMonth + 1, cells.length - startOffset - daysInMonth + 1));
    }
    return cells;
  })();
  const mobileCalendarWeekRows = Array.from({ length: Math.ceil(mobileCalCells.length / 7) }, (_, w) => mobileCalCells.slice(w * 7, w * 7 + 7)).map((weekDays) => {
    const weekStart = new Date(weekDays[0]);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekDays[6]);
    weekEnd.setHours(23, 59, 59, 999);

    const events = displayedReservations
      .map((r) => {
        const startDate = parseMySqlDateTime(r.start_time) ?? new Date(r.start_time);
        const endDate = parseMySqlDateTime(r.end_time) ?? new Date(r.end_time);
        if (startDate > weekEnd || endDate < weekStart) {
          return null;
        }

        const adjStart = startDate <= weekStart
          ? 0
          : weekDays.findIndex((d) =>
              d.getFullYear() === startDate.getFullYear() &&
              d.getMonth() === startDate.getMonth() &&
              d.getDate() === startDate.getDate()
            );
        const adjEnd = weekDays.reduce((acc, d, i) => {
          const dayStart = new Date(d);
          dayStart.setHours(0, 0, 0, 0);
          return endDate >= dayStart ? i : acc;
        }, 0);

        return {
          ...r,
          startCol: Math.max(0, adjStart),
          endCol: Math.min(6, adjEnd),
          isMultiDay: !(
            startDate.getFullYear() === endDate.getFullYear() &&
            startDate.getMonth() === endDate.getMonth() &&
            startDate.getDate() === endDate.getDate()
          ),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aStart = parseMySqlDateTime(a.start_time) ?? new Date(a.start_time);
        const bStart = parseMySqlDateTime(b.start_time) ?? new Date(b.start_time);
        return aStart - bStart;
      });

    const lanes = [];
    events.forEach((ev) => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        const overlaps = lanes[i].some((le) => !(ev.endCol < le.startCol || ev.startCol > le.endCol));
        if (!overlaps) {
          lanes[i].push(ev);
          ev._lane = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev._lane = lanes.length;
        lanes.push([ev]);
      }
    });

    return { weekDays, events, laneCount: lanes.length, weekStart, weekEnd };
  });

  return (
    <div className="animate-fade-in flex flex-col gap-4 h-full">
      {!isAdmin && (
        <button
          onClick={onCreateRes}
          className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/30 active:scale-95 transition-all text-center flex items-center justify-center gap-2"
        >
          <span className="text-xl leading-none">+</span>
          Crear reserva
        </button>
      )}

      {(user.role === 'admin' || user.role === 'empleado' || user.role === 'gestor' || user.role === 'supervisor') && activeReservation && (
        <ActiveReservationCard
          reservation={activeReservation}
          onDeliver={onDeliverActiveReservation}
          isSubmitting={deliveringActiveReservation}
        />
      )}

      <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="select-none text-lg font-bold text-slate-800 dark:text-white">
            {isAdmin ? 'Últimas reservas' : 'Mis reservas'}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
              {displayedReservations.length} registros
            </span>
            <div className="flex items-center bg-slate-100 dark:bg-slate-700/60 rounded-xl p-1 gap-0.5">
              <button
                onClick={() => setViewMode('table')}
                title="Vista lista"
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-slate-400'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                title="Vista calendario"
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-slate-400'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-slate-400 text-center py-10 italic">Cargando...</div>
        ) : viewMode === 'calendar' ? (
          <div>
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200 capitalize">
                {MONTH_NAMES[calMonth]} {calYear}
              </span>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>

            {/* Day labels */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_LABELS.map(l => (
                <div key={l} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-1">{l}</div>
              ))}
            </div>

            {user.role === 'empleado' ? (
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-200 dark:bg-slate-700">
                {mobileCalendarWeekRows.map(({ weekDays, events, laneCount, weekStart, weekEnd }, wi) => (
                  <div
                    key={wi}
                    className="relative grid grid-cols-7 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                    style={{ minHeight: `${Math.max(58, 42 + laneCount * 14)}px` }}
                  >
                    {weekDays.map((cellDate, di) => {
                      const isValid = cellDate.getMonth() === calMonth;
                      const isTodayCell = isValid && cellDate.getTime() === today.getTime();
                      const isSelected = isValid && cellDate.getDate() === selectedDay;
                      const dayRes = isValid ? (dayResMap[cellDate.getDate()] ?? []) : [];
                      const singleDayRes = dayRes.filter((r) => {
                        const start = parseMySqlDateTime(r.start_time) ?? new Date(r.start_time);
                        const end = parseMySqlDateTime(r.end_time) ?? new Date(r.end_time);
                        return start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
                      });

                      return (
                        <button
                          key={`${wi}-${di}`}
                          disabled={!isValid}
                          onClick={() => isValid && setSelectedDay(cellDate.getDate() === selectedDay ? null : cellDate.getDate())}
                          className={`relative z-10 flex flex-col items-center pt-1.5 pb-1 min-h-[58px] transition-colors border-r border-slate-200 dark:border-slate-700 last:border-r-0
                            ${!isValid ? 'bg-slate-50 dark:bg-slate-900/40 cursor-default opacity-30' :
                              isSelected ? 'bg-primary/10 dark:bg-primary/20' :
                              'bg-white dark:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-700/60 cursor-pointer'}`}
                        >
                          <span className={`text-xs font-semibold leading-none mb-1 w-6 h-6 flex items-center justify-center rounded-full
                            ${isTodayCell ? 'bg-primary text-white' :
                              isSelected ? 'text-primary font-bold' :
                              'text-slate-700 dark:text-slate-200'}`}>
                            {cellDate.getDate()}
                          </span>
                          {singleDayRes.length > 0 && (
                            <div className="flex flex-wrap justify-center gap-[2px] max-w-full px-0.5">
                              {singleDayRes.slice(0, 3).map((r, i) => (
                                <span key={i} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[r.status] ?? 'bg-slate-400'}`} />
                              ))}
                              {singleDayRes.length > 3 && <span className="text-[8px] text-slate-400 leading-none">+{singleDayRes.length - 3}</span>}
                            </div>
                          )}
                        </button>
                      );
                    })}

                    <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: '31px' }}>
                      {events.filter((ev) => ev.isMultiDay).map((ev) => {
                        const colW = 100 / 7;
                        const left = ev.startCol * colW;
                        const width = (ev.endCol - ev.startCol + 1) * colW;
                        const top = ev._lane * 12;
                        const barColor = ({
                          pendiente: '#f59e0b',
                          aprobada: '#22c55e',
                          activa: '#3b82f6',
                          finalizada: '#8b5cf6',
                          rechazada: '#ef4444',
                        }[ev.status] ?? '#94a3b8');
                        const isStartVisible = ev.startCol > 0 || ev._start >= weekStart;
                        const isEndVisible = ev.endCol < 6 || ev._end <= weekEnd;

                        return (
                          <div
                            key={`${ev.id}-${wi}`}
                            className="absolute shadow-sm"
                            style={{
                              left: `calc(${left}% + 2px)`,
                              width: `calc(${width}% - 4px)`,
                              top: `${top}px`,
                              height: '8px',
                              backgroundColor: barColor,
                              borderRadius: `${isStartVisible ? '999px' : '0'} ${isEndVisible ? '999px' : '0'} ${isEndVisible ? '999px' : '0'} ${isStartVisible ? '999px' : '0'}`,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Day grid */
              <div className="grid grid-cols-7 gap-px bg-slate-200 dark:bg-slate-700 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                {Array.from({ length: rows * 7 }).map((_, idx) => {
                  const day = idx - startOffset + 1;
                  const isValid = day >= 1 && day <= daysInMonth;
                  const dayDate = isValid ? new Date(calYear, calMonth, day) : null;
                  const isToday = isValid && dayDate.getTime() === today.getTime();
                  const isSelected = isValid && day === selectedDay;
                  const dayRes = isValid ? (dayResMap[day] ?? []) : [];
                  const hasRes = dayRes.length > 0;

                  return (
                    <button
                      key={idx}
                      disabled={!isValid}
                      onClick={() => isValid && setSelectedDay(day === selectedDay ? null : day)}
                      className={`relative flex flex-col items-center pt-1.5 pb-1 min-h-[44px] transition-colors
                        ${!isValid ? 'bg-slate-50 dark:bg-slate-900/40 cursor-default' :
                          isSelected ? 'bg-primary/10 dark:bg-primary/20' :
                          'bg-white dark:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-700/60 cursor-pointer'}
                      `}
                    >
                      {isValid && (
                        <>
                          <span className={`text-xs font-semibold leading-none mb-1 w-6 h-6 flex items-center justify-center rounded-full
                            ${isToday ? 'bg-primary text-white' :
                              isSelected ? 'text-primary font-bold' :
                              'text-slate-700 dark:text-slate-200'}`}>
                            {day}
                          </span>
                          {hasRes && (
                            <div className="flex flex-wrap justify-center gap-[2px] max-w-full px-0.5">
                              {dayRes.slice(0, 3).map((r, i) => (
                                <span key={i} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[r.status] ?? 'bg-slate-400'}`} />
                              ))}
                              {dayRes.length > 3 && <span className="text-[8px] text-slate-400 leading-none">+{dayRes.length - 3}</span>}
                            </div>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected day detail */}
            {selectedDay && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {selectedDay} {MONTH_NAMES[calMonth]} — {selectedDayRes.length} reserva{selectedDayRes.length !== 1 ? 's' : ''}
                </p>
                {selectedDayRes.length === 0 ? (
                  <p className="text-slate-400 text-sm italic text-center py-4">Sin reservas este día</p>
                ) : selectedDayRes.map(r => (
                  <div key={r.id} className="bg-white dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700/50">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{[r.brand, r.model].filter(Boolean).join(' ')}</p>
                        {isAdmin && <p className="text-primary text-[10px] font-medium truncate">{r.username}</p>}
                        <p className="text-[10px] font-mono text-slate-400">{r.license_plate}</p>
                      </div>
                      <span className={`chip-uniform px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${STATUS_RESERVATION[r.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700'}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="flex gap-4 text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                      <span><span className="font-bold text-slate-400">Inicio </span>{formatDateTime(r.start_time)}</span>
                      <span><span className="font-bold text-slate-400">Fin </span>{formatDateTime(r.end_time)}</span>
                    </div>
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                      <button onClick={() => onEdit(r)} className="px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-lg text-[11px] font-bold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        Editar
                      </button>
                      <button onClick={() => onDelete(r.id)} className="p-1.5 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-lg">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : displayedReservations.length === 0 ? (
          <div className="text-slate-400 text-center py-10 italic">No hay ninguna reserva</div>
        ) : (
          <div className="space-y-4">
            {paginatedReservations.map((r) => {
              const vehicleName = [r.brand, r.marca, r.model].filter(Boolean).join(' ') || r.model || r.brand || r.marca || 'Vehículo';
              const vehiclePlate = String(r.license_plate ?? '').trim();

              return (
                <div
                  key={r.id}
                  className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50 shadow-[0_2px_8px_rgba(0,0,0,0.07)] dark:shadow-none hover:border-primary/50 dark:hover:border-primary/50 transition-all group">
                  <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight whitespace-normal break-words">
                        {vehicleName}
                      </h3>
                      {vehiclePlate && (
                        <p className="text-xs font-mono text-slate-400 mt-1 whitespace-normal break-words">
                          ({vehiclePlate})
                        </p>
                      )}
                      {isAdmin && (
                        <p className="text-primary font-medium text-xs mt-1 truncate">Usuario: {r.username}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`chip-uniform px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${STATUS_RESERVATION[r.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700'}`}>
                        {r.status}
                      </span>
                      {r.status === 'rechazada' && r.motivo_rechazo && (
                        <button
                          type="button"
                          onClick={() => onViewReason({
                            title: 'Motivo de rechazo',
                            reason: r.motivo_rechazo
                          })}
                          className="text-[10px] font-semibold text-red-500 dark:text-red-400 flex items-center gap-1 transition-all active:scale-95"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          Ver motivo
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 mb-5">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                      <FontAwesomeIcon icon={faCalendarAlt} className="w-3.5 h-3.5 text-primary" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Inicio</span>
                        <span className="text-xs font-semibold">{formatDateTime(r.start_time)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                      <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5 text-amber-500" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Fin</span>
                        <span className="text-xs font-semibold">{formatDateTime(r.end_time)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end pt-4 border-t border-slate-200 dark:border-slate-700/50 gap-2">
                    <button
                      onClick={() => onEdit(r)}
                      className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 transition-colors text-xs font-bold flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      Editar
                    </button>
                    <button
                      onClick={() => onDelete(r.id)}
                      aria-label="Eliminar reserva"
                      className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
            {visibleItems < displayedReservations.length && (
              <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Cards de estadísticas ──
const STAT_COLORS = {
  'secondary': {
    text: 'text-secondary dark:text-slate-300',
    bg: 'bg-secondary/10 dark:bg-slate-300/10'
  },
  'green-500': { text: 'text-green-500', bg: 'bg-green-500/10' },
  'amber-500': { text: 'text-amber-500', bg: 'bg-amber-500/10' },
  'red-500': { text: 'text-red-500', bg: 'bg-red-500/10' },
};

const StatCard = ({ title, value, color, icon, onClick }) => {
  const { text, bg } = STAT_COLORS[color] ?? { text: 'text-slate-500', bg: 'bg-slate-500/10' };
  const isInteractive = typeof onClick === 'function';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={!isInteractive}
      className={`glass-card-solid p-6 rounded-2xl shadow-sm flex items-center justify-between 
             transition-all duration-300 select-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 group text-left
             hover:-translate-y-1 hover:shadow-md hover:border-[#E5007D]/20 cursor-pointer`}
    >
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">{title}</p>
        <h3 className="text-3xl font-bold text-slate-800 dark:text-white mt-1">{value}</h3>
      </div>
      <div className={`${text} ${bg} w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all duration-300 group-hover:scale-110 shadow-inner`}>
        {icon}
      </div>
    </button>
  );
};

// ── Títulos de página ──
const PAGE_TITLES = {
  inicio: 'Dashboard',
  vehiculos: 'Vehículos',
  reservas: 'Reservas',
  usuarios: 'Usuarios',
  centros: 'Gestión de Centros',
  validaciones: 'Validaciones',
  auditoria: 'Auditoría',
};

// ── AdminDashboard ──
const AdminDashboard = ({ initialPage = 'inicio' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile(768);
  const { currentUser, refreshCurrentUser } = useCurrentUser();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const { socket, isConnected } = useSocket();

  // Sincronizar el estado del sidebar al cambiar entre móvil/desktop.
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Determinar la página permitida a partir de la URL o de una preferencia
  const getInitialPage = (role, preferredPage = null) => {
    const saved = localStorage.getItem('activeDashboardPage');
    const allowed = {
      admin: ['inicio', 'vehiculos', 'reservas', 'usuarios', 'validaciones', 'auditoria', 'centros'],
      supervisor: ['inicio', 'vehiculos', 'reservas', 'validaciones', 'centros'],
      empleado: ['inicio'],
      gestor: ['inicio', 'vehiculos']
    };

    if (preferredPage && allowed[role]?.includes(preferredPage)) return preferredPage;

    if (saved) {
      if (allowed[role]?.includes(saved)) return saved;
    }
    return 'inicio';
  };

  const getPageFromPath = (pathname, role, preferredPage = null) => {
    const pathToPage = {
      '/inicio': 'inicio',
      '/vehiculos': 'vehiculos',
      '/reservas': 'reservas',
      '/usuarios': 'usuarios',
      '/centros': 'centros',
      '/validaciones': 'validaciones',
      '/auditoria': 'auditoria',
    };

    const pageFromPath = pathToPage[pathname];
    if (pageFromPath) return getInitialPage(role, pageFromPath);
    return getInitialPage(role, preferredPage);
  };

  const activePage = getPageFromPath(location.pathname, currentUser.role, initialPage);

  const [darkMode, setDarkMode] = useState(getStoredDarkMode());
  const [stats, setStats] = useState({ totalVehiculos: 0, reservasActivas: 0, vehiculosPendientesValidacion: 0, documentosExpirados: 0, partesTallerDesactualizados: 0 });
  const [reservations, setReservations] = useState([]);
  const [deliveryValidationReservationIds, setDeliveryValidationReservationIds] = useState([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [deliveringActiveReservation, setDeliveringActiveReservation] = useState(false);
  const [reservationsViewKey, setReservationsViewKey] = useState(0);
  const [viewingReason, setViewingReason] = useState(null);
  const userMenuRef = useRef(null);
  const activePageRef = useRef(activePage);
  const isGatedRef = useRef(false);

  // Para triggers de móvil
  const [triggerAddReservation, setTriggerAddReservation] = useState(false);
  const [triggerEditReservation, setTriggerEditReservation] = useState(null);
  const [triggerDeleteReservationId, setTriggerDeleteReservationId] = useState(null);
  const userCentreText = useMemo(() => getUserCentreText(currentUser), [currentUser]);
  const requiresCentreSelection = Boolean(currentUser?.requires_centre_selection && currentUser.role !== 'admin');
  const vehicleViewState = location.state?.vehicleView ?? null;
  const pagePaths = {
    inicio: '/inicio',
    vehiculos: '/vehiculos',
    reservas: '/reservas',
    usuarios: '/usuarios',
    centros: '/centros',
    validaciones: '/validaciones',
    auditoria: '/auditoria',
  };

  const goToPage = (page, options = {}) => {
    const allowedPage = getInitialPage(currentUser.role, page);
    const targetPath = pagePaths[allowedPage] ?? '/inicio';
    navigate(targetPath, options);
  };

  useEffect(() => {
    if (!vehicleViewState) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [vehicleViewState, location.pathname, navigate]);

  useEffect(() => {
    persistAndApplyTheme(darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Guardar página activa en localStorage
  useEffect(() => {
    localStorage.setItem('activeDashboardPage', activePage);
  }, [activePage]);

  // Bloquear scroll al abrir modal
  useEffect(() => {
    if (showLogoutModal || triggerDeleteReservationId) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showLogoutModal, triggerDeleteReservationId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mantener ref de activePage sincronizado (pero no causa remount del listener)
  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  const updateReservationStatus = async (reservation, status) => {
    if (!reservation?.id) return false;

    const response = await apiFetch(`/api/dashboard/reservations/${reservation.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status,
        // No enviamos el resto de campos para evitar conflictos de validación
        // El backend usará los valores originales si no se proporcionan
      })
    });

    return response.ok;
  };

  const syncTimeBasedReservationStatuses = async (reservationsList) => {
    const updates = planReservationTimeBasedUpdates(reservationsList, new Date());
    if (updates.length === 0) return reservationsList;

    const next = Array.isArray(reservationsList) ? [...reservationsList] : [];
    let changed = false;

    for (const u of updates) {
      const ok = await updateReservationStatus(u.reservation, u.newStatus);
      if (!ok) continue;

      const idx = next.findIndex((r) => String(r.id) === String(u.reservation.id));
      if (idx === -1) continue;

      next[idx] = { ...next[idx], status: u.newStatus };
      changed = true;
    }

    return changed ? next : reservationsList;
  };

  const fetchDashboardData = async () => {
    setLoadingReservations(true);

    try {
      // Estadísticas solo para admin/supervisor
      if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
        const statsRes = await apiFetch('/api/dashboard/stats');
        if (statsRes.ok) {
          const newStats = await statsRes.json();
          setStats(prev => ({ ...prev, ...newStats }));
        } else if (statsRes.status !== 401) {
          console.error('Error fetching stats:', statsRes.status);
        }
      }

      // Reservas entra cualquier usuario, pero filtramos por rol
      const resRes = await apiFetch('/api/dashboard/reservations');
      if (resRes.ok) {
        let data = await resRes.json();

        if (Array.isArray(data)) {
          // El backend ya sincroniza los estados (syncReservationStatusesByTime)
          // por lo que no es necesario hacerlo de nuevo en el cliente.

          if (currentUser.role === 'empleado' || currentUser.role === 'gestor' || currentUser.role === 'supervisor') {
            const now = new Date();
            data = data.filter(r => {
              const endDate = parseMySqlDateTime(r.end_time);
              const diffTime = now.getTime() - endDate.getTime();
              const diffDays = diffTime / (1000 * 3600 * 24);
              return diffDays <= 10;
            });
          }
          setReservations(data);
        } else {
          setReservations([]);
        }
      } else {
        if (resRes.status !== 401) console.error('Error fetching reservations:', resRes.status);
        setReservations([]);
      }

      const validationsRes = await apiFetch('/api/dashboard/validations');
      if (validationsRes.ok) {
        const validations = await validationsRes.json();

        if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
          const pendingValidations = Array.isArray(validations)
            ? validations.filter(v => v.status !== 'revisada' && hasValidDeliveryKilometers(v))
            : [];
          setStats(prev => ({
            ...prev,
            vehiculosPendientesValidacion: pendingValidations.length
          }));
        }

        const ids = Array.isArray(validations)
          ? validations
            .filter((validation) => hasValidDeliveryKilometers(validation))
            .map((validation) => validation?.reservation_id)
            .filter((id) => id !== undefined && id !== null)
            .map(String)
          : [];
        setDeliveryValidationReservationIds([...new Set(ids)]);
      } else {
        if (validationsRes.status !== 401) console.error('Error fetching validations:', validationsRes.status);
        setDeliveryValidationReservationIds([]);
      }
    } catch (e) {
      console.error('Error cargando dashboard:', e);
      setReservations([]);
      setDeliveryValidationReservationIds([]);
    } finally {
      setLoadingReservations(false);
    }
  };

  // Función para recargar solo las reservas
  const reloadReservations = async () => {
    try {
      const resRes = await apiFetch('/api/dashboard/reservations');
      if (resRes.ok) {
        let data = await resRes.json();
        if (Array.isArray(data)) {
          // Sincronización ya manejada por el backend

          if (currentUser.role === 'empleado' || currentUser.role === 'gestor' || currentUser.role === 'supervisor') {
            const now = new Date();
            data = data.filter(r => {
              const endDate = parseMySqlDateTime(r.end_time);
              const diffTime = now.getTime() - endDate.getTime();
              const diffDays = diffTime / (1000 * 3600 * 24);
              return diffDays <= 10;
            });
          }
          setReservations(data);
        }
      }
    } catch (e) {
      console.error('Error recargando reservas:', e);
    }
  };

  // Función para recargar solo los usuarios
  const reloadUsers = () => {
    // TriggerReload para UsersView - actualiza la tabla de usuarios
    // Se implementa en el componente UsersView
    setReservationsViewKey(prev => prev + 1);
  };

  // Cargar datos al montar, al cambiar de página o cuando cambia el usuario/centros
  useEffect(() => {
    fetchDashboardData();

    const intervalId = setInterval(() => {
      if (!isGatedRef.current) fetchDashboardData();
    }, 30000);

    return () => clearInterval(intervalId);
  }, [
    activePage,
    currentUser?.id,
    currentUser?.role,
    JSON.stringify(currentUser?.centre_ids ?? [])
  ]);

  useReservationRealtimeNotifications({
    socket,
    isConnected,
    currentUser,
    enabled: !requiresCentreSelection && (currentUser.role === 'admin' || currentUser.role === 'supervisor'),
    onNewReservation: (newReservation, meta) => {
      if (!meta.isInUserCentres) return;

      setReservations((prev) => [newReservation, ...prev]);

      if (meta.isSupervisor) {
        const toastLabel = meta.isOwnReservation
          ? 'Reserva creada'
          : `Nueva reserva de ${newReservation.username} - ${newReservation.license_plate}`;
        toast.success(toastLabel, { duration: 5000 });
      }
    },
    onUpdatedReservation: (updatedReservation, meta) => {
      if (!meta.isInUserCentres) return;

      setReservations((prev) =>
        prev.map((r) => (r.id === updatedReservation.id ? updatedReservation : r))
      );

      if (String(updatedReservation?.status ?? '').toLowerCase() === 'finalizada') {
        return;
      }

      if (meta.isSupervisor) {
        const toastLabel = meta.isOwnReservation
          ? 'Reserva actualizada'
          : `Reserva actualizada: ${updatedReservation.model} - ${updatedReservation.license_plate}`;
        toast.success(toastLabel, { duration: 5000 });
      }
    },
    onDeletedReservation: (data, meta) => {
      if (!meta.isAdmin && !meta.isSupervisor) return;

      setReservations((prev) => prev.filter((r) => r.id !== data.id));
      reloadReservations();

      if (meta.isSupervisor) {
        toast.success('Reserva eliminada', { duration: 5000 });
      }
    },
  });

  useEffect(() => {
    if (!socket || !isConnected || currentUser.role !== 'admin') {
      return;
    }

    const handleNewUser = (newUser) => {
      const canSee = currentUser.role === 'admin' ||
        (newUser.centre_ids ?? []).some((id) =>
          (currentUser.centre_ids ?? []).map(String).includes(String(id))
        );

      if (canSee) {
        toast.success(`Nuevo usuario: ${newUser.username} (${newUser.role})`, { duration: 5000 });
      }
      if (canSee && activePageRef.current === 'usuarios') {
        reloadUsers();
      }
    };

    const handleUpdatedUser = (updatedUser) => {
      const canSee = currentUser.role === 'admin' ||
        (updatedUser.centre_ids ?? []).some((id) =>
          (currentUser.centre_ids ?? []).map(String).includes(String(id))
        );

      if (canSee && updatedUser.changedFields.includes('role')) {
        toast.success(`Rol de ${updatedUser.username} cambió a ${updatedUser.role}`, { duration: 5000 });
      }
      if (canSee && activePageRef.current === 'usuarios') {
        reloadUsers();
      }
    };

    const handleDeletedUser = () => {
      toast.success('Usuario eliminado', { duration: 5000 });
      if (activePageRef.current === 'usuarios') {
        reloadUsers();
      }
    };

    socket.on('new_user', handleNewUser);
    socket.on('updated_user', handleUpdatedUser);
    socket.on('deleted_user', handleDeletedUser);

    return () => {
      socket.off('new_user', handleNewUser);
      socket.off('updated_user', handleUpdatedUser);
      socket.off('deleted_user', handleDeletedUser);
    };
  }, [socket, isConnected, currentUser.role, currentUser.id]);

  // Filtramos el menú según el array 'roles' de cada item y ocultamos 'reservas' para empleados/gestores en móvil
  const menuItems = [
    { key: 'inicio', name: 'Inicio', icon: <FontAwesomeIcon icon={faHouse} />, roles: ['admin', 'supervisor', 'empleado', 'gestor'] },
    { key: 'vehiculos', name: 'Vehículos', icon: <FontAwesomeIcon icon={faCar} />, roles: ['admin', 'supervisor', 'gestor'] },
    { key: 'reservas', name: 'Reservas', icon: <FontAwesomeIcon icon={faCalendarDays} />, roles: ['admin', 'supervisor', 'empleado', 'gestor'] },
    { key: 'usuarios', name: 'Usuarios', icon: <FontAwesomeIcon icon={faUser} />, roles: ['admin'] },
    { key: 'centros', name: 'Centros', icon: <FontAwesomeIcon icon={faBuilding} />, roles: ['admin', 'supervisor'] },
    { key: 'validaciones', name: 'Validaciones', icon: <FontAwesomeIcon icon={faSquareCheck} />, roles: ['admin', 'supervisor'] },
    { key: 'auditoria', name: 'Auditoría', icon: <FontAwesomeIcon icon={faHistory} />, roles: ['admin'] },

  ].filter(item => {
    const isRoleAllowed = item.roles.includes(currentUser.role);
    if (!isRoleAllowed) return false;

    // Si el rol es empleado o gestor, ocultamos la pestaña de reservas, ya que su Inicio será las reservas
    if ((currentUser.role === 'empleado' || currentUser.role === 'gestor') && item.key === 'reservas') {
      return false;
    }

    return true;
  });

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const toggleTheme = () => setDarkMode(prev => !prev);
  const openProfilePage = () => {
    setIsUserMenuOpen(false);
    navigate('/mi-perfil');
  };
  const openLogoutModalFromMenu = () => {
    setIsUserMenuOpen(false);
    handleLogout();
  };

  const submittedDeliveryReservationIds = Array.from(new Set([
    ...deliveryValidationReservationIds,
  ]));

  const confirmLogout = () => {
    apiFetch('/api/auth/logout', { method: 'POST' })
      .catch(() => null)
      .finally(() => {
        sessionStorage.clear();
        localStorage.removeItem('user');
        localStorage.removeItem('centres');
        localStorage.removeItem('loginAt');
        localStorage.removeItem('activeDashboardPage');
        localStorage.removeItem('token');
        window.dispatchEvent(new Event('session-auth-changed'));
        navigate('/', { replace: true });
      });
  };

  // - La reserva está ACTIVA (durante el período de uso)
  // - Es del usuario actual (solo empleados, gestores y supervisores)
  // - No ha sido rellenada aún
  // El admin gestiona los formularios de entrega desde la sección de Validaciones
  const activeReservation = (currentUser.role === 'admin' || currentUser.role === 'empleado' || currentUser.role === 'gestor' || currentUser.role === 'supervisor')
    ? (() => {
      const res = findActiveReservationForUser(reservations, currentUser.id, submittedDeliveryReservationIds);
      if (!res) return null;
      // Solo mostrar si aún no fue entregada
      const isAlreadyDelivered = hasValidDeliveryKilometers(res) || submittedDeliveryReservationIds.includes(String(res.id));
      if (!isAlreadyDelivered) return res;
      return null;
    })()
    : null;

  const handleDeliverActiveReservation = async ({ reservation, kmEntrega, estadoEntrega, informeEntrega, fotoContador }) => {
    if (!reservation?.id) return;

    setDeliveringActiveReservation(true);

    try {
      const response = await apiFetch(`/api/dashboard/reservations/${reservation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: reservation.user_id,
          vehicle_id: reservation.vehicle_id,
          start_time: toMySqlDateTime(reservation.start_time),
          end_time: toMySqlDateTime(reservation.end_time),
          status: 'finalizada',
          km_entrega: kmEntrega,
          estado_entrega: estadoEntrega === 'Si' ? 'incorrecto' : 'correcto',
          informe_entrega: informeEntrega,
          foto_contador: fotoContador ?? null,
          validacion_entrega: 'pendiente',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo finalizar la reserva.');
      }

      toast.success('Reserva finalizada.');
      setReservations((prev) => prev.map((item) => (
        String(item.id) === String(reservation.id)
          ? {
            ...item,
            status: 'finalizada',
            km_entrega: kmEntrega,
            estado_entrega: estadoEntrega === 'Si' ? 'incorrecto' : 'correcto',
            informe_entrega: informeEntrega,
            validacion_entrega: 'pendiente',
          }
          : item
      )));

      await fetchDashboardData();
      setReservationsViewKey((prev) => prev + 1);
    } catch (error) {
      toast.error(error.message || 'Error al actualizar la reserva.');
    } finally {
      setDeliveringActiveReservation(false);
    }
  };

  const isGated = false;
  isGatedRef.current = isGated;

  const renderContent = () => {
    switch (activePage) {
      case 'inicio':
        return (
          <>
            {isMobile ? (
              <MobileHomeView
                reservations={reservations}
                loading={loadingReservations}
                user={currentUser}
                submittedDeliveryIds={submittedDeliveryReservationIds}
                onViewReason={setViewingReason}
                onCreateRes={() => {
                  setTriggerAddReservation(true);
                  if (currentUser.role !== 'empleado' && currentUser.role !== 'gestor') goToPage('reservas');
                }}
                onEdit={(res) => {
                  setTriggerEditReservation(res);
                  if (currentUser.role !== 'empleado' && currentUser.role !== 'gestor') goToPage('reservas');
                }}
                onDelete={(id) => {
                  setTriggerDeleteReservationId(id);
                  if (currentUser.role !== 'empleado' && currentUser.role !== 'gestor') goToPage('reservas');
                }}
                activeReservation={activeReservation}
                onDeliverActiveReservation={handleDeliverActiveReservation}
                deliveringActiveReservation={deliveringActiveReservation}
              />
            ) : (currentUser.role === 'empleado' || currentUser.role === 'gestor') ? (
              <div className="animate-fade-in flex flex-col gap-8 min-h-full w-full">
                {activeReservation && (
                  <div className="w-full">
                    <ActiveReservationCard
                      reservation={activeReservation}
                      onDeliver={handleDeliverActiveReservation}
                      isSubmitting={deliveringActiveReservation}
                    />
                  </div>
                )}
                <div className={`w-full flex-1 flex flex-col ${activeReservation ? 'min-h-0' : 'min-h-[32rem]'}`}>
                  <ReservationsView
                    key={`employee-inicio-${reservationsViewKey}`}
                    user={currentUser}
                    allowPageFlow={Boolean(activeReservation)}
                    shouldOpenAddModal={triggerAddReservation}
                    onAddModalOpened={() => setTriggerAddReservation(false)}
                    reservationToEdit={triggerEditReservation}
                    onEditModalOpened={() => setTriggerEditReservation(null)}
                    reservationToDeleteId={triggerDeleteReservationId}
                    onDeleteActionHandled={() => setTriggerDeleteReservationId(null)}
                    onDeliverReservation={handleDeliverActiveReservation}
                    onOperationComplete={fetchDashboardData}
                  />
                </div>
              </div>
            ) : (
              <HomeView
                stats={stats}
                reservations={reservations}
                loading={loadingReservations}
                user={currentUser}
                activeReservation={activeReservation}
                onDeliverActiveReservation={handleDeliverActiveReservation}
                deliveringActiveReservation={deliveringActiveReservation}
                onViewReason={setViewingReason}
                submittedDeliveryIds={submittedDeliveryReservationIds}
                onTotalVehiclesClick={() => navigate('/vehiculos')}
                onValidationsClick={() => navigate('/validaciones')}
                onWorkshopReportsClick={() => {
                  if (stats.partesTallerDesactualizados === 1) {
                    navigate('/vehiculos', {
                      state: {
                        vehicleView: {
                          openMatchingDocs: 'workshop-outdated',
                        },
                      },
                    });
                    return;
                  }

                  navigate('/vehiculos', {
                    state: {
                      vehicleView: {
                        initialSortConfig: { key: 'is_workshop_report_outdated', direction: 'desc' },
                      },
                    },
                  });
                }}
                onExpiredDocumentsClick={() => {
                  if (stats.documentosExpirados === 1) {
                    navigate('/vehiculos', {
                      state: {
                        vehicleView: {
                          openMatchingDocs: 'expired-documents',
                        },
                      },
                    });
                    return;
                  }

                  navigate('/vehiculos', {
                    state: {
                      vehicleView: {
                        initialSortConfig: { key: 'has_expired_documents', direction: 'desc' },
                      },
                    },
                  });
                }}
              />
            )}

            {/* Para empleados en móvil, manejamos los modales de reserva aquí mismo sin redirigir */}
            {isMobile && (currentUser.role === 'empleado' || currentUser.role === 'gestor') && (
              <ReservationsView
                key={`employee-mobile-headless-${reservationsViewKey}`}
                user={currentUser}
                headless
                enableRealtimeNotifications={true}
                shouldOpenAddModal={triggerAddReservation}
                onAddModalOpened={() => setTriggerAddReservation(false)}
                reservationToEdit={triggerEditReservation}
                onEditModalOpened={() => setTriggerEditReservation(null)}
                reservationToDeleteId={triggerDeleteReservationId}
                onDeleteActionHandled={() => setTriggerDeleteReservationId(null)}
                onDeliverReservation={handleDeliverActiveReservation}
                submittedDeliveryIds={submittedDeliveryReservationIds}
                onOperationComplete={fetchDashboardData}
              />
            )}
          </>
        );
      case 'vehiculos': return <VehiclesView user={currentUser} routeVehicleView={vehicleViewState} />;
      case 'reservas':
        return <ReservationsView
          key={`reservas-page-${reservationsViewKey}`}
          user={currentUser}
          enableRealtimeNotifications={currentUser.role !== 'supervisor'}
          shouldOpenAddModal={triggerAddReservation}
          onAddModalOpened={() => setTriggerAddReservation(false)}
          reservationToEdit={triggerEditReservation}
          onEditModalOpened={() => setTriggerEditReservation(null)}
          reservationToDeleteId={triggerDeleteReservationId}
          onDeleteActionHandled={() => setTriggerDeleteReservationId(null)}
          onDeliverReservation={handleDeliverActiveReservation}
          submittedDeliveryIds={submittedDeliveryReservationIds}
          onOperationComplete={fetchDashboardData}
        />;
      case 'usuarios': return <UsersView />;
      case 'centros': return <CentersView onModalChange={(isOpen) => document.body.style.overflow = isOpen ? 'hidden' : 'unset'} />;
      case 'validaciones': return <ValidationsView />;
      case 'auditoria': return <AuditLogView />;
      default: return null;
    }
  };

  const pageTitle = activePage === 'inicio' && currentUser.role === 'empleado'
    ? 'Inicio'
    : PAGE_TITLES[activePage];
  const shouldScrollInicioForRole = activePage === 'inicio' && (currentUser.role === 'empleado' || currentUser.role === 'gestor' || currentUser.role === 'supervisor' || currentUser.role === 'admin');

  return (
    <div className="h-screen bg-[#DAD7D1] text-slate-900 dark:bg-black dark:text-slate-100 flex flex-col md:flex-row transition-colors duration-300 overflow-hidden">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3500,
          style: { borderRadius: '12px', fontFamily: 'inherit', fontSize: '14px' },
          success: { style: { background: darkMode ? '#1e293b' : '#fff', color: darkMode ? '#4ade80' : '#166534', border: `1px solid ${darkMode ? '#166534' : '#bbf7d0'}` } },
          error: { style: { background: darkMode ? '#1e293b' : '#fff', color: darkMode ? '#f87171' : '#991b1b', border: `1px solid ${darkMode ? '#991b1b' : '#fecaca'}` } },
        }}
      />

      {isMobile && (
        <MobileHeader
          showMenuButton={currentUser.role !== 'empleado' && currentUser.role !== 'gestor'}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          logo={macrosadLogo}
          onLogoClick={() => goToPage('inicio')}
          userInitial={(currentUser.username?.[0] ?? 'U').toUpperCase()}
          onThemeToggle={toggleTheme}
          darkMode={darkMode}
          onUserMenuToggle={() => setIsUserMenuOpen(prev => !prev)}
        />
      )}

      {isMobile && isUserMenuOpen && (
        <>
          <button
            onClick={() => setIsUserMenuOpen(false)}
            className="fixed inset-0 z-[95]"
            aria-label="Cerrar menu de usuario"
          />
          <div className="select-none fixed top-16 right-4 mt-2 w-56 rounded-2xl glass-card-solid shadow-xl z-[100] overflow-hidden">
            <button
              onClick={openProfilePage}
              className="w-full text-left px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
            >
              Administrar perfil
            </button>
            <div className="h-px bg-slate-100 dark:bg-slate-700" />
            <button
              onClick={openLogoutModalFromMenu}
              className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </>
      )}

      {/* OVERLAY FOR MOBILE SIDEBAR */}
      {!isGated && isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[70] animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      {!isGated && <aside className={`
        ${isMobile
          ? `fixed inset-y-0 left-0 z-[80] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          : `relative ${sidebarOpen ? 'w-64' : 'w-20'}`
        } 
        glass-card-solid transition-all duration-300 flex flex-col shadow-xl border-r border-[#E5007D]/10 dark:border-white/10 flex-shrink-0`}>

        {!isMobile && (
          <div
            onClick={() => goToPage('inicio')}
            className="select-none p-6 text-slate-800 dark:text-white font-bold text-xl border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 cursor-pointer group transition-colors"
          >
            <span className="p-2 rounded-lg text-sm flex-shrink-0 group-hover:scale-110 transition-transform">
              <img src={macrosadLogo} alt="Macrosad" width="24" height="24" className="h-6 w-auto group-hover:rotate-12 transition-transform duration-300" />            </span>
            {sidebarOpen &&
              <div className="leading-tight text-left">
                <span className="text-black/80 dark:text-white transition-colors">Macrosad</span><br /><span className="text-xs text-black/80 dark:text-white transition-colors">Reserva de vehículos</span>
              </div>
            }
          </div>
        )}

        <nav className="select-none flex-1 p-4 space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                goToPage(item.key);
                if (isMobile) setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200
                ${activePage === item.key
                  ? 'bg-[#E5007D] text-white shadow-lg shadow-pink-500/30 dark:bg-[#E5007D] dark:text-white'
                  : 'text-black/85 hover:bg-black/10 dark:text-white/90 dark:hover:bg-white/10'
                }`}>
              <span className="text-xl flex-shrink-0">{item.icon}</span>
              {(sidebarOpen || isMobile) && <span className="font-medium">{item.name}</span>}
            </button>
          ))}
        </nav>

        <div className="select-none w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200">
          <span className="font-medium">{userCentreText}</span>
        </div>
      </aside>}

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* NAVBAR SUPERIOR - Solo en Desktop */}
        {!isMobile && (
          <header className="h-20 glass-card-solid border-b-0 flex items-center justify-between px-8 shadow-sm flex-shrink-0 relative z-[90]">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Contraer barra lateral' : 'Expandir barra lateral'} className="p-2 hover:bg-white/40 dark:hover:bg-white/25 rounded-lg text-black/70 dark:text-white">
                {sidebarOpen ? <FontAwesomeIcon icon={faAngleLeft} /> : <FontAwesomeIcon icon={faAngleRight} />}
              </button>

              <div
                role="button"
                tabIndex={0}
                aria-label={darkMode ? 'Pasar a modo claro' : 'Pasar a modo oscuro'}
                onClick={toggleTheme}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTheme(); }}
                className="cursor-pointer p-2 text-black/70 dark:text-white/80 dark:hover:text-white hover:scale-110 active:scale-95 transition-all group"
                title={darkMode ? "Pasar a modo claro" : "Pasar a modo oscuro"}
              >
                {darkMode ? (
                  <svg className="w-6 h-6 transition-transform duration-500 rotate-0 group-hover:rotate-45" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
                    <line x1="12" y1="2" x2="12" y2="4" />
                    <line x1="12" y1="20" x2="12" y2="22" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="2" y1="12" x2="4" y2="12" />
                    <line x1="20" y1="12" x2="22" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 transition-transform duration-500 -rotate-12 group-hover:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="none" opacity="0.85" />
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
              </div>
            </div>

            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(prev => !prev)}
                aria-label="Menú de usuario"
                className="select-none flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/25 transition-colors"
              >
                <p className="text-sm font-bold text-black/75 dark:text-white">{currentUser.username ?? 'Usuario'}</p>
                <div className="w-10 h-10 bg-[#E5007D] rounded-full flex items-center justify-center text-white font-bold shadow-md shadow-pink-500/40 border-2 border-white/40">
                  {(currentUser.username?.[0] ?? 'U').toUpperCase()}
                </div>
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white shadow-xl z-[100] overflow-hidden dark:bg-slate-800">
                  <button
                    onClick={openProfilePage}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  >
                    Administrar perfil
                  </button>
                  <div className="h-px bg-slate-100 dark:bg-slate-700" />
                  <button
                    onClick={openLogoutModalFromMenu}
                    className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>

          </header>
        )}

        {/* AREA DE TRABAJO */}
        <section className={`${isMobile ? 'p-3 pb-6' : 'p-8'} ${isGated || shouldScrollInicioForRole || isMobile ? 'overflow-y-auto overflow-x-hidden custom-scrollbar' : 'overflow-hidden'} flex-1 flex flex-col relative`}>
          {/* Capa de fondo con blur */}
          <div className="fixed inset-0 bg-center bg-no-repeat blur-[5px] scale-[1.05] -z-6 pointer-events-none opacity-40 dark:opacity-40" />

          <div
            key={isGated ? 'gated' : activePage}
            className={`animate-slide-up relative z-10 ${isGated || shouldScrollInicioForRole ? 'h-full min-h-0 flex flex-col pb-6' : 'flex-1 flex flex-col min-h-0'} ${!isGated && !shouldScrollInicioForRole && isMobile && activePage === 'inicio' ? 'overflow-hidden' : ''}`}
          >
            {isGated ? (
              <div className="flex flex-col items-center justify-start w-full pt-4 pb-8 px-0 sm:px-4">
                <div className="w-full max-w-2xl space-y-4">
                  <div className="text-center select-none">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Tienes una entrega pendiente</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Completa el formulario de entrega para acceder a la aplicación.</p>
                  </div>
                  <ActiveReservationCard
                    reservation={activeReservation}
                    onDeliver={handleDeliverActiveReservation}
                    isSubmitting={deliveringActiveReservation}
                  />
                </div>
              </div>
            ) : <Suspense fallback={<ViewLoader />}>{renderContent()}</Suspense>}
          </div>
        </section>
      </main>

      <CentreSelectionModal
        open={requiresCentreSelection}
        user={currentUser}
        refreshCurrentUser={refreshCurrentUser}
      />

      {showLogoutModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
            onClick={() => setShowLogoutModal(false)}
          />
          <div className="glass-card-solid rounded-2xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Cerrar sesión?</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
              Tendrás que volver a introducir tus credenciales.
            </p>
            <div className="select-none flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 shadow-lg shadow-red-500/30 transition-all hover:scale-[1.02] active:scale-95"
              >
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA VER MOTIVO */}
      {viewingReason && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-md animate-modal-overlay"
            onClick={() => setViewingReason(null)}
          />
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-scale-in">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white uppercase tracking-tight">
                  {viewingReason.title}
                </h3>
                <button
                  onClick={() => setViewingReason(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <FontAwesomeIcon icon={faXmark} className="text-slate-400" />
                </button>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-500/20 rounded-2xl p-5">
                <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed break-words whitespace-pre-wrap italic">
                  "{viewingReason.reason}"
                </p>
              </div>
              <button
                onClick={() => setViewingReason(null)}
                className="mt-6 w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-sm shadow-lg hover:brightness-90 transition-all active:scale-95"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminDashboard;
