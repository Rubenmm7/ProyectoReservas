import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faCalendarAlt, faFilePdf, faEye, faDownload, faXmark, faExpand } from '@fortawesome/free-solid-svg-icons';
import DatePickerCalendar from './DatePickerCalendar';
import { validateSpanishPlate, filterPlateInput } from '../utils/licensePlateValidator';
import { normalizeSearchText } from '../utils/reservationsViewHelpers';

const BRAND_OPTIONS = [
  'Alfa Romeo',
  'Alpine',
  'Aston Martin',
  'Audi',
  'Bentley',
  'BMW',
  'BYD',
  'Cadillac',
  'Changan',
  'Chery',
  'Chevrolet',
  'Citroen',
  'Cupra',
  'Dacia',
  'Denza',
  'DFSK',
  'Dodge',
  'DR Automobiles',
  'DS Automobiles',
  'Ebro',
  'Ferrari',
  'Fiat',
  'Ford',
  'Geely',
  'GMC',
  'GWM',
  'Honda',
  'Hyundai',
  'Ineos',
  'Isuzu',
  'Jaguar',
  'Jaecoo',
  'Jeep',
  'Kia',
  'Lamborghini',
  'Lancia',
  'Land Rover',
  'Leapmotor',
  'Lepas',
  'Lexus',
  'Lynk & Co',
  'Maserati',
  'Maxus',
  'Mazda',
  'McLaren',
  'Mercedes-Benz',
  'MG',
  'MINI',
  'Mitsubishi',
  'Nissan',
  'Omoda',
  'Opel',
  'Peugeot',
  'Polestar',
  'Porsche',
  'RAM',
  'Renault',
  'Seat',
  'Skoda',
  'Smart',
  'SsangYong / KGM',
  'Subaru',
  'Suzuki',
  'Tesla',
  'Tiger',
  'Toyota',
  'Volkswagen',
  'Volvo',
  'Xpeng',
  'Zeekr'
];

const VEHICLE_TYPE_OPTIONS = ['turismo', 'suv', 'furgoneta', 'industrial', 'berlina', 'monovolumen', 'otro'];
const ENERGY_TYPE_OPTIONS = [
    { value: 'combustion', label: 'Combustión' },
    { value: 'hibrido', label: 'Híbrido' },
    { value: 'electrico', label: 'Eléctrico' },
];
const FUEL_LEVEL_OPTIONS = [
    { value: 'vacio', label: 'Vacío' },
    { value: 'medio-vacio', label: 'Medio vacío' },
    { value: 'medio', label: 'Medio' },
    { value: 'medio-lleno', label: 'Medio lleno' },
    { value: 'lleno', label: 'Lleno' },
];

const INITIAL_FORM_STATE = {
    license_plate: '',
    brand: '',
    model: '',
    vehicle_type: 'turismo',
    seats: 5,
    trunk_capacity_l: '',
    energy_type: 'combustion',
    fuel_level: 'medio',
    extras: '',
    status: 'disponible',
    kilometers: 0,
    centre_id: '',
};

const INITIAL_DOC_FORM_STATE = { type: '', expiration_date: '', original_name: '' };

const STATUS_STYLES = {
    'disponible': 'bg-green-100 text-black dark:bg-green-900/30 dark:text-white/90',
    'no-disponible': 'bg-red-100 text-black dark:bg-red-900/30 dark:text-white/90',
    'reservado': 'bg-amber-100 text-black dark:bg-amber-900/30 dark:text-white/90',
    'en-uso': 'bg-blue-100 text-black dark:bg-blue-900/30 dark:text-white/90',
    'en-taller': 'bg-orange-100 text-black dark:bg-orange-900/30 dark:text-white/90',
    'formulario-entrega-pendiente': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
    'pendiente-validacion': 'bg-cyan-100 text-black dark:bg-cyan-900/30 dark:text-white/90',
};

const STATUS_LABELS = {
    'disponible': 'Disponible',
    'no-disponible': 'No disponible',
    'reservado': 'Reservado',
    'en-uso': 'En uso',
    'en-taller': 'En taller',
    'formulario-entrega-pendiente': 'Formulario entrega pendiente',
    'pendiente-validacion': 'Pendiente de validación'
};

const DOC_TYPE_LABELS = {
    'seguro': 'Seguro',
    'itv': 'ITV',
    'permiso-circulacion': 'Permiso de circulación',
    'ficha-tecnica': 'Ficha técnica',
    'otros': 'Otros',
    'parte-taller': 'Parte de taller'
};

const getVehicleDisplayLabel = (vehicle, includePlate = true) => {
    const brand = String(vehicle?.brand ?? '').trim();
    const model = String(vehicle?.model ?? '').trim();
    const plate = String(vehicle?.license_plate ?? '').trim();
    const name = [brand, model].filter(Boolean).join(' / ') || model || brand || 'Vehículo';
    return includePlate && plate ? `${name} (${plate})` : name;
};

const getVehicleOptionsFilter = (vehicle) => {
    if (Number(vehicle?.has_expired_documents ?? 0) > 0) return 'expired-documents';
    if (Boolean(vehicle?.is_workshop_report_outdated)) return 'workshop-outdated';
    return 'clean';
};

const isDocumentExpired = (expirationDate) => {
    if (!expirationDate) return false;
    const docDate = new Date(expirationDate);
    if (isNaN(docDate.getTime())) return false;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return docDate < todayStart;
};

