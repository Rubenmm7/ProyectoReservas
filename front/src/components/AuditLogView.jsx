import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch, faEye, faXmark, faChevronLeft, faChevronRight,
  faCalendarAlt, faChevronDown, faListCheck, faTable, faCheck,
  faFileExcel, faFilePdf
} from '@fortawesome/free-solid-svg-icons';
import toast from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { Listbox, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import MonthYearPicker from './MonthYearPicker';
import TimeValueSelect from './TimeValueSelect';
import { exportToExcel, exportToPDF } from '../utils/exportUtils';

const options = [
  { id: '', name: 'Todas las tablas' },
  { id: 'users', name: 'Usuarios' },
  { id: 'vehicles', name: 'Vehículos' },
  { id: 'reservations', name: 'Reservas' },
  { id: 'documents', name: 'Documentación' },
  { id: 'validations', name: 'Validaciones' },
  { id: 'audit_logs', name: 'Auditoría' },
];

const tableNameMap = {
  users: 'Usuarios',
  vehicles: 'Vehículos',
  reservations: 'Reservas',
  documents: 'Documentación',
  validations: 'Validaciones',
  audit_logs: 'Auditoría',
};

// --- HELPERS (same style as ValidationsView) ---
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

// --- CUSTOM DATE TIME PICKER (copied from ValidationsView for consistency) ---
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
            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
              <FontAwesomeIcon icon={faChevronLeft} className="text-[10px]" />
            </button>
            <button
              type="button"
              onClick={() => setIsMonthYearPickerOpen(true)}
              className="font-bold text-xs uppercase tracking-tighter text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-1 rounded-lg transition-colors cursor-pointer"
            >
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </button>
            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
              <FontAwesomeIcon icon={faChevronRight} className="text-[10px]" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-2">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1 mb-4">
            {days.map((day, i) => (
              day ? (
                <button type="button" key={i} onClick={() => {
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
                value={selectedDate.getMinutes()}
                onChange={(nextValue) => handleTimeChange('minute', nextValue)}
                options={Array.from({ length: 60 }, (_, i) => ({
                  value: i,
                  label: formatTimeUnit(i),
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

const StyledSelect = ({ value, onChange, children, ariaLabel, icon }) => {
  const isPlaceholder = value === '' || value === null || value === undefined;
  const leftPadding = icon ? 'pl-10' : 'pl-4';
  const textColor = isPlaceholder ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100';

  return (
    <div className="group relative">
      {icon && (
        <FontAwesomeIcon
          icon={icon}
          className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] transition-colors ${isPlaceholder ? 'text-slate-400 dark:text-slate-500' : 'text-primary'
            }`}
        />
      )}
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className={`w-full appearance-none ${leftPadding} pr-10 py-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-900/50 backdrop-blur text-sm font-semibold ${textColor} outline-none transition-all shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary`}
      >
        {children}
      </select>
      <FontAwesomeIcon
        icon={faChevronDown}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs transition-transform duration-150 group-focus-within:-rotate-180 group-focus-within:text-slate-500"
      />
    </div>
  );
};

const FilterSelect = ({ value, onChange, options, placeholder, icon }) => {
  const selectedOption = options.find((option) => option.value === value) || options[0];

  return (
    <Listbox value={value} onChange={onChange}>
      {({ open }) => (
        <div className="relative">
          <Listbox.Button className="w-full rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-900/50 px-4 py-3 text-left shadow-sm transition-all hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary backdrop-blur">
            <div className="flex items-center gap-3">

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  {placeholder}
                </p>
                <p className={`truncate text-sm font-semibold ${value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
                  {selectedOption?.label ?? placeholder}
                </p>
              </div>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`text-slate-400 text-xs transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              />
            </div>
          </Listbox.Button>

          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Listbox.Options className="absolute z-50 mt-2 max-h-74 w-full overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 shadow-2xl ring-1 ring-black/5 focus:outline-none">
              {options.map((option) => (
                <Listbox.Option
                  key={option.value}
                  value={option.value}
                  className={({ active, selected }) => `cursor-pointer px-3 py-2 mx-2 rounded-xl transition-colors ${active ? 'bg-primary/10 text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-300'} ${selected ? 'font-semibold' : 'font-medium'}`}
                >
                  {({ selected }) => (
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate">{option.label}</span>
                      {selected && <FontAwesomeIcon icon={faCheck} className="text-primary dark:text-primary-400 text-xs" />}
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      )}
    </Listbox>
  );
};

// --- Modal de Detalles ---
const DetailModal = ({ audit, isOpen, onClose, darkMode }) => {
  if (!isOpen || !audit) return null;

  const fieldLabels = {
    informe_incidencias: 'Informe incidencias',
    informe_superior: 'Informe superior',
    informe_entrega: 'Informe entrega',
    incidencias: 'Incidencia',
    km_entrega: 'Km entrega',
    km_inicial: 'Km iniciales',
    decision_estado: 'Estado decidido',
    vehiculo: 'Vehículo',
    type: 'Tipo de documento',
    original_name: 'Nombre de archivo',
    expiration_date: 'Fecha de vencimiento',
    file: 'Archivo',
    document_type: 'Tipo de documento',
    vehicle_id: 'ID vehículo',
    user_id: 'ID usuario',
    start_time: 'Inicio reserva',
    end_time: 'Fin reserva',
    status: 'Estado',
  };

  const parseDetails = (raw) => {
    if (raw === null || raw === undefined) return null;
    let parsed;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    } else {
      parsed = raw;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed;
  };

  const formatDateDisplay = (value) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Si' : 'No';
    if (typeof value === 'string') {
      // Verificar si parece una cadena de fecha estándar (ISO 8601 o formatos SQL comunes como AAAA-MM-DD)
      const isDateString = /^\d{4}-\d{2}-\d{2}(T|\s)?/.test(value);
      if (isDateString) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
        }
      }
    }
    return String(value);
  };

  const formatFieldLabel = (key) => fieldLabels[key] || String(key).replaceAll('_', ' ');

  const renderChangesTable = (rows) => (
    <table className="w-full text-left text-xs border-collapse">
      <thead>
        <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-300 dark:border-slate-600 font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          <th className="px-3 py-2.5">Campo</th>
          <th className="px-3 py-2.5">De</th>
          <th className="px-3 py-2.5">Pasa a</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, change]) => {
          const isVehiculo = key === 'vehiculo';
          const isChanged = String(change.from) !== String(change.to);
          return (
            <tr key={key} className={`border-b border-slate-200 dark:border-slate-700 transition-colors ${isVehiculo ? 'bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
              }`}>
              <td className={`px-3 py-2 font-medium ${isVehiculo ? 'text-primary font-bold' : 'text-slate-700 dark:text-slate-300'
                }`}>{formatFieldLabel(key)}</td>
              <td className={`px-3 py-2 ${isVehiculo && isChanged ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-400'
                }`}>{formatDateDisplay(change.from ?? '-')}</td>
              <td className={`px-3 py-2 ${isVehiculo && isChanged ? 'text-primary font-semibold' : 'text-slate-600 dark:text-slate-400'
                }`}>{formatDateDisplay(change.to ?? '-')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderKeyValueTable = (obj) => (
    <table className="w-full text-left text-xs border-collapse">
      <thead>
        <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-300 dark:border-slate-600 font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          <th className="px-3 py-2.5">Campo</th>
          <th className="px-3 py-2.5">Valor</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(obj).map(([key, value]) => (
          <tr key={key} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
            <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 uppercase">{formatFieldLabel(key)}</td>
            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatDateDisplay(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderAuditDetails = (rawDetails) => {
    const details = parseDetails(rawDetails);
    if (!details) {
      return <p className="text-xs text-slate-500">No hay detalles disponibles</p>;
    }

    if (typeof details !== 'object' || Array.isArray(details)) {
      return (
        <pre className={`p-3 rounded-lg text-xs overflow-x-auto ${darkMode ? 'bg-slate-900 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300'}`}>
          {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
        </pre>
      );
    }

    const hasChanges = details.changes && typeof details.changes === 'object';
    const hasPrevCurr = details.previous && details.current && typeof details.previous === 'object' && typeof details.current === 'object';

    if (hasChanges) {
      const rows = Object.entries(details.changes).map(([key, value]) => {
        if (typeof value === 'object' && value !== null && ('from' in value || 'to' in value)) {
          return [key, { from: value.from ?? '-', to: value.to ?? '-' }];
        }
        return [key, { from: '-', to: value }];
      });

      return (
        <>
          <p className="text-sm font-semibold mb-2">Detalles de cambios</p>
          {renderChangesTable(rows)}
          {details.modifiedFields && details.modifiedFields.length > 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Campos modificados: {details.modifiedFields.join(', ')}</p>
          )}
        </>
      );
    }

    if (hasPrevCurr) {
      const keys = Array.from(new Set([...Object.keys(details.previous), ...Object.keys(details.current)]));
      const rows = keys.map((key) => ([key, { from: details.previous?.[key] ?? '-', to: details.current?.[key] ?? '-' }]));

      return (
        <>
          <p className="text-sm font-semibold mb-2">Antes / Después</p>
          {renderChangesTable(rows)}
        </>
      );
    }

    return (
      <>
        <p className="text-sm font-semibold mb-2">Valores</p>
        {renderKeyValueTable(details)}
      </>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-[200] p-4">
      <div className={`${darkMode ? 'bg-slate-800' : 'bg-white'} rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
        {/* Header */}
        <div className={`select-none sticky top-0 flex items-center justify-between p-6 border-b ${darkMode ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
          <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>
            Detalles de auditoría
          </h3>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}
          >
            <FontAwesomeIcon icon={faXmark} className="text-lg" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>ID</p>
              <p className={`block max-w-full truncate text-sm font-mono ${darkMode ? 'text-slate-200' : 'text-slate-900'}`} title={String(audit.id_auditoria)}>{audit.id_auditoria}</p>
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Usuario</p>
              <p className={`block max-w-full truncate text-sm font-medium ${darkMode ? 'text-slate-200' : 'text-slate-900'}`} title={audit.username || 'Sistema'}>{audit.username || 'Sistema'}</p>
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Acción</p>
              <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary`}>
                {audit.accion}
              </span>
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Tabla</p>
              <p className={`block max-w-full truncate text-sm ${darkMode ? 'text-slate-300' : 'text-slate-700'}`} title={audit.tabla_afectada}>{audit.tabla_afectada}</p>
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Registro ID</p>
              <p className={`block max-w-full truncate text-sm font-mono ${darkMode ? 'text-slate-300' : 'text-slate-700'}`} title={String(audit.registro_id || '-')}>{audit.registro_id || '-'}</p>
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Rol</p>
              <p className={`block max-w-full truncate text-sm ${darkMode ? 'text-slate-300' : 'text-slate-700'}`} title={audit.rol_momento}>{audit.rol_momento}</p>
            </div>
          </div>

          <div>
            <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'} mb-2`}>Fecha</p>
            <p className={`text-sm ${darkMode ? 'text-slate-300' : 'text-slate-700'} flex items-center gap-2`}>
              {new Date(audit.fecha).toLocaleString('es-ES')}
            </p>
          </div>

          {audit.detalles_admin && (
            <div>
              <p className={`text-xs font-semibold uppercase ${darkMode ? 'text-slate-400' : 'text-slate-500'} mb-2`}>Detalles</p>
              <div className={`p-3 rounded-lg text-xs overflow-x-auto ${darkMode ? 'bg-slate-900 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300'}`}>
                {renderAuditDetails(audit.detalles_admin)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function AuditLogView() {
  const isMobile = useIsMobile();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [totalRecords, setTotalRecords] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(0);
  const pageSize = 7;
  const loadingPagesRef = useRef(new Set());

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [columnFilters, setColumnFilters] = useState({
    username: '',
    accion: '',
    tabla_afectada: '',
    registro_id: '',
    fecha: ''
  });

  // Sorting Config
  const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [visibleItems, setVisibleItems] = useState(7);
  const scrollObserverRef = useRef(null);

  // Detectar dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      const storedTheme = localStorage.getItem('theme');
      const htmlHasDarkClass = document.documentElement.classList.contains('dark');
      setDarkMode(storedTheme === 'dark' || htmlHasDarkClass);
    };

    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', checkDarkMode);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', checkDarkMode);
    };
  }, []);

  const queryKey = useMemo(() => JSON.stringify({
    searchTerm,
    actionFilter,
    tableFilter,
    startDate,
    endDate,
    columnFilters,
    sortConfig,
  }), [searchTerm, actionFilter, tableFilter, startDate, endDate, columnFilters, sortConfig]);

  const buildQueryString = (page) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
      sortBy: sortConfig.key,
      sortDirection: sortConfig.direction,
    });

    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    if (actionFilter) params.set('action', actionFilter);
    if (tableFilter) params.set('table', tableFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (columnFilters.username.trim()) params.set('usernameSearch', columnFilters.username.trim());
    if (columnFilters.accion.trim()) params.set('actionSearch', columnFilters.accion.trim());
    if (columnFilters.tabla_afectada.trim()) params.set('tableSearch', columnFilters.tabla_afectada.trim());
    if (columnFilters.registro_id.trim()) params.set('registroIdSearch', columnFilters.registro_id.trim());
    if (columnFilters.fecha.trim()) params.set('fechaSearch', columnFilters.fecha.trim());

    return params.toString();
  };

  const fetchAuditPage = async (page, { append = false } = {}) => {
    if (loadingPagesRef.current.has(page)) return;
    loadingPagesRef.current.add(page);

    try {
      setLoading(true);
      const response = await apiFetch(`/api/audit/logs?${buildQueryString(page)}`);
      if (!response.ok) {
        throw new Error('Error al cargar auditoría');
      }

      const data = await response.json();
      const pageLogs = Array.isArray(data.data) ? data.data : [];

      setLogs(append ? (prev) => [...prev, ...pageLogs] : pageLogs);

      setTotalRecords(Number(data?.pagination?.totalRecords || 0));
      setServerTotalPages(Number(data?.pagination?.totalPages || 0));
    } catch (error) {
      console.error('Error:', error);
      toast.error(error.message);
    } finally {
      loadingPagesRef.current.delete(page);
      setLoading(false);
    }
  };

  useEffect(() => {
    setLogs([]);
    setTotalRecords(0);
    setServerTotalPages(0);
    setCurrentPage(1);
    setVisibleItems(7);
    loadingPagesRef.current.clear();
  }, [queryKey]);

  useEffect(() => {
    fetchAuditPage(currentPage, { append: isMobile && currentPage > 1 });
  }, [currentPage, queryKey, isMobile]);

  // Reset pagination cuando cambia búsqueda
  useEffect(() => {
    setCurrentPage(1);
    setVisibleItems(7);
  }, [searchTerm, actionFilter, tableFilter, startDate, endDate, columnFilters]);

  const requestSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
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

  // Paginación
  const paginatedLogs = useMemo(() => {
    if (isMobile) {
      return logs.slice(0, visibleItems);
    }
    return logs;
  }, [logs, isMobile, visibleItems]);

  const totalPages = serverTotalPages || Math.ceil(totalRecords / pageSize);
  const shouldStretchRows = !isMobile && paginatedLogs.length === pageSize;
  const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
    rowCount: paginatedLogs.length,
    enabled: shouldStretchRows,
  });

  // Infinite scroll en móvil
  useEffect(() => {
    if (!isMobile) return;

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        if (visibleItems < logs.length) {
          setVisibleItems(prev => prev + 8);
        } else if (currentPage < totalPages) {
          setCurrentPage(prev => prev + 1);
        }
      }
    }, { threshold: 0.1 });

    if (scrollObserverRef.current) observer.observe(scrollObserverRef.current);
    return () => observer.disconnect();
  }, [isMobile, visibleItems, logs.length, currentPage, totalPages]);

  const handleViewDetails = (audit) => {
    setSelectedAudit(audit);
    setIsDetailOpen(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setActionFilter('');
    setTableFilter('');
    setStartDate('');
    setEndDate('');
    setColumnFilters({ username: '', accion: '', tabla_afectada: '', registro_id: '', fecha: '' });
  };

  const exportColumns = [
    { header: 'ID', key: 'id_auditoria' },
    { header: 'Usuario', key: 'username' },
    { header: 'Acción', key: 'accion' },
    { header: 'Tabla', key: 'tabla_afectada' },
    { header: 'Registro ID', key: 'registro_id' },
    { header: 'Rol', key: 'rol_momento' },
    { header: 'Fecha', key: 'fecha' }
  ];

  const fetchAllForExport = async () => {
    try {
      const params = new URLSearchParams({
        sortBy: sortConfig.key,
        sortDirection: sortConfig.direction,
      });

      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      if (actionFilter) params.set('action', actionFilter);
      if (tableFilter) params.set('table', tableFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (columnFilters.username.trim()) params.set('usernameSearch', columnFilters.username.trim());
      if (columnFilters.accion.trim()) params.set('actionSearch', columnFilters.accion.trim());
      if (columnFilters.tabla_afectada.trim()) params.set('tableSearch', columnFilters.tabla_afectada.trim());
      if (columnFilters.registro_id.trim()) params.set('registroIdSearch', columnFilters.registro_id.trim());
      if (columnFilters.fecha.trim()) params.set('fechaSearch', columnFilters.fecha.trim());
      
      params.set('limit', totalRecords > 0 ? String(totalRecords) : '10000');
      params.set('page', '1');

      const response = await apiFetch(`/api/audit/logs?${params.toString()}`);
      if (!response.ok) throw new Error('Error al cargar datos para exportar');
      
      const data = await response.json();
      return Array.isArray(data.data) ? data.data : [];
    } catch (error) {
      console.error('Error fetching for export:', error);
      toast.error('Error al preparar la exportación');
      return null;
    }
  };

  const handleExportExcel = async () => {
    const toastId = toast.loading('Preparando exportación a Excel...');
    const allData = await fetchAllForExport();
    if (!allData) {
      toast.dismiss(toastId);
      return;
    }

    const data = allData.map(log => ({
      ...log,
      fecha: new Date(log.fecha).toLocaleString('es-ES'),
      username: log.username || 'Sistema'
    }));
    exportToExcel(data, 'Auditoria_Reservas', exportColumns);
    toast.dismiss(toastId);
    toast.success('Reporte Excel descargado');
  };

  const handleExportPDF = async () => {
    const toastId = toast.loading('Preparando exportación a PDF...');
    const allData = await fetchAllForExport();
    if (!allData) {
      toast.dismiss(toastId);
      return;
    }

    const data = allData.map(log => ({
      ...log,
      fecha: new Date(log.fecha).toLocaleString('es-ES'),
      username: log.username || 'Sistema'
    }));
    exportToPDF(data, 'Auditoria_Reservas', exportColumns, 'Reporte de Auditoría');
    toast.dismiss(toastId);
    toast.success('Reporte PDF descargado');
  };

  return (
    <div className="relative h-full flex flex-col glass-card-solid rounded-3xl shadow-sm p-6 animate-fade-in transition-colors overflow-hidden">
      {isMobile ? (
        <div className="select-none flex flex-col gap-4 mb-6 shrink-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Registro de auditoría</h2>
              <div className="flex items-center gap-2">
                {(searchTerm || actionFilter || tableFilter || startDate || endDate) && (
                  <button
                    onClick={clearFilters}
                    className="p-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                    title="Limpiar filtros"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
                <button onClick={handleExportExcel} className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors" title="Exportar a Excel">
                  <FontAwesomeIcon icon={faFileExcel} className="text-lg" />
                </button>
                <button onClick={handleExportPDF} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors" title="Exportar a PDF">
                  <FontAwesomeIcon icon={faFilePdf} className="text-lg" />
                </button>
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                  {totalRecords} Registros totales
                </span>
              </div>
            </div>

            <div className="relative self-end w-full">
              <FontAwesomeIcon
                icon={faSearch}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"
              />
              <input
                type="text"
                placeholder="Buscar por usuario o tabla..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FilterSelect
                icon={faListCheck}
                value={actionFilter}
                onChange={setActionFilter}
                options={[
                  { value: '', label: 'Todas las acciones' },
                  { value: 'CREATE', label: 'CREATE' },
                  { value: 'UPDATE', label: 'UPDATE' },
                  { value: 'DELETE', label: 'DELETE' },
                  { value: 'READ', label: 'READ' },
                ]}
              />

              <FilterSelect
                icon={faTable}
                value={tableFilter}
                onChange={setTableFilter}
                options={[
                  { value: '', label: 'Todas las tablas' },
                  ...options.slice(1).map((option) => ({ value: option.id, label: option.name })),
                ]}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 justify-between">
            <CustomDateTimePicker label="Desde" value={startDate} onChange={setStartDate} align="left" />
            <CustomDateTimePicker label="Hasta" value={endDate} onChange={setEndDate} align="right" />
          </div>
        </div>
      ) : (
        /* Vista PC */
        <div className="select-none flex flex-col mb-6 shrink-0 w-full">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Registro de auditoría</h2>
            <div className="flex items-center gap-2">
              {(searchTerm || actionFilter || tableFilter || startDate || endDate) && (
                <button
                  onClick={clearFilters}
                  className="p-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                  title="Limpiar filtros"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
              <button onClick={handleExportExcel} className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors" title="Exportar a Excel">
                <FontAwesomeIcon icon={faFileExcel} className="text-lg" />
              </button>
              <button onClick={handleExportPDF} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors" title="Exportar a PDF">
                <FontAwesomeIcon icon={faFilePdf} className="text-lg" />
              </button>
              <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                {totalRecords} Registros totales
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="relative flex-1 min-w-[260px] max-w-xl">
              <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
              <input
                type="text"
                placeholder="Buscar por usuario o tabla..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
              />
            </div>

            <div className="w-[210px] min-w-[190px]">
              <FilterSelect
                value={actionFilter}
                onChange={setActionFilter}
                options={[
                  { value: '', label: 'Todas las acciones' },
                  { value: 'CREATE', label: 'CREATE' },
                  { value: 'UPDATE', label: 'UPDATE' },
                  { value: 'DELETE', label: 'DELETE' },
                  { value: 'READ', label: 'READ' },
                ]}
              />
            </div>

            <div className="w-[210px] min-w-[190px]">
              <FilterSelect
                value={tableFilter}
                onChange={setTableFilter}
                options={[
                  { value: '', label: 'Todas las tablas' },
                  ...options.slice(1).map((option) => ({ value: option.id, label: option.name })),
                ]}
              />
            </div>

            <div className="w-[220px] min-w-[200px]">
              <CustomDateTimePicker label="Desde" value={startDate} onChange={setStartDate} align="left" />
            </div>
            <div className="w-[220px] min-w-[200px]">
              <CustomDateTimePicker label="Hasta" value={endDate} onChange={setEndDate} align="right" />
            </div>
          </div>
        </div>
      )}

      {/* Contenido (Tabla y Listado) */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
            <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
            <p className="italic">Cargando auditoría...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400 font-medium">No hay registros para mostrar</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
              {searchTerm || actionFilter || tableFilter || startDate || endDate || Object.values(columnFilters).some(v => v !== '')
                ? 'Pruebe a cambiar los filtros de búsqueda.'
                : 'El registro de auditoría aparecerá aquí conforme se realicen acciones.'}
            </p>
          </div>
        ) : isMobile ? (
          /* Vista móvil - Mantenemos tu diseño de tarjetas */
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {paginatedLogs.map((audit) => (
              <div
                key={audit.id_auditoria}
                className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/50 shadow-sm hover:border-primary/50 dark:hover:border-primary/50 transition-all group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="min-w-0 flex-1 pr-3">
                    <h3 className="block max-w-full font-bold text-slate-800 dark:text-white text-lg leading-tight truncate" title={audit.username || 'Sistema'}>
                      {audit.username || 'Sistema'}
                    </h3>
                    <p className="block max-w-full truncate text-slate-500 dark:text-slate-400 text-xs font-semibold mt-1" title={tableNameMap[audit.tabla_afectada] || audit.tabla_afectada}>
                      {tableNameMap[audit.tabla_afectada] || audit.tabla_afectada}
                    </p>
                  </div>
                  <span className={`px-4 py-1.5 rounded-full text-xs font-semibold border ${audit.accion === 'CREATE' ? 'bg-green-50 dark:bg-green-500/10 text-black dark:text-white/90 border-green-200 dark:border-green-500/30' :
                    audit.accion === 'UPDATE' ? 'bg-primary/10 text-primary border-primary/30' :
                      audit.accion === 'DELETE' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30' :
                        'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30'
                    }`}>
                    {audit.accion}
                  </span>
                </div>

                <div className="space-y-2 mb-5">
                  <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                    <FontAwesomeIcon icon={faCalendarAlt} className="w-3.5 h-3.5 text-primary" />
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Fecha</span>
                      <span className="text-xs font-semibold">{new Date(audit.fecha).toLocaleString('es-ES')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end pt-4 border-t border-slate-100 dark:border-slate-700/50 gap-2">
                  <button
                    onClick={() => handleViewDetails(audit)}
                    className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors text-xs font-bold flex items-center gap-2"
                  >
                    <FontAwesomeIcon icon={faEye} className="w-4 h-4" /> Ver detalle
                  </button>
                </div>
              </div>
            ))}
            {visibleItems < logs.length && (
              <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
              </div>
            )}
          </div>
        ) : (
          /* Vista PC - Tabla */
          <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
            <div ref={tableWrapperRef} className="flex-1 overflow-hidden">
              <table className="w-full text-sm text-left relative">
                <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                  <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                    <th onClick={() => requestSort('username')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                      <div className="flex items-center justify-center gap-2">
                        <span>Usuario</span>
                        {getSortIcon('username')}
                      </div>
                    </th>
                    <th onClick={() => requestSort('accion')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                      <div className="flex items-center justify-center gap-2">
                        <span>Acción</span>
                        {getSortIcon('accion')}
                      </div>
                    </th>
                    <th onClick={() => requestSort('tabla_afectada')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                      <div className="flex items-center justify-center gap-2">
                        <span>Tabla</span>
                        {getSortIcon('tabla_afectada')}
                      </div>
                    </th>
                    <th onClick={() => requestSort('fecha')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                      <div className="flex items-center justify-center gap-2">
                        <span>Fecha</span>
                        {getSortIcon('fecha')}
                      </div>
                    </th>
                    <th className="pb-3 px-4 text-center">Opciones</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.map((audit) => (
                    <tr
                      key={audit.id_auditoria}
                      style={rowHeight != null ? { height: `${rowHeight}px` } : undefined}
                      className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                        <span
                          className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                          title={audit.username || 'Sistema'}
                        >
                          {audit.username || 'Sistema'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex justify-center">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${audit.accion === 'CREATE' ? 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400' :
                            audit.accion === 'UPDATE' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                              audit.accion === 'DELETE' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' :
                                'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}>
                            {audit.accion}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-300">
                        {tableNameMap[audit.tabla_afectada] || audit.tabla_afectada}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-300">
                        {new Date(audit.fecha).toLocaleString('es-ES')}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => handleViewDetails(audit)}
                            title="Ver detalle"
                            className="p-2 text-slate-400 hover:text-primary hover:bg-primary/10 dark:hover:bg-primary/20 rounded-lg transition-colors"
                          >
                            <FontAwesomeIcon icon={faEye} className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="select-none flex items-center justify-between px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 rounded-b-2xl shrink-0">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Página <span className="font-bold text-slate-700 dark:text-slate-200">{currentPage}</span> de {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                            ? 'bg-[#E5007D] text-white shadow-lg shadow-pink-600/30'
                            : 'hover:bg-white hover:shadow-lg hover:shadow-pink-600/25 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300'
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
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
        )}
      </div>

      {/* Modal */}
      <DetailModal
        audit={selectedAudit}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        darkMode={darkMode}
      />
    </div>
  );
}
