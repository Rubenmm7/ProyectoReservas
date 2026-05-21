import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCalendarAlt, faChevronLeft, faChevronRight,
  faSearch, faTrashAlt, faEye, faClock, faGaugeHigh,
  faTriangleExclamation, faFilePdf,
  faCircleCheck, faBan, faXmark, faWrench
} from '@fortawesome/free-solid-svg-icons';
import toast from 'react-hot-toast';
import companyLogo from '../assets/isotipo-petalos.svg';
import MonthYearPicker from './MonthYearPicker';
import TimeValueSelect from './TimeValueSelect';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { getDeliveryKilometers, hasValidDeliveryKilometers, formatDeliveryKilometers } from '../utils/delivery';

// --- HOOK PARA DETECTAR MÓVIL ---
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

// --- HELPERS ---
const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const toLocalISOString = (date) => {
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatTimeUnit = (value) => String(value).padStart(2, '0');

const formatBooleanLabel = (value, positive = 'Si', negative = 'No') => (value ? positive : negative);

const formatVehicleDecision = (value) => {
  if (value === 'disponible') return 'Disponible';
  if (value === 'no-disponible') return 'No disponible';
  if (value === 'en-taller') return 'En taller';
  return 'Pendiente';
};

const formatVehicleLabel = (vehicle = {}, includePlate = true) => {
  const brand = String(vehicle?.brand ?? '').trim();
  const model = String(vehicle?.model ?? '').trim();
  const plate = String(vehicle?.license_plate ?? '').trim();
  const name = [brand, model].filter(Boolean).join(' ') || model || brand || 'Vehículo';
  return includePlate && plate ? `${name} (${plate})` : name;
};

const loadImageDataUrl = async (src) => {
  const response = await apiFetch(src);
  const svgText = await response.text();
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.width || 220;
    canvas.height = image.height || 90;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const buildValidationPdf = async (validation) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const addWrappedText = (text, x, posY, maxWidth, options = {}) => {
    const lines = doc.splitTextToSize(String(text || ''), maxWidth);
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(options.size || 10);
    doc.setTextColor(...(options.color || [51, 65, 85]));
    doc.text(lines, x, posY);
    return posY + (lines.length * ((options.size || 10) * 0.45)) + 2;
  };

  const ensurePageSpace = (requiredHeight = 18) => {
    if (y + requiredHeight <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };

  const addSection = (title, rows) => {
    ensurePageSpace(28);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin + 4, y + 6.5);
    y += 16;

    rows.forEach(({ label, value }) => {
      ensurePageSpace(20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(label, margin, y);

      y = addWrappedText(value || 'Sin datos', margin + 42, y, contentWidth - 42, {
        size: 10.5,
        color: [30, 41, 59],
      });

      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    });
  };

  try {
    const logoAsset = await loadImageDataUrl(companyLogo);
    const maxLogoWidth = 28;
    const maxLogoHeight = 14;
    const logoRatio = logoAsset.width / logoAsset.height;
    let logoWidth = maxLogoWidth;
    let logoHeight = logoWidth / logoRatio;

    if (logoHeight > maxLogoHeight) {
      logoHeight = maxLogoHeight;
      logoWidth = logoHeight * logoRatio;
    }

    doc.addImage(logoAsset.dataUrl, 'PNG', margin, y - 2, logoWidth, logoHeight);
  } catch (error) {
    console.error('No se pudo cargar el logo para el PDF:', error);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(15, 23, 42);
  doc.text('Informe de validación', pageWidth - margin, y + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generado el ${formatDate(new Date().toISOString())}`, pageWidth - margin, y + 10, { align: 'right' });
  y += 20;

  doc.setFillColor(229, 0, 125);
  doc.roundedRect(margin, y, contentWidth, 22, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(formatVehicleLabel(validation, false), margin + 5, y + 9);
  doc.setFontSize(11);
  doc.text(validation.license_plate || 'Sin matrícula', margin + 5, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.text(formatVehicleDecision(validation.decision_estado), pageWidth - margin - 5, y + 12.5, { align: 'right' });
  y += 30;

  addSection('Datos generales', [
    { label: 'Usuario', value: validation.username || 'Sin usuario' },
    { label: 'Fecha de inicio', value: formatDate(validation.start_time) || 'Sin fecha' },
    { label: 'Fecha de fin', value: formatDate(validation.end_time) || 'Sin fecha' },
    { label: 'Envío del formulario', value: formatDate(validation.created_at) || 'Sin fecha' },
    { label: 'Estado de revisión', value: validation.status === 'revisada' ? 'Revisada' : 'Pendiente' },
    { label: 'Incidencias', value: formatBooleanLabel(validation.incidencias, 'Si', 'No') },
  ]);

  addSection('Información del vehículo', [
    { label: 'Vehículo', value: formatVehicleLabel(validation, false) || 'Sin modelo' },
    { label: 'Matrícula', value: validation.license_plate || 'Sin matrícula' },
    { label: 'Kilómetros iniciales', value: `${validation.km_inicial ?? 0} km` },
    { label: 'Kilómetros de entrega', value: formatDeliveryKilometers(validation, 'Sin kilometraje registrado') },
    { label: 'Decisión final', value: formatVehicleDecision(validation.decision_estado) },
  ]);

  addSection('Observaciones', [
    { label: 'Mensaje del usuario', value: validation.informe_entrega || 'Sin mensaje de entrega.' },
    { label: 'Comentario supervisor', value: validation.informe_superior || 'Sin comentario del supervisor.' },
    { label: 'Informe de incidencias', value: validation.informe_incidencias || 'Sin incidencias registradas.' },
  ]);

  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text('Documento generado desde el panel de validaciones.', margin, pageHeight - 10);

  const safePlate = (validation.license_plate || 'validacion').replace(/[^a-z0-9_-]/gi, '_');
  return {
    blob: doc.output('blob'),
    fileName: `validacion_${safePlate}_${validation.id}.pdf`,
  };
};

// --- CUSTOM DATE TIME PICKER ---
const CustomDateTimePicker = ({ value, onChange, label, align = "left" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMonthYearPickerOpen, setIsMonthYearPickerOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedDate = value ? new Date(value) : new Date();
  const [viewDate, setViewDate] = useState(new Date(selectedDate));
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  const days = useMemo(() => {
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    const d = [];
    const total = new Date(y, m + 1, 0).getDate();
    const start = (new Date(y, m, 1).getDay() + 6) % 7;
    for (let i = 0; i < start; i++) d.push(null);
    for (let i = 1; i <= total; i++) d.push(i);
    return d;
  }, [viewDate]);

  const handleTimeChange = (type, val) => {
    const newDate = new Date(selectedDate);
    if (type === 'hour') newDate.setHours(parseInt(val));
    else newDate.setMinutes(parseInt(val));
    onChange(toLocalISOString(newDate));
  };

  const handleMonthYearSelect = (month, year) => {
    setViewDate(new Date(year, month, 1));
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="select-none flex flex-col space-y-2 w-full">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</label>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 border-primary bg-white dark:bg-slate-800 transition-all cursor-pointer w-full
                    ${isOpen ? 'border-primary bg-white dark:bg-slate-800' : 'border-slate-300 dark:border-slate-700 bg-transparent'}`}
        >
          <FontAwesomeIcon icon={faCalendarAlt} className="text-primary text-sm" />
          <span className={`text-sm font-medium ${value ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
            {value ? formatDate(value) : "DD/MM/AAAA"}
          </span>
        </div>
      </div>

      {isOpen && (
        <div className={`absolute z-[110] mt-2 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-[280px] ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="flex items-center justify-between mb-4 px-1">
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
              <FontAwesomeIcon icon={faChevronLeft} className="text-[10px]" />
            </button>
            <button
              onClick={() => setIsMonthYearPickerOpen(true)}
              className="font-bold text-xs uppercase tracking-tighter text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-1 rounded-lg transition-colors cursor-pointer"
            >
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </button>
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
              <FontAwesomeIcon icon={faChevronRight} className="text-[10px]" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-2">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1 mb-4">
            {days.map((day, i) => (
              day ? (
                <button key={i} onClick={() => {
                  const nd = new Date(selectedDate);
                  nd.setFullYear(viewDate.getFullYear(), viewDate.getMonth(), day);
                  onChange(toLocalISOString(nd));
                }}
                  className={`aspect-square rounded-lg text-xs font-bold flex items-center justify-center transition-all ${selectedDate.getDate() === day && selectedDate.getMonth() === viewDate.getMonth() && selectedDate.getFullYear() === viewDate.getFullYear() ? 'bg-primary text-white shadow-lg' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                  {day}
                </button>
              ) : <div key={i} />
            ))}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mb-4" />

          {/* Time Selection */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1">
              <TimeValueSelect
                label="Hora"
                value={selectedDate.getHours()}
                onChange={(nextValue) => handleTimeChange('hour', nextValue)}
                options={Array.from({ length: 24 }, (_, i) => ({
                  value: i,
                  label: formatTimeUnit(i),
                }))}
              />
            </div>
            <span className="mt-4 font-bold text-slate-300 dark:text-slate-600">:</span>
            <div className="flex-1">
              <TimeValueSelect
                label="Min"
                value={Math.floor(selectedDate.getMinutes() / 5) * 5}
                onChange={(nextValue) => handleTimeChange('minute', nextValue)}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: i * 5,
                  label: formatTimeUnit(i * 5),
                }))}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-full py-2 bg-primary text-white rounded-xl font-bold text-xs shadow-lg shadow-primary/40 hover:brightness-90 transition-all"
          >
            Confirmar
          </button>
        </div>
      )}

      <MonthYearPicker
        isOpen={isMonthYearPickerOpen}
        onClose={() => setIsMonthYearPickerOpen(false)}
        onSelect={handleMonthYearSelect}
        initialMonth={viewDate.getMonth()}
        initialYear={viewDate.getFullYear()}
      />
    </div>
  );
};

// --- MODAL DE DETALLE DE VALIDACIÓN ---
const ValidationDetailModal = ({ validation, onClose }) => {
  const isReadOnly = validation.status === 'revisada';
  const isMobile = useIsMobile();
  const originalComentario = validation.informe_superior || '';
  const deliveryKm = getDeliveryKilometers(validation);
  const hasDeliveryKm = hasValidDeliveryKilometers(validation);
  const [kmValue, setKmValue] = useState('');
  const [comentario, setComentario] = useState(originalComentario);
  const [incidencia, setIncidencia] = useState(validation.incidencias || false);
  const [informeIncidencias, setInformeIncidencias] = useState(validation.informe_incidencias || '');
  const [isSaving, setIsSaving] = useState(false);
  const [decisionEstado, setDecisionEstado] = useState(validation.decision_estado || null);
  const hasFoto = !!validation.foto_contador;
  const [fotoFullscreen, setFotoFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const wheelRef = useRef(null);

  const openFullscreen = () => { setZoom(1); setPan({ x: 0, y: 0 }); setFotoFullscreen(true); };
  const closeFullscreen = () => setFotoFullscreen(false);

  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setZoom(prev => Math.min(8, Math.max(0.5, prev - e.deltaY * 0.001)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fotoFullscreen]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      setPan({ x: ev.clientX - dragRef.current.startX, y: ev.clientY - dragRef.current.startY });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleUpdateCommentOnly = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/dashboard/validations/${validation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: validation.status,
          informe_superior: comentario,
          km_entrega: validation.km_entrega,
          incidencias: incidencia,
          informe_incidencias: incidencia ? informeIncidencias : '',
          decision_estado: decisionEstado
        })
      });
      if (!res.ok) throw new Error('Error al actualizar el comentario');
      toast.success('Comentario actualizado con éxito');
      onClose();
      if (window.refreshValidations) window.refreshValidations();
    } catch (e) {
      console.error('Error actualizando solo comentario:', e);
      toast.error('Error al actualizar el comentario');
    } finally {
      setIsSaving(false);
    }
  };

  const handleVehicleStatus = async (newStatus) => {
    setIsSaving(true);
    try {
      // 1. Calcular km finales (prioridad: supervisor input > user input > baseline)
      let kmFinal = null;
      if (kmValue.trim() !== '') {
        kmFinal = parseInt(kmValue, 10);
      } else if (hasDeliveryKm) {
        kmFinal = deliveryKm;
      }

      const baselineKm = validation.km_inicial ?? 0;
      if (kmFinal === null || Number.isNaN(kmFinal) || kmFinal <= 0) {
        toast.error('No hay kilómetros de entrega registrados.');
        setIsSaving(false);
        return;
      }

      let updatedKm = Math.max(kmFinal, baselineKm);

      // 1. Marcar LA VALIDACIÓN como revisada y guardar el comentario del supervisor
      // El backend ahora se encarga de actualizar el estado del vehículo en esta misma petición
      const res = await apiFetch(`/api/dashboard/validations/${validation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'revisada',
          informe_superior: comentario,
          km_entrega: updatedKm,
          incidencias: incidencia,
          informe_incidencias: incidencia ? informeIncidencias : '',
          decision_estado: newStatus
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(errorData.error || 'Error al procesar la validación');
      }
      setDecisionEstado(newStatus);

      const statusLabels = { 'disponible': 'disponible', 'no-disponible': 'no disponible', 'en-taller': 'en taller' };
      const statusMsg = statusLabels[newStatus] || newStatus;
      const incidentMsg = incidencia ? 'con incidencia' : 'sin incidencias';
      toast.success(`Vehículo ${statusMsg} y ${incidentMsg}`);

      onClose();
      if (window.refreshValidations) window.refreshValidations();
    } catch (e) {
      console.error('Error actualizando vehículo o validación:', e);
      toast.error('Error al procesar la validación');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
        onClick={onClose}
      />

      {/* Foto fullscreen con zoom/pan */}
      {fotoFullscreen && (
        <div
          ref={wheelRef}
          className="fixed inset-0 z-[10000] bg-black/95 overflow-hidden"
          style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
        >
          {/* Barra superior */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom(prev => Math.min(8, parseFloat((prev + 0.25).toFixed(2))))} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-lg font-bold transition-colors" title="Acercar">+</button>
              <button onClick={() => setZoom(prev => Math.max(0.5, parseFloat((prev - 0.25).toFixed(2))))} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-lg font-bold transition-colors" title="Alejar">−</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="px-3 h-8 flex items-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors" title="Restablecer">{Math.round(zoom * 100)}%</button>
            </div>
            <button
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              onClick={closeFullscreen}
              title="Cerrar"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          {/* Imagen con transform */}
          <div
            className="w-full h-full flex items-center justify-center"
            onMouseDown={handleMouseDown}
            onClick={(e) => { if (e.target === e.currentTarget) closeFullscreen(); }}
          >
            <img
              src={validation.foto_contador}
              alt="Foto cuentakilómetros"
              draggable={false}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center', transition: dragRef.current ? 'none' : 'transform 0.15s ease', userSelect: 'none' }}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Panel */}
      <div className={`bg-white dark:bg-slate-800 rounded-3xl w-full h-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700 overflow-hidden flex ${isMobile ? 'flex-col' : hasFoto ? '' : 'max-w-lg'}`}>
        <div className={`overflow-y-auto flex flex-col ${isMobile ? 'flex-1 min-w-0 order-last' : hasFoto ? 'w-2/5 shrink-0 border-r border-slate-200 dark:border-slate-700' : 'flex-1 min-w-0'}`}>

        {/* Header */}
        <div className={`relative border-b border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800/50 ${isMobile ? 'flex items-center gap-3 px-4 py-3 shrink-0' : 'px-7 pt-7 pb-2'}`}>
          <div className={isMobile ? 'flex-1 min-w-0' : ''}>
            <p className={`text-slate-400 dark:text-white/40 font-semibold uppercase tracking-widest ${isMobile ? 'text-[9px] mb-0.5' : 'text-xs mb-1'}`}>Detalle de validación</p>
            <h3 className={`font-bold leading-tight text-slate-800 dark:text-white/90 ${isMobile ? 'text-sm truncate' : 'text-xl'}`}>
              {formatVehicleLabel(validation, false)}
            </h3>
            <p className={`text-primary font-mono ${isMobile ? 'text-xs' : 'text-sm mt-0.5'}`}>{validation.license_plate}</p>
          </div>
          <button
            onClick={onClose}
            className={`flex items-center justify-center rounded-full transition-colors ${isMobile ? 'shrink-0 w-8 h-8 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600' : 'absolute top-4 right-4 w-8 h-8 bg-black/50 dark:bg-white/20 hover:bg-black/60 dark:hover:bg-white/30 text-white'}`}
          >
            <FontAwesomeIcon icon={faXmark} className="text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className={isMobile ? 'px-4 pb-6 pt-4' : 'px-7 pb-7 pt-3'}>
          {/* Mensaje del usuario */}
          <div className="mb-5">
            <label className="flex items-center gap-2 text-md tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Mensaje del usuario
            </label>
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 px-5 py-4 min-h-[80px] flex flex-col justify-between">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed italic break-words whitespace-pre-wrap">
                {hasDeliveryKm
                  ? (validation.informe_entrega
                    ? `"${validation.informe_entrega}"`
                    : <span className="text-slate-400 dark:text-slate-500 not-italic">Sin mensaje de entrega.</span>)
                  : <span className="text-slate-400 dark:text-slate-500 not-italic">Entrega pendiente.</span>
                }
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 not-italic">
                — {validation.username} · {formatDate(validation.created_at)}
              </p>
            </div>
          </div>

          {/* Kilómetros del vehiculo limitados */}
          <div className="mb-5">
            <label className="flex items-center gap-2 text-md tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Kilómetros del vehículo
            </label>
            <input
              type="number"
              min={validation.km_inicial ?? 0}
              max="15000000"
              step="1"
              value={kmValue}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || parseInt(val, 10) <= 15000000) {
                  setKmValue(val);
                }
              }}
              disabled={isReadOnly || isSaving}
              placeholder={isReadOnly
                ? (hasDeliveryKm ? `${deliveryKm} km (Verificado)` : 'Sin kilometraje registrado')
                : (hasDeliveryKm ? `Del usuario: ${deliveryKm} km.` : 'Sin kilometraje registrado')}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors 
                ${isReadOnly
                  ? 'bg-slate-100 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-slate-400'}`}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 ml-1">
              {hasDeliveryKm
                ? <>Si se deja vacío, tomará el kilometraje indicado por el usuario ({deliveryKm} km). <br />(Km anteriores a la reserva {validation.km_inicial} km)</>
                : <>No hay kilometraje de entrega registrado todavía. <br />(Km anteriores a la reserva {validation.km_inicial} km)</>
              }
            </p>
          </div>

          {/* Comentario del cargo superior */}
          <div className="mb-5">
            <label className="flex items-center gap-2 text-md tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Tu comentario
            </label>
            <textarea
              rows={3}
              value={comentario}
              onChange={(e) => {
                const newValue = e.target.value;
                if (isReadOnly) {
                  // No permitir borrar el comentario original
                  if (newValue.startsWith(originalComentario)) {
                    setComentario(newValue);
                  }
                } else {
                  setComentario(newValue);
                }
              }}
              disabled={isSaving}
              placeholder={isReadOnly ? "Añadir más información..." : "Escribe aquí tu comentario sobre la entrega del vehículo..."}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors resize-none 
                ${isReadOnly
                  ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-primary/20 focus:border-primary'
                  : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 placeholder:text-slate-500 dark:placeholder:text-slate-400/50'}`}
            />
            {isReadOnly && comentario !== originalComentario && (
              <button
                onClick={handleUpdateCommentOnly}
                disabled={isSaving}
                className="mt-2 w-full py-2 bg-primary hover:brightness-90 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-primary/40 active:translate-y-0 hover:-translate-y-0.5"
              >
                {isSaving ? 'Guardando...' : 'Actualizar comentario'}
              </button>
            )}
          </div>

          {/* Checkbox Incidencia */}
          <div className="mb-0">
            <label className="flex items-center gap-3 cursor-pointer select-none group w-fit">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={incidencia}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIncidencia(checked);
                    if (!checked) setInformeIncidencias('');
                  }}
                  disabled={isReadOnly || isSaving}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${incidencia
                  ? 'bg-red-500 border-red-500'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 group-hover:border-red-400'
                  }`}>
                  {incidencia && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <span className={`text-sm font-semibold transition-colors ${isReadOnly ? 'cursor-not-allowed' : ''} ${incidencia ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
                <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1.5 text-xs" />
                Incidencia
              </span>
            </label>

            {incidencia && (
              <div className="mt-3">
                <textarea
                  rows={3}
                  value={informeIncidencias}
                  onChange={(e) => setInformeIncidencias(e.target.value)}
                  disabled={isReadOnly || isSaving}
                  placeholder="Describe la incidencia detectada..."
                  className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors resize-none ${isReadOnly
                    ? 'bg-slate-100 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-500 cursor-not-allowed'
                    : 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-900/10 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 placeholder:text-red-400/70 dark:placeholder:text-red-400/40'}`}
                />
              </div>
            )}
          </div>

          {/* Label + botones de estado */}
          <div className="select-none pt-5 ">
            <p className="text-s font-bold tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              El vehículo debe pasar a estado:
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleVehicleStatus('no-disponible')}
                disabled={isReadOnly || isSaving || (!hasDeliveryKm && kmValue.trim() === '')}
                className={`flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl font-bold text-[11px] transition-all active:translate-y-0 disabled:translate-y-0
                  ${isReadOnly ? 'cursor-default' : 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer'}
                  ${decisionEstado === 'no-disponible'
                    ? 'bg-red-500 text-white shadow-red-500/20 shadow-lg'
                    : (decisionEstado && decisionEstado !== 'no-disponible')
                      ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 grayscale opacity-40'
                      : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 opacity-100'}`}
              >
                <FontAwesomeIcon icon={faBan} className="text-xs" />
                No disponible
              </button>
              <button
                onClick={() => handleVehicleStatus('en-taller')}
                disabled={isReadOnly || isSaving || (!hasDeliveryKm && kmValue.trim() === '')}
                className={`flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl font-bold text-[11px] transition-all active:translate-y-0 disabled:translate-y-0
                  ${isReadOnly ? 'cursor-default' : 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer'}
                  ${decisionEstado === 'en-taller'
                    ? 'bg-orange-500 text-white shadow-orange-500/20 shadow-lg'
                    : (decisionEstado && decisionEstado !== 'en-taller')
                      ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 grayscale opacity-40'
                      : 'bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 text-orange-600 dark:text-orange-400 opacity-100'}`}
              >
                <FontAwesomeIcon icon={faWrench} className="text-xs" />
                En taller
              </button>
              <button
                onClick={() => handleVehicleStatus('disponible')}
                disabled={isReadOnly || isSaving || (!hasDeliveryKm && kmValue.trim() === '')}
                className={`flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl font-bold text-[11px] transition-all active:translate-y-0 disabled:translate-y-0
                  ${isReadOnly ? 'cursor-default' : 'hover:-translate-y-0.5 hover:shadow-md cursor-pointer'}
                  ${decisionEstado === 'disponible'
                    ? 'bg-green-500 text-white shadow-green-500/20 shadow-lg'
                    : (decisionEstado && decisionEstado !== 'disponible')
                      ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 grayscale opacity-40'
                      : 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-600 dark:text-green-400 opacity-100'}`}
              >
                <FontAwesomeIcon icon={faCircleCheck} className="text-xs" />
                Disponible
              </button>
            </div>
          </div>
        </div>
        </div>

        {hasFoto && (
          isMobile ? (
            <div
              className="order-first shrink-0 relative bg-slate-900 cursor-zoom-in overflow-hidden"
              style={{ height: '180px' }}
              onClick={openFullscreen}
            >
              <img
                src={validation.foto_contador}
                alt="Foto cuentakilómetros"
                className="w-full h-full object-contain"
                draggable={false}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 flex items-end justify-between">
                <div>
                  <p className="text-[9px] font-bold text-primary uppercase tracking-wider">Foto usuario</p>
                  <p className="text-xs text-white font-semibold">Foto cuentakilómetros</p>
                </div>
                <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                  <span className="text-white text-[10px] font-semibold">Ampliar</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900 animate-in slide-in-from-right duration-300">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80">
                <div>
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Foto usuario</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-white">Foto cuentakilómetros usuario</p>
                </div>
                <button
                  onClick={openFullscreen}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Pantalla completa"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
                <img
                  src={validation.foto_contador}
                  alt="Foto cuentakilómetros"
                  className="max-w-full max-h-full rounded-2xl object-contain border border-slate-200 dark:border-slate-700 shadow-lg cursor-zoom-in"
                  onClick={openFullscreen}
                />
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};

// --- VISTA PRINCIPAL ---
const ValidationsView = () => {
  const isMobile = useIsMobile();
  const [validations, setValidations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });

  // Estado del modal de detalle
  const [selectedValidation, setSelectedValidation] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null);
  const [viewingReason, setViewingReason] = useState(null);

  // --- PAGINACIÓN Y SCROLL INFINITO ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;
  const [visibleItems, setVisibleItems] = useState(7);
  const [totalRecords, setTotalRecords] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(0);
  const scrollObserverRef = useRef(null);
  const loadingPagesRef = useRef(new Set());
  const hasMountedRef = useRef(false);

  // totalPages declarado antes de los effects para evitar TDZ
  const totalPages = serverTotalPages || Math.ceil(totalRecords / itemsPerPage) || 1;

  const handlePreviewPdf = async (validation) => {
    try {
      const { blob, fileName } = await buildValidationPdf(validation);
      const url = URL.createObjectURL(blob);
      setPdfPreview(prev => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url, fileName };
      });
    } catch (error) {
      console.error('Error generando el PDF:', error);
      toast.error('No se pudo generar el PDF');
    }
  };

  const closePdfPreview = () => {
    setPdfPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const downloadPreviewPdf = () => {
    if (!pdfPreview?.url) return;

    const link = document.createElement('a');
    link.href = pdfPreview.url;
    link.download = pdfPreview.fileName;
    link.click();
  };

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (!sortConfig || sortConfig.key !== key) {
      return (
        <svg className="w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortConfig.direction === 'asc' ? (
      <svg className="w-3 h-3 ml-1 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 ml-1 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  const fetchValidations = async (page = 1, append = false) => {
    if (loadingPagesRef.current.has(page)) return;
    loadingPagesRef.current.add(page);
    try {
      const searchParam = searchTerm.trim() ? `&search=${encodeURIComponent(searchTerm.trim())}` : '';
      const startParam = filterStartDate ? `&startDate=${encodeURIComponent(filterStartDate)}` : '';
      const endParam = filterEndDate ? `&endDate=${encodeURIComponent(filterEndDate)}` : '';
      const sortParam = sortConfig?.key ? `&sortBy=${sortConfig.key}&sortDir=${sortConfig.direction}` : '';
      const res = await apiFetch(`/api/dashboard/validations?page=${page}&limit=7${searchParam}${startParam}${endParam}${sortParam}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        setValidations(prev => append ? [...prev, ...list] : list);
        setTotalRecords(Number(data?.pagination?.totalRecords || list.length));
        setServerTotalPages(Number(data?.pagination?.totalPages || 1));
      }
    } catch (e) { console.error(e); }
    finally {
      setLoading(false);
      loadingPagesRef.current.delete(page);
    }
  };

  useEffect(() => {
    setValidations([]);
    setCurrentPage(1);
    setVisibleItems(7);
    setTotalRecords(0);
    setServerTotalPages(0);
    loadingPagesRef.current.clear();
    fetchValidations(1, false);
    window.refreshValidations = () => {
      loadingPagesRef.current.clear();
      fetchValidations(1, false);
    };
    return () => {
      delete window.refreshValidations;
    };
  }, []);

  // Bloquear scroll cuando algún modal está abierto
  useEffect(() => {
    if (deleteId || selectedValidation || pdfPreview) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [deleteId, selectedValidation, pdfPreview]);

  const confirmDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`/api/dashboard/validations/${deleteId}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Error al eliminar la validación');
      }

      setValidations((prev) => prev.filter((v) => String(v.id) !== String(deleteId)));
      setTotalRecords(prev => Math.max(0, prev - 1));
      setDeleteId(null);

      // Notificar a ReservationsView que debe refrescar sin sincronizar vehículos
      if (window.refreshReservationsNoSync) {
        window.refreshReservationsNoSync();
      }

      toast.success('Validación eliminada correctamente');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Error al eliminar la validación');
    } finally {
      setIsDeleting(false);
    }
  };

  // Re-fetch cuando cambia la búsqueda (búsqueda en servidor)
  useEffect(() => {
    setValidations([]);
    setCurrentPage(1);
    setVisibleItems(7);
    setTotalRecords(0);
    setServerTotalPages(0);
    loadingPagesRef.current.clear();
    fetchValidations(1, false);
  }, [searchTerm]);

  // Re-fetch en servidor cuando cambian filtros de fecha
  useEffect(() => {
    setValidations([]);
    setCurrentPage(1);
    setVisibleItems(7);
    setTotalRecords(0);
    setServerTotalPages(0);
    loadingPagesRef.current.clear();
    fetchValidations(1, false);
  }, [filterStartDate, filterEndDate]);

  // Re-fetch cuando cambia la ordenación (ordenación server-side)
  useEffect(() => {
    setValidations([]);
    setCurrentPage(1);
    setVisibleItems(7);
    setTotalRecords(0);
    setServerTotalPages(0);
    loadingPagesRef.current.clear();
    fetchValidations(1, false);
  }, [sortConfig]);

  // Cargar nueva página al navegar (incluido volver a página 1)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    fetchValidations(currentPage, isMobile);
  }, [currentPage, isMobile]);

  // Observer para scroll infinito en móvil
  useEffect(() => {
    if (!isMobile) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (visibleItems < validations.length) {
            setVisibleItems((prev) => prev + 8);
          } else if (currentPage < totalPages) {
            const nextPage = currentPage + 1;
            setCurrentPage(nextPage);
            fetchValidations(nextPage, true);
          }
        }
      },
      { threshold: 0.1 }
    );

    if (scrollObserverRef.current) {
      observer.observe(scrollObserverRef.current);
    }

    return () => observer.disconnect();
  }, [isMobile, visibleItems, validations.length, currentPage, totalPages]);

  const processedValidations = validations;

  // Datos paginados
  const paginatedValidations = isMobile
    ? processedValidations.slice(0, visibleItems)
    : processedValidations;
  const shouldStretchRows = !isMobile && paginatedValidations.length === itemsPerPage;
  const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
    rowCount: paginatedValidations.length,
    enabled: shouldStretchRows,
  });

  return (
    <div className="relative h-full flex flex-col glass-card-solid rounded-3xl shadow-sm p-6 animate-fade-in transition-colors overflow-hidden">
      {isMobile ? (
        <div className="select-none flex flex-col gap-4 mb-6 shrink-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Validaciones</h2>
              <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                {totalRecords} validaciones
              </span>
            </div>

            <div className="relative self-end w-full">
              <FontAwesomeIcon
                icon={faSearch}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"
              />
              <input
                type="text"
                placeholder="Buscar por usuario, vehículo o matrícula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 justify-between">
            <CustomDateTimePicker label="Desde" value={filterStartDate} onChange={setFilterStartDate} align="left" />
            <CustomDateTimePicker label="Hasta" value={filterEndDate} onChange={setFilterEndDate} align="right" />
          </div>
        </div>
      ) : (
        <div className="select-none flex flex-col mb-6 shrink-0 w-full">
          {/* Primera línea: Título a la izquierda + Contador a la derecha */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Validaciones</h2>
            <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
              {totalRecords} Registros
            </span>
          </div>

          {/* Segunda línea: Búsqueda y filtros */}
          <div className="flex flex-wrap items-end gap-7">
            <div className="relative flex-1 min-w-[260px] max-w-xl">
              <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
              <input
                type="text"
                placeholder="Buscar por usuario, vehículo o matrícula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
              />
            </div>

            <div className="w-[220px] min-w-[200px]">
              <CustomDateTimePicker label="Desde" value={filterStartDate} onChange={setFilterStartDate} align="left" />
            </div>
            <div className="w-[220px] min-w-[200px]">
              <CustomDateTimePicker label="Hasta" value={filterEndDate} onChange={setFilterEndDate} align="right" />
            </div>

            {(filterStartDate || filterEndDate) && (
              <button
                onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                className="p-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                title="Limpiar filtros"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* CONTENIDO */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary dark:border-t-primary rounded-full animate-spin mb-4"></div>
            <p className="italic">Cargando validaciones...</p>
          </div>
        ) : processedValidations.length === 0 ? (
          <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400 font-medium">No hay validaciones para mostrar</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
              {searchTerm || filterStartDate || filterEndDate ? 'Pruebe a cambiar los filtros de búsqueda.' : 'Las validaciones aparecerán aquí al finalizar reservas.'}
            </p>
          </div>
        ) : !isMobile ? (
          /* --- VISTA PC --- */
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
              <div ref={tableWrapperRef} className="flex-1 overflow-hidden">
                <table className="w-full text-sm text-left relative">
                  <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                    <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                      <th onClick={() => requestSort('username')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                        <div className="flex items-center justify-center">
                          Usuario {getSortIcon('username')}
                        </div>
                      </th>
                      <th onClick={() => requestSort('model')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                        <div className="flex items-center justify-center">
                          Vehículo {getSortIcon('model')}
                        </div>
                      </th>
                      <th onClick={() => requestSort('created_at')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                        <div className="flex items-center justify-center">
                          Fecha Registro {getSortIcon('created_at')}
                        </div>
                      </th>
                      <th onClick={() => requestSort('status')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                        <div className="flex items-center justify-center">
                          Estado {getSortIcon('status')}
                        </div>
                      </th>
                      <th onClick={() => requestSort('incidencias')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                        <div className="flex items-center justify-center">
                          Incidencia {getSortIcon('incidencias')}
                        </div>
                      </th>
                      <th className="pb-3 px-4 text-center">
                        <div className="flex items-center justify-center">
                          Opciones
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedValidations.map((v) => (
                      <tr key={v.id} style={rowHeight != null ? { height: `${rowHeight}px` } : undefined} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                          <span
                            className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                            title={v.username}
                          >
                            {v.username}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-300">
                          <span
                            className="font-semibold inline-block max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap align-bottom"
                            title={formatVehicleLabel(v)}
                          >
                            {formatVehicleLabel(v)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-300">{formatDate(v.created_at)}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex justify-center">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${v.status === 'revisada' ? 'bg-indigo-50 dark:bg-indigo-500/10 text-black dark:text-white/90 border border-indigo-100 dark:border-indigo-500/20' : 'bg-amber-50 dark:bg-amber-500/10 text-black dark:text-white/90 border border-amber-100 dark:border-amber-500/20'}`}>
                              {v.status === 'revisada' ? 'Revisada' : 'Pendiente'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex justify-center">
                            <span className={`chip-uniform px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${v.incidencias ? 'bg-red-50 dark:bg-red-500/10 text-black dark:text-white/90 border border-red-100 dark:border-red-500/20' : 'bg-green-50 dark:bg-green-500/10 text-black dark:text-white/90 border border-green-100 dark:border-green-500/20'}`}>
                              {v.incidencias ? 'Si' : 'No'}
                            </span>
                          </div>
                          {!!v.incidencias && v.informe_incidencias && (
                            <button
                              onClick={() => setViewingReason({
                                title: 'Motivo de incidencia',
                                reason: v.informe_incidencias
                              })}
                              className="mt-1 text-[9px] font-bold text-red-500 hover:underline uppercase tracking-tighter mx-auto block transition-all hover:scale-105"
                            >
                              Ver motivo
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">

                            <button
                              onClick={() => setSelectedValidation(v)}
                              title="Ver detalle"
                              className="p-2 text-slate-400 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20 rounded-lg transition-colors mr-1"
                            >
                              <FontAwesomeIcon icon={faEye} className="w-5 h-5" />
                            </button>

                            <button
                              onClick={() => handlePreviewPdf(v)}
                              title="Ver PDF"
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                              <FontAwesomeIcon icon={faFilePdf} className="w-5 h-5" />
                            </button>

                            <button
                              onClick={() => setDeleteId(v.id)}
                              title="Eliminar validación"
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>

              {/* PAGINACIÓN ESCRITORIO */}
              {totalPages > 1 && (
                <div className="select-none flex items-center justify-between px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 rounded-b-2xl shrink-0">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Página <span className="font-bold text-slate-700 dark:text-slate-200">{currentPage}</span> de {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      aria-label="Anterior"
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
                    </button>

                    <div className="flex items-center gap-1">
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
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${currentPage === page
                              ? 'bg-primary text-white shadow-lg shadow-primary/30'
                              : 'hover:bg-white hover:shadow-lg hover:shadow-primary/25 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300'
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
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                    </button>

                    <div className="ml-4 flex items-center gap-2 border-l border-slate-200 dark:border-slate-700 pl-4">
                      <span className="text-xs text-slate-400">Ir a:</span>
                      <input
                        type="number"
                        defaultValue={currentPage}
                        min="1"
                        max={totalPages}
                        className="w-12 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const p = parseInt(e.target.value);
                            if (p >= 1 && p <= totalPages) setCurrentPage(p);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* --- VISTA MÓVIL --- */
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            <>
              {paginatedValidations.map((v) => (
                <div
                  key={v.id}
                  className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50 shadow-[0_2px_8px_rgba(0,0,0,0.07)] dark:shadow-none hover:border-primary/50 dark:hover:border-primary/80 transition-all group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="min-w-0 flex-1 pr-3">
                      <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight truncate" title={v.username}>{v.username}</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold mt-1">
                        {formatVehicleLabel(v)}
                      </p>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-xs font-semibold border ${v.incidencias ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30' : 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/30'}`}>
                      {v.incidencias ? 'Incorrecto' : 'Correcto'}
                    </span>
                  </div>

                  <div className="space-y-2 mb-5">
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                      <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-primary" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Kilómetros entrega</span>
                        <span className="text-xs font-semibold">{hasValidDeliveryKilometers(v) ? `${getDeliveryKilometers(v)} km` : 'Pendiente'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                      <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5 text-amber-500" />
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Fecha registro</span>
                        <span className="text-xs font-semibold">{formatDate(v.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-4 border-t border-slate-100 dark:border-slate-700/50 gap-2">
                    <button
                      onClick={() => handlePreviewPdf(v)}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-xs font-bold flex items-center gap-2"
                    >
                      <FontAwesomeIcon icon={faFilePdf} className="w-4 h-4" />
                      PDF
                    </button>
                    <button
                      onClick={() => setSelectedValidation(v)}
                      className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors text-xs font-bold flex items-center gap-2"
                    >
                      <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
                      Ver detalle
                    </button>
                    <button
                      onClick={() => setDeleteId(v.id)}
                      title="Eliminar validación"
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      <FontAwesomeIcon icon={faTrashAlt} className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Elemento observador para scroll infinito móvil */}
              {visibleItems < processedValidations.length && (
                <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </>
          </div>
        )}
      </div>

      {/* MODAL DETALLE DE VALIDACIÓN */}
      {selectedValidation && (
        <ValidationDetailModal
          validation={selectedValidation}
          onClose={() => setSelectedValidation(null)}
        />
      )}

      {/* MODAL PARA VER MOTIVO/INCIDENCIA */}
      {viewingReason && (
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
        </div>
      )}

      {pdfPreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-slate-900/70 dark:bg-slate-900/85 backdrop-blur-xl animate-modal-overlay"
            onClick={closePdfPreview}
          />
          <div className="relative z-10 bg-white dark:bg-slate-800 rounded-3xl w-full h-full border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Vista previa del PDF</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{pdfPreview.fileName}</p>
              </div>
              <div className="flex items-center flex-col md:flex-row gap-2">
                <button
                  onClick={() => window.open(pdfPreview.url, '_blank')}
                  className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-bold flex items-center gap-2"
                >
                  <FontAwesomeIcon icon={faEye} />
                  Pantalla completa
                </button>
                <button
                  onClick={downloadPreviewPdf}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-sm font-bold"
                >
                  Descargar
                </button>
                <button
                  onClick={closePdfPreview}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-bold"
                >
                  Cerrar
                </button>
              </div>
            </div>
            <iframe
              src={pdfPreview.url}
              title="Vista previa PDF"
              className="w-full flex-1 bg-slate-200 dark:bg-slate-900"
            />

          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR ELIMINACIÓN */}
      {deleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
            onClick={() => !isDeleting && setDeleteId(null)}
          />
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Estás seguro?</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
              Esta acción eliminará la validación permanentemente y no se puede deshacer.
            </p>
            <div className="select-none flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-70"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-70 flex items-center justify-center"
              >
                {isDeleting ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Sí, eliminar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ValidationsView;