const VehiclesView = ({ onModalChange, user, routeVehicleView = null }) => {
    const isGestor = user?.role === 'gestor';
    const isMobile = useIsMobile();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal & Form State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingId, setEditingId] = useState(null);
    const [formLoading, setFormLoading] = useState(false);
    const [error, setError] = useState('');
    const [plateError, setPlateError] = useState('');

    // Delete Confirmation State
    const [deleteId, setDeleteId] = useState(null);
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
    const [isCentreDropdownOpen, setIsCentreDropdownOpen] = useState(false);
    const statusDropdownRef = useRef(null);
    const centreDropdownRef = useRef(null);

    // Document Management State
    const [documents, setDocuments] = useState([]);
    const [docsLoading, setDocsLoading] = useState(false);
    const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
    const [isAddDocModalOpen, setIsAddDocModalOpen] = useState(false);
    const [isEditDocModalOpen, setIsEditDocModalOpen] = useState(false);
    const [editingDoc, setEditingDoc] = useState(null);
    const [docFile, setDocFile] = useState(null);
    const [docFormData, setDocFormData] = useState(INITIAL_DOC_FORM_STATE);
    const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
    const [deleteDocId, setDeleteDocId] = useState(null);
    const [selectedVehicle, setSelectedVehicle] = useState(null);
    const typeDropdownRef = useRef(null);
    const [isEditDocDatePickerOpen, setIsEditDocDatePickerOpen] = useState(false);
    const [isAddDocDatePickerOpen, setIsAddDocDatePickerOpen] = useState(false);
    const [docNameError, setDocNameError] = useState('');
    const [pdfPreview, setPdfPreview] = useState(null);

    // Sorting & Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'license_plate', direction: 'asc' });
    const [filterExpired, setFilterExpired] = useState(false);
    const [optionsFilter, setOptionsFilter] = useState('all');
    const [brandFilter, setBrandFilter] = useState('');
    const [vehicleTypeFilter, setVehicleTypeFilter] = useState('');
    const [energyTypeFilter, setEnergyTypeFilter] = useState('');
    const [fuelLevelFilter, setFuelLevelFilter] = useState('');

    const [seatsMinFilter, setSeatsMinFilter] = useState('');
    const [seatsMaxFilter, setSeatsMaxFilter] = useState('');
    const [trunkMinFilter, setTrunkMinFilter] = useState('');
    const [trunkMaxFilter, setTrunkMaxFilter] = useState('');
    const [centres, setCentres] = useState([]);
    const [centreSearchTerm, setCentreSearchTerm] = useState('');
    const autoOpenRequestRef = useRef(null);

    // Paginación y Scroll Infinito
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 7;
    const [visibleItems, setVisibleItems] = useState(7);
    const [totalRecords, setTotalRecords] = useState(0);
    const [serverTotalPages, setServerTotalPages] = useState(0);
    const scrollObserverRef = useRef(null);
    const loadingPagesRef = useRef(new Set());
    const hasMountedRef = useRef(false);
    const routeSortConfig = routeVehicleView?.initialSortConfig ?? null;

    // totalPages se necesita antes de los effects
    const totalPages = serverTotalPages || Math.ceil(totalRecords / itemsPerPage) || 1;
    const routeOpenDocsMode = routeVehicleView?.openMatchingDocs ?? null;

    const vehicleMatchesActiveFilters = (vehicle) => {
        if (filterExpired || optionsFilter === 'expired-documents') {
            return Number(vehicle?.has_expired_documents ?? 0) > 0;
        }

        if (optionsFilter === 'workshop-outdated') {
            return Number(vehicle?.has_expired_documents ?? 0) === 0 && Boolean(vehicle?.is_workshop_report_outdated);
        }

        if (optionsFilter === 'clean') {
            return Number(vehicle?.has_expired_documents ?? 0) === 0 && !Boolean(vehicle?.is_workshop_report_outdated);
        }

        return true;
    };

    const syncVehicleDocuments = (vehicleId, docs) => {
        if (!vehicleId) return;

        const expiredCount = docs.filter(doc => isDocumentExpired(doc.expiration_date)).length;
        let wasVisible = false;
        let willBeVisible = false;

        setVehicles(prev => prev
            .map(vehicle => (
                vehicle.id === vehicleId
                    ? (() => {
                        wasVisible = vehicleMatchesActiveFilters(vehicle);
                        const nextVehicle = { ...vehicle, has_expired_documents: expiredCount };
                        willBeVisible = vehicleMatchesActiveFilters(nextVehicle);
                        return nextVehicle;
                    })()
                    : vehicle
            ))
            .filter(vehicleMatchesActiveFilters)
        );

        if (wasVisible && !willBeVisible) {
            setTotalRecords(prev => Math.max(0, prev - 1));
        }

        setSelectedVehicle(prev =>
            prev?.id === vehicleId ? { ...prev, has_expired_documents: expiredCount } : prev
        );
    };

    const fetchCentres = async () => {
        try {
            const response = await fetch('/api/dashboard/centres?page=1&limit=500');
            const data = await response.json();
            const centresData = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
            setCentres(centresData);
        } catch (error) {
            console.error('Error cargando centros:', error);
        }
    };

    const fetchVehicles = async (page = 1, append = false) => {
        setLoading(true);
        try {
            const searchParam = searchTerm.trim() ? `&search=${encodeURIComponent(searchTerm.trim())}` : '';
            const expiredParam = filterExpired ? '&filterExpired=1' : '';
            const optionsFilterParam = optionsFilter && optionsFilter !== 'all'
                ? `&optionsFilter=${encodeURIComponent(optionsFilter)}`
                : '';
            const brandParam = brandFilter ? `&brand=${encodeURIComponent(brandFilter)}` : '';
            const vehicleTypeParam = vehicleTypeFilter ? `&vehicleType=${encodeURIComponent(vehicleTypeFilter)}` : '';
            const energyTypeParam = energyTypeFilter ? `&energyType=${encodeURIComponent(energyTypeFilter)}` : '';
            const fuelLevelParam = fuelLevelFilter ? `&fuelLevel=${encodeURIComponent(fuelLevelFilter)}` : '';
            const seatsMinParam = seatsMinFilter !== '' ? `&seatsMin=${encodeURIComponent(seatsMinFilter)}` : '';
            const seatsMaxParam = seatsMaxFilter !== '' ? `&seatsMax=${encodeURIComponent(seatsMaxFilter)}` : '';
            const trunkMinParam = trunkMinFilter !== '' ? `&trunkMin=${encodeURIComponent(trunkMinFilter)}` : '';
            const trunkMaxParam = trunkMaxFilter !== '' ? `&trunkMax=${encodeURIComponent(trunkMaxFilter)}` : '';
            const sortParam = sortConfig ? `&sortBy=${sortConfig.key}&sortDir=${sortConfig.direction}` : '';
            const response = await fetch(`/api/dashboard/vehicles?page=${page}&limit=7${searchParam}${expiredParam}${optionsFilterParam}${brandParam}${vehicleTypeParam}${energyTypeParam}${fuelLevelParam}${seatsMinParam}${seatsMaxParam}${trunkMinParam}${trunkMaxParam}${sortParam}`);
            const data = await response.json();
            const nextVehicles = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
            if (!append && !searchTerm.trim() && optionsFilter !== 'all' && nextVehicles.length === 0) {
                if (optionsFilter === 'expired-documents') {
                    setOptionsFilter('workshop-outdated');
                    return;
                }
                setOptionsFilter('all');
                return;
            }
            setVehicles((prev) => append ? [...prev, ...nextVehicles] : nextVehicles);
            setTotalRecords(Number(data?.pagination?.totalRecords || nextVehicles.length));
            setServerTotalPages(Number(data?.pagination?.totalPages || 1));
        } catch (error) {
            console.error('Error cargando vehículos:', error);
        } finally {
            setLoading(false);
            loadingPagesRef.current.delete(page);
        }
    };



    const handlePreviewDocPdf = (doc) => {
        if (!doc.file_path) return;
        setPdfPreview({
            url: `/api/dashboard/documents/${doc.id}/view`,
            fileName: doc.original_name
        });
    };

    const closePdfPreview = () => setPdfPreview(null);

    const downloadPreviewPdf = () => {
        if (!pdfPreview?.url) return;
        const link = document.createElement('a');
        link.href = pdfPreview.url;
        link.download = pdfPreview.fileName;
        link.click();
    };

    useEffect(() => {
        setVehicles([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchVehicles(1, false);
        fetchCentres();
        const intervalId = setInterval(() => {
            fetchVehicles(currentPage, isMobile);
        }, 30000);

        return () => clearInterval(intervalId);
    }, [searchTerm, filterExpired, sortConfig, optionsFilter, brandFilter, vehicleTypeFilter, energyTypeFilter, fuelLevelFilter, seatsMinFilter, seatsMaxFilter, trunkMinFilter, trunkMaxFilter]);

    // Cargar nueva página al navegar (incluido volver a página 1)
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        fetchVehicles(currentPage, isMobile);
    }, [currentPage, isMobile]);

    useEffect(() => {
        // Cerrar dropdown al hacer click fuera
        const handleClickOutside = (event) => {
            if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
                setIsStatusDropdownOpen(false);
            }
            if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target)) {
                setIsTypeDropdownOpen(false);
            }
            if (centreDropdownRef.current && !centreDropdownRef.current.contains(event.target)) {
                setIsCentreDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        if (routeSortConfig?.key) {
            setSortConfig(routeSortConfig);
        }
    }, [routeSortConfig?.key, routeSortConfig?.direction]);

    useEffect(() => {
        if (!routeOpenDocsMode || vehicles.length === 0) return;

        const requestKey = routeOpenDocsMode;
        if (autoOpenRequestRef.current === requestKey) return;

        const targetVehicle = vehicles.find((vehicle) => {
            if (routeOpenDocsMode === 'workshop-outdated') {
                return Boolean(vehicle.is_workshop_report_outdated);
            }

            if (routeOpenDocsMode === 'expired-documents') {
                return Number(vehicle.has_expired_documents ?? 0) > 0;
            }

            return false;
        });

        if (!targetVehicle) return;

        autoOpenRequestRef.current = requestKey;
        handleOpenDocsModal(targetVehicle);
    }, [routeOpenDocsMode, vehicles]);

    // Observer para scroll infinito en móvil
    useEffect(() => {
        if (!isMobile) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    if (visibleItems < vehicles.length) {
                        setVisibleItems((prev) => prev + 7);
                    } else if (currentPage < totalPages) {
                        const nextPage = currentPage + 1;
                        setCurrentPage(nextPage);
                        fetchVehicles(nextPage, true);
                    }
                }
            },
            { threshold: 0.1 }
        );

        if (scrollObserverRef.current) {
            observer.observe(scrollObserverRef.current);
        }

        return () => observer.disconnect();
    }, [isMobile, visibleItems, vehicles.length, currentPage, totalPages]);

    // Bloquear scroll al abrir modal
    useEffect(() => {
        if (isModalOpen || isDocsModalOpen || isAddDocModalOpen || isEditDocModalOpen || deleteId || deleteDocId || isAddDocDatePickerOpen || isEditDocDatePickerOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isModalOpen, isDocsModalOpen, isAddDocModalOpen, isEditDocModalOpen, deleteId, deleteDocId, isAddDocDatePickerOpen, isEditDocDatePickerOpen]);

    const handleOpenModal = (vehicle = null) => {
        setError('');
        setPlateError('');
        if (vehicle) {
            setFormData({
                license_plate: vehicle.license_plate,
                brand: vehicle.brand || '',
                model: vehicle.model,
                vehicle_type: vehicle.vehicle_type || 'turismo',
                seats: vehicle.seats ?? 5,
                trunk_capacity_l: vehicle.trunk_capacity_l ?? '',
                energy_type: vehicle.energy_type || 'combustion',
                fuel_level: vehicle.fuel_level || 'medio',
                extras: vehicle.extras || '',
                status: vehicle.status,
                kilometers: vehicle.kilometers,
                centre_id: vehicle.centre_id || ''
            });
            setEditingId(vehicle.id);
        } else {
            setFormData(INITIAL_FORM_STATE);
            setEditingId(null);
        }
        setCentreSearchTerm('');
        setIsModalOpen(true);
        onModalChange?.(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(INITIAL_FORM_STATE);
        setEditingId(null);
        onModalChange?.(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setFormLoading(true);
        setError('');

        const normalizedPlate = formData.license_plate.replace(/[\s\-]/g, '');
        const validation = validateSpanishPlate(normalizedPlate);

        if (!validation.isValid) {
            setError(validation.error);
            setFormLoading(false);
            return;
        }

        const isEditing = !!editingId;
        const url = isEditing
            ? `/api/dashboard/vehicles/${editingId}`
            : '/api/dashboard/vehicles';

        const payload = {
            ...formData,
            license_plate: normalizedPlate,
            brand: formData.brand.trim(),
            model: formData.model.trim(),
            vehicle_type: formData.vehicle_type,
            seats: formData.seats === '' || formData.seats === null ? undefined : Number(formData.seats),
            trunk_capacity_l: formData.trunk_capacity_l === '' ? undefined : Number(formData.trunk_capacity_l),
            energy_type: formData.energy_type,
            fuel_level: formData.fuel_level,
            extras: formData.extras.trim() || undefined,
            centre_id: formData.centre_id === '' ? undefined : formData.centre_id,
        };

        try {
            const response = await fetch(url, {
                method: isEditing ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al guardar el vehículo');
            }

            await fetchVehicles();
            handleCloseModal();
            toast.success(isEditing ? '¡Vehículo actualizado!' : '¡Vehículo creado!');
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
        setDeleteId(null); // Close the confirmation modal

        const deletePromise = fetch(`/api/dashboard/vehicles/${id}`, {
            method: 'DELETE'
        });

        toast.promise(deletePromise, {
            loading: 'Eliminando...',
            success: () => {
                setVehicles(vehicles.filter(v => v.id !== id));
                return 'Vehículo eliminado';
            },
            error: 'Error al eliminar el vehículo',
        });
    };

    const fetchDocuments = async (vehicleId) => {
        setDocsLoading(true);
        try {
            const response = await fetch(`/api/dashboard/vehicles/${vehicleId}/documents`);
            const data = await response.json();
            const docs = Array.isArray(data) ? data : [];
            setDocuments(docs);
            syncVehicleDocuments(vehicleId, docs);
            return docs;
        } catch (error) {
            console.error('Error cargando documentos:', error);
            toast.error('Error al cargar documentos');
            return [];
        } finally {
            setDocsLoading(false);
        }
    };

    const handleOpenDocsModal = (vehicle) => {
        setSelectedVehicle(vehicle);
        fetchDocuments(vehicle.id);
        setIsDocsModalOpen(true);
        onModalChange?.(true);
    };

    const handleCloseDocsModal = () => {
        setIsDocsModalOpen(false);
        setSelectedVehicle(null);
        setDocuments([]);
        setIsAddDocModalOpen(false);
        setIsEditDocModalOpen(false);
        setEditingDoc(null);
        setDocFile(null);
        setDocFormData(INITIAL_DOC_FORM_STATE);
        setIsTypeDropdownOpen(false);
        setDeleteDocId(null);
        setPdfPreview(null);
        onModalChange?.(false);
    };

    const handleOpenAddDocModal = () => {
        setDocFile(null);
        setEditingDoc(null);
        setDocFormData(INITIAL_DOC_FORM_STATE);
        setIsTypeDropdownOpen(false);
        setIsAddDocModalOpen(true);
    };

    const handleCloseAddDocModal = () => {
        setIsAddDocModalOpen(false);
        setDocFile(null);
        setDocFormData(INITIAL_DOC_FORM_STATE);
        setIsTypeDropdownOpen(false);
        setDocNameError('');
    };

    const handleDeleteDocRequest = (docId) => {
        setDeleteDocId(docId);
    };

    const confirmDeleteDoc = async () => {
        if (!deleteDocId) return;
        const docId = deleteDocId;
        const vehicleId = selectedVehicle?.id;
        setDeleteDocId(null);

        try {
            const response = await fetch(`/api/dashboard/documents/${docId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Error al eliminar el documento');
            }

            setDocuments(prev => {
                const updatedDocs = prev.filter(d => d.id !== docId);
                syncVehicleDocuments(vehicleId, updatedDocs);
                return updatedDocs;
            });
            toast.success('Documento eliminado');
        } catch (error) {
            toast.error(error.message || 'Error al eliminar el documento');
        }
    };

    const handleAddDoc = async (e) => {
        e.preventDefault();
        const trimmedName = docFormData.original_name.trim();

        if (!docFormData.type || !docFormData.expiration_date || !trimmedName) {
            toast.error('El nombre, tipo y fecha son obligatorios');
            return;
        }

        if (trimmedName.length > 30) {
            toast.error('El nombre del documento no puede exceder 30 caracteres');
            setDocNameError('Máximo 30 caracteres');
            return;
        }

        setDocNameError('');

        const formData = new FormData();
        if (docFile) {
            formData.append('pdf', docFile);
        }
        formData.append('type', docFormData.type);
        formData.append('expiration_date', docFormData.expiration_date);
        formData.append('original_name', trimmedName);

        try {
            const response = await fetch(`/api/dashboard/vehicles/${selectedVehicle.id}/documents`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            setDocuments(prev => {
                const updatedDocs = [data.document, ...prev];
                syncVehicleDocuments(selectedVehicle?.id, updatedDocs);
                return updatedDocs;
            });
            handleCloseAddDocModal();
            toast.success('Documento añadido correctamente');
        } catch (error) {
            toast.error(error.message);
        }
    };

    const handleOpenEditDocModal = (doc) => {
        setEditingDoc(doc);
        setDocFile(null);
        setDocFormData({
            type: doc.type,
            expiration_date: doc.expiration_date ? doc.expiration_date.split('T')[0] : '',
            original_name: doc.original_name || ''
        });
        setDocNameError('');
        setIsEditDocModalOpen(true);
    };

    const handleUpdateDoc = async (e) => {
        e.preventDefault();
        const trimmedName = docFormData.original_name.trim();

        if (!docFormData.type || !docFormData.expiration_date || !trimmedName) {
            toast.error('Todos los campos son obligatorios');
            return;
        }

        if (trimmedName.length > 30) {
            toast.error('El nombre del documento no puede exceder 30 caracteres');
            setDocNameError('Máximo 30 caracteres');
            return;
        }

        setDocNameError('');

        const formDataToSend = new FormData();
        if (docFile) {
            formDataToSend.append('pdf', docFile);
        }
        formDataToSend.append('type', docFormData.type);
        formDataToSend.append('expiration_date', docFormData.expiration_date);
        formDataToSend.append('original_name', trimmedName);

        try {
            const response = await fetch(`/api/dashboard/documents/${editingDoc.id}`, {
                method: 'PUT',
                body: formDataToSend
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            setDocuments(prev => {
                const updatedDocs = prev.map(d => d.id === editingDoc.id ? { ...d, ...docFormData } : d);
                syncVehicleDocuments(selectedVehicle?.id, updatedDocs);
                return updatedDocs;
            });
            setIsEditDocModalOpen(false);
            setEditingDoc(null);
            setDocFormData(INITIAL_DOC_FORM_STATE);
            setDocFile(null);
            setIsTypeDropdownOpen(false);
            setDocNameError('');
            toast.success(docFile ? 'Documento y PDF actualizados correctamente' : 'Documento actualizado correctamente');
        } catch (error) {
            toast.error(error.message);
        }
    };

    const sortedVehicles = vehicles;
    const cycleOptionsFilter = () => {
        setFilterExpired(false);
        setOptionsFilter((prev) => {
            if (prev === 'all') return 'expired-documents';
            if (prev === 'expired-documents') return 'workshop-outdated';
            return 'all';
        });
    };

    // Datos paginados
    const paginatedVehicles = isMobile
        ? sortedVehicles.slice(0, visibleItems)
        : sortedVehicles;
    const shouldStretchRows = !isMobile && paginatedVehicles.length === itemsPerPage;
    const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
        rowCount: paginatedVehicles.length,
        enabled: shouldStretchRows,
    });

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
            {isMobile ? (
                // --- CABECERA MÓVIL (2 filas) ---
                <div className="select-none flex flex-col gap-4 mb-6">
                    {/* Fila 1: Título, Buscador, Contador */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Vehículos</h2>
                            <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                                {totalRecords} vehículos
                            </span>
                        </div>
                        <div className="select-none relative w-full">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Buscar por modelo o matrícula..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                            />
                        </div>
                    </div>

                    {/* Fila 2: Filtro Docs a la izquierda, Añadir a la derecha */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => {
                                setOptionsFilter('all');
                                setFilterExpired((prev) => !prev);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all border ${filterExpired
                                ? 'bg-red-500 text-white border-red-500 shadow-md shadow-red-500/20'
                                : 'text-red-500 bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/20'
                                }`}
                            title={filterExpired ? "Mostrar todos" : "Filtrar expirados"}
                        >
                            <svg className={`w-4 h-4 transition-transform duration-300 ${filterExpired ? 'scale-110' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </button>

                        {!isGestor && (
                            <button
                                onClick={() => handleOpenModal()}
                                className="bg-primary hover:brightness-95 text-white px-3 py-1.5 rounded-xl font-medium text-sm flex items-center transition-colors shadow-sm shadow-primary/20"
                                title="Añadir vehículo">
                                <span className="text-lg mr-1 leading-none">+</span>
                                <span>Añadir</span>
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                // --- CABECERA DESKTOP (separada en 2 líneas) ---
                <div className="select-none flex flex-col gap-6 mb-6 shrink-0 w-full">
                    {/* Primera línea: Título a la izquierda + Contador y botón a la derecha */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Vehículos</h2>
                        <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                            {totalRecords} Registros
                        </span>
                    </div>

                    {/* Segunda línea: Búsqueda y filtros */}
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="relative flex-1 min-w-[260px] max-w-xl">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Buscar por modelo o matrícula..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                            />
                        </div>

                        <div className="flex-1 flex justify-end gap-6">
                            <button
                                onClick={() => {
                                    setOptionsFilter('all');
                                    setFilterExpired((prev) => !prev);
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border ${filterExpired
                                    ? 'bg-red-500 text-white border-red-500 shadow-md shadow-red-500/20'
                                    : 'text-white bg-red-500 dark:bg-red-600 dark:text-black/300 border-red-100 hover:text-black/300 dark:border-red-500/30 hover:bg-red-600 dark:hover:bg-red-700/50'
                                }`}
                                title={filterExpired ? "Mostrar todos" : "Filtrar por documentos expirados"}
                            >
                                <svg className={`w-5 h-5 transition-transform duration-300 ${filterExpired ? 'scale-110' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-sm font-bold">
                                    Documentos expirados
                                </span>
                            </button>
                            {!isGestor && (
                                <button
                                    onClick={() => handleOpenModal()}
                                    className="bg-primary hover:brightness-95 text-white px-4 py-1.5 rounded-xl font-medium text-sm flex items-end transition-colors shadow-sm shadow-primary/20"
                                    title="Añadir vehículo">
                                    <span className="text-xl mr-1.5 leading-none mb-0.5">+</span>
                                    <span>Añadir vehículo</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="mb-4 flex flex-wrap items-end gap-3">
                <select
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                    className="min-w-[160px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                >
                    <option value="">Todas las marcas</option>
                    {BRAND_OPTIONS.map((brand) => (
                        <option key={brand} value={brand}>{brand}</option>
                    ))}
                </select>
                <select
                    value={vehicleTypeFilter}
                    onChange={(e) => setVehicleTypeFilter(e.target.value)}
                    className="min-w-[160px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                >
                    <option value="">Todos los tipos</option>
                    {VEHICLE_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                    ))}
                </select>
                <select
                    value={energyTypeFilter}
                    onChange={(e) => setEnergyTypeFilter(e.target.value)}
                    className="min-w-[150px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                >
                    <option value="">Todas las energías</option>
                    {ENERGY_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <select
                    value={fuelLevelFilter}
                    onChange={(e) => setFuelLevelFilter(e.target.value)}
                    className="min-w-[170px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                >
                    <option value="">Combustible / batería</option>
                    {FUEL_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>

                <input
                    type="number"
                    min="1"
                    value={seatsMinFilter}
                    onChange={(e) => setSeatsMinFilter(e.target.value)}
                    placeholder="Plazas mín."
                    className="w-28 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                />
                <input
                    type="number"
                    min="1"
                    value={seatsMaxFilter}
                    onChange={(e) => setSeatsMaxFilter(e.target.value)}
                    placeholder="Plazas máx."
                    className="w-28 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                />
                <input
                    type="number"
                    min="0"
                    value={trunkMinFilter}
                    onChange={(e) => setTrunkMinFilter(e.target.value)}
                    placeholder="Maletero mín."
                    className="w-32 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                />
                <input
                    type="number"
                    min="0"
                    value={trunkMaxFilter}
                    onChange={(e) => setTrunkMaxFilter(e.target.value)}
                    placeholder="Maletero máx."
                    className="w-32 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary/20 outline-none"
                />
                {(() => {
                    const hasActiveFilters = brandFilter !== '' || vehicleTypeFilter !== '' || energyTypeFilter !== '' || fuelLevelFilter !== '' || seatsMinFilter !== '' || seatsMaxFilter !== '' || trunkMinFilter !== '' || trunkMaxFilter !== '';
                    return (
                        <button
                            type="button"
                            onClick={() => {
                                setBrandFilter('');
                                setVehicleTypeFilter('');
                                setEnergyTypeFilter('');
                                setFuelLevelFilter('');
                                setSeatsMinFilter('');
                                setSeatsMaxFilter('');
                                setTrunkMinFilter('');
                                setTrunkMaxFilter('');
                            }}
                            className={`px-3 py-2 rounded-xl border transition-colors ${hasActiveFilters ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-900/20 dark:border-red-500/30 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                            Limpiar filtros
                        </button>
                    );
                })()}
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                    <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p className="italic">Cargando vehículos...</p>
                </div>
            ) : sortedVehicles.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No hay vehículos para mostrar</p>
                    <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
                        {searchTerm || filterExpired ? 'Pruebe a cambiar los filtros de búsqueda.' : 'Los vehículos que añadas aparecerán aquí.'}
                    </p>
                </div>
            ) : isMobile ? (


                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {/* Modo móvil */}
                    {paginatedVehicles.map((v) => (
                        <div
                            key={v.id}
                            className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700/50 shadow-sm hover:border-primary/50 dark:hover:border-primary/50 transition-all group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight">{getVehicleDisplayLabel(v, false)}</h3>
                                    <p className="text-primary font-mono text-sm mt-0.5">{v.license_plate}</p>
                                </div>
                                <span className={`chip-uniform px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[v.status.toLowerCase()] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700'}`}>
                                    {v.status.replace(/-/g, ' ')}
                                </span>
                            </div>
                            <div className="flex flex-col gap-2 mb-4">
                                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    <span className="text-xs font-medium">{v.centre_name || 'Sin centro'}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400 mb-5">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold">
                                        {String(Math.round(Number(v.kilometers))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50">
                                <button
                                    onClick={() => handleOpenDocsModal(v)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${v.has_expired_documents > 0
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100'
                                        : v.is_workshop_report_outdated
                                            ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100'
                                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100'
                                        }`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Documentos
                                </button>
                                <div className="flex items-center gap-2">
                                    {!isGestor && (
                                        <>
                                            <button
                                                onClick={() => handleOpenModal(v)}
                                                className="p-2.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 transition-colors"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClick(v.id)}
                                                className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 transition-colors"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {visibleItems < sortedVehicles.length && (
                        <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
                    <div ref={tableWrapperRef} className="flex-1 overflow-hidden"> {/* Tabla de vehículos */}
                        <table className="w-full text-sm text-left relative">
                            <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                                <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                                    <th onClick={() => requestSort('model')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Vehículo {getSortIcon('model')}
                                        </div>
                                    </th>
                                    <th onClick={() => requestSort('license_plate')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Matrícula {getSortIcon('license_plate')}
                                        </div>
                                    </th>
                                    <th onClick={() => requestSort('status')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Estado {getSortIcon('status')}
                                        </div>
                                    </th>
                                    <th onClick={() => requestSort('kilometers')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Kilómetros {getSortIcon('kilometers')}
                                        </div>
                                    </th>
                                    <th onClick={() => requestSort('centre_name')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Centro {getSortIcon('centre_name')}
                                        </div>
                                    </th>

                                    <th onClick={cycleOptionsFilter} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                        <div className="flex items-center justify-center">
                                            Opciones
                                            <svg className="w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                            </svg>
                                        </div>
                                    </th>

                                </tr>
                            </thead>
                            <tbody>
                                {paginatedVehicles.map((v) => (
                                    (() => {
                                        const vehicleOptionsFilter = getVehicleOptionsFilter(v);
                                        const isExpiredDocs = vehicleOptionsFilter === 'expired-documents';
                                        const isWorkshopOutdated = vehicleOptionsFilter === 'workshop-outdated';

                                        return (
                                    <tr key={v.id} style={rowHeight != null ? { height: `${rowHeight}px` } : undefined} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                        <td className="py-3.6 px-4 text-center font-medium text-slate-700 dark:text-slate-200">{getVehicleDisplayLabel(v, false)}</td>
                                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                                            <span
                                                className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                                                title={v.license_plate}
                                            >
                                                {v.license_plate}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[v.status.toLowerCase()] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                                {STATUS_LABELS[v.status]}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">{String(Math.round(Number(v.kilometers))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km</td>
                                        <td className="py-3 px-4 text-center text-slate-600 dark:text-slate-400">
                                            <span
                                                className="inline-block max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap"
                                                title={v.centre_name || '—'}
                                            >
                                                {v.centre_name || '—'}
                                            </span>
                                        </td>

                                        {/* Botones de opciones (editar y eliminar)*/}
                                        <td className="py-3 px-4 text-center whitespace-nowrap">
                                            <button
                                                onClick={() => handleOpenDocsModal(v)}
                                                className={`p-2 rounded-lg transition-colors mr-1 ${isExpiredDocs
                                                    ? 'text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40'
                                                    : isWorkshopOutdated
                                                        ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                        : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                                                    }`}
                                                title={isExpiredDocs
                                                    ? "Documentación expirada"
                                                    : isWorkshopOutdated
                                                        ? "Parte de taller desactualizado (>15.000 km)"
                                                        : "Documentos"}
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            </button>
                                            {!isGestor && (
                                                <>
                                                    <button
                                                        onClick={() => handleOpenModal(v)}
                                                        className="p-2 text-slate-400 hover:text-primary hover:bg-primary/20 dark:hover:bg-primary/20 rounded-lg transition-colors mr-1"
                                                        title="Editar vehículo"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteClick(v.id)}
                                                        aria-label="Eliminar vehículo"
                                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                        title="Eliminar vehículo"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                        );
                                    })()
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
                                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
            )}

            {/* MODAL */}
            {isModalOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-[90vh] sm:max-w-4xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                {editingId ? 'Editar vehículo' : 'Añadir nuevo vehículo'}
                            </h3>
                            <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex-1 overflow-y-auto form-scrollbar p-6 space-y-4 pb-32">
                                {error && (
                                    <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800/50">
                                        {error}
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Matrícula
                                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">(4 dígitos + 3 letras)</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        maxLength="7"
                                        className={`w-full px-4 py-2 rounded-xl border transition-all outline-none uppercase font-mono tracking-wider ${plateError
                                            ? 'border-red-500 dark:border-red-500 bg-red-50 dark:bg-red-900/20 text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500'
                                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary'
                                            }`}
                                        placeholder="1234BCB"
                                        value={formData.license_plate}
                                        onChange={e => {
                                            const filtered = filterPlateInput(e.target.value);
                                            setFormData({ ...formData, license_plate: filtered });

                                            if (filtered.length === 0) {
                                                setPlateError('');
                                            } else if (filtered.length === 7) {
                                                const validation = validateSpanishPlate(filtered);
                                                setPlateError(validation.isValid ? '' : validation.error);
                                            } else {
                                                setPlateError('');
                                            }
                                        }}
                                    />
                                    {plateError && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center">
                                            {plateError}
                                        </p>
                                    )}
                                    {formData.license_plate.length === 7 && !plateError && (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1 flex items-center">
                                            <span className="mr-1">✓</span>
                                            Formato válido
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Modelo
                                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
                                            ({formData.model.length}/60)
                                        </span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        maxLength="60"
                                        className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                                        placeholder="Ford Transit"
                                        value={formData.model}
                                        onChange={e => setFormData({ ...formData, model: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Marca</label>
                                        <select
                                            required
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                                            value={formData.brand}
                                            onChange={e => setFormData({ ...formData, brand: e.target.value })}
                                        >
                                            <option value="">Seleccionar marca...</option>
                                            {BRAND_OPTIONS.map((brand) => (
                                                <option key={brand} value={brand}>{brand}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de vehículo</label>
                                        <select
                                            required
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                                            value={formData.vehicle_type}
                                            onChange={e => setFormData({ ...formData, vehicle_type: e.target.value })}
                                        >
                                            {VEHICLE_TYPE_OPTIONS.map((type) => (
                                                <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Plazas</label>
                                        <input
                                            type="number"
                                            required
                                            min="1"
                                            max="99"
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all"
                                            value={formData.seats}
                                            onChange={e => setFormData({ ...formData, seats: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Maletero (L)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="99999"
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all"
                                            placeholder="Opcional"
                                            value={formData.trunk_capacity_l}
                                            onChange={e => setFormData({ ...formData, trunk_capacity_l: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Energía</label>
                                        <select
                                            required
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                                            value={formData.energy_type}
                                            onChange={e => setFormData({ ...formData, energy_type: e.target.value })}
                                        >
                                            {ENERGY_TYPE_OPTIONS.map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Combustible / batería</label>
                                        <select
                                            required
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                                            value={formData.fuel_level}
                                            onChange={e => setFormData({ ...formData, fuel_level: e.target.value })}
                                        >
                                            {FUEL_LEVEL_OPTIONS.map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Extras</label>
                                    <textarea
                                        rows="3"
                                        maxLength="2000"
                                        className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all resize-none"
                                        placeholder="Bluetooth, Android Auto, cámara trasera..."
                                        value={formData.extras}
                                        onChange={e => setFormData({ ...formData, extras: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Estado</label>
                                        <div className="relative" ref={statusDropdownRef}>
                                            <button
                                                type="button"
                                                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                                className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all flex justify-between items-center"
                                            >
                                                <span className={!formData.status ? 'text-slate-400' : ''}>
                                                    {STATUS_LABELS[formData.status] || 'Seleccionar estado...'}
                                                </span>
                                                <svg className={`w-4 h-4 transition-transform duration-200 ${isStatusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>

                                            {isStatusDropdownOpen && (
                                                <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                                        {['disponible', 'no-disponible', 'reservado', 'en-uso', 'en-taller', 'formulario-entrega-pendiente', 'pendiente-validacion'].map(s => (
                                                            <div
                                                                key={s}
                                                                onClick={() => {
                                                                    setFormData({ ...formData, status: s });
                                                                    setIsStatusDropdownOpen(false);
                                                                }}
                                                                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between
                                                                    ${formData.status === s
                                                                        ? 'bg-primary/10 text-primary font-medium'
                                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                            >
                                                                <span>{STATUS_LABELS[s]}</span>
                                                                {formData.status === s && (
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
                                        <input type="hidden" required value={formData.status} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            Kilómetros
                                        </label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            max="15000000"
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all"
                                            placeholder="0"
                                            value={formData.kilometers === 0 ? '' : formData.kilometers}
                                            onChange={e => {
                                                const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                if (value <= 15000000) {
                                                    setFormData({ ...formData, kilometers: value });
                                                }
                                            }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Centro</label>
                                    <div className="relative" ref={centreDropdownRef}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsCentreDropdownOpen(!isCentreDropdownOpen);
                                                if (!isCentreDropdownOpen) setCentreSearchTerm('');
                                            }}
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all flex justify-between items-center"
                                        >
                                            <span className={!formData.centre_id ? 'text-slate-400' : ''}>
                                                {centres.find(c => c.id === formData.centre_id)?.nombre || 'Seleccionar centro...'}
                                            </span>
                                            <svg className={`w-4 h-4 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>

                                        {isCentreDropdownOpen && (
                                            <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                <div className="p-2 border-b border-slate-100 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50">
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar centro..."
                                                            value={centreSearchTerm}
                                                            onChange={(e) => setCentreSearchTerm(e.target.value)}
                                                            className="w-full pl-8 pr-4 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all text-slate-700 dark:text-slate-200"
                                                            autoFocus
                                                        />
                                                        <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                                        </svg>
                                                    </div>
                                                </div>
                                                <div className="max-h-[260px] overflow-y-auto custom-scrollbar">
                                                    {centres.filter(c => normalizeSearchText(c.nombre).includes(normalizeSearchText(centreSearchTerm))).length === 0 ? (
                                                        <div className="px-4 py-3 text-xs text-slate-500 italic text-center">No se encontraron centros</div>
                                                    ) : (
                                                        centres
                                                            .filter(c => normalizeSearchText(c.nombre).includes(normalizeSearchText(centreSearchTerm)))
                                                            .map(c => (
                                                                <div
                                                                    key={c.id}
                                                                    onClick={() => {
                                                                        setFormData({ ...formData, centre_id: c.id });
                                                                        setIsCentreDropdownOpen(false);
                                                                    }}
                                                                    className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between
                                                                        ${formData.centre_id === c.id
                                                                            ? 'bg-primary/10 text-primary font-medium'
                                                                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                                >
                                                                    <span>{c.nombre}</span>
                                                                    {formData.centre_id === c.id && (
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
                                    <input type="hidden" required value={formData.centre_id} />
                                </div>
                            </div>

                            <div className="select-none p-6 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 flex gap-3">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={formLoading}
                                    className="flex-1 px-4 py-2 bg-primary hover:brightness-95 text-white rounded-xl transition-colors font-medium shadow-sm shadow-primary/30 disabled:opacity-70 flex justify-center items-center"
                                >
                                    {formLoading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    ) : (
                                        editingId ? 'Guardar Cambios' : 'Añadir'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* Modal de Confirmación de Eliminación */}
            {deleteId && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                            Esta acción eliminará el vehículo permanentemente y no se puede deshacer.
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

            {/* MODAL DE DOCUMENTOS */}
            {isDocsModalOpen && (
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay p-0 sm:p-10">
                    <div className={`bg-white dark:bg-slate-800 shadow-2xl w-full h-[92vh] sm:h-full sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up border-x border-b sm:border border-slate-200 dark:border-slate-700 ${pdfPreview ? 'sm:max-w-6xl' : 'sm:max-w-4xl'}`}>
                        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50">
                            <div className="min-w-0 flex-1 mr-4">
                                <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white truncate">Documentación</h3>
                                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">{getVehicleDisplayLabel(selectedVehicle)}</p>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                                {!isGestor && (
                                    <button
                                        onClick={handleOpenAddDocModal}
                                        className="select-none px-3 py-1.5 sm:px-4 sm:py-2 bg-primary hover:brightness-95 text-white rounded-xl transition-all font-medium flex items-center gap-2 shadow-sm shadow-primary/20"
                                        title="Añadir Documento"
                                    >
                                        <span className="text"> + Nuevo</span>
                                        <span className="hidden sm:inline">documento</span>
                                    </button>
                                )}
                                <button onClick={handleCloseDocsModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2" title="Cerrar">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                            <div className={`flex-1 overflow-y-auto p-4 sm:p-6 transition-all duration-300 ${pdfPreview ? 'hidden md:block md:w-1/2 lg:w-2/5 border-r border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/10' : 'w-full'}`}>
                                {docsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-20">
                                        <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                                        <p className="text-slate-500 dark:text-slate-400 italic">Cargando documentos...</p>
                                    </div>
                                ) : documents.length === 0 ? (
                                    <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/40 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                                        <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p className="text-slate-500 dark:text-slate-400 font-medium">No hay documentos registrados</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4">
                                        <table className="w-full text-sm text-left">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                                                    <th className="pb-3 px-4">Tipo</th>
                                                    <th className="pb-3 px-4">Nombre Original</th>
                                                    <th className="pb-3 px-4">Vencimiento</th>
                                                    {(!isGestor || documents.some(d => d.file_path)) && (
                                                        <th className="pb-3 px-4 text-center">Acciones</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {documents.map(doc => (
                                                    <tr key={doc.id} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800/40 dark:even:bg-slate-900/20 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                                        <td className="py-3 px-4 font-bold text-slate-700 dark:text-white">{DOC_TYPE_LABELS[doc.type] || doc.type}</td>
                                                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={doc.original_name}>
                                                            {doc.original_name}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            {doc.expiration_date ? (
                                                                <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold ${isDocumentExpired(doc.expiration_date) ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-primary/10 text-primary dark:bg-primary/20'}`}>
                                                                    {new Date(doc.expiration_date).toLocaleDateString()}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 italic">No expira</span>
                                                            )}
                                                        </td>
                                                        {(!isGestor || documents.some(d => d.file_path)) && (
                                                        <td className="py-3 px-4 text-center whitespace-nowrap">
                                                            <div className="flex items-center justify-center gap-1">
                                                                {doc.file_path && (
                                                                    <button
                                                                        onClick={() => handlePreviewDocPdf(doc)}
                                                                        className={`p-2 rounded-lg transition-all ${pdfPreview?.url?.includes(doc.id) ? 'bg-primary text-white shadow-sm' : 'text-primary hover:bg-primary/10'}`}
                                                                        title="Ver PDF"
                                                                    >
                                                                        <FontAwesomeIcon icon={faFilePdf} className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                {!isGestor && (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleOpenEditDocModal(doc)}
                                                                            className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                                                            title="Editar documento"
                                                                        >
                                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                                            </svg>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleDeleteDocRequest(doc.id)}
                                                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                                            title="Eliminar documento"
                                                                        >
                                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                            </svg>
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {pdfPreview && (
                                <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900 animate-in slide-in-from-right duration-300 relative">
                                    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 backdrop-blur-md">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Vista previa</p>
                                            <p className="text-sm font-bold text-slate-700 dark:text-white truncate">{pdfPreview.fileName}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => window.open(pdfPreview.url, '_blank')}
                                                className="p-2 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                                                title="Pantalla completa"
                                            >
                                                <FontAwesomeIcon icon={faExpand} className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={downloadPreviewPdf}
                                                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                                title="Descargar"
                                            >
                                                <FontAwesomeIcon icon={faDownload} className="w-4 h-4" />
                                            </button>
                                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                                            <button
                                                onClick={closePdfPreview}
                                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-all"
                                                title="Cerrar vista previa"
                                            >
                                                <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                    <iframe
                                        src={pdfPreview.url}
                                        title="Vista previa PDF"
                                        className="w-full flex-1 border-none bg-slate-200 dark:bg-slate-900"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* SUB-MODAL: AÑADIR DOCUMENTO */}
                    {isAddDocModalOpen && (
                        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 sm:p-20">
                            <div className="fixed inset-0 bg-slate-900/50 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay" onClick={handleCloseAddDocModal} />
                            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md relative z-10 animate-scale-in border border-slate-200 dark:border-slate-700 overflow-hidden">
                                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                    <h4 className="text-lg font-bold text-slate-800 dark:text-white">Nuevo documento</h4>
                                    <button onClick={handleCloseAddDocModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>

                                <form onSubmit={handleAddDoc} className="p-6 space-y-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nombre del documento</label>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">{docFormData.original_name.length}/30</span>
                                        </div>
                                        <input
                                            type="text"
                                            required
                                            maxLength="30"
                                            className={`w-full px-4 py-2.5 rounded-xl border ${docNameError ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 ${docNameError ? 'focus:ring-red-500' : 'focus:ring-primary'} transition-all font-medium`}
                                            placeholder="Ej: Seguro Allianz 2024"
                                            value={docFormData.original_name}
                                            onChange={e => {
                                                const trimmedValue = e.target.value.trimStart();
                                                setDocFormData({ ...docFormData, original_name: trimmedValue });
                                                if (trimmedValue.length > 30) {
                                                    setDocNameError('Máximo 30 caracteres');
                                                } else {
                                                    setDocNameError('');
                                                }
                                            }}
                                        />
                                        {docNameError && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{docNameError}</p>}
                                    </div>

                                    <div className="relative" ref={typeDropdownRef}>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de documento</label>
                                        <button
                                            type="button"
                                            onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                                            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all flex justify-between items-center"
                                        >
                                            <span className={!docFormData.type ? 'text-slate-400' : ''}>
                                                {DOC_TYPE_LABELS[docFormData.type] || 'Seleccionar tipo...'}
                                            </span>
                                            <svg className={`w-4 h-4 transition-transform duration-200 ${isTypeDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>

                                        {isTypeDropdownOpen && (
                                            <div className="absolute z-[90] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                                    {['seguro', 'itv', 'permiso-circulacion', 'ficha-tecnica', 'parte-taller', 'otros'].map(t => (
                                                        <div
                                                            key={t}
                                                            onClick={() => {
                                                                setDocFormData({ ...docFormData, type: t });
                                                                setIsTypeDropdownOpen(false);
                                                            }}
                                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between 
                                                                ${docFormData.type === t
                                                                    ? 'bg-primary/10 text-primary font-medium'
                                                                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                        >
                                                            <span>{DOC_TYPE_LABELS[t]}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fecha de expiración</label>
                                        <button
                                            type="button"
                                            onClick={() => setIsAddDocDatePickerOpen(true)}
                                            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary transition-all font-medium flex items-center justify-between hover:border-primary dark:hover:border-primary"
                                        >
                                            <span>{docFormData.expiration_date ? new Date(docFormData.expiration_date).toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' }) : 'Seleccionar fecha...'}</span>
                                            <FontAwesomeIcon icon={faCalendarAlt} className="text-primary" />
                                        </button>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Archivo PDF</label>
                                        <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-300 dark:border-slate-600 border-dashed rounded-2xl hover:border-primary/50 transition-colors cursor-pointer relative group">
                                            <input
                                                type="file"
                                                accept=".pdf"
                                                onChange={e => setDocFile(e.target.files[0])}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            />
                                            <div className="space-y-1 text-center">
                                                <svg className="mx-auto h-10 w-10 text-slate-400 group-hover:text-primary transition-colors" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                                                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                                <div className="flex text-sm text-slate-600 dark:text-slate-400">
                                                    <span className="relative rounded-md font-medium text-primary hover:brightness-90">
                                                        {docFile ? docFile.name : 'Haz clic para subir'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-500">Sólo PDF hasta 5MB</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="select-none pt-4 flex gap-3">
                                        <button
                                            type="button"
                                            onClick={handleCloseAddDocModal}
                                            className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 transition-colors font-medium"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            className="flex-1 px-4 py-2.5 bg-primary hover:brightness-95 text-white rounded-xl transition-all font-medium shadow-lg shadow-primary/20"
                                        >
                                            Añadir
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* DATE PICKER PARA AGREGAR DOCUMENTO */}
                    <DatePickerCalendar
                        isOpen={isAddDocDatePickerOpen}
                        onClose={() => setIsAddDocDatePickerOpen(false)}
                        onSelect={(date) => setDocFormData({ ...docFormData, expiration_date: date })}
                        initialDate={docFormData.expiration_date}
                    />

                    {/* Modal de Confirmación de Eliminación de Documento */}
                    {deleteDocId && (
                        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                            <div
                                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
                                onClick={() => setDeleteDocId(null)}
                            />
                            <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full relative z-10 shadow-2xl animate-scale-in border border-slate-200 dark:border-slate-700">
                                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-center text-slate-800 dark:text-white mb-2">¿Eliminar documento?</h3>
                                <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
                                    Esta acción eliminará el documento permanentemente y no se puede deshacer.
                                </p>
                                <div className="select-none flex gap-3">
                                    <button
                                        onClick={() => setDeleteDocId(null)}
                                        className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmDeleteDoc}
                                        className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                                    >
                                        Sí, eliminar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* MODAL PARA EDITAR DOCUMENTO */}
                    {isEditDocModalOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-10 bg-slate-900/40 backdrop-blur-sm">
                            <div className="bg-white dark:bg-slate-800 shadow-2xl w-full max-w-lg rounded-3xl overflow-hidden flex flex-col transform transition-all border border-slate-200 dark:border-slate-700 animate-scale-in">
                                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50">
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Editar documento</h3>
                                    <button onClick={() => { setIsEditDocModalOpen(false); setEditingDoc(null); setDocFormData(INITIAL_DOC_FORM_STATE); setIsTypeDropdownOpen(false); setDocNameError(''); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-2">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                                <div className="p-8">
                                    <form onSubmit={handleUpdateDoc} className="space-y-6">
                                        <div>
                                            <div className="flex justify-between items-center mb-1">
                                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nombre del documento</label>
                                                <span className="text-xs text-slate-500 dark:text-slate-400">{docFormData.original_name.length}/30</span>
                                            </div>
                                            <input
                                                type="text"
                                                required
                                                maxLength="30"
                                                className={`w-full px-4 py-2.5 rounded-xl border ${docNameError ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 ${docNameError ? 'focus:ring-red-500' : 'focus:ring-primary'} transition-all font-medium`}
                                                placeholder="Ej: Seguro Allianz 2024"
                                                value={docFormData.original_name}
                                                onChange={e => {
                                                    const trimmedValue = e.target.value.trimStart();
                                                    setDocFormData({ ...docFormData, original_name: trimmedValue });
                                                    if (trimmedValue.length > 30) {
                                                        setDocNameError('Máximo 30 caracteres');
                                                    } else {
                                                        setDocNameError('');
                                                    }
                                                }}
                                            />
                                            {docNameError && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{docNameError}</p>}
                                        </div>

                                        <div className="relative" ref={typeDropdownRef}>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de documento</label>
                                            <button
                                                type="button"
                                                onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all flex justify-between items-center font-medium"
                                            >
                                                <span>{docFormData.type ? DOC_TYPE_LABELS[docFormData.type] : 'Seleccionar tipo...'}</span>
                                                <svg className={`w-4 h-4 transition-transform duration-200 ${isTypeDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>

                                            {isTypeDropdownOpen && (
                                                <div className="absolute z-[120] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                                        {['seguro', 'itv', 'permiso-circulacion', 'ficha-tecnica', 'parte-taller', 'otros'].map(t => (
                                                            <div
                                                                key={t}
                                                                onClick={() => {
                                                                    setDocFormData({ ...docFormData, type: t });
                                                                    setIsTypeDropdownOpen(false);
                                                                }}
                                                                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between
                                                                        ${docFormData.type === t
                                                                        ? 'bg-primary/10 text-primary font-medium'
                                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                            >
                                                                <span>{DOC_TYPE_LABELS[t]}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fecha de expiración</label>
                                            <button
                                                type="button"
                                                onClick={() => setIsEditDocDatePickerOpen(true)}
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary transition-all font-medium flex items-center justify-between hover:border-primary dark:hover:border-primary"
                                            >
                                                <span>{docFormData.expiration_date ? new Date(docFormData.expiration_date).toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' }) : 'Seleccionar fecha...'}</span>
                                                <FontAwesomeIcon icon={faCalendarAlt} className="text-primary" />
                                            </button>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Archivo PDF (opcional)</label>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Si desea reemplazar el PDF actual, seleccione uno nuevo. Si no selecciona archivo, se mantendrá el actual.</p>
                                            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-300 dark:border-slate-600 border-dashed rounded-2xl hover:border-primary/50 transition-colors cursor-pointer relative group">
                                                <input
                                                    type="file"
                                                    accept=".pdf"
                                                    onChange={e => setDocFile(e.target.files[0])}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                />
                                                <div className="space-y-1 text-center">
                                                    <svg className="mx-auto h-10 w-10 text-slate-400 group-hover:text-primary transition-colors" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                                                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                    <div className="flex text-sm text-slate-600 dark:text-slate-400">
                                                        <span className="relative rounded-md font-medium text-primary hover:brightness-90">
                                                            {docFile ? docFile.name : 'Haz clic para subir'}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500">Sólo PDF hasta 5MB</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="select-none pt-4 flex gap-3">
                                            <button
                                                type="button"
                                                onClick={() => { setIsEditDocModalOpen(false); setEditingDoc(null); setDocFormData(INITIAL_DOC_FORM_STATE); setIsTypeDropdownOpen(false); setDocNameError(''); }}
                                                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/80 text-white rounded-xl transition-all font-medium shadow-lg shadow-primary/20"
                                            >
                                                Guardar
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DATE PICKER PARA EDITAR DOCUMENTO */}
                    <DatePickerCalendar
                        isOpen={isEditDocDatePickerOpen}
                        onClose={() => setIsEditDocDatePickerOpen(false)}
                        onSelect={(date) => setDocFormData({ ...docFormData, expiration_date: date })}
                        initialDate={docFormData.expiration_date}
                    />
                </div>
            )}
        </div>
    );
};

export default VehiclesView;

