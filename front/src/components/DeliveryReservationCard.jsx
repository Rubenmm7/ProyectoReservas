import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';

const STATUS_RESERVATION = {
  aprobada: 'bg-cyan-100 text-black border border-cyan-200 dark:bg-cyan-500/20 dark:text-white/90 dark:border-cyan-500/30',
  activa: 'bg-blue-100 text-black border border-blue-200 dark:bg-blue-500/20 dark:text-white/90 dark:border-blue-500/30',
  pendiente: 'bg-amber-100 text-black border border-amber-200 dark:bg-amber-500/20 dark:text-white/90 dark:border-amber-500/30',
  rechazada: 'bg-red-100 text-black border border-red-200 dark:bg-red-500/20 dark:text-white/90 dark:border-red-500/30',
  finalizada: 'bg-violet-100 text-black border border-violet-200 dark:bg-violet-500/20 dark:text-white/90 dark:border-violet-500/30',
  fecha: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getInitialKm = (reservation, vehicle) => {
  if (reservation?.km_inicial !== null && reservation?.km_inicial !== undefined) {
    const reservationKm = Number(reservation.km_inicial);
    if (!Number.isNaN(reservationKm)) return reservationKm;
  }

  const vehicleKm = Number(vehicle?.kilometers);
  if (!Number.isNaN(vehicleKm) && vehicleKm >= 0) return vehicleKm;

  return 0;
};

const compressImage = (file) =>
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

const useIsDesktop = () => {
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

const formatVehicleLabel = (vehicle = {}, includePlate = true) => {
  const brand = String(vehicle?.brand ?? '').trim();
  const model = String(vehicle?.model ?? '').trim();
  const plate = String(vehicle?.license_plate ?? '').trim();
  const name = [brand, model].filter(Boolean).join(' / ') || model || brand || 'Vehículo';
  return includePlate && plate ? `${name} (${plate})` : name;
};

export default function DeliveryReservationCard({
  reservation,
  onDeliver,
  isSubmitting = false,
  vehicle: propVehicle,
  title = 'Formulario de entrega del vehículo',
}) {
  const [kmInitial, setKmInitial] = useState(0);
  const [kmEntrega, setKmEntrega] = useState('');
  const [informeEntrega, setInformeEntrega] = useState('');
  const [estadoEntrega, setEstadoEntrega] = useState('No');
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [fotoContador, setFotoContador] = useState(null);
  const statusDropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const isDesktop = useIsDesktop();

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
          const res = await fetch('/api/dashboard/vehicles');

          if (res.ok) {
            const vehicles = await res.json();
            const found = vehicles.find(v => String(v.id) === String(reservation.vehicle_id));
            if (found) {
              setKmInitial(getInitialKm(reservation, found));
            } else {
              setKmInitial(getInitialKm(reservation, null));
            }
          }
        } catch (err) {
          console.error('Error fetching vehicle for delivery card:', err);
        }
      }
    };

    if (!propVehicle) {
      fetchVehicle();
    } else {
      setKmInitial(getInitialKm(reservation, propVehicle));
    }

    setKmEntrega('');
    setInformeEntrega('');
    setEstadoEntrega('No');
    setFotoContador(null);
  }, [reservation?.id, reservation?.vehicle_id, propVehicle]);

  if (!reservation) return null;

  const isDeliveryPending = String(reservation.status ?? '').toLowerCase() === 'finalizada';

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
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
      toast.error('Introduce un kilometraje válido.');
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
            {title}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {reservation.username ? `${reservation.username} · ` : ''}
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
          <p className="font-semibold uppercase tracking-wide text-[10px] text-slate-400 dark:text-slate-500">
            {'Fin'}
          </p>
          <p className="font-semibold mt-1">{formatDateTime(reservation.end_time)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Kilometros actuales
          </label>
          <input
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
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Anotaciones de entrega
          </label>
          <textarea
            rows={4}
            maxLength={255}
            value={informeEntrega}
            onChange={(e) => setInformeEntrega(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-y min-h-[110px] whitespace-pre-line break-words overflow-y-auto"
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
}
