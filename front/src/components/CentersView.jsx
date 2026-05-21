import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faCar, faUsers, faEye, faLink, faLinkSlash, faUserPlus, faUserMinus, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { normalizeSearchText } from '../utils/reservationsViewHelpers';

const INITIAL_FORM_STATE = { id_unifica: '', nombre: '', provincia: '', localidad: '', direccion: '', telefono: '', codigo_postal: '' };

const formatVehicleLabel = (vehicle = {}, includePlate = true) => {
    const brand = String(vehicle?.brand ?? '').trim();
    const model = String(vehicle?.model ?? '').trim();
    const plate = String(vehicle?.license_plate ?? '').trim();
    const name = [brand, model].filter(Boolean).join(' / ') || model || brand || 'Vehículo';
    return includePlate && plate ? `${name} (${plate})` : name;
};

const CentersView = ({ onModalChange }) => {
    const isMobile = useIsMobile();
    const [centres, setCentres] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal & Form State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingId, setEditingId] = useState(null);
    const [formLoading, setFormLoading] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState(null);
    const [syncLoading, setSyncLoading] = useState(false);

    // Details State
    const [detailId, setDetailId] = useState(null);
    const [centreDetails, setCentreDetails] = useState({ vehicles: [], users: [] });
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [catalogUsers, setCatalogUsers] = useState([]);
    const [catalogVehicles, setCatalogVehicles] = useState([]);
    const [assignmentLoading, setAssignmentLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [usersModalOpen, setUsersModalOpen] = useState(false);
    const [vehiclesModalOpen, setVehiclesModalOpen] = useState(false);
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const [vehicleSearchTerm, setVehicleSearchTerm] = useState('');
    const [pendingVehicleTransfer, setPendingVehicleTransfer] = useState(null);

    // Sorting & Filter State
    const [sortConfig, setSortConfig] = useState({ key: 'nombre', direction: 'asc' });
    const [searchTerm, setSearchTerm] = useState('');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [visibleItems, setVisibleItems] = useState(7);
    const [totalRecords, setTotalRecords] = useState(0);
    const [serverTotalPages, setServerTotalPages] = useState(0);
    const itemsPerPage = 7;
    const scrollObserverRef = useRef(null);
    const hasMountedRef = useRef(false);
    const loadingPagesRef = useRef(new Set());

    const sortedCentres = centres;

    const paginatedCentres = useMemo(() => {
        if (isMobile) {
            return sortedCentres.slice(0, visibleItems);
        }
        return sortedCentres;
    }, [sortedCentres, isMobile, visibleItems]);

    const totalPages = serverTotalPages || Math.ceil(totalRecords / itemsPerPage) || 1;
    const shouldStretchRows = !isMobile && paginatedCentres.length === itemsPerPage;
    const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
        rowCount: paginatedCentres.length,
        enabled: shouldStretchRows,
    });

    const fetchCentres = async (page = 1, append = false) => {
        if (loadingPagesRef.current.has(page)) return;
        loadingPagesRef.current.add(page);
        try {
            const searchParam = searchTerm.trim() ? `&search=${encodeURIComponent(searchTerm.trim())}` : '';
            const sortParam = sortConfig ? `&sortBy=${sortConfig.key}&sortDir=${sortConfig.direction}` : '';
            const response = await apiFetch(`/api/dashboard/centres?page=${page}&limit=7${searchParam}${sortParam}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Error al cargar centros');
            }
            const data = await response.json();
            const centresData = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
            setCentres(prev => append ? [...prev, ...centresData] : centresData);
            setTotalRecords(Number(data?.pagination?.totalRecords || centresData.length));
            setServerTotalPages(Number(data?.pagination?.totalPages || 1));
        } catch (error) {
            console.error('Error cargando centros:', error);
            toast.error('Error al cargar la lista de centros');
        } finally {
            setLoading(false);
            loadingPagesRef.current.delete(page);
        }
    };

    const refreshDetailData = async () => {
        if (detailId) {
            await handleViewDetails(detailId, { preserveUi: true });
        }
        await fetchCentres(currentPage, false);
    };

    useEffect(() => {
        setCentres([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchCentres(1, false);
    }, []);

    // Re-fetch cuando cambia la búsqueda
    useEffect(() => {
        setCentres([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchCentres(1, false);
    }, [searchTerm]);

    // Re-fetch cuando cambia la ordenación (ordenación server-side)
    useEffect(() => {
        setCentres([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchCentres(1, false);
    }, [sortConfig]);

    // Cargar nueva página al navegar (incluido volver a página 1)
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        fetchCentres(currentPage, isMobile);
    }, [currentPage, isMobile]);

    // Infinite Scroll Observer para la vista móvil
    useEffect(() => {
        if (!isMobile) return;

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                if (visibleItems < centres.length) {
                    setVisibleItems(prev => prev + 8);
                } else if (currentPage < totalPages) {
                    const nextPage = currentPage + 1;
                    setCurrentPage(nextPage);
                    fetchCentres(nextPage, true);
                }
            }
        }, { threshold: 0.1 });

        if (scrollObserverRef.current) {
            observer.observe(scrollObserverRef.current);
        }

        return () => observer.disconnect();
    }, [isMobile, centres.length, visibleItems, currentPage, totalPages]);

    // Bloquear scroll al abrir modal
    useEffect(() => {
        if (isModalOpen || deleteId || detailId || usersModalOpen || vehiclesModalOpen || pendingVehicleTransfer) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isModalOpen, deleteId, detailId, usersModalOpen, vehiclesModalOpen, pendingVehicleTransfer]);

    const handleOpenModal = (centre = null) => {
        setError('');
        if (centre) {
            setFormData({
                id_unifica: centre.id_unifica || '',
                nombre: centre.nombre || '',
                provincia: centre.provincia || '',
                localidad: centre.localidad || '',
                direccion: centre.direccion || '',
                telefono: centre.telefono || '',
                codigo_postal: centre.codigo_postal || ''
            });
            setEditingId(centre.id);
        } else {
            setFormData(INITIAL_FORM_STATE);
            setEditingId(null);
        }
        setIsModalOpen(true);
        onModalChange?.(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(INITIAL_FORM_STATE);
        setEditingId(null);
        onModalChange?.(false);
    };

    const isValidCP = (cp) => /^\d{5}$/.test(cp) && parseInt(cp, 10) >= 1000 && parseInt(cp, 10) <= 52999;
    const isValidTelefono = (tel) => /^[6789]\d{8}$/.test(tel);

    const handleSave = async (e) => {
        e.preventDefault();
        setFormLoading(true);
        if (!formData.nombre || !formData.provincia) {
            setError('El nombre y la provincia son obligatorios.');
            setFormLoading(false);
            return;
        }

        if (formData.codigo_postal && !isValidCP(formData.codigo_postal)) {
            setError('El código postal no es válido. Debe tener 5 dígitos (01000–52999).');
            setFormLoading(false);
            return;
        }

        if (formData.telefono && !isValidTelefono(formData.telefono)) {
            setError('El teléfono no es válido. Debe tener 9 dígitos y empezar por 6, 7, 8 o 9.');
            setFormLoading(false);
            return;
        }

        const isEditing = !!editingId;
        const currentEditingId = editingId;

        const url = isEditing
            ? `/api/dashboard/centres/${editingId}`
            : '/api/dashboard/centres';

        try {
            const response = await apiFetch(url, {
                method: isEditing ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al guardar el centro');
            }

            toast.success(isEditing ? 'Centro actualizado' : 'Centro creado');
            await fetchCentres(currentPage, false);
            handleCloseModal();
        } catch (err) {
            setError(err.message);
            setFormLoading(false);
        }
    };

    const handleSyncCentres = async () => {
        setSyncLoading(true);
        const toastId = toast.loading('Sincronizando centros...');
        try {
            const response = await apiFetch('/api/dashboard/centres/sync', {
                method: 'POST'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Error al sincronizar');
            toast.success('Centros sincronizados exitosamente', { id: toastId });
            await fetchCentres(1, false);
        } catch (error) {
            console.error('Error sincronizando centros:', error);
            // El backend devuelve error.details y error.stderr
            if (error.details) console.error('Details:', error.details);
            if (error.stderr) console.error('Stderr:', error.stderr);
            toast.error(error.message || 'Error al sincronizar centros', { id: toastId });
        } finally {
            setSyncLoading(false);
        }
    };

    const handleDeleteClick = (id) => {
        setDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;

        const id = deleteId;
        setDeleteId(null);

        const deletePromise = await apiFetch(`/api/dashboard/centres/${id}`, {
            method: 'DELETE'
        });

        if (deletePromise.ok) {
            toast.success('Centro eliminado');
            await fetchCentres(currentPage, false);
        } else {
            const data = await deletePromise.json();
            toast.error(data.error || 'Error al eliminar el centro');
        }
    };

    const handleViewDetails = async (id, options = {}) => {
        setDetailId(id);
        setDetailsLoading(true);
        setDetailError('');
        if (!options.preserveUi) {
            setUsersModalOpen(false);
            setVehiclesModalOpen(false);
            setUserSearchTerm('');
            setVehicleSearchTerm('');
        }
        try {
            const [detailsRes, usersRes, vehiclesRes] = await Promise.all([
                apiFetch(`/api/dashboard/centres/${id}/details`),
                apiFetch('/api/dashboard/users?scope=centres'),
                apiFetch('/api/dashboard/vehicles?scope=centres'),
            ]);

            const detailsData = detailsRes.ok ? await detailsRes.json() : { vehicles: [], users: [] };
            const usersData = usersRes.ok ? await usersRes.json() : [];
            const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : [];

            setCentreDetails({
                vehicles: Array.isArray(detailsData?.vehicles) ? detailsData.vehicles : [],
                users: Array.isArray(detailsData?.users) ? detailsData.users : [],
            });
            setCatalogUsers(Array.isArray(usersData) ? usersData : []);
            setCatalogVehicles(Array.isArray(vehiclesData) ? vehiclesData : []);
        } catch (error) {
            console.error('Error cargando detalles:', error);
            toast.error('Error al cargar detalles del centro');
        } finally {
            setDetailsLoading(false);
        }
    };

    const updateUserCentres = async (user, nextCentreIds) => {
        const response = await apiFetch(`/api/dashboard/users/${user.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ centre_ids: nextCentreIds }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo actualizar el usuario');
        }
    };

    const updateVehicleCentre = async (vehicle, centreId) => {
        const response = await apiFetch(`/api/dashboard/vehicles/${vehicle.id}?scope=centres`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ centre_id: centreId }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'No se pudo actualizar el vehículo');
        }
    };

    const handleToggleUserCentre = async (user, shouldAssign) => {
        setAssignmentLoading(true);
        setDetailError('');
        try {
            const currentCentres = Array.isArray(user.centre_ids) ? user.centre_ids.map(Number) : [];
            const nextCentreIds = shouldAssign
                ? Array.from(new Set([...currentCentres, Number(detailId)]))
                : currentCentres.filter((cid) => String(cid) !== String(detailId));

            await updateUserCentres(user, nextCentreIds);
            toast.success(shouldAssign ? 'Usuario asignado al centro' : 'Usuario desasignado del centro');
            await refreshDetailData();
        } catch (error) {
            setDetailError(error.message || 'No se pudo actualizar el usuario');
            toast.error(error.message || 'No se pudo actualizar el usuario');
        } finally {
            setAssignmentLoading(false);
        }
    };

    const handleToggleVehicleCentre = async (vehicle, shouldAssign) => {
        setAssignmentLoading(true);
        setDetailError('');
        try {
            await updateVehicleCentre(vehicle, shouldAssign ? detailId : null);
            toast.success(shouldAssign ? 'Vehículo asignado al centro' : 'Vehículo desasignado del centro');
            await refreshDetailData();
        } catch (error) {
            setDetailError(error.message || 'No se pudo actualizar el vehículo');
            toast.error(error.message || 'No se pudo actualizar el vehículo');
        } finally {
            setAssignmentLoading(false);
        }
    };

    const getVehicleCentreActionLabel = (vehicle) => {
        const currentCentreId = String(vehicle?.centre_id ?? '');
        const targetCentreId = String(detailId);
        if (!currentCentreId) return 'Asignar a este centro';
        if (currentCentreId === targetCentreId) return 'Asignado';
        return 'Mover a este centro';
    };

    const isVehicleInCurrentCentre = (vehicle) => String(vehicle?.centre_id ?? '') === String(detailId);

    const handleVehicleTransferClick = (vehicle) => {
        if (!vehicle) return;

        const currentCentreId = String(vehicle?.centre_id ?? '');
        const targetCentreId = String(detailId);

        if (!currentCentreId || currentCentreId === targetCentreId) {
            handleToggleVehicleCentre(vehicle, true);
            return;
        }

        setPendingVehicleTransfer({
            vehicle,
            fromCentreName: vehicle.centre_name || `Centro ID: ${vehicle.centre_id}`,
            toCentreName: detailCentre?.nombre || `Centro ID: ${detailId}`,
        });
    };

    const confirmVehicleTransfer = async () => {
        if (!pendingVehicleTransfer?.vehicle) return;
        const vehicle = pendingVehicleTransfer.vehicle;
        setPendingVehicleTransfer(null);
        await handleToggleVehicleCentre(vehicle, true);
    };

    const detailCentre = centres.find((c) => String(c.id) === String(detailId));
    const linkedUsers = centreDetails.users;
    const availableUsers = catalogUsers.filter(
        (u) => !linkedUsers.some((linked) => String(linked.id) === String(u.id))
    );
    const linkedVehicles = centreDetails.vehicles;
    const availableVehicles = catalogVehicles;

    const getUserCentresData = (user) => {
        const centreIds = Array.isArray(user?.centre_ids) ? user.centre_ids.map(Number) : [];
        const centreNames = Array.isArray(user?.centre_names)
            ? user.centre_names.filter(Boolean)
            : typeof user?.centre_names === 'string'
                ? user.centre_names.split('||').map((name) => name.trim()).filter(Boolean)
                : [];
        const uniqueNames = Array.from(new Set(centreNames));
        const totalCentres = uniqueNames.length || centreIds.length;

        if (totalCentres === 0) {
            return {
                centreNames: [],
                centreSummary: 'Sin centro asignado',
                centreTitle: 'Sin centro asignado',
                hasCentres: false,
            };
        }

        if (totalCentres === 1) {
            const singleCentre = uniqueNames[0] || '1 centro asignado';
            return {
                centreNames: uniqueNames,
                centreSummary: singleCentre,
                centreTitle: singleCentre,
                hasCentres: true,
            };
        }

        return {
            centreNames: uniqueNames,
            centreSummary: `Asignado a ${totalCentres} centros`,
            centreTitle: uniqueNames.join(', '),
            hasCentres: true,
        };
    };

    const userQuery = normalizeSearchText(userSearchTerm);
    const vehicleQuery = normalizeSearchText(vehicleSearchTerm);

    const filteredLinkedUsers = linkedUsers.filter((user) => {
        if (!userQuery) return true;
        return [user.username, user.role]
            .filter(Boolean)
            .some((field) => normalizeSearchText(field).includes(userQuery));
    });

    const filteredAvailableUsers = availableUsers.filter((user) => {
        if (!userQuery) return true;
        return [user.username, user.role]
            .filter(Boolean)
            .some((field) => normalizeSearchText(field).includes(userQuery));
    });

    const filteredLinkedVehicles = linkedVehicles.filter((vehicle) => {
        if (!vehicleQuery) return true;
        return [vehicle.brand, vehicle.license_plate, vehicle.model, vehicle.status]
            .filter(Boolean)
            .some((field) => normalizeSearchText(field).includes(vehicleQuery));
    });

    const filteredAvailableVehicles = availableVehicles.filter((vehicle) => {
        if (!vehicleQuery) return true;
        return [vehicle.brand, vehicle.license_plate, vehicle.model, vehicle.status, vehicle.centre_name]
            .filter(Boolean)
            .some((field) => normalizeSearchText(field).includes(vehicleQuery));
    });

    const getVehicleCentreBadge = (vehicle) => {
        const currentCentreId = String(vehicle?.centre_id ?? '');
        const targetCentreId = String(detailId);
        const isCurrentCentre = !!currentCentreId && currentCentreId === targetCentreId;
        const hasCentre = !!currentCentreId;
        const centreLabel = vehicle?.centre_name || (hasCentre ? `Centro ID: ${vehicle.centre_id}` : 'Sin centro asignado');

        if (!hasCentre) {
            return {
                label: 'Sin centro asignado',
                title: 'Este vehículo no tiene un centro asignado',
                tone: 'neutral',
                isCurrentCentre: false,
            };
        }

        if (isCurrentCentre) {
            return {
                label: `Centro actual: ${centreLabel}`,
                title: centreLabel,
                tone: 'current',
                isCurrentCentre: true,
            };
        }

        return {
            label: `Asignado a ${centreLabel}`,
            title: `Asignado al centro: ${centreLabel}`,
            tone: 'foreign',
            isCurrentCentre: false,
        };
    };

    const closeDetailModals = () => {
        setDetailId(null);
        setUsersModalOpen(false);
        setVehiclesModalOpen(false);
        setDetailError('');
        setUserSearchTerm('');
        setVehicleSearchTerm('');
        setPendingVehicleTransfer(null);
    };

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
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

    return (
        <div className="relative h-full flex flex-col glass-card-solid rounded-3xl shadow-sm p-6 animate-fade-in transition-colors overflow-hidden">
            {/* CABECERA */}
            {isMobile ? (
                <div className="select-none flex flex-col gap-4 mb-6 shrink-0">
                    {/* Fila 1: Título (izquierda) + Contador (derecha) */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Centros</h2>
                        <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                            {totalRecords} registros
                        </span>
                    </div>
                    <div className="relative w-full">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Buscar por nombre, provincia, localidad..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary focus:outline-none transition-all text-slate-700 dark:text-slate-200"
                        />
                    </div>
                    {/* Fila 3: Sincronizar (izquierda) + Añadir (derecha) */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handleSyncCentres}
                            disabled={syncLoading}
                            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 border border-slate-200 dark:border-slate-700"
                            title="Sincronizar con UnificaPP"
                        >
                            <svg className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span>Sincronizar</span>
                        </button>
                        <button
                            onClick={() => handleOpenModal()}
                            className="bg-primary hover:brightness-95 text-white px-3 py-1.5 rounded-xl font-medium text-sm flex items-center transition-colors shadow-sm shadow-primary/20"
                        >
                            <span className="text-lg mr-1 leading-none">+</span>
                            <span>Añadir</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="select-none flex flex-col gap-6 mb-6 shrink-0 w-full">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0 flex items-center gap-2">
                            Centros
                        </h2>
                        <div className="flex items-center gap-3">
                            <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                                {totalRecords} Registros
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-4 justify-between">
                        <div className="relative flex-1 min-w-[260px] max-w-xl">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Buscar por nombre, provincia, localidad..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSyncCentres}
                                disabled={syncLoading}
                                className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50"
                            >
                                <svg className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                <span>Sincronizar</span>
                            </button>
                            <button
                                onClick={() => handleOpenModal()}
                                className="bg-primary hover:brightness-95 text-white px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors shadow-sm shadow-primary/20"
                            >
                                <span className="text-xl leading-none">+</span>
                                <span>Añadir Centro</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                    <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p className="italic">Cargando centros...</p>
                </div>
            ) : sortedCentres.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No hay centros registrados</p>
                </div>
            ) : isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                    {paginatedCentres.map((c) => (
                        <div
                            key={c.id}
                            className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50 shadow-[0_2px_8px_rgba(0,0,0,0.07)] dark:shadow-none hover:border-primary/50 dark:hover:border-primary/50 transition-all"
                        >
                            {/* Cabecera tarjeta */}
                            <div className="flex justify-between items-start mb-3">
                                <div className="min-w-0 flex-1 pr-3">
                                    <h3 className="font-bold text-slate-800 dark:text-white text-base leading-tight truncate">{c.nombre}</h3>
                                    {c.id_unifica && (
                                        <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                                            ID Unifica: {c.id_unifica}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={() => handleViewDetails(c.id)}
                                        className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded-xl hover:bg-blue-100 transition-colors"
                                        title="Ver detalles"
                                    >
                                        <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleOpenModal(c)}
                                        className="p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 transition-colors"
                                        title="Editar centro"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(c.id)}
                                        className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl hover:bg-red-100 transition-colors"
                                        title="Eliminar centro"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Datos del centro */}
                            <div className="space-y-2 pt-3 border-t border-slate-50 dark:border-slate-700/50">
                                {(c.localidad || c.provincia) && (
                                    <div className="flex items-start gap-2.5 text-slate-500 dark:text-slate-400">
                                        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">Ubicación</span>
                                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                {[c.localidad, c.provincia].filter(Boolean).join(', ')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {c.direccion && (
                                    <div className="flex items-start gap-2.5 text-slate-500 dark:text-slate-400">
                                        <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                        </svg>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">Dirección</span>
                                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{c.direccion}</span>
                                        </div>
                                    </div>
                                )}
                                <div className="flex gap-4">
                                    {c.telefono && (
                                        <div className="flex items-start gap-2.5 text-slate-500 dark:text-slate-400">
                                            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                            </svg>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-slate-400">Teléfono</span>
                                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{c.telefono}</span>
                                            </div>
                                        </div>
                                    )}
                                    {c.codigo_postal && (
                                        <div className="flex items-start gap-2.5 text-slate-500 dark:text-slate-400">
                                            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                                            </svg>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-slate-400">C.P.</span>
                                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{c.codigo_postal}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={scrollObserverRef} className="h-4" />
                </div>
            ) : (
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
                        <div ref={tableWrapperRef} className="flex-1 overflow-hidden">
                            <table className="w-full text-sm text-left relative">
                                <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                                    <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                                        <th onClick={() => requestSort('nombre')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">Nombre {getSortIcon('nombre')}</div>
                                        </th>
                                        <th onClick={() => requestSort('localidad')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">Localidad {getSortIcon('localidad')}</div>
                                        </th>
                                        <th onClick={() => requestSort('provincia')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">Provincia {getSortIcon('provincia')}</div>
                                        </th>
                                        <th className="pb-3 px-4 text-center">Opciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedCentres.map((c) => (
                                        <tr key={c.id} style={rowHeight != null ? { height: `${rowHeight}px` } : undefined} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                            <td className="py-3 px-4 text-center font-bold text-slate-700 dark:text-white">
                                                <span
                                                    className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                                                    title={c.nombre}
                                                >
                                                    {c.nombre}
                                                </span>
                                            </td>
                                            <td className="py-4 px-4 text-center text-slate-500 dark:text-slate-400">{c.localidad || '---'}</td>
                                            <td className="py-4 px-4 text-center text-slate-500 dark:text-slate-400">{c.provincia || '---'}</td>
                                            <td className="py-4 px-4 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => handleViewDetails(c.id)}
                                                        className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                        title="Ver detalles (Vinculaciones)"
                                                    >
                                                        <FontAwesomeIcon icon={faEye} className="w-5 h-5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenModal(c)}
                                                        className="p-2 text-slate-400 hover:text-primary hover:bg-primary/20 dark:hover:bg-primary/20 rounded-lg transition-colors mr-1"
                                                        title="Editar centro"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteClick(c.id)}
                                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                        title="Eliminar centro"
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
            )}

            {/* MODAL CREAR/EDITAR */}
            {isModalOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                {editingId ? 'Editar Centro' : 'Añadir nuevo centro'}
                            </h3>
                            <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="flex-1 overflow-y-auto form-scrollbar p-6 space-y-4">
                            {error && <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800/50">{error}</div>}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre del centro</label>
                                    <input type="text" required maxLength={100} value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">ID Unifica</label>
                                    <input type="text" maxLength={20} value={formData.id_unifica} onChange={e => setFormData({ ...formData, id_unifica: e.target.value })} className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Código Postal</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={5}
                                        value={formData.codigo_postal}
                                        onChange={e => {
                                            const val = e.target.value.replace(/\D/g, '');
                                            setFormData({ ...formData, codigo_postal: val });
                                        }}
                                        className={`w-full px-4 py-2 rounded-xl border bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 outline-none transition-all ${formData.codigo_postal && !isValidCP(formData.codigo_postal)
                                            ? 'border-red-400 dark:border-red-500 focus:ring-red-300'
                                            : 'border-slate-300 dark:border-slate-600 focus:ring-primary'
                                            }`}
                                        placeholder="ej. 28001"
                                    />
                                    {formData.codigo_postal && !isValidCP(formData.codigo_postal) && (
                                        <p className="mt-1 text-xs text-red-500 dark:text-red-400">CP no válido (5 dígitos, 01000–52999)</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Provincia</label>
                                    <input type="text" maxLength={60} value={formData.provincia} onChange={e => setFormData({ ...formData, provincia: e.target.value })} className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Localidad</label>
                                    <input type="text" maxLength={80} value={formData.localidad} onChange={e => setFormData({ ...formData, localidad: e.target.value })} className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all" />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Dirección</label>
                                    <input type="text" maxLength={150} value={formData.direccion} onChange={e => setFormData({ ...formData, direccion: e.target.value })} className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all" />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Teléfono</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={9}
                                        value={formData.telefono}
                                        onChange={e => {
                                            const val = e.target.value.replace(/\D/g, '');
                                            setFormData({ ...formData, telefono: val });
                                        }}
                                        className={`w-full px-4 py-2 rounded-xl border bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 outline-none transition-all ${formData.telefono && !isValidTelefono(formData.telefono)
                                            ? 'border-red-400 dark:border-red-500 focus:ring-red-300'
                                            : 'border-slate-300 dark:border-slate-600 focus:ring-primary'
                                            }`}
                                        placeholder="ej. 912345678"
                                    />
                                    {formData.telefono && !isValidTelefono(formData.telefono) && (
                                        <p className="mt-1 text-xs text-red-500 dark:text-red-400">Teléfono no válido (9 dígitos, empieza por 6, 7, 8 o 9)</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-3 py-4 sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 mt-6">
                                <button type="button" onClick={handleCloseModal} className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 transition-colors dark:hover:bg-slate-600 font-medium">Cancelar</button>
                                <button type="submit" disabled={formLoading} className="flex-1 px-4 py-2 bg-primary text-white rounded-xl font-medium shadow-sm shadow-primary/30 disabled:opacity-70 flex items-center justify-center">
                                    {formLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (editingId ? 'Guardar Cambios' : 'Añadir')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL DETALLES */}
            {detailId && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start gap-4">
                            <div className="flex flex-col gap-2 min-w-0">
                                <div className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full bg-[#E5007D]/10 text-[#E5007D] text-xs font-semibold uppercase tracking-[0.18em]">
                                    Detalles del centro
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white truncate">
                                    {detailCentre?.nombre || "Centro"}
                                </h3>
                            </div>
                            <button
                                onClick={closeDetailModals}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                                title="Cerrar"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto form-scrollbar p-6">
                            {detailsLoading ? (
                                <div className="flex flex-col items-center justify-center py-20">
                                    <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                                    <p className="italic text-slate-400">Cargando vinculaciones...</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {detailError && (
                                        <div className="rounded-2xl border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                                            {detailError}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Usuarios</p>
                                            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">{centreDetails.users.length}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Vehiculos</p>
                                            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">{centreDetails.vehicles.length}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4">
                                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Ubicacion</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                {detailCentre?.localidad || "Sin localidad"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setUsersModalOpen(true)}
                                            className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 px-5 py-4 text-left hover:border-[#E5007D]/40 hover:shadow-lg hover:shadow-[#E5007D]/10 transition-all"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-11 h-11 rounded-2xl bg-[#E5007D]/10 text-[#E5007D] flex items-center justify-center">
                                                    <FontAwesomeIcon icon={faUsers} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-slate-800 dark:text-white">Gestionar usuarios</p>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Asignar o desasignar usuarios del centro</p>
                                                </div>
                                            </div>
                                            <FontAwesomeIcon icon={faChevronRight} className="text-slate-300 group-hover:text-[#E5007D] transition-colors" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setVehiclesModalOpen(true)}
                                            className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 px-5 py-4 text-left hover:border-[#E5007D]/40 hover:shadow-lg hover:shadow-[#E5007D]/10 transition-all"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-11 h-11 rounded-2xl bg-[#E5007D]/10 text-[#E5007D] flex items-center justify-center">
                                                    <FontAwesomeIcon icon={faCar} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-slate-800 dark:text-white">Gestionar vehiculos</p>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">Asignar o desasignar vehiculos del centro</p>
                                                </div>
                                            </div>
                                            <FontAwesomeIcon icon={faChevronRight} className="text-slate-300 group-hover:text-[#E5007D] transition-colors" />
                                        </button>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/20 p-5">
                                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">Datos del centro</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                            <div>
                                                <span className="block text-slate-400">Direccion</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{detailCentre?.direccion || "Sin direccion"}</span>
                                            </div>
                                            <div>
                                                <span className="block text-slate-400">Provincia</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{detailCentre?.provincia || "Sin provincia"}</span>
                                            </div>
                                            <div>
                                                <span className="block text-slate-400">Telefono</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{detailCentre?.telefono || "Sin telefono"}</span>
                                            </div>
                                            <div>
                                                <span className="block text-slate-400">Codigo postal</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{detailCentre?.codigo_postal || "Sin codigo postal"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL USUARIOS */}
            {detailId && usersModalOpen && createPortal(
                <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-slate-900/55 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-5 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                                <button
                                    type="button"
                                    onClick={() => setUsersModalOpen(false)}
                                    className="mt-0.5 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[#E5007D] hover:border-[#E5007D]/30 hover:bg-[#E5007D]/5 transition-colors"
                                    title="Volver al detalle"
                                >
                                    <FontAwesomeIcon icon={faChevronLeft} />
                                </button>
                                <div className="min-w-0">
                                    <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white truncate">
                                        Usuarios del centro
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                                        {detailCentre?.nombre || "Centro seleccionado"}
                                    </p>
                                </div>
                            </div>
                            <div className="w-full sm:w-80">
                                <label className="relative block">
                                    <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                                    <input
                                        type="text"
                                        value={userSearchTerm}
                                        onChange={(e) => setUserSearchTerm(e.target.value)}
                                        placeholder="Buscar por usuario o rol"
                                        className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#E5007D]/30"
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto form-scrollbar p-5 sm:p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/25 p-4 sm:p-5">
                                    <div className="flex items-center justify-between gap-3 mb-4">
                                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                            <FontAwesomeIcon icon={faUsers} className="text-[#E5007D]" />
                                            Vinculados
                                        </h4>
                                        <span className="text-xs font-semibold text-slate-500">{filteredLinkedUsers.length}</span>
                                    </div>
                                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                                        {filteredLinkedUsers.length === 0 ? (
                                            <p className="text-sm italic text-slate-400">No hay usuarios que coincidan con la busqueda.</p>
                                        ) : (
                                            filteredLinkedUsers.map((u) => {
                                                const userCentres = getUserCentresData(u);
                                                return (
                                                    <div key={u.id} className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700/60">
                                                        <div className="flex flex-col min-w-0 gap-1">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{u.username}</span>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{u.role}</span>
                                                                <span
                                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${userCentres.hasCentres ? 'bg-[#E5007D]/10 text-[#E5007D] border-[#E5007D]/20' : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`}
                                                                    title={userCentres.centreTitle}
                                                                >
                                                                    {userCentres.centreSummary}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={assignmentLoading}
                                                            onClick={() => handleToggleUserCentre(u, false)}
                                                            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 disabled:opacity-50"
                                                            title="Desasignar usuario"
                                                        >
                                                            <FontAwesomeIcon icon={faUserMinus} />
                                                            Desasignar
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </section>

                                <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/25 p-4 sm:p-5">
                                    <div className="flex items-center justify-between gap-3 mb-4">
                                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                            <FontAwesomeIcon icon={faUserPlus} className="text-[#E5007D]" />
                                            Disponibles
                                        </h4>
                                        <span className="text-xs font-semibold text-slate-500">{filteredAvailableUsers.length}</span>
                                    </div>
                                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                                        {filteredAvailableUsers.length === 0 ? (
                                            <p className="text-sm italic text-slate-400">No hay usuarios disponibles para asignar.</p>
                                        ) : (
                                            filteredAvailableUsers.map((u) => {
                                                const userCentres = getUserCentresData(u);
                                                const isAssignedElsewhere = userCentres.hasCentres;
                                                return (
                                                    <div key={u.id} className={`flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900/40 rounded-2xl border border-dashed ${isAssignedElsewhere ? 'border-amber-300 dark:border-amber-700/60' : 'border-slate-200 dark:border-slate-700/60'}`}>
                                                        <div className="flex flex-col min-w-0 gap-1">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{u.username}</span>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{u.role}</span>
                                                                <span
                                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${isAssignedElsewhere ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40' : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`}
                                                                    title={userCentres.centreTitle}
                                                                >
                                                                    {userCentres.centreSummary}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={assignmentLoading}
                                                            onClick={() => handleToggleUserCentre(u, true)}
                                                            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-[#E5007D]/10 text-[#E5007D] hover:bg-[#E5007D]/15 disabled:opacity-50"
                                                            title="Asignar usuario"
                                                        >
                                                            <FontAwesomeIcon icon={faUserPlus} />
                                                            Asignar
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL VEHICULOS */}
            {detailId && vehiclesModalOpen && createPortal(
                <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-slate-900/55 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-5 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                                <button
                                    type="button"
                                    onClick={() => setVehiclesModalOpen(false)}
                                    className="mt-0.5 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[#E5007D] hover:border-[#E5007D]/30 hover:bg-[#E5007D]/5 transition-colors"
                                    title="Volver al detalle"
                                >
                                    <FontAwesomeIcon icon={faChevronLeft} />
                                </button>
                                <div className="min-w-0">
                                    <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white truncate">
                                        Vehiculos del centro
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                                        {detailCentre?.nombre || "Centro seleccionado"}
                                    </p>
                                </div>
                            </div>
                            <div className="w-full sm:w-80">
                                <label className="relative block">
                                    <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                                    <input
                                        type="text"
                                        value={vehicleSearchTerm}
                                        onChange={(e) => setVehicleSearchTerm(e.target.value)}
                                        placeholder="Buscar por matricula, modelo o estado"
                                        className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#E5007D]/30"
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto form-scrollbar p-5 sm:p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/25 p-4 sm:p-5">
                                    <div className="flex items-center justify-between gap-3 mb-4">
                                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                            <FontAwesomeIcon icon={faCar} className="text-[#E5007D]" />
                                            Vinculados
                                        </h4>
                                        <span className="text-xs font-semibold text-slate-500">{filteredLinkedVehicles.length}</span>
                                    </div>
                                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                                        {filteredLinkedVehicles.length === 0 ? (
                                            <p className="text-sm italic text-slate-400">No hay vehiculos que coincidan con la busqueda.</p>
                                        ) : (
                                            filteredLinkedVehicles.map((v) => {
                                                const vehicleCentre = getVehicleCentreBadge(v);
                                                return (
                                                    <div key={v.id} className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700/60">
                                                        <div className="flex flex-col min-w-0 gap-1">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{formatVehicleLabel(v, false)}</span>
                                                            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-mono">{v.license_plate}</span>
                                                            <span
                                                                className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${vehicleCentre.tone === 'current'
                                                                    ? 'bg-[#E5007D]/10 text-[#E5007D] border-[#E5007D]/20'
                                                                    : vehicleCentre.tone === 'foreign'
                                                                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40'
                                                                        : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                                                    }`}
                                                                title={vehicleCentre.title}
                                                            >
                                                                {vehicleCentre.label}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={assignmentLoading}
                                                            onClick={() => handleToggleVehicleCentre(v, false)}
                                                            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 disabled:opacity-50"
                                                            title="Desasignar vehiculo"
                                                        >
                                                            <FontAwesomeIcon icon={faLinkSlash} />
                                                            Desasignar
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </section>

                                <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/25 p-4 sm:p-5">
                                    <div className="flex items-center justify-between gap-3 mb-4">
                                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                            <FontAwesomeIcon icon={faLink} className="text-[#E5007D]" />
                                            Todos los vehículos
                                        </h4>
                                        <span className="text-xs font-semibold text-slate-500">{filteredAvailableVehicles.length}</span>
                                    </div>
                                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                                        {filteredAvailableVehicles.length === 0 ? (
                                            <p className="text-sm italic text-slate-400">No hay vehiculos para mostrar.</p>
                                        ) : (
                                            filteredAvailableVehicles.map((v) => {
                                                const vehicleCentre = getVehicleCentreBadge(v);
                                                const isAssignedElsewhere = vehicleCentre.tone === 'foreign';
                                                return (
                                                    <div key={v.id} className={`flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900/40 rounded-2xl border border-dashed ${isAssignedElsewhere ? 'border-amber-300 dark:border-amber-700/60' : 'border-slate-200 dark:border-slate-700/60'}`}>
                                                        <div className="flex flex-col min-w-0 gap-1">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{formatVehicleLabel(v, false)}</span>
                                                            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-mono">{v.license_plate}</span>
                                                            <span
                                                                className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${vehicleCentre.tone === 'current'
                                                                    ? 'bg-[#E5007D]/10 text-[#E5007D] border-[#E5007D]/20'
                                                                    : vehicleCentre.tone === 'foreign'
                                                                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40'
                                                                        : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                                                    }`}
                                                                title={vehicleCentre.title}
                                                            >
                                                                {vehicleCentre.label}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={assignmentLoading || isVehicleInCurrentCentre(v)}
                                                            onClick={() => handleVehicleTransferClick(v)}
                                                            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-[#E5007D]/10 text-[#E5007D] hover:bg-[#E5007D]/15 disabled:opacity-50"
                                                            title={isVehicleInCurrentCentre(v) ? 'Ya asignado al centro' : getVehicleCentreActionLabel(v)}
                                                        >
                                                            <FontAwesomeIcon icon={faLink} />
                                                            {getVehicleCentreActionLabel(v)}
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL CONFIRMAR CAMBIO DE CENTRO */}
            {pendingVehicleTransfer && createPortal(
                <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
                    <div
                        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay"
                        onClick={() => setPendingVehicleTransfer(null)}
                    />
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-3">
                            Confirmar cambio de centro
                        </h3>
                        <p className="text-slate-600 dark:text-slate-300 text-center mb-3">
                            Vas a mover el vehículo <span className="font-semibold">{formatVehicleLabel(pendingVehicleTransfer.vehicle, false)}</span> de <span className="font-semibold">{pendingVehicleTransfer.fromCentreName}</span> a <span className="font-semibold">{pendingVehicleTransfer.toCentreName}</span>.
                        </p>
                        <p className="text-sm text-amber-700 dark:text-amber-300 text-center mb-6">
                            Al confirmar, el vehículo dejará de estar disponible en el centro anterior y pasará a este centro.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setPendingVehicleTransfer(null)}
                                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={assignmentLoading}
                                onClick={confirmVehicleTransfer}
                                className="flex-1 px-4 py-3 rounded-xl bg-primary text-white font-semibold hover:brightness-95 transition-colors shadow-lg shadow-primary/20 disabled:opacity-70"
                            >
                                Confirmar cambio
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL ELIMINAR */}
            {deleteId && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-slate-900/60 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay" onClick={() => setDeleteId(null)} />
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Eliminar Centro?</h3>
                        <p className="text-red-500 dark:text-red-400 text-center text-sm font-semibold mb-8">
                            ¡ATENCIÓN! Esta acción eliminará el centro y TODOS sus vehículos, reservas y documentos asociados de forma irreversible.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setDeleteId(null)} className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200">Cancelar</button>
                            <button onClick={confirmDelete} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20">Eliminar</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default CentersView;
