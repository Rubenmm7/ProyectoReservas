import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useSocket } from '../hooks/useSocket';
import { useReservationRealtimeNotifications } from '../hooks/useReservationRealtimeNotifications';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt, faClock, faChevronLeft, faChevronRight, faCheck, faTimes, faFile, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { isVehicleReservable, isNonTerminalReservationStatus, normalizeVehicleStatus, getDesiredVehicleStatusForReservations } from '../utils/statusConcordance';
import { planReservationTimeBasedUpdates } from '../utils/reservationAutoStatus';
import { parseMySqlDateTime } from '../utils/dateTime';
import {
    matchesSearchableFields,
    getUserCentreIds,
    isVehicleInUserCentres,
    hasBlockingReservationForVehicle,
    hasDeliveryBeenSubmitted,
    isEmployeeLikeUser,
    isAdminOrSupervisorUser,
    canOpenDeliveryForm,
    formatDate,
    getDefaultReservationStart,
    getDefaultReservationEnd,
    toLocalISOString,
    formatTimeUnit,
} from '../utils/reservationsViewHelpers';
import MonthYearPicker from './MonthYearPicker';
import TimeValueSelect from './TimeValueSelect';
import DeliveryReservationCard from './DeliveryReservationCard';

const INITIAL_FORM_STATE = { user_id: '', centre_id: '', vehicle_id: '', start_time: '', end_time: '', status: 'pendiente' };
const RESERVATION_STATUS_OPTIONS = ['pendiente', 'aprobada', 'activa', 'finalizada', 'rechazada'];
const RESERVATION_STATUS_ORDER = ['rechazada', 'finalizada', 'activa', 'aprobada', 'pendiente'];
const STATUS_STYLES = {
    'aprobada': 'bg-green-100 text-black border border-green-200 dark:bg-green-500/20 dark:text-white/90 dark:border-green-500/30',
    'activa': 'bg-blue-100 text-black border border-blue-200 dark:bg-blue-500/20 dark:text-white/90 dark:border-blue-500/30',
    'finalizada': 'bg-violet-100 text-black border border-violet-200 dark:bg-violet-500/20 dark:text-white/90 dark:border-violet-500/30',
    'rechazada': 'bg-red-100 text-black border border-red-200 dark:bg-red-500/20 dark:text-white/90 dark:border-red-500/30',
    'pendiente': 'bg-amber-100 text-black border border-amber-200 dark:bg-amber-500/20 dark:text-white/90 dark:border-amber-500/30',
    'fecha': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const formatVehicleLabel = (vehicle = {}, includePlate = true) => {
    const brand = String(vehicle?.brand ?? '').trim();
    const model = String(vehicle?.model ?? '').trim();
    const plate = String(vehicle?.license_plate ?? '').trim();
    const name = [brand, model].filter(Boolean).join(' / ') || model || brand || 'Vehículo';
    return includePlate && plate ? `${name} (${plate})` : name;
};




// ── CUSTOM DATE TIME PICKER COMPONENT ──
const CustomDateTimePicker = ({ value, onChange, label, align = "left", disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMonthYearPickerOpen, setIsMonthYearPickerOpen] = useState(false);
    const containerRef = useRef(null);
    const panelRef = useRef(null);
    const [panelStyle, setPanelStyle] = useState(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (panelRef.current && panelRef.current.contains(e.target)) return;
            if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen || typeof window === 'undefined') return;

        const updatePanelPosition = () => {
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const panelWidth = 280;
            const gap = 10;
            const estimatedHeight = 390;
            const spaceBelow = window.innerHeight - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

            const nextStyle = {
                position: 'fixed',
                zIndex: 10050,
                width: `${panelWidth}px`,
                maxHeight: 'calc(100vh - 32px)',
                overflow: 'auto',
                top: placeAbove ? 'auto' : `${Math.min(rect.bottom + gap, window.innerHeight - 16)}px`,
                bottom: placeAbove ? `${Math.max(window.innerHeight - rect.top + gap, 16)}px` : 'auto',
                left: align === 'right' ? 'auto' : `${Math.max(16, Math.min(rect.left, window.innerWidth - panelWidth - 16))}px`,
                right: align === 'right' ? `${Math.max(16, window.innerWidth - rect.right)}px` : 'auto',
            };

            setPanelStyle(nextStyle);
        };

        updatePanelPosition();
        window.addEventListener('resize', updatePanelPosition);
        document.addEventListener('scroll', updatePanelPosition, true);

        return () => {
            window.removeEventListener('resize', updatePanelPosition);
            document.removeEventListener('scroll', updatePanelPosition, true);
        };
    }, [isOpen, align]);

    const selectedDate = value ? (parseMySqlDateTime(value) ?? new Date()) : new Date();
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
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">{label}</label>
                <div
                    onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 transition-all w-full
                        ${disabled ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 opacity-70 cursor-not-allowed' : (isOpen ? 'ring-4 ring-primary/10 border-primary bg-white dark:bg-slate-800 cursor-pointer shadow-md' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:shadow-md cursor-pointer')}`}
                >
                    <FontAwesomeIcon icon={faCalendarAlt} className="text-primary text-sm" />
                    <span className={`text-sm font-medium ${value ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                        {value ? formatDate(value) : "DD/MM/AAAA"}
                    </span>
                </div>
            </div>

            {isOpen && (
                <div className={`absolute z-[110] mt-2 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-[280px] ${align === "right" ? "right-0" : "left-0"}`}>
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4 px-1">
                        <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-500 transition-colors">
                            <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsMonthYearPickerOpen(true)}
                            className="font-bold text-sm text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                            {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
                        </button>
                        <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-500 transition-colors">
                            <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
                        </button>
                    </div>

                    {/* Weekdays */}
                    <div className="grid grid-cols-7 gap-1 mb-2 text-center text-[10px] font-bold text-slate-400 uppercase">
                        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <span key={d}>{d}</span>)}
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1 mb-5">
                        {days.map((day, i) => (
                            day ? (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                        const nd = new Date(selectedDate);
                                        nd.setFullYear(viewDate.getFullYear(), viewDate.getMonth(), day);
                                        onChange(toLocalISOString(nd));
                                    }}
                                    className={`aspect-square rounded-xl text-xs font-bold flex items-center justify-center transition-all
                                        ${selectedDate.getDate() === day && selectedDate.getMonth() === viewDate.getMonth() && selectedDate.getFullYear() === viewDate.getFullYear()
                                            ? 'bg-primary text-white shadow-lg shadow-primary/30'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                >
                                    {day}
                                </button>
                            ) : <div key={i} />
                        ))}
                    </div>

                    <div className="h-px bg-slate-100 dark:bg-slate-700 mb-5" />

                    {/* Time Selection */}
                    <div className="flex items-center gap-4 mb-5">
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
                        <span className="mt-5 font-bold text-slate-300 dark:text-slate-600">:</span>
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
                        className="w-full py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:brightness-95 transition-all"
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

export default function ReservationsView({
    shouldOpenAddModal,
    onAddModalOpened,
    reservationToEdit,
    onEditModalOpened,
    reservationToDeleteId,
    onDeleteActionHandled,
    onDeliverReservation,
    submittedDeliveryIds = [],
    headless = false,
    allowPageFlow = false,
    onOperationComplete,
    enableRealtimeNotifications = true,
}) {
    const recentlyCreatedByMeRef = useRef(new Set());
    const isMobile = useIsMobile();
    const { currentUser } = useCurrentUser();
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal/Form State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingId, setEditingId] = useState(null);
    const [formLoading, setFormLoading] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState(null);
    const [deliveryReservation, setDeliveryReservation] = useState(null);
    const [deliverySubmitting, setDeliverySubmitting] = useState(false);
    const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);

    // Modal de rechazo con motivo
    const [rejectModalReservation, setRejectModalReservation] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectLoading, setRejectLoading] = useState(false);
    const [viewingReason, setViewingReason] = useState(null);
    const renderToBody = (node) => (
        typeof document !== 'undefined' ? createPortal(node, document.body) : null
    );
    const isEmployeeLike = isEmployeeLikeUser(currentUser);
    const shouldKeepHeaderVisible = headless && isMobile && isEmployeeLike;
    const shouldPortalDesktopOverlays = true; // Aplicar a todos los roles
    const renderOverlay = (node) => renderToBody(node);

    // Trigger: Agregar nueva
    useEffect(() => {
        if (shouldOpenAddModal) {
            handleOpenModal();
            if (onAddModalOpened) onAddModalOpened();
        }
    }, [shouldOpenAddModal]);

    // Trigger: Editar existente
    useEffect(() => {
        if (reservationToEdit) {
            handleOpenModal(reservationToEdit);
            if (onEditModalOpened) onEditModalOpened();
        }
    }, [reservationToEdit]);

    // Trigger: Borrar existente
    useEffect(() => {
        if (reservationToDeleteId) {
            handleDeleteClick(reservationToDeleteId);
            if (onDeleteActionHandled) onDeleteActionHandled();
        }
    }, [reservationToDeleteId]);

    // Bloquear scroll de fondo (incluyendo pull-down en móvil) al abrir modal
    useEffect(() => {
        const shouldLock = isModalOpen || deleteId || isDeliveryModalOpen;
        if (!shouldLock || typeof window === 'undefined') return;

        const body = document.body;
        const html = document.documentElement;
        const scrollY = window.scrollY;

        const prevStyles = {
            bodyOverflow: body.style.overflow,
            bodyPosition: body.style.position,
            bodyTop: body.style.top,
            bodyWidth: body.style.width,
            bodyOverscrollBehavior: body.style.overscrollBehavior,
            htmlOverflow: html.style.overflow,
            htmlOverscrollBehavior: html.style.overscrollBehavior,
        };

        html.style.overflow = 'hidden';
        html.style.overscrollBehavior = 'none';
        body.style.overflow = 'hidden';
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.width = '100%';
        body.style.overscrollBehavior = 'none';

        return () => {
            html.style.overflow = prevStyles.htmlOverflow;
            html.style.overscrollBehavior = prevStyles.htmlOverscrollBehavior;
            body.style.overflow = prevStyles.bodyOverflow;
            body.style.position = prevStyles.bodyPosition;
            body.style.top = prevStyles.bodyTop;
            body.style.width = prevStyles.bodyWidth;
            body.style.overscrollBehavior = prevStyles.bodyOverscrollBehavior;
            window.scrollTo(0, scrollY);
        };
    }, [isModalOpen, deleteId, isDeliveryModalOpen]);

    // Select Options State
    const [usersList, setUsersList] = useState([]);
    const [centresList, setCentresList] = useState([]);
    const [vehiclesList, setVehiclesList] = useState([]);
    const [isVehicleDropdownOpen, setIsVehicleDropdownOpen] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isCentreDropdownOpen, setIsCentreDropdownOpen] = useState(false);
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
    const vehicleDropdownRef = useRef(null);
    const userDropdownRef = useRef(null);
    const centreDropdownRef = useRef(null);
    const statusDropdownRef = useRef(null);

    // Search states for dropdowns
    const [userSearchTermDropdown, setUserSearchTermDropdown] = useState('');
    const [vehicleSearchTermDropdown, setVehicleSearchTermDropdown] = useState('');
    const [centreSearchTermDropdown, setCentreSearchTermDropdown] = useState('');

    // Sorting & Filter State
    const [sortConfig, setSortConfig] = useState({ key: 'upcoming_start_time', direction: 'asc' });
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [reservationStatusCounts, setReservationStatusCounts] = useState({
        pendiente: 0,
        aprobada: 0,
        activa: 0,
        finalizada: 0,
        rechazada: 0,
    });
    const currentUserCentreIds = useMemo(() => getUserCentreIds(currentUser), [currentUser]);
    const isAdminSupervisor = isAdminOrSupervisorUser(currentUser);
    const shouldShowLocalSuccessToasts = currentUser?.role !== 'supervisor';
    const selectedBookingUser = useMemo(() => {
        if (isAdminSupervisor) {
            return usersList.find((user) => String(user.id) === String(formData.user_id)) || null;
        }
        return currentUser || null;
    }, [currentUser, formData.user_id, isAdminSupervisor, usersList]);
    const selectedBookingUserCentreIds = useMemo(() => getUserCentreIds(selectedBookingUser), [selectedBookingUser]);
    const bookingCentreId = String(formData.centre_id ?? '');
    const bookingHasCentreSelection = (selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0) || selectedBookingUserCentreIds.length > 1;
    const bookingResolvedCentreIds = useMemo(() => {
        if (selectedBookingUserCentreIds.length === 0) {
            return bookingCentreId ? [bookingCentreId] : [];
        }
        if (selectedBookingUserCentreIds.length === 1) return selectedBookingUserCentreIds;
        if (!bookingCentreId) return [];
        return selectedBookingUserCentreIds.includes(bookingCentreId) ? [bookingCentreId] : [];
    }, [bookingCentreId, selectedBookingUserCentreIds]);
    const bookingAllowedCentreIds = useMemo(() => {
        if (selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0) return centresList.map((centre) => String(centre.id));
        return selectedBookingUserCentreIds;
    }, [centresList, selectedBookingUser, selectedBookingUserCentreIds]);
    const bookingCentreOptions = useMemo(() => {
        if (selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0) return centresList;
        if (bookingAllowedCentreIds.length === 0) return [];
        return centresList.filter((centre) => bookingAllowedCentreIds.includes(String(centre.id)));
    }, [bookingAllowedCentreIds, centresList, selectedBookingUser, selectedBookingUserCentreIds]);
    const createWizard = useMemo(() => {
        if (isAdminSupervisor) {
            return bookingHasCentreSelection
                ? { user: 1, centre: 2, dates: 3, vehicle: 4, total: 4, hasCentreSelection: true }
                : { user: 1, dates: 2, vehicle: 3, total: 3, hasCentreSelection: false };
        }
        return bookingHasCentreSelection
            ? { centre: 1, dates: 2, vehicle: 3, total: 3, hasCentreSelection: true }
            : { dates: 1, vehicle: 2, total: 2, hasCentreSelection: false };
    }, [bookingHasCentreSelection, isAdminSupervisor]);
    const showCreateUserStep = !editingId && isAdminSupervisor && wizardStep === createWizard.user;
    const showCreateCentreStep = !editingId && bookingHasCentreSelection && wizardStep === createWizard.centre;
    const showCreateDatesStep = !editingId && wizardStep === createWizard.dates;
    const showCreateVehicleStep = !editingId && wizardStep === createWizard.vehicle;

    // Paginación y Scroll Infinito
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 7;
    const [visibleItems, setVisibleItems] = useState(7);
    const [totalRecords, setTotalRecords] = useState(0);
    const [serverTotalPages, setServerTotalPages] = useState(0);
    const scrollObserverRef = useRef(null);
    const loadingPagesRef = useRef(new Set());
    const hasMountedRef = useRef(false);
    const hasSortMountedRef = useRef(false);

    // Paginación para la tabla de vehículos reservados DENTRO del modal
    const [currentModalPage, setCurrentModalPage] = useState(1);
    const itemsPerModalPage = 10;

    const sortedReservations = useMemo(() => {
        if (isEmployeeLikeUser(currentUser)) {
            return reservations.filter(r => r.user_id === currentUser.id);
        }
        return reservations;
    }, [reservations, currentUser]);

    // Datos paginados
    const totalPages = serverTotalPages || Math.ceil(totalRecords / itemsPerPage) || 1;
    const paginatedReservations = isMobile
        ? sortedReservations.slice(0, visibleItems)
        : sortedReservations;
    const shouldStretchRows = !isMobile && paginatedReservations.length === itemsPerPage;
    const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
        rowCount: paginatedReservations.length,
        enabled: shouldStretchRows,
    });

    const filteredUsersList = useMemo(() => (
        usersList.filter((user) =>
            matchesSearchableFields(user, userSearchTermDropdown, ['username', 'name', 'full_name', 'first_name', 'last_name', 'role'])
        )
    ), [usersList, userSearchTermDropdown]);

    const filteredVehiclesList = useMemo(() => (
        vehiclesList.filter((vehicle) =>
            matchesSearchableFields(vehicle, vehicleSearchTermDropdown, ['license_plate', 'model', 'brand', 'marca'])
        )
    ), [vehiclesList, vehicleSearchTermDropdown]);

    const filteredCentresList = useMemo(() => (
        bookingCentreOptions.filter((centre) =>
            matchesSearchableFields(centre, centreSearchTermDropdown, ['nombre', 'name', 'codigo', 'code'])
        )
    ), [bookingCentreOptions, centreSearchTermDropdown]);

    // Opciones de centro específicas para edición: solo los centros del usuario seleccionado
    const editCentreOptions = useMemo(() => {
        if (!editingId) return [];
        // Para admin sin centros asignados, mostrar todos los centros
        if (selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0) return centresList;
        if (selectedBookingUserCentreIds.length === 0) return [];
        return centresList.filter((centre) => selectedBookingUserCentreIds.includes(String(centre.id)));
    }, [editingId, selectedBookingUser, selectedBookingUserCentreIds, centresList]);

    const filteredEditCentresList = useMemo(() => (
        editCentreOptions.filter((centre) =>
            matchesSearchableFields(centre, centreSearchTermDropdown, ['nombre', 'name', 'codigo', 'code'])
        )
    ), [editCentreOptions, centreSearchTermDropdown]);

    const editHasMultipleCentres = editCentreOptions.length > 1;
    const editCentreDisplayName = useMemo(() => {
        if (!formData.centre_id) return '';
        const found = centresList.find((c) => String(c.id) === String(formData.centre_id));
        return found?.nombre || '';
    }, [formData.centre_id, centresList]);

    // Lógica para la tabla de reservas activas en el modal
    const activeModalReservations = useMemo(() =>
        reservations.filter(r => isNonTerminalReservationStatus(r.status)),
        [reservations]
    );
    const totalModalPages = Math.ceil(activeModalReservations.length / itemsPerModalPage);
    const paginatedModalReservations = useMemo(() =>
        activeModalReservations.slice((currentModalPage - 1) * itemsPerModalPage, currentModalPage * itemsPerModalPage),
        [activeModalReservations, currentModalPage]
    );

    const isSelectableVehicle = (vehicle) => {
        const selectedVehicleId = String(formData.vehicle_id ?? '');
        if (selectedVehicleId && String(vehicle?.id) === selectedVehicleId) return true;
        return isVehicleReservable(vehicle?.status) && !hasBlockingReservationForVehicle(reservations, vehicle?.id, editingId);
    };

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        const isActiveKey = sortConfig && (
            sortConfig.key === key ||
            (key === 'start_time' && sortConfig.key === 'upcoming_start_time')
        );

        if (!isActiveKey) {
            return (
                <svg className="w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
            );
        }

        const isAscending = sortConfig.key === 'upcoming_start_time'
            ? true
            : sortConfig.direction === 'asc';

        return isAscending ? (
            <svg className="w-3 h-3 ml-1 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7" />
            </svg>
        ) : (
            <svg className="w-3 h-3 ml-1 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" />
            </svg>
        );
    };

    const cycleStatusFilter = () => {
        const availableStatuses = RESERVATION_STATUS_ORDER.filter((status) => Number(reservationStatusCounts?.[status] || 0) > 0);
        if (availableStatuses.length === 0) {
            setFilterStatus('');
            return;
        }

        setFilterStatus((prev) => {
            if (!prev) return availableStatuses[0];
            const currentIndex = RESERVATION_STATUS_ORDER.indexOf(prev);
            const nextStatus = availableStatuses.find((status) => RESERVATION_STATUS_ORDER.indexOf(status) > currentIndex);
            return nextStatus || '';
        });
    };

    const updateReservationStatus = async (reservation, status) => {
        if (!reservation?.id) return false;

        const response = await fetch(`/api/dashboard/reservations/${reservation.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status,
                // No enviamos el resto de campos para evitar conflictos de validación
            })
        });

        return response.ok;
    };

    const updateVehicleStatus = async (vehicle, status) => {
        if (!vehicle?.id) return false;

        const response = await fetch(`/api/dashboard/vehicles/${vehicle.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...vehicle,
                status,
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
            // eslint-disable-next-line no-await-in-loop
            const ok = await updateReservationStatus(u.reservation, u.newStatus);
            if (!ok) continue;

            const idx = next.findIndex(r => String(r.id) === String(u.reservation.id));
            if (idx === -1) continue;

            next[idx] = { ...next[idx], status: u.newStatus };
            changed = true;
        }

        return changed ? next : reservationsList;
    };

    const syncVehicleStatusesFromReservations = async (reservationsList) => {
        try {
            const response = await fetch('/api/dashboard/vehicles');

            if (!response.ok) return false;

            const vehicles = await response.json();
            const list = Array.isArray(vehicles) ? vehicles : [];
            // No sincronizar vehículos en estados terminales (finales)
            // Estos estados solo deben cambiar por acción explícita del usuario
            const updates = list
                .filter((vehicle) => {
                    const s = normalizeVehicleStatus(vehicle?.status);
                    // Excluir estados terminales: pendiente-validacion, formulario-entrega-pendiente, no-disponible
                    if (s === 'pendiente-validacion' || s === 'formulario-entrega-pendiente' || s === 'no-disponible') return false;
                    return true;
                })
                .map((vehicle) => ({
                    vehicle,
                    desiredStatus: getDesiredVehicleStatusForReservations(vehicle, reservationsList),
                }))
                .filter(({ vehicle, desiredStatus }) =>
                    desiredStatus && normalizeVehicleStatus(vehicle?.status) !== desiredStatus
                );

            if (updates.length === 0) return false;

            await Promise.all(updates.map(({ vehicle, desiredStatus }) =>
                updateVehicleStatus(vehicle, desiredStatus)
            )); return true;
        } catch (error) {
            return false;
        }
    };

    const fetchReservations = async (skipVehicleSync = false, page = 1, append = false) => {
        if (loadingPagesRef.current.has(page)) return;
        loadingPagesRef.current.add(page);
        try {
            const syncPart = skipVehicleSync ? '&sync=false' : '';
            const searchParam = searchTerm.trim() ? `&search=${encodeURIComponent(searchTerm.trim())}` : '';
            const startParam = filterStartDate ? `&startDate=${encodeURIComponent(filterStartDate)}` : '';
            const endParam = filterEndDate ? `&endDate=${encodeURIComponent(filterEndDate)}` : '';
            const statusParam = filterStatus ? `&statusFilter=${encodeURIComponent(filterStatus)}` : '';
            const sortParam = sortConfig ? `&sortBy=${sortConfig.key}&sortDir=${sortConfig.direction}` : '';
            const response = await fetch(`/api/dashboard/reservations?page=${page}&limit=7${syncPart}${searchParam}${startParam}${endParam}${statusParam}${sortParam}`);
            if (response.ok) {
                const data = await response.json();
                const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
                const synced = list;
                const responseStatusCounts = data?.pagination?.statusCounts || {};
                setReservationStatusCounts({
                    pendiente: Number(responseStatusCounts.pendiente || 0),
                    aprobada: Number(responseStatusCounts.aprobada || 0),
                    activa: Number(responseStatusCounts.activa || 0),
                    finalizada: Number(responseStatusCounts.finalizada || 0),
                    rechazada: Number(responseStatusCounts.rechazada || 0),
                });
                const hasOtherFiltersActive = Boolean(searchTerm.trim() || filterStartDate || filterEndDate);
                if (!append && filterStatus && !hasOtherFiltersActive && synced.length === 0) {
                    const currentIndex = RESERVATION_STATUS_ORDER.indexOf(filterStatus);
                    const availableStatuses = RESERVATION_STATUS_ORDER.filter((status) => Number(responseStatusCounts?.[status] || 0) > 0);
                    const nextStatus = availableStatuses.find((status) => {
                        if (currentIndex === -1) return true;
                        return RESERVATION_STATUS_ORDER.indexOf(status) > currentIndex;
                    }) || availableStatuses[0] || '';

                    if (nextStatus && nextStatus !== filterStatus) {
                        setFilterStatus(nextStatus);
                    } else {
                        setFilterStatus('');
                    }
                    return;
                }
                if (!skipVehicleSync && isAdminSupervisor) {
                    await syncVehicleStatusesFromReservations(synced);
                }
                setReservations(prev => append ? [...prev, ...synced] : synced);
                setTotalRecords(Number(data?.pagination?.totalRecords || synced.length));
                setServerTotalPages(Number(data?.pagination?.totalPages || 1));
                if (isModalOpen) {
                    await fetchOptions(formData.start_time || null, formData.end_time || null, editingId, append ? [...reservations, ...synced] : synced);
                }
            } else {
                setReservations([]);
            }
        } catch (error) {
            setReservations([]);
        } finally {
            setLoading(false);
            loadingPagesRef.current.delete(page);
        }
    };

    const fetchCentres = async () => {
        try {
            const response = await fetch('/api/dashboard/centres');

            if (!response.ok) {
                setCentresList([]);
                return;
            }

            const data = await response.json();
            setCentresList(Array.isArray(data) ? data : []);
        } catch (error) {
            setCentresList([]);
        }
    };

    const fetchOptions = async (start = null, end = null, excludeResId = null, reservationsOverride = reservations) => {
        const reservationsSource = Array.isArray(reservationsOverride) ? reservationsOverride : [];
        try {
            let vehiclesUrl = '/api/dashboard/vehicles';
            const params = new URLSearchParams();
            if (start) params.append('start', start);
            if (end) params.append('end', end);
            if (excludeResId) params.append('excludeRes', excludeResId);
            if (params.toString()) {
                vehiclesUrl += `?${params.toString()}`;
            }

            const headers = {};
            const centreFilterIds = bookingResolvedCentreIds.length > 0 ? bookingResolvedCentreIds : selectedBookingUserCentreIds;

            const filterVehiclesByCentre = (vehiclesData) => (Array.isArray(vehiclesData) ? vehiclesData : []).filter((v) => {
                const isSelectedVehicle = String(formData.vehicle_id ?? '') && String(v.id) === String(formData.vehicle_id ?? '');
                const isAccessibleVehicle =
                    isVehicleReservable(v.status) &&
                    !hasBlockingReservationForVehicle(reservationsSource, v.id, excludeResId);

                if (isAdminSupervisor && selectedBookingUserCentreIds.length === 0 && !formData.centre_id) {
                    return isSelectedVehicle || isAccessibleVehicle;
                }

                if (centreFilterIds.length === 0) return isSelectedVehicle;

                return isSelectedVehicle || (
                    isAccessibleVehicle &&
                    isVehicleInUserCentres(v, centreFilterIds)
                );
            });

            // Si es admin/supervisor, necesitamos la lista de usuarios. El centro lo resuelve el flujo del modal.
            if (isAdminSupervisor) {
                const [usersRes, vehiclesRes] = await Promise.all([
                    fetch('/api/dashboard/users', { headers }),
                    fetch(vehiclesUrl, { headers })
                ]);
                const usersData = usersRes.ok ? await usersRes.json() : [];
                const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : [];

                setUsersList(Array.isArray(usersData) ? usersData : []);
                setVehiclesList(filterVehiclesByCentre(vehiclesData));
            }
            else {
                const vehiclesRes = await fetch(vehiclesUrl, { headers });
                const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : [];
                setUsersList([currentUser]);
                setVehiclesList(filterVehiclesByCentre(vehiclesData));
            }
        } catch (error) {
            setVehiclesList([]);
            setUsersList([currentUser]);
        }
    };

    useEffect(() => {
        fetchCentres();
        fetchReservations();
        fetchOptions();

        // Exponer función global para refrescar sin sincronizar vehículos (usado cuando se elimina validación)
        window.refreshReservationsNoSync = () => fetchReservations(true);

        // Comprobación periódica (cada 30s) para activar reservas cuando llega su hora
        // y marcarlas como finalizadas cuando superan su fecha fin.
        const intervalId = setInterval(() => {
            fetchReservations();
        }, 30000);

        // Cerrar dropdown al hacer click fuera
        const handleClickOutside = (event) => {
            if (vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(event.target)) {
                setIsVehicleDropdownOpen(false);
            }
            if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
                setIsUserDropdownOpen(false);
            }
            if (centreDropdownRef.current && !centreDropdownRef.current.contains(event.target)) {
                setIsCentreDropdownOpen(false);
            }
            if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
                setIsStatusDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Socket listeners para notificaciones en tiempo real
    const { socket, isConnected } = useSocket();
    const shouldEnableRealtime = enableRealtimeNotifications && currentUser?.role !== 'supervisor';
    useReservationRealtimeNotifications({
        socket,
        isConnected,
        currentUser,
        enabled: shouldEnableRealtime,
        onNewReservation: (reservation, meta) => {
            if (meta.isSupervisor) return;
            if (!meta.isOwnReservation) return;
            if (recentlyCreatedByMeRef.current.has(String(reservation.id))) return;
            setReservations((prev) => {
                const alreadyExists = prev.some((r) => String(r.id) === String(reservation.id));
                if (alreadyExists) return prev;
                return [reservation, ...prev];
            });
            fetchReservations();
        },
        onUpdatedReservation: (reservation, meta) => {
            if (meta.isSupervisor) return;
            if (recentlyCreatedByMeRef.current.has(String(reservation.id))) return;
            if (reservation.status === 'finalizada') {
                fetchReservations();
                return;
            }
            if (!meta.isOwnReservation) return;
            fetchReservations();
        },
        onDeletedReservation: (data, meta) => {
            if (meta.isSupervisor) return;
            setReservations((prev) => prev.filter((r) => String(r.id) !== String(data.id)));
            fetchReservations();
        },
    });

    useEffect(() => {
        setReservations([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchCentres();
        fetchReservations();
        fetchOptions();
    }, [
        currentUser?.id,
        currentUser?.role,
        currentUserCentreIds.join('|'),
    ]);

    // Re-fetch cuando cambia la búsqueda (búsqueda en servidor)
    useEffect(() => {
        setReservations([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchReservations(false, 1, false);
    }, [searchTerm]);

    // Re-fetch en servidor cuando cambian filtros de fecha
    useEffect(() => {
        setReservations([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchReservations(false, 1, false);
    }, [filterStartDate, filterEndDate]);

    // Re-fetch cuando cambia el filtro de estado
    useEffect(() => {
        setReservations([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchReservations(false, 1, false);
    }, [filterStatus]);

    // Re-fetch cuando cambia la ordenación (ordenación server-side)
    useEffect(() => {
        if (!sortConfig) return;
        if (!hasSortMountedRef.current) {
            hasSortMountedRef.current = true;
            return;
        }
        setReservations([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchReservations(false, 1, false);
    }, [sortConfig]);

    // Cargar nueva página al navegar (incluido volver a página 1)
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        fetchReservations(false, currentPage, isMobile);
    }, [currentPage, isMobile]);

    // Reiniciar paginación del modal al abrirlo o cambiar de paso
    useEffect(() => {
        if (isModalOpen) {
            setCurrentModalPage(1);
        }
    }, [isModalOpen, wizardStep]);

    // Observer para scroll infinito en móvil
    useEffect(() => {
        if (!isMobile) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    if (visibleItems < reservations.length) {
                        setVisibleItems((prev) => prev + 8);
                    } else if (currentPage < totalPages) {
                        const nextPage = currentPage + 1;
                        setCurrentPage(nextPage);
                        fetchReservations(false, nextPage, true);
                    }
                }
            },
            { threshold: 0.1 }
        );

        if (scrollObserverRef.current) {
            observer.observe(scrollObserverRef.current);
        }

        return () => observer.disconnect();
    }, [isMobile, visibleItems, reservations.length, currentPage, totalPages]);

    const handleQuickApprove = async (r) => {
        const ok = await updateReservationStatus(r, 'aprobada');
        if (ok) {
            await fetchReservations();
        } else {
            toast.error('Error al aprobar reserva');
        }
    };

    const handleOpenRejectModal = (r) => {
        setRejectModalReservation(r);
        setRejectReason('');
    };

    const handleConfirmReject = async () => {
        if (!rejectModalReservation) return;
        setRejectLoading(true);
        try {
            const response = await fetch(`/api/dashboard/reservations/${rejectModalReservation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'rechazada',
                    motivo_rechazo: rejectReason.trim() || null,
                }),
            });
            if (response.ok) {
                toast.success('Reserva rechazada');
                setRejectModalReservation(null);
                setRejectReason('');
                await fetchReservations();
            } else {
                toast.error('Error al rechazar la reserva');
            }
        } catch {
            toast.error('Error al rechazar la reserva');
        } finally {
            setRejectLoading(false);
        }
    };

    // Kept for compatibility (used in some inline flows)
    const handleQuickReject = (r) => handleOpenRejectModal(r);

    // Actualizar vehículos disponibles cuando cambian las fechas en el formulario
    useEffect(() => {
        if (isModalOpen) {
            fetchOptions(formData.start_time || null, formData.end_time || null, editingId);
        }
    }, [isModalOpen, formData.start_time, formData.end_time, formData.user_id, formData.centre_id, editingId, bookingResolvedCentreIds.join('|')]);


    useEffect(() => {
        if (!isModalOpen) return;

        // Caso 1: Nuevo (o edición) y el usuario seleccionado solo tiene un centro.
        // Forzamos ese centro para que no llegue vacío al backend.
        if (selectedBookingUserCentreIds.length === 1) {
            const onlyCentreId = String(selectedBookingUserCentreIds[0]);
            if (String(formData.centre_id ?? '') !== onlyCentreId) {
                setFormData(prev => ({ ...prev, centre_id: onlyCentreId }));
            }
            return;
        }

        // Caso 2: Edición. Intentamos sincronizar con el vehículo actual o la reserva original.
        if (editingId) {
            const currentVehicle = vehiclesList.find(v => String(v.id) === String(formData.vehicle_id));
            if (currentVehicle?.centre_id !== undefined && currentVehicle?.centre_id !== null) {
                const nextCentreId = String(currentVehicle.centre_id);
                if (String(formData.centre_id ?? '') !== nextCentreId) {
                    setFormData(prev => ({ ...prev, centre_id: nextCentreId }));
                }
            }
            return;
        }
    }, [isModalOpen, editingId, formData.centre_id, formData.vehicle_id, selectedBookingUserCentreIds, vehiclesList]);


    const validateDateStep = () => {
        const start = parseMySqlDateTime(formData.start_time);
        const end = parseMySqlDateTime(formData.end_time);
        const now = new Date();

        if (!formData.start_time || !formData.end_time) {
            setError('Debes seleccionar fecha de inicio y fecha de fin');
            return false;
        }

        if (!start || !end) {
            setError('La fecha seleccionada no es válida');
            return false;
        }

        if (start >= end) {
            setError('La fecha de inicio debe ser anterior a la fecha de fin');
            return false;
        }

        if (start < now && isEmployeeLikeUser(currentUser)) {
            setError('La fecha de inicio no puede estar en el pasado');
            return false;
        }

        // Validación de solapamiento para el usuario seleccionado
        const hasOverlap = reservations.some((reservation) => {
            if (String(reservation.user_id) !== String(formData.user_id)) return false;
            if (reservation.status === 'rechazada' || reservation.status === 'finalizada') return false;
            if (editingId && String(reservation.id) === String(editingId)) return false;

            const rStart = parseMySqlDateTime(reservation.start_time);
            const rEnd = parseMySqlDateTime(reservation.end_time);
            if (!rStart || !rEnd) return false;
            return (start < rEnd && end > rStart);
        });

        if (hasOverlap) {
            setError('Este usuario ya tiene una reserva activa en este horario');
            return false;
        }

        return true;
    };

    const handleOpenModal = async (reservation = null) => {
        setError('');
        setWizardStep(1);
        if (reservation) {
            // Si el usuario es empleado y la reserva NO está en estado 'pendiente', no permitir editar
            if (isEmployeeLikeUser(currentUser) && reservation.status !== 'pendiente') {
                toast.error('Solo puedes editar reservas que estén pendientes');
                return;
            }

            const start = toLocalISOString(reservation.start_time);
            const end = toLocalISOString(reservation.end_time);
            const vehicleOfReservation = vehiclesList.find(v => String(v.id) === String(reservation.vehicle_id));
            const resolvedCentreId = String(
                vehicleOfReservation?.centre_id ?? reservation.centre_id ?? ''
            );

            setFormData({
                user_id: reservation.user_id,
                centre_id: resolvedCentreId,
                vehicle_id: reservation.vehicle_id,
                start_time: start,
                end_time: end,
                status: reservation.status,
                motivo_rechazo: reservation.motivo_rechazo || '',
                // Guardamos info extra para mostrar mientras carga la lista
                temp_vehicle_info: formatVehicleLabel(reservation)
            });
            setEditingId(reservation.id);
            // Cargar opciones excluyendo la reserva actual para que el vehículo actual aparezca en la lista
            await fetchOptions(start, end, reservation.id);
        } else {
            const defaultStart = getDefaultReservationStart();
            const defaultEnd = getDefaultReservationEnd(defaultStart);
            setFormData({
                ...INITIAL_FORM_STATE,
                user_id: isEmployeeLikeUser(currentUser) ? currentUser.id : '',
                start_time: toLocalISOString(defaultStart),
                end_time: toLocalISOString(defaultEnd)
            });
            setEditingId(null);
            await fetchOptions();
        }
        setUserSearchTermDropdown('');
        setVehicleSearchTermDropdown('');
        setCentreSearchTermDropdown('');
        setIsCentreDropdownOpen(false);
        setIsUserDropdownOpen(false);
        setIsVehicleDropdownOpen(false);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(INITIAL_FORM_STATE);
        setEditingId(null);
        setUserSearchTermDropdown('');
        setVehicleSearchTermDropdown('');
        setCentreSearchTermDropdown('');
        setIsCentreDropdownOpen(false);
        setIsUserDropdownOpen(false);
        setIsVehicleDropdownOpen(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setFormLoading(true);
        setError('');

        const isEditing = !!editingId;

        // Garantizar validación de fechas también como última línea de defensa
        if (!validateDateStep()) {
            setFormLoading(false);
            return;
        }

        if (selectedBookingUserCentreIds.length > 1 && !formData.centre_id) {
            setError('Selecciona un centro para continuar');
            setFormLoading(false);
            return;
        }

        const url = isEditing
            ? `/api/dashboard/reservations/${editingId}`
            : '/api/dashboard/reservations';

        try {
            if (isEditing || showCreateVehicleStep) {
                const originalReservation = isEditing
                    ? reservations.find(r => String(r.id) === String(editingId))
                    : null;

                // Si es edición y el vehículo es el mismo, no es necesario validar que esté en la lista
                const isSameVehicle = isEditing && originalReservation &&
                    String(originalReservation.vehicle_id) === String(formData.vehicle_id);
                const selectedVehicle = vehiclesList.find(v => String(v.id) === String(formData.vehicle_id));
                const selectedVehicleId = selectedVehicle?.id ?? formData.vehicle_id;
                const hasPendingReservation = hasBlockingReservationForVehicle(
                    reservations,
                    selectedVehicleId,
                    isEditing ? editingId : null
                );

                if (hasPendingReservation) {
                    throw new Error('Ese vehículo ya tiene una reserva pendiente, aprobada o activa.');
                }

                if (!isSameVehicle) {
                    if (!selectedVehicle) {
                        throw new Error('Selecciona un vehículo válido.');
                    }

                    const selectedVehicleStatus = normalizeVehicleStatus(selectedVehicle.status);

                    // Regla: solo se puede reservar un vehículo si está en "disponible"
                    if (selectedVehicleStatus !== 'disponible') {
                        if (isEmployeeLikeUser(currentUser) || formData.status !== 'rechazada') {
                            throw new Error('Solo se puede reservar un vehículo que esté en "disponible".');
                        }
                    }
                }
            }

            const response = await fetch(url, {
                method: isEditing ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al guardar la reserva');
            }

            // Registrar el ID para suprimir el toast del socket
            const savedId = String(data.id ?? editingId ?? '');
            if (savedId) {
                recentlyCreatedByMeRef.current.add(savedId);
                setTimeout(() => recentlyCreatedByMeRef.current.delete(savedId), 5000);
            }

            if (shouldShowLocalSuccessToasts) {
                toast.success(isEditing ? 'Reserva actualizada' : 'Reserva creada', {
                    duration: 4000
                });
            }

            await fetchReservations();
            handleCloseModal();

            if (onOperationComplete) onOperationComplete();
        } catch (err) {
            setError(err.message);
        } finally {
            setFormLoading(false);
        }
    };

    const handleDeleteClick = (id) => {
        setDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;
        const id = deleteId;
        setDeleteId(null);

        try {
            // Buscar la reserva que se va a eliminar para ver su estado
            const reservationToDelete = reservations.find(r => r.id === id);
            const isFinalized = reservationToDelete && String(reservationToDelete.status).toLowerCase() === 'finalizada';

            const res = await fetch(`/api/dashboard/reservations/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) throw new Error();

            // Eliminar de la lista local inmediatamente
            setReservations(prev => prev.filter(r => r.id !== id));

            // Si era una reserva finalizada, NO sincronizar estados de vehículos
            // porque eso cambiaría el estado del vehículo incorrectamente
            await fetchReservations(isFinalized);

            if (onOperationComplete) onOperationComplete();
            if (shouldShowLocalSuccessToasts) {
                toast.success('Reserva eliminada');
            }
        } catch {
            toast.error('Error al eliminar la reserva');
        }
    };

    const handleOpenDeliveryModal = (reservation) => {
        if (!canOpenDeliveryForm(reservation, currentUser, submittedDeliveryIds, typeof onDeliverReservation === 'function')) return;
        setDeliveryReservation(reservation);
        setIsDeliveryModalOpen(true);
    };

    const handleCloseDeliveryModal = () => {
        setIsDeliveryModalOpen(false);
        setDeliveryReservation(null);
    };

    const handleDeliverReservationFromModal = async ({ reservation, kmEntrega, estadoEntrega, informeEntrega, fotoContador }) => {
        if (!reservation?.id) return;
        if (typeof onDeliverReservation !== 'function') return;

        setDeliverySubmitting(true);
        try {
            // Registrar el ID para suprimir el toast del socket en caso de que llegue antes que la recarga
            if (reservation?.id) {
                recentlyCreatedByMeRef.current.add(String(reservation.id));
                setTimeout(() => recentlyCreatedByMeRef.current.delete(String(reservation.id)), 5000);
            }

            await onDeliverReservation({
                reservation,
                kmEntrega,
                estadoEntrega,
                informeEntrega,
                fotoContador,
            });
            await fetchReservations();
            handleCloseDeliveryModal();
        } catch (error) {
        } finally {
            setDeliverySubmitting(false);
        }
    };

    if (headless) {
        return (
            <>
                {isModalOpen && (
                    renderToBody(
                        <div className={`fixed left-0 right-0 bottom-0 ${shouldKeepHeaderVisible ? 'top-16 z-[55]' : 'top-0 z-[9999]'} flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay overscroll-none`}>
                            <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-[92vh] sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up overscroll-contain">
                                <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50 shrink-0">
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                        {editingId ? 'Editar reserva' : 'Añadir nueva reserva'}
                                    </h3>
                                    <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>

                                <div className="flex-1 flex flex-col min-h-0">
                                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar overscroll-contain">
                                        {error && (
                                            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800/50">
                                                {error}
                                            </div>
                                        )}

                                        {showCreateUserStep && (
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Seleccionar Usuario</label>
                                                <div className="relative" ref={userDropdownRef}>
                                                    <div className="relative flex items-center">
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar o seleccionar usuario..."
                                                            value={isUserDropdownOpen ? userSearchTermDropdown : (formData.user_id ? usersList.find(u => u.id == formData.user_id)?.username || '' : '')}
                                                            onChange={(e) => {
                                                                setUserSearchTermDropdown(e.target.value);
                                                                if (!isUserDropdownOpen) setIsUserDropdownOpen(true);
                                                            }}
                                                            onClick={() => setIsUserDropdownOpen(true)}
                                                            className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                        />
                                                        <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isUserDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </div>

                                                    {isUserDropdownOpen && (
                                                        <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                            <div className="max-h-[250px] overflow-y-auto custom-scrollbar p-1">
                                                                {filteredUsersList.length === 0 ? (
                                                                    <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay usuarios disponibles</div>
                                                                ) : (
                                                                    filteredUsersList.map(u => (
                                                                        <div
                                                                            key={u.id}
                                                                            onClick={() => {
                                                                                setFormData({ ...formData, user_id: u.id });
                                                                                setIsUserDropdownOpen(false);
                                                                            }}
                                                                            className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                                ${formData.user_id == u.id
                                                                                    ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                        >
                                                                            <span>{u.username} <span className={`text-[10px] ml-2 px-1.5 py-0.5 rounded-md uppercase border ${formData.user_id == u.id ? 'border-white/30 text-white/80' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-transparent'}`}></span></span>
                                                                            {formData.user_id == u.id && (
                                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                                </svg>
                                                                            )}
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Paginación de la tabla del modal */}
                                                {totalModalPages > 1 && (
                                                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-700/50">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentModalPage(prev => Math.max(1, prev - 1))}
                                                            disabled={currentModalPage === 1}
                                                            className="p-1 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1 shadow-sm"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
                                                            Anterior
                                                        </button>
                                                        <div className="flex gap-1">
                                                            {[...Array(totalModalPages)].map((_, i) => (
                                                                <button
                                                                    key={i}
                                                                    type="button"
                                                                    onClick={() => setCurrentModalPage(i + 1)}
                                                                    className={`w-6 h-6 rounded-md text-[10px] font-bold transition-all ${currentModalPage === i + 1 ? 'bg-primary text-white shadow-md shadow-primary/20' : 'text-slate-400 hover:bg-white dark:hover:bg-slate-800'}`}
                                                                >
                                                                    {i + 1}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentModalPage(prev => Math.min(totalModalPages, prev + 1))}
                                                            disabled={currentModalPage === totalModalPages}
                                                            className="p-1 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1 shadow-sm"
                                                        >
                                                            Siguiente
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {showCreateCentreStep && (
                                            <div className="space-y-4">
                                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Seleccionar Centro</label>
                                                <div className="relative" ref={centreDropdownRef}>
                                                    <div className="relative flex items-center">
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar o seleccionar centro..."
                                                            value={isCentreDropdownOpen ? centreSearchTermDropdown : (formData.centre_id
                                                                ? (bookingCentreOptions.find((centre) => String(centre.id) === String(formData.centre_id))?.nombre || 'Centro seleccionado')
                                                                : (selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0 ? 'Global (Todos los centros)' : ''))}
                                                            onChange={(e) => {
                                                                setCentreSearchTermDropdown(e.target.value);
                                                                if (!isCentreDropdownOpen) setIsCentreDropdownOpen(true);
                                                            }}
                                                            onClick={() => setIsCentreDropdownOpen(true)}
                                                            className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                        />
                                                        <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </div>

                                                    {isCentreDropdownOpen && (
                                                        <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                            <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                                                                {selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0 && (
                                                                    <div
                                                                        onClick={() => {
                                                                            setFormData({ ...formData, centre_id: '' });
                                                                            setIsCentreDropdownOpen(false);
                                                                            setCentreSearchTermDropdown('');
                                                                        }}
                                                                        className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                            ${!formData.centre_id
                                                                                ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                    >
                                                                        <span>Global (Todos los centros)</span>
                                                                        {!formData.centre_id && (
                                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                            </svg>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {filteredCentresList.length === 0 ? (
                                                                    <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay centros disponibles</div>
                                                                ) : filteredCentresList.map((centre) => (
                                                                    <div
                                                                        key={centre.id}
                                                                        onClick={() => {
                                                                            setFormData({ ...formData, centre_id: centre.id });
                                                                            setIsCentreDropdownOpen(false);
                                                                            setCentreSearchTermDropdown('');
                                                                        }}
                                                                        className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                            ${String(formData.centre_id) === String(centre.id)
                                                                                ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                    >
                                                                        <span>{centre.nombre}</span>
                                                                        {String(formData.centre_id) === String(centre.id) && (
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
                                        )}

                                        {(editingId || showCreateDatesStep) && (
                                            <div className="select-none space-y-4">
                                                {!editingId && <label className="block text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Definir fechas</label>}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <CustomDateTimePicker
                                                        label="Fecha de inicio"
                                                        value={formData.start_time}
                                                        onChange={(val) => setFormData({ ...formData, start_time: val })}
                                                        align="left"
                                                    />
                                                    <CustomDateTimePicker
                                                        label="Fecha de fin"
                                                        value={formData.end_time}
                                                        onChange={(val) => setFormData({ ...formData, end_time: val })}
                                                        error={(parseMySqlDateTime(formData.end_time) <= parseMySqlDateTime(formData.start_time)) && formData.end_time}
                                                        align="right"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {(editingId || showCreateVehicleStep) && (
                                            <div className="space-y-4">
                                                {!editingId && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Paso {createWizard.vehicle}: Seleccionar Vehículo</label>}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {editingId && isAdminSupervisor && (
                                                        <div>
                                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Usuario</label>
                                                            <div className="relative" ref={userDropdownRef}>
                                                                <div className="relative flex items-center">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Buscar o seleccionar usuario..."
                                                                        value={isUserDropdownOpen ? userSearchTermDropdown : (formData.user_id ? `${usersList.find(u => u.id == formData.user_id)?.username || ''} (${usersList.find(u => u.id == formData.user_id)?.role || ''})` : '')}
                                                                        onChange={(e) => {
                                                                            setUserSearchTermDropdown(e.target.value);
                                                                            if (!isUserDropdownOpen) setIsUserDropdownOpen(true);
                                                                        }}
                                                                        onClick={() => setIsUserDropdownOpen(true)}
                                                                        className="w-full px-4 py-2 pr-10 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all cursor-text"
                                                                    />
                                                                    <svg className={`absolute right-3 w-4 h-4 pointer-events-none text-slate-400 transition-transform duration-200 ${isUserDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                </div>

                                                                {isUserDropdownOpen && (
                                                                    <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                        <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                                                            {filteredUsersList.map(u => (
                                                                                <div key={u.id} onClick={() => { setFormData({ ...formData, user_id: u.id }); setIsUserDropdownOpen(false); }} className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between ${formData.user_id == u.id ? 'bg-primary/10 text-primary font-medium' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}>
                                                                                    <span>{u.username} ({u.role})</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {editingId && (
                                                        <div>
                                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Centro</label>
                                                            {editHasMultipleCentres ? (
                                                                <div className="relative" ref={centreDropdownRef}>
                                                                    <div className="relative flex items-center">
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Buscar o seleccionar centro..."
                                                                            value={isCentreDropdownOpen ? centreSearchTermDropdown : editCentreDisplayName}
                                                                            onChange={(e) => {
                                                                                setCentreSearchTermDropdown(e.target.value);
                                                                                if (!isCentreDropdownOpen) setIsCentreDropdownOpen(true);
                                                                            }}
                                                                            onClick={() => setIsCentreDropdownOpen(true)}
                                                                            className="w-full px-4 py-2 pr-10 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all cursor-text shadow-sm"
                                                                        />
                                                                        <svg className={`absolute right-3 w-4 h-4 pointer-events-none text-slate-400 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                                        </svg>
                                                                    </div>

                                                                    {isCentreDropdownOpen && (
                                                                        <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                            <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                                {filteredEditCentresList.length === 0 ? (
                                                                                    <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay centros disponibles</div>
                                                                                ) : filteredEditCentresList.map((centre) => (
                                                                                    <div
                                                                                        key={centre.id}
                                                                                        onClick={() => {
                                                                                            setFormData({ ...formData, centre_id: centre.id });
                                                                                            setIsCentreDropdownOpen(false);
                                                                                            setCentreSearchTermDropdown('');
                                                                                        }}
                                                                                        className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between rounded-lg mb-0.5
                                                                                            ${String(formData.centre_id) === String(centre.id)
                                                                                                ? 'bg-primary/10 text-primary font-medium'
                                                                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                                                    >
                                                                                        <span>{centre.nombre}</span>
                                                                                        {String(formData.centre_id) === String(centre.id) && (
                                                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                                            </svg>
                                                                                        )}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <input
                                                                    type="text"
                                                                    readOnly
                                                                    value={editCentreDisplayName}
                                                                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 cursor-not-allowed opacity-80"
                                                                />
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className={(editingId && isEmployeeLikeUser(currentUser)) || (!editingId) ? 'col-span-2' : ''}>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vehículo</label>
                                                        <div className="relative" ref={vehicleDropdownRef}>
                                                            <div className="relative flex items-center">
                                                                <input
                                                                    type="text"
                                                                    placeholder="Buscar o seleccionar vehículo..."
                                                                    value={isVehicleDropdownOpen ? vehicleSearchTermDropdown : (formData.vehicle_id ? (vehiclesList.find(v => v.id == formData.vehicle_id) ? formatVehicleLabel(vehiclesList.find(v => v.id == formData.vehicle_id)) : formData.temp_vehicle_info || '') : '')}
                                                                    onChange={(e) => {
                                                                        setVehicleSearchTermDropdown(e.target.value);
                                                                        if (!isVehicleDropdownOpen) setIsVehicleDropdownOpen(true);
                                                                    }}
                                                                    onClick={() => setIsVehicleDropdownOpen(true)}
                                                                    className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text font-medium"
                                                                />
                                                                <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isVehicleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                                </svg>
                                                            </div>

                                                            {isVehicleDropdownOpen && (
                                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                        {filteredVehiclesList.length === 0 ? (
                                                                            <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay vehículos disponibles</div>
                                                                        ) : (
                                                                            filteredVehiclesList.map(v => {
                                                                                const selectable = isSelectableVehicle(v);
                                                                                return (
                                                                                    <div
                                                                                        key={v.id}
                                                                                        onClick={() => {
                                                                                            if (!selectable) return;
                                                                                            setFormData({ ...formData, vehicle_id: v.id });
                                                                                            setIsVehicleDropdownOpen(false);
                                                                                        }}
                                                                                        className={`px-4 py-3 text-sm transition-all flex items-center justify-between rounded-xl mb-1
                                                                                ${formData.vehicle_id == v.id
                                                                                                ? 'bg-primary text-white font-bold shadow-lg shadow-primary-500/20'
                                                                                                : selectable
                                                                                                    ? 'cursor-pointer text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                                                                                                    : 'cursor-not-allowed text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/40 opacity-70'}`}
                                                                                    >
                                                                                        <span>{formatVehicleLabel(v)}</span>
                                                                                        {!selectable && (
                                                                                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full bg-white/60 dark:bg-white/10">
                                                                                                No disponible
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {!isEmployeeLikeUser(currentUser) && (
                                                    <div>
                                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Estado</label>
                                                        <div className="relative" ref={statusDropdownRef}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                                                className="w-full px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all flex justify-between items-center shadow-sm hover:shadow-md capitalize"
                                                            >
                                                                <span className={!formData.status ? 'text-slate-400' : 'font-medium'}>
                                                                    {formData.status || 'Seleccionar estado...'}
                                                                </span>
                                                                <svg className={`w-5 h-5 transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                                </svg>
                                                            </button>

                                                            {isStatusDropdownOpen && (
                                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                        {RESERVATION_STATUS_OPTIONS.map(s => (
                                                                            <div
                                                                                key={s}
                                                                                onClick={() => {
                                                                                    setFormData({ ...formData, status: s });
                                                                                    setIsStatusDropdownOpen(false);
                                                                                }}
                                                                                className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1 capitalize
                                                                                ${formData.status === s
                                                                                        ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/20'
                                                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                            >
                                                                                <span>{s}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {formData.status === 'rechazada' && !isEmployeeLikeUser(currentUser) && (
                                                    <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
                                                        <label className="block text-sm font-semibold text-red-600 dark:text-red-400 mb-2 ml-1">
                                                            Motivo del rechazo
                                                            <span className="ml-1 text-xs font-normal text-slate-400">(opcional)</span>
                                                        </label>
                                                        <textarea
                                                            rows={3}
                                                            maxLength={255}
                                                            value={formData.motivo_rechazo || ''}
                                                            onChange={(e) => setFormData({ ...formData, motivo_rechazo: e.target.value })}
                                                            placeholder="Indica el motivo para que el usuario pueda consultarlo..."
                                                            className="w-full rounded-2xl border border-red-300 dark:border-red-800/60 bg-red-50/50 dark:bg-red-900/20 px-5 py-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-4 focus:ring-red-400/20 focus:border-red-400 transition-all resize-none min-h-[100px] placeholder-red-400/60 dark:placeholder-red-400/30"
                                                        />
                                                        <div className="flex justify-between items-center mt-1 px-1">
                                                            <p className="text-[10px] text-red-500 dark:text-red-400/90 italic">Este mensaje será visible para el empleado.</p>
                                                            <p className="text-[10px] text-slate-400 font-mono">{(formData.motivo_rechazo || '').length}/255</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {formData.status === 'rechazada' && !isEmployeeLikeUser(currentUser) && (
                                                    <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
                                                        <label className="block text-sm font-semibold text-red-600 dark:text-red-400 mb-2 ml-1">
                                                            Motivo del rechazo
                                                            <span className="ml-1 text-xs font-normal text-slate-400">(opcional)</span>
                                                        </label>
                                                        <textarea
                                                            rows={3}
                                                            maxLength={255}
                                                            value={formData.motivo_rechazo || ''}
                                                            onChange={(e) => setFormData({ ...formData, motivo_rechazo: e.target.value })}
                                                            placeholder="Indica el motivo para que el usuario pueda consultarlo..."
                                                            className="w-full rounded-2xl border border-red-300 dark:border-red-800/60 bg-red-50/50 dark:bg-red-900/20 px-5 py-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-4 focus:ring-red-400/20 focus:border-red-400 transition-all resize-none min-h-[100px] placeholder-red-400/60 dark:placeholder-red-400/30"
                                                        />
                                                        <div className="flex justify-between items-center mt-1 px-1">
                                                            <p className="text-[10px] text-red-500 dark:text-red-400/90 italic">Este mensaje será visible para el empleado.</p>
                                                            <p className="text-[10px] text-slate-400 font-mono">{(formData.motivo_rechazo || '').length}/255</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="select-none p-6 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 flex gap-3">
                                        {!editingId && wizardStep > 1 ? (
                                            <button
                                                type="button"
                                                onClick={() => setWizardStep(prev => prev - 1)}
                                                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                                            >
                                                Atrás
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleCloseModal}
                                                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                                            >
                                                Cancelar
                                            </button>
                                        )}

                                        {!editingId && wizardStep < createWizard.vehicle ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setError('');

                                                    if (isAdminSupervisor && wizardStep === createWizard.user) {
                                                        if (!formData.user_id) {
                                                            setError('Selecciona un usuario para continuar');
                                                            return;
                                                        }
                                                        setWizardStep(createWizard.hasCentreSelection ? createWizard.centre : createWizard.dates);
                                                    } else if (isAdminSupervisor && createWizard.hasCentreSelection && wizardStep === createWizard.centre) {
                                                        const isGlobalAdminSelected = selectedBookingUser?.role === 'admin' && selectedBookingUserCentreIds.length === 0;
                                                        if (!formData.centre_id && !isGlobalAdminSelected) {
                                                            setError('Selecciona un centro para continuar');
                                                            return;
                                                        }
                                                        setWizardStep(createWizard.dates);
                                                    } else if (!isAdminSupervisor && createWizard.hasCentreSelection && wizardStep === createWizard.centre) {
                                                        if (!formData.centre_id) {
                                                            setError('Selecciona un centro para continuar');
                                                            return;
                                                        }
                                                        setWizardStep(createWizard.dates);
                                                    } else if (wizardStep === createWizard.dates) {
                                                        if (!validateDateStep()) {
                                                            return;
                                                        }
                                                        setWizardStep(createWizard.vehicle);
                                                    }
                                                }}
                                                className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl transition-colors font-medium shadow-sm shadow-primary/30 flex justify-center items-center"
                                            >
                                                Siguiente
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleSave}
                                                disabled={formLoading}
                                                className="flex-1 px-4 py-2 bg-primary hover:brightness-95 text-white rounded-xl transition-colors font-medium shadow-sm shadow-primary/30 disabled:opacity-70 flex justify-center items-center"
                                            >
                                                {formLoading ? (
                                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                ) : (
                                                    editingId ? 'Guardar Cambios' : 'Confirmar Reserva'
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                )}

                {deleteId && (
                    renderToBody(
                        <div className={`fixed left-0 right-0 bottom-0 ${shouldKeepHeaderVisible ? 'top-16 z-[55]' : 'top-0 z-[9999]'} flex items-center justify-center p-4 overscroll-none`}>
                            <div
                                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
                                onClick={() => setDeleteId(null)}
                            />
                            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Estás seguro?</h3>
                                <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
                                    Esta acción eliminará la reserva permanentemente y no se puede deshacer.
                                </p>
                                <div className="select-none flex gap-3">
                                    <button
                                        onClick={() => setDeleteId(null)}
                                        className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmDelete}
                                        className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                                    >
                                        Sí, eliminar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                )}
            </>
        );
    }

    return (
        <div className="relative flex-1 min-h-0 flex flex-col glass-card-solid rounded-3xl shadow-sm p-6 animate-fade-in transition-colors overflow-hidden">
            {isMobile ? (
                // --- CABECERA MÓVIL ---
                <div className="select-none flex flex-col gap-4 mb-6">
                    {/* Fila 1: Título, Contador y Botón Agregar */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Reservas</h2>
                            <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg w-fit">
                                {totalRecords} Registros
                            </span>
                        </div>
                        <button
                            onClick={() => handleOpenModal()}
                            className="bg-primary hover:brightness-95 text-white px-4 py-2 rounded-2xl font-bold text-xs flex items-center transition-all shadow-lg shadow-primary/20 active:scale-95"
                        >
                            <span className="text-lg mr-1.5 leading-none">+</span>
                            <span>Nueva</span>
                        </button>
                    </div>

                    {/* Fila 2: Buscador */}
                    <div className="relative w-full">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Buscar usuario, vehículo, matrícula o estado ..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                        />
                    </div>

                    {/* Fila 3: Filtros de Fecha */}
                    <div className="grid grid-cols-2 gap-3">
                        <CustomDateTimePicker
                            label="Desde"
                            value={filterStartDate}
                            onChange={(val) => setFilterStartDate(val)}
                            align="left"
                        />
                        <CustomDateTimePicker
                            label="Hasta"
                            value={filterEndDate}
                            onChange={(val) => setFilterEndDate(val)}
                            align="right"
                        />
                    </div>

                    <div className="flex items-center justify-end">
                        <button
                            onClick={cycleStatusFilter}
                            className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition-all border ${filterStatus
                                ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                                : 'bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:text-primary'
                                }`}
                            title={filterStatus ? `Filtrando por ${filterStatus}` : 'Filtrar por estado'}
                        >
                            Estado
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M7 12h10M10 18h4" />
                            </svg>
                        </button>
                    </div>

                    {/* Fila 4: Limpiar Filtros */}
                    {(filterStartDate || filterEndDate) && (
                        <button
                            onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                            className="w-full py-2.5 text-[10px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl transition-colors flex items-center justify-center gap-2"
                        >
                            <FontAwesomeIcon icon={faTimes} />
                            LIMPIAR FILTROS
                        </button>
                    )}
                </div>
            ) : (
                // --- CABECERA DESKTOP ---
                <div className="select-none flex flex-col mb-6 shrink-0 w-full">
                    {/* Primera línea: Título a la izquierda + Contador y botón a la derecha */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Reservas</h2>
                        <div className="flex items-center gap-3">
                            <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                                {totalRecords} Registros
                            </span>

                        </div>
                    </div>

                    {/* Segunda línea: Filtros y búsqueda */}
                    <div className="flex items-end gap-4">
                        <div className="relative flex-1 min-w-[260px] max-w-xl">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Buscar usuario, vehículo, matrícula o estado ..."
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
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        )}
                        <button
                            onClick={() => handleOpenModal()}
                            className="bg-primary ml-auto mb-1.5 hover:brightness-95 text-white px-4 py-1.5 rounded-xl font-medium text-sm flex items-center transition-colors shadow-sm shadow-primary/20"
                            title="Añadir reserva">
                            <span className="text-xl mr-1.5 leading-none mb-0.5">+</span>
                            <span>Añadir reserva</span>
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                    <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p className="italic">Cargando reservas...</p>
                </div>
            ) : sortedReservations.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No hay reservas para mostrar</p>
                    <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">{searchTerm || filterStartDate || filterEndDate || filterStatus ? 'Pruebe a cambiar los filtros de búsqueda.' : 'Las reservas aparecerán aquí una vez creadas.'}</p>
                </div>
            ) : isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {paginatedReservations.map((r) => (
                        <div
                            key={r.id}
                            className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/50 shadow-sm hover:border-primary/50 dark:hover:border-primary/50 transition-all group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight">{r.model}</h3>
                                    {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
                                        <p className="text-primary font-medium text-xs mt-1">
                                            Usuario:
                                            <span
                                                className="ml-1 inline-block max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap align-middle"
                                                title={r.username}
                                            >
                                                {r.username}
                                            </span>
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={"chip-uniform px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider " + (STATUS_STYLES[r.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700')}>
                                        {r.status}
                                    </span>
                                </div>
                            </div>
                            {r.status === 'rechazada' && r.motivo_rechazo && (
                                <button
                                    type="button"
                                    onClick={() => setViewingReason({
                                        title: 'Motivo de rechazo',
                                        reason: r.motivo_rechazo
                                    })}
                                    className="mb-3 text-[10px] font-bold text-red-500 hover:underline uppercase tracking-tighter flex items-center gap-1.5 transition-all hover:scale-105"
                                >
                                    <FontAwesomeIcon icon={faTriangleExclamation} className="text-[9px]" />
                                    Ver motivo
                                </button>
                            )}

                            <div className="space-y-2 mb-5">
                                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                                    <FontAwesomeIcon icon={faCalendarAlt} className="w-3.5 h-3.5 text-primary" />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase font-bold text-slate-400">Inicio</span>
                                        <span className="text-xs font-semibold">{formatDate(r.start_time)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                                    <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5 text-amber-500" />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase font-bold text-slate-400">Fin</span>
                                        <span className="text-xs font-semibold">{formatDate(r.end_time)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-end pt-4 border-t border-slate-50 dark:border-slate-700/50 gap-2">
                                {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && r.status === 'pendiente' && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleQuickApprove(r)}
                                            className="p-2.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl hover:bg-green-100 transition-colors"
                                            title="Aprobar rápidamente"
                                        >
                                            <FontAwesomeIcon icon={faCheck} className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleQuickReject(r)}
                                            className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 transition-colors"
                                            title="Rechazar rápidamente"
                                        >
                                            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                                {/* Icono de documento SOLO para admin/supervisor si la reserva está finalizada, no ha sido rellenada, y no es la suya */}
                                {((currentUser.role === 'admin' || currentUser.role === 'supervisor')
                                    && r.status === 'finalizada'
                                    && !hasDeliveryBeenSubmitted(r, submittedDeliveryIds)
                                    && String(r.user_id) !== String(currentUser.id)
                                ) && (
                                        <button
                                            onClick={() => handleOpenDeliveryModal(r)}
                                            className="p-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 rounded-xl hover:bg-indigo-100 transition-colors"
                                            title="Completar entrega como supervisor/admin"
                                        >
                                            <FontAwesomeIcon icon={faFile} className="w-4 h-4" />
                                        </button>
                                    )}
                                {(currentUser.role === 'admin' || currentUser.role === 'supervisor' || r.user_id === currentUser.id) ? (
                                    <>
                                        <button
                                            onClick={() => handleOpenModal(r)}
                                            className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 transition-colors text-xs font-bold flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                            Editar
                                        </button>
                                        <button
                                            onClick={() => handleDeleteClick(r.id)}
                                            className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-[10px] text-slate-400 font-bold uppercase italic px-3 py-1 bg-slate-50 dark:bg-slate-900/30 rounded-lg">Solo lectura</span>
                                )}
                            </div>
                        </div>
                    ))}
                    {visibleItems < sortedReservations.length && (
                        <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                </div>
            ) : (
                <div className={`${allowPageFlow ? 'h-auto overflow-hidden' : 'flex-1 min-h-0 overflow-hidden'} flex flex-col`}>
                    <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
                        <div ref={tableWrapperRef} className={allowPageFlow ? 'overflow-hidden' : 'flex-1 min-h-0 overflow-hidden'}>
                            <table className="w-full text-sm text-left relative">
                                <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                                    <tr className=" select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                                        {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
                                            <th onClick={() => requestSort('username')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                                <div className="flex items-center justify-center">
                                                    Usuario {getSortIcon('username')}
                                                </div>
                                            </th>
                                        )}
                                        <th onClick={() => requestSort('model')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Vehículo {getSortIcon('model')}
                                            </div>
                                        </th>
                                        <th onClick={() => requestSort('start_time')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Fecha Inicio {getSortIcon('start_time')}
                                            </div>
                                        </th>
                                        <th onClick={() => requestSort('end_time')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Fecha Fin {getSortIcon('end_time')}
                                            </div>
                                        </th>
                                        <th onClick={cycleStatusFilter} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Estado
                                                <svg className={`w-3 h-3 ml-1 transition-colors ${filterStatus ? 'text-primary' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M7 12h10M10 18h4" />
                                                </svg>
                                            </div>
                                        </th>
                                        <th className="pb-3 px-4 text-center">Opciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedReservations.map((r) => (
                                        <tr key={r.id} style={rowHeight != null ? { height: `${rowHeight}px` } : undefined} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                            {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
                                                <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                                                    <span
                                                        className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                                                        title={r.username}
                                                    >
                                                        {r.username}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                                                <span
                                                    className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                                                    title={r.model}
                                                >
                                                    {r.model}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES.fecha ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                                    {formatDate(r.start_time)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES.fecha ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                                    {formatDate(r.end_time)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                                        {r.status}
                                                    </span>
                                                    {r.status === 'rechazada' && r.motivo_rechazo && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setViewingReason({
                                                                title: 'Motivo de rechazo',
                                                                reason: r.motivo_rechazo
                                                            })}
                                                            className="mt-1 text-[9px] font-bold text-red-500 hover:underline uppercase tracking-tighter transition-all hover:scale-105"
                                                        >
                                                            Ver motivo
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Botones de opciones (editar y eliminar) */}
                                            <td className="py-3 px-4 text-center ">
                                                {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && r.status === 'pendiente' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleQuickApprove(r)}
                                                            className="p-2 text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors mr-1"
                                                            title="Aprobar rápidamente"
                                                        >
                                                            <FontAwesomeIcon icon={faCheck} className="w-5 h-5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleQuickReject(r)}
                                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors mr-1"
                                                            title="Rechazar rápidamente"
                                                        >
                                                            <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
                                                        </button>
                                                    </>
                                                )}
                                                {/* Icono de documento SOLO para admin/supervisor en reservas finalizadas de otros usuarios que no han rellenado */}
                                                {((currentUser.role === 'admin' || currentUser.role === 'supervisor')
                                                    && r.status === 'finalizada'
                                                    && !hasDeliveryBeenSubmitted(r, submittedDeliveryIds)
                                                    && String(r.user_id) !== String(currentUser.id)
                                                    && typeof onDeliverReservation === 'function'
                                                ) && (
                                                        <button
                                                            onClick={() => handleOpenDeliveryModal(r)}
                                                            className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors mr-1"
                                                            title="Completar entrega como supervisor/admin"
                                                        >
                                                            <FontAwesomeIcon icon={faFile} className="w-5 h-5" />
                                                        </button>
                                                    )}
                                                {(currentUser.role === 'admin' || currentUser.role === 'supervisor' || r.user_id === currentUser.id) ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleOpenModal(r)}
                                                            className="p-2 text-slate-400 hover:text-primary hover:bg-primary/20 dark:hover:bg-primary/20 rounded-lg transition-colors mr-1"
                                                            title="Editar reserva"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                            </svg>
                                                        </button>

                                                        <button
                                                            onClick={() => handleDeleteClick(r.id)}
                                                            aria-label="Eliminar reserva"
                                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                            title="Eliminar reserva"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-slate-400 italic">Solo lectura</span>
                                                )}
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
                                            min="1"
                                            max={totalPages}
                                            value={currentPage}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 1 && val <= totalPages) setCurrentPage(val);
                                            }}
                                            className="w-12 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MODAL CREADO/EDICIÓN */}
            {isModalOpen && renderOverlay(
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    {/* MODAL que hay que cambiar para empleado */}
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-[90vh] sm:max-w-4xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50 shrink-0">
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                            {editingId ? 'Editar reserva' : 'Añadir nueva reserva'}
                        </h3>
                        <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                        <div className="flex-1 overflow-y-auto p-6 flex flex-col">
                            <div className="flex-1 overflow-y-auto overscroll-contain form-scrollbar p-6 space-y-4 pb-32">
                                {error && (
                                    <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800/50">
                                        {error}
                                    </div>
                                )}

                                {/* PASO 1 (Admin/Supervisor): SELECCIÓN DE USUARIO */}
                                {showCreateUserStep && (
                                    <div className="select-none animate-in fade-in slide-in-from-right-4 duration-300">
                                        <label className="block text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Reserva de:</label>
                                        <div className="relative" ref={userDropdownRef}>
                                            <div className="relative flex items-center">
                                                <input
                                                    type="text"
                                                    placeholder="Buscar por nombre..."
                                                    value={isUserDropdownOpen ? userSearchTermDropdown : (formData.user_id ? usersList.find(u => u.id == formData.user_id)?.username || '' : '')}
                                                    onChange={(e) => {
                                                        setUserSearchTermDropdown(e.target.value);
                                                        if (!isUserDropdownOpen) setIsUserDropdownOpen(true);
                                                    }}
                                                    onClick={() => setIsUserDropdownOpen(true)}
                                                    className="select-none w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                />
                                                <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isUserDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>

                                            {isUserDropdownOpen && (
                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                    <div className="max-h-[250px] overflow-y-auto custom-scrollbar p-1">
                                                        {filteredUsersList.length === 0 ? (
                                                            <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay usuarios disponibles</div>
                                                        ) : (
                                                            filteredUsersList.map(u => (
                                                                <div
                                                                    key={u.id}
                                                                    onClick={() => {
                                                                        setFormData({ ...formData, user_id: u.id });
                                                                        setIsUserDropdownOpen(false);
                                                                    }}
                                                                    className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                        ${formData.user_id == u.id
                                                                            ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                >
                                                                    <span>{u.username}</span>
                                                                    {formData.user_id == u.id && (
                                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {showCreateCentreStep && (
                                    <div className="select-none space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <label className="block text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Seleccionar Centro</label>
                                        <div className="relative" ref={centreDropdownRef}>
                                            <div className="relative flex items-center">
                                                <input
                                                    type="text"
                                                    placeholder="Buscar o seleccionar centro..."
                                                    value={isCentreDropdownOpen ? centreSearchTermDropdown : (formData.centre_id
                                                        ? (bookingCentreOptions.find((centre) => String(centre.id) === String(formData.centre_id))?.nombre || 'Centro seleccionado')
                                                        : '')}
                                                    onChange={(e) => {
                                                        setCentreSearchTermDropdown(e.target.value);
                                                        if (!isCentreDropdownOpen) setIsCentreDropdownOpen(true);
                                                    }}
                                                    onClick={() => setIsCentreDropdownOpen(true)}
                                                    className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                />
                                                <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                            {isCentreDropdownOpen && (
                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                    <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                                                        {filteredCentresList.length === 0 ? (
                                                            <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay centros disponibles</div>
                                                        ) : filteredCentresList.map((centre) => (
                                                            <div
                                                                key={centre.id}
                                                                onClick={() => {
                                                                    setFormData({ ...formData, centre_id: centre.id });
                                                                    setIsCentreDropdownOpen(false);
                                                                    setCentreSearchTermDropdown('');
                                                                }}
                                                                className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                    ${String(formData.centre_id) === String(centre.id)
                                                                        ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                            >
                                                                <span>{centre.nombre}</span>
                                                                {String(formData.centre_id) === String(centre.id) && (
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
                                )}

                                {/* PASO FECHAS */}
                                {(editingId || showCreateDatesStep) && (
                                    <div className="select-none space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        {!editingId && <label className="block text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Definir fechas</label>}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <CustomDateTimePicker
                                                label="Fecha de inicio"
                                                value={formData.start_time}
                                                onChange={(val) => setFormData({ ...formData, start_time: val })}
                                                align="left"
                                            />
                                            <CustomDateTimePicker
                                                label="Fecha de fin"
                                                value={formData.end_time}
                                                onChange={(val) => setFormData({ ...formData, end_time: val })}
                                                error={(parseMySqlDateTime(formData.end_time) <= parseMySqlDateTime(formData.start_time)) && formData.end_time}
                                                align="right"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* PASO 3 (Admin/Sup) o PASO 2 (Emp): VEHÍCULO Y ESTADO */}
                                {(editingId || showCreateVehicleStep) && (
                                    <div className="select-none space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        {!editingId && <label className="block text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 ml-1">Paso {createWizard.vehicle}: Seleccionar vehículo</label>}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Si estamos editando y somos admin, podemos cambiar el usuario aquí mismo */}
                                            {editingId && isAdminSupervisor && (
                                                <div className="col-span-2 sm:col-span-1">
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Usuario</label>
                                                    <div className="relative" ref={userDropdownRef}>
                                                        <div className="relative flex items-center">
                                                            <input
                                                                type="text"
                                                                placeholder="Buscar por nombre..."
                                                                value={isUserDropdownOpen ? userSearchTermDropdown : (formData.user_id ? usersList.find(u => u.id == formData.user_id)?.username || '' : '')}
                                                                onChange={(e) => {
                                                                    setUserSearchTermDropdown(e.target.value);
                                                                    if (!isUserDropdownOpen) setIsUserDropdownOpen(true);
                                                                }}
                                                                onClick={() => setIsUserDropdownOpen(true)}
                                                                className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                            />
                                                            <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isUserDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </div>
                                                        {isUserDropdownOpen && (
                                                            <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                    {filteredUsersList.length === 0 ? (
                                                                        <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay usuarios disponibles</div>
                                                                    ) : filteredUsersList.map(u => (
                                                                        <div key={u.id} onClick={() => { setFormData({ ...formData, user_id: u.id }); setIsUserDropdownOpen(false); }} className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1 ${formData.user_id == u.id ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}>
                                                                            <span>{u.username}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {editingId && (
                                                <div className="col-span-2 sm:col-span-1">
                                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Centro</label>
                                                    {editHasMultipleCentres ? (
                                                        <div className="relative" ref={centreDropdownRef}>
                                                            <div className="relative flex items-center">
                                                                <input
                                                                    type="text"
                                                                    placeholder="Buscar o seleccionar centro..."
                                                                    value={isCentreDropdownOpen ? centreSearchTermDropdown : editCentreDisplayName}
                                                                    onChange={(e) => {
                                                                        setCentreSearchTermDropdown(e.target.value);
                                                                        if (!isCentreDropdownOpen) setIsCentreDropdownOpen(true);
                                                                    }}
                                                                    onClick={() => setIsCentreDropdownOpen(true)}
                                                                    className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text"
                                                                />
                                                                <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                                </svg>
                                                            </div>

                                                            {isCentreDropdownOpen && (
                                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                        {filteredEditCentresList.length === 0 ? (
                                                                            <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay centros disponibles</div>
                                                                        ) : filteredEditCentresList.map((centre) => (
                                                                            <div
                                                                                key={centre.id}
                                                                                onClick={() => {
                                                                                    setFormData({ ...formData, centre_id: centre.id });
                                                                                    setIsCentreDropdownOpen(false);
                                                                                    setCentreSearchTermDropdown('');
                                                                                }}
                                                                                className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1
                                                                                    ${String(formData.centre_id) === String(centre.id)
                                                                                        ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                            >
                                                                                <span>{centre.nombre}</span>
                                                                                {String(formData.centre_id) === String(centre.id) && (
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
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={editCentreDisplayName}
                                                            className="w-full px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 cursor-not-allowed opacity-80"
                                                        />
                                                    )}
                                                </div>
                                            )}

                                            <div className={(editingId && isAdminSupervisor) ? 'col-span-2 sm:col-span-1' : 'col-span-2'}>
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 ml-1">Vehículos disponibles</label>
                                                <div className="relative" ref={vehicleDropdownRef}>
                                                    <div className="relative flex items-center">
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar por matrícula o modelo..."
                                                            value={isVehicleDropdownOpen ? vehicleSearchTermDropdown : (formData.vehicle_id ? (vehiclesList.find(v => v.id == formData.vehicle_id) ? formatVehicleLabel(vehiclesList.find(v => v.id == formData.vehicle_id)) : formData.temp_vehicle_info || 'Cargando vehículo...') : '')}
                                                            onChange={(e) => {
                                                                setVehicleSearchTermDropdown(e.target.value);
                                                                if (!isVehicleDropdownOpen) setIsVehicleDropdownOpen(true);
                                                            }}
                                                            onClick={() => setIsVehicleDropdownOpen(true)}
                                                            className="w-full px-5 py-3 pr-10 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all shadow-sm hover:shadow-md cursor-text font-medium"
                                                        />
                                                        <svg className={`absolute right-4 w-5 h-5 pointer-events-none text-slate-400 transition-transform duration-200 ${isVehicleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsVehicleDropdownOpen(!isVehicleDropdownOpen)}
                                                        className="hidden w-full px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 outline-none transition-all flex justify-between items-center shadow-sm hover:shadow-md"
                                                    >
                                                        <span className={!formData.vehicle_id ? 'text-slate-400' : 'font-medium'}>
                                                            {formData.vehicle_id
                                                                ? (vehiclesList.find(v => v.id == formData.vehicle_id)
                                                                    ? formatVehicleLabel(vehiclesList.find(v => v.id == formData.vehicle_id))
                                                                    : formData.temp_vehicle_info || 'Cargando vehículo...')
                                                                : 'Seleccionar vehículo...'}
                                                        </span>
                                                        <svg className={`w-5 h-5 transition-transform duration-200 ${isVehicleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>

                                                    {isVehicleDropdownOpen && (
                                                        <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                            <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                {filteredVehiclesList.length === 0 ? (
                                                                    <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No hay vehículos disponibles</div>
                                                                ) : (
                                                                    filteredVehiclesList.map(v => {
                                                                        const selectable = isSelectableVehicle(v);
                                                                        return (
                                                                            <div
                                                                                key={v.id}
                                                                                onClick={() => {
                                                                                    if (!selectable) return;
                                                                                    setFormData({ ...formData, vehicle_id: v.id });
                                                                                    setIsVehicleDropdownOpen(false);
                                                                                }}
                                                                                className={`px-4 py-3 text-sm transition-all flex items-center justify-between rounded-xl mb-1
                                                                        ${formData.vehicle_id == v.id
                                                                                        ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                        : selectable
                                                                                            ? 'cursor-pointer text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                                                                                            : 'cursor-not-allowed text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/40 opacity-70'}`}
                                                                            >
                                                                                <span>{formatVehicleLabel(v)}</span>
                                                                                {!selectable && (
                                                                                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full bg-white/60 dark:bg-white/10">
                                                                                        No disponible
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {!isEmployeeLikeUser(currentUser) && (
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Estado</label>
                                                <div className="relative" ref={statusDropdownRef}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                                        className="w-full px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all flex justify-between items-center shadow-sm hover:shadow-md capitalize"
                                                    >
                                                        <span className={!formData.status ? 'text-slate-400' : 'font-medium'}>
                                                            {formData.status || 'Seleccionar estado...'}
                                                        </span>
                                                        <svg className={`w-5 h-5 transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>

                                                    {isStatusDropdownOpen && (
                                                        <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                            <div className="max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                                                {RESERVATION_STATUS_OPTIONS.map(s => (
                                                                    <div
                                                                        key={s}
                                                                        onClick={() => {
                                                                            setFormData({ ...formData, status: s });
                                                                            setIsStatusDropdownOpen(false);
                                                                        }}
                                                                        className={`px-4 py-3 text-sm cursor-pointer transition-all flex items-center justify-between rounded-xl mb-1 capitalize
                                                                        ${formData.status === s
                                                                                ? 'bg-primary text-white font-bold shadow-lg shadow-primary/20'
                                                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                                                    >
                                                                        <span>{s}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {formData.status === 'rechazada' && !isEmployeeLikeUser(currentUser) && (
                                            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
                                                <label className="block text-sm font-semibold text-red-700 dark:text-red-300 mb-2 ml-1">
                                                    Motivo del rechazo
                                                    <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">(opcional)</span>
                                                </label>
                                                <textarea
                                                    rows={3}
                                                    maxLength={255}
                                                    value={formData.motivo_rechazo || ''}
                                                    onChange={(e) => setFormData({ ...formData, motivo_rechazo: e.target.value })}
                                                    placeholder="Indica el motivo para que el usuario pueda consultarlo..."
                                                    className="w-full rounded-2xl border border-red-300 dark:border-red-800/60 bg-red-50/50 dark:bg-red-900/20 px-5 py-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-4 focus:ring-red-400/20 focus:border-red-400 transition-all resize-none min-h-[100px] placeholder-red-400/60 dark:placeholder-red-400/30"
                                                />
                                                <div className="flex justify-between items-center mt-1 px-1">
                                                    <p className="text-[10px] text-red-500 dark:text-red-400/90 italic">Este mensaje será visible para el empleado.</p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{(formData.motivo_rechazo || '').length}/255</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Tabla de vehiculos reservados y quien los tiene (todos los roles) */}
                                        <div className="mt-8 mb-2">
                                            <h4 className="text-sm font-bold text-slate-700 dark:text-white mb-4 ml-1 flex items-center justify-between">
                                                <span>Vehículos bajo reserva actual</span>
                                                {totalModalPages > 1 && (
                                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                                        Página {currentModalPage} de {totalModalPages}
                                                    </span>
                                                )}
                                            </h4>
                                            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 shadow-sm">
                                                <div className="overflow-x-auto custom-scrollbar">
                                                    <table className="w-full text-sm text-left border-collapse">
                                                        <thead className="bg-slate-50 dark:bg-slate-800">
                                                            <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                                                                <th className="py-3 px-4 text-center">Vehículo / Matrícula</th>
                                                                <th className="py-3 px-4 text-center">Usuario</th>
                                                                <th className="py-3 px-4 text-center">Estado</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {paginatedModalReservations.length > 0 ? (
                                                                paginatedModalReservations.map(reservation => (
                                                                    <tr key={reservation.id} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                                                        <td className="py-3.5 px-4 text-center text-slate-700 dark:text-slate-200 font-medium">
                                                                            {formatVehicleLabel(reservation)}
                                                                        </td>
                                                                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                                                                            {reservation.username}
                                                                        </td>
                                                                        <td className="py-3 px-4 text-center">
                                                                            <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[reservation.status] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700'}`}>
                                                                                {reservation.status}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                ))
                                                            ) : (
                                                                <tr>
                                                                    <td colSpan="3" className="py-8 text-center text-slate-400 italic bg-white dark:bg-slate-900/50">
                                                                        No hay reservas vigentes actualmente
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Paginación de la tabla del modal */}
                                                {totalModalPages > 1 && (
                                                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-700/50">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentModalPage(prev => Math.max(1, prev - 1))}
                                                            disabled={currentModalPage === 1}
                                                            aria-label="Anterior"
                                                            className="p-1 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1 shadow-sm"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
                                                            Anterior
                                                        </button>
                                                        <div className="flex gap-1">
                                                            {[...Array(totalModalPages)].map((_, i) => (
                                                                <button
                                                                    key={i}
                                                                    type="button"
                                                                    onClick={() => setCurrentModalPage(i + 1)}
                                                                    className={`w-6 h-6 rounded-md text-[10px] font-bold transition-all ${currentModalPage === i + 1 ? 'bg-primary text-white shadow-md shadow-primary/20' : 'text-slate-400 hover:bg-white dark:hover:bg-slate-800'}`}
                                                                >
                                                                    {i + 1}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCurrentModalPage(prev => Math.min(totalModalPages, prev + 1))}
                                                            disabled={currentModalPage === totalModalPages}
                                                            aria-label="Siguiente"
                                                            className="p-1 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1 shadow-sm"
                                                        >
                                                            Siguiente
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="select-none p-6 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 flex gap-3">
                                {(!editingId && wizardStep > 1) ? (
                                    <button
                                        type="button"
                                        onClick={() => setWizardStep(prev => prev - 1)}
                                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                                    >
                                        Atrás
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleCloseModal}
                                        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                                    >
                                        Cancelar
                                    </button>
                                )}

                                {!editingId && wizardStep < createWizard.vehicle ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError('');
                                            if (isAdminSupervisor && wizardStep === createWizard.user) {
                                                if (!formData.user_id) {
                                                    setError('Selecciona un usuario para continuar');
                                                    return;
                                                }
                                                setWizardStep(createWizard.hasCentreSelection ? createWizard.centre : createWizard.dates);
                                            } else if (isAdminSupervisor && createWizard.hasCentreSelection && wizardStep === createWizard.centre) {
                                                if (!formData.centre_id) {
                                                    setError('Selecciona un centro para continuar');
                                                    return;
                                                }
                                                setWizardStep(createWizard.dates);
                                            } else if (!isAdminSupervisor && createWizard.hasCentreSelection && wizardStep === createWizard.centre) {
                                                if (!formData.centre_id) {
                                                    setError('Selecciona un centro para continuar');
                                                    return;
                                                }
                                                setWizardStep(createWizard.dates);
                                            } else if (wizardStep === createWizard.dates) {
                                                if (!validateDateStep()) {
                                                    return;
                                                }
                                                setWizardStep(createWizard.vehicle);
                                            }
                                        }}
                                        className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl transition-colors font-medium shadow-sm shadow-primary/30 flex justify-center items-center"
                                    >
                                        Siguiente
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        disabled={formLoading}
                                        className="flex-1 px-4 py-2 bg-primary hover:brightness-95 text-white rounded-xl transition-all font-medium shadow-lg shadow-primary/20 disabled:opacity-70 flex justify-center items-center"
                                    >
                                        {formLoading ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        ) : (
                                            editingId ? 'Guardar Cambios' : 'Confirmar Reserva'
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {deleteId && renderOverlay(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 min-h-screen">
                    <div
                        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
                        onClick={() => setDeleteId(null)}
                    />
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Estás seguro?</h3>
                        <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
                            Esta acción eliminará la reserva permanentemente y no se puede deshacer.
                        </p>
                        <div className="select-none flex gap-3">
                            <button
                                onClick={() => setDeleteId(null)}
                                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                            >
                                Sí, eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE RECHAZO CON MOTIVO */}
            {rejectModalReservation && renderOverlay(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 min-h-screen">
                    <div
                        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
                        onClick={() => { if (!rejectLoading) { setRejectModalReservation(null); setRejectReason(''); } }}
                    />
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                        {/* Icono */}
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
                            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </div>

                        <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-1">Rechazar reserva</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-1">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{rejectModalReservation.username}</span>
                            {' — '}{rejectModalReservation.model} ({rejectModalReservation.license_plate})
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 text-center mb-6">
                            Opcionalmente, indica el motivo del rechazo para que el usuario lo pueda consultar.
                        </p>

                        {/* Campo de motivo */}
                        <div className="mb-6">
                            <label htmlFor="reject-reason-input" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Motivo del rechazo
                                <span className="ml-1 text-xs font-normal text-slate-400">(opcional)</span>
                            </label>
                            <textarea
                                id="reject-reason-input"
                                rows={3}
                                maxLength={255}
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                disabled={rejectLoading}
                                placeholder="Ej: El vehículo no está disponible debido a un inconveniente mecánico..."
                                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 px-4 py-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400 transition-colors resize-none min-h-[80px] placeholder-slate-400"
                            />
                            <p className="text-right text-[10px] text-slate-400 mt-1">{rejectReason.length}/255</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setRejectModalReservation(null); setRejectReason(''); }}
                                disabled={rejectLoading}
                                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmReject}
                                disabled={rejectLoading}
                                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {rejectLoading ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                        Confirmar rechazo
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isDeliveryModalOpen && deliveryReservation && renderOverlay(
                <div
                    className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
                    onClick={handleCloseDeliveryModal}
                >
                    <div
                        className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-[85vh] sm:max-w-4xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                Formulario de entrega
                            </h3>
                            <button
                                onClick={handleCloseDeliveryModal}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 flex flex-col">
                            <DeliveryReservationCard
                                reservation={deliveryReservation}
                                onDeliver={handleDeliverReservationFromModal}
                                isSubmitting={deliverySubmitting}
                            />
                        </div>
                    </div>
                </div>
            )}
            {/* MODAL PARA VER MOTIVO */}
            {viewingReason && renderOverlay(
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
                                    <FontAwesomeIcon icon={faTimes} className="text-slate-400" />
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
        </div>
    );
}


