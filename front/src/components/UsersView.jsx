import { apiFetch } from '../utils/http';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import useIsMobile from '../hooks/useIsMobile';
import { useAdaptiveTableRowHeight } from '../hooks/useAdaptiveTableRowHeight';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { normalizeSearchText } from '../utils/reservationsViewHelpers';
import { useCurrentUser } from '../hooks/useCurrentUser';

const INITIAL_FORM_STATE = { username: '', password: '', confirmPassword: '', role: 'empleado', centre_ids: [] };

const STATUS_STYLES = {
    'empleado': 'bg-green-100 text-black dark:bg-green-900/30 dark:text-white/90',
    'admin': 'bg-red-100 text-black dark:bg-red-900/30 dark:text-white/90',
    'supervisor': 'bg-amber-100 text-black dark:bg-amber-900/30 dark:text-white/90',
};

const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

const getUserCentresLabel = (user, centres) => {
    if (user?.role === 'admin') return 'Global';

    const centreNames = user?.centre_ids
        ?.map((id) => centres.find((c) => c.id === id)?.nombre)
        .filter(Boolean)
        .join(', ');

    return centreNames || 'Sin centro asignado';
};

const UsersView = ({ onModalChange }) => {
    const isMobile = useIsMobile();
    const { currentUser } = useCurrentUser();
    const [users, setUsers] = useState([]);
    const [centres, setCentres] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal & Form State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingId, setEditingId] = useState(null);
    const [formLoading, setFormLoading] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState(null);
    const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
    const [isCentreDropdownOpen, setIsCentreDropdownOpen] = useState(false);
    const [centreSearchTerm, setCentreSearchTerm] = useState('');
    const roleDropdownRef = useRef(null);
    const centreDropdownRef = useRef(null);

    const allowPageFlow = false;

    // Sorting & Filter State
    const [sortConfig, setSortConfig] = useState({ key: 'username', direction: 'asc' });
    const [searchTerm, setSearchTerm] = useState('');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [visibleItems, setVisibleItems] = useState(7);
    const [totalRecords, setTotalRecords] = useState(0);
    const [serverTotalPages, setServerTotalPages] = useState(0);
    const itemsPerPage = 7;
    const pageSize = 7;
    const scrollObserverRef = useRef(null);
    const loadingPagesRef = useRef(new Set());
    const hasMountedRef = useRef(false);

    const sortedUsers = users;

    const paginatedUsers = useMemo(() => {
        if (isMobile) {
            return sortedUsers.slice(0, visibleItems);
        }
        return sortedUsers;
    }, [sortedUsers, isMobile, visibleItems]);

    const totalPages = serverTotalPages || Math.ceil(totalRecords / pageSize);
    const shouldStretchRows = !isMobile && paginatedUsers.length === pageSize;
    const { tableWrapperRef, theadRef, rowHeight } = useAdaptiveTableRowHeight({
        rowCount: paginatedUsers.length,
        enabled: shouldStretchRows,
    });

    const fetchUsers = async (page = 1, append = false) => {
        if (loadingPagesRef.current.has(page)) return;
        loadingPagesRef.current.add(page);
        try {
            const searchParam = searchTerm.trim() ? `&search=${encodeURIComponent(searchTerm.trim())}` : '';
            const sortParam = sortConfig ? `&sortBy=${sortConfig.key}&sortDir=${sortConfig.direction}` : '';
            const [usRes, cenRes] = await Promise.all([
                apiFetch(`/api/dashboard/users?page=${page}&limit=${pageSize}${searchParam}${sortParam}`),
                apiFetch('/api/dashboard/centres')
            ]);

            if (!usRes.ok || !cenRes.ok) {
                const errorData = !usRes.ok ? await usRes.json().catch(() => ({})) : await cenRes.json().catch(() => ({}));
                throw new Error(errorData.error || 'Error al cargar usuarios o centros');
            }

            const usData = await usRes.json();
            const cenData = await cenRes.json();

            const nextUsers = Array.isArray(usData?.data) ? usData.data : Array.isArray(usData) ? usData : [];
            setUsers((prev) => append ? [...prev, ...nextUsers] : nextUsers);
            setTotalRecords(Number(usData?.pagination?.totalRecords || nextUsers.length));
            setServerTotalPages(Number(usData?.pagination?.totalPages || 1));
            setCentres(cenData);
        } catch (error) {
            console.error('Error cargando datos:', error);
            toast.error(error.message || 'Error al cargar los datos');
        } finally {
            setLoading(false);
            loadingPagesRef.current.delete(page);
        }
    };

    useEffect(() => {
        setUsers([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchUsers(1, false);

        const handleClickOutside = (event) => {
            if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target)) {
                setIsRoleDropdownOpen(false);
            }
            if (centreDropdownRef.current && !centreDropdownRef.current.contains(event.target)) {
                setIsCentreDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Re-fetch cuando cambia la búsqueda
    useEffect(() => {
        setUsers([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchUsers(1, false);
    }, [searchTerm]);

    // Re-fetch cuando cambia la ordenación (ordenación server-side)
    useEffect(() => {
        setUsers([]);
        setCurrentPage(1);
        setVisibleItems(7);
        setTotalRecords(0);
        setServerTotalPages(0);
        loadingPagesRef.current.clear();
        fetchUsers(1, false);
    }, [sortConfig]);

    // Cargar nueva página al navegar (incluido volver a página 1)
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        fetchUsers(currentPage, isMobile);
    }, [currentPage, isMobile]);

    // Infinite Scroll Observer para la vista móvil
    useEffect(() => {
        if (!isMobile) return;

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                if (visibleItems < users.length) {
                    setVisibleItems(prev => prev + 8);
                } else if (currentPage < totalPages) {
                    const nextPage = currentPage + 1;
                    setCurrentPage(nextPage);
                    fetchUsers(nextPage, true);
                }
            }
        }, { threshold: 0.1 });

        if (scrollObserverRef.current) {
            observer.observe(scrollObserverRef.current);
        }

        return () => observer.disconnect();
    }, [isMobile, visibleItems, users.length, currentPage, totalPages]);

    // Bloquear scroll al abrir modal
    useEffect(() => {
        if (isModalOpen || deleteId) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isModalOpen, deleteId]);

    const handleOpenModal = (user = null) => {
        setError('');
        if (user) {
            setFormData({ username: user.username, password: '', confirmPassword: '', role: user.role, centre_ids: user.centre_ids || [] });
            setEditingId(user.id);
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

        const isEditing = !!editingId;
        const url = isEditing
            ? `/api/dashboard/users/${editingId}`
            : '/api/dashboard/users';

        // El password es obligatorio solo si estamos creando
        if (!isEditing && !formData.password) {
            setError('La contraseña es obligatoria para nuevos usuarios');
            setFormLoading(false);
            return;
        }

        // Validar que las contraseñas coincidan si se ha introducido alguna
        if (formData.password && formData.password !== formData.confirmPassword) {
            setError('Las contraseñas no coinciden');
            setFormLoading(false);
            return;
        }

        const { confirmPassword, ...payload } = formData;
        // Si estamos editando y no se ha introducido contraseña, no la enviamos
        if (isEditing && !payload.password) {
            delete payload.password;
        }

        try {
            const response = await apiFetch(url, {
                method: isEditing ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al guardar el usuario');
            }

            setUsers([]);
            await fetchUsers(1, false);
            handleCloseModal();
        } catch (err) {
            setError(err.message);
        } finally {
            setFormLoading(false);
        }
    };

    const handleDeleteClick = (id) => {
        if (id === currentUser?.id) return;
        setDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;

        const id = deleteId;
        setDeleteId(null);

        const deletePromise = apiFetch(`/api/dashboard/users/${id}`, {
            method: 'DELETE'
        });

        toast.promise(deletePromise, {
            loading: 'Eliminando...',
            success: () => {
                setUsers(users.filter(u => u.id !== id));
                fetchUsers(1, false);
            },
            error: 'Error al eliminar el usuario',
        });
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
            {isMobile ? (
                // --- CABECERA MÓVIL (2 filas) ---
                <div className="select-none flex flex-col gap-4 mb-6">
                    {/* Fila 1: Título, Buscador, Contador */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Usuarios</h2>
                            <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                                {totalRecords} usuarios
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
                                placeholder="Buscar por nombre o rol..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                            />
                        </div>
                    </div>

                    {/* Fila 2: Añadir a la derecha */}
                    <div className="flex justify-end">
                        <button
                            onClick={() => handleOpenModal()}
                            className="bg-primary hover:brightness-95 text-white px-3 py-1.5 rounded-xl font-medium text-sm flex items-center transition-colors shadow-sm shadow-primary/20"
                            title="Añadir usuario" >
                            <span className="text-lg mr-1 leading-none">+</span>
                            <span>Agregar usuario</span>
                        </button>
                    </div>
                </div>
            ) : (
                // --- CABECERA DESKTOP (separada en 2 líneas) ---
                <div className="select-none flex flex-col gap-6 mb-6 shrink-0 w-full">
                    {/* Primera línea: Título a la izquierda + Contador y botón a la derecha */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white shrink-0">Usuarios</h2>
                        <div className="flex items-center gap-3">
                            <span className="select-none text-sm font-medium px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg whitespace-nowrap">
                                {totalRecords} Registros
                            </span>
                        </div>
                    </div>

                    {/* Segunda línea: Búsqueda */}
                    <div className="flex flex-wrap items-end gap-4 justify-between">
                        <div className="relative flex-1 min-w-[260px] max-w-xl">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Buscar por nombre o rol..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-700 dark:text-slate-200"
                            />
                        </div>
                        <div className='flex justify-end'>
                            <button
                                onClick={() => handleOpenModal()}
                                className="bg-primary hover:brightness-95 text-white px-4 py-1.5 rounded-xl font-medium text-sm flex items-end transition-colors shadow-sm shadow-primary/20"
                                title="Agregar usuario">
                                <span className="text-xl mr-1.5 leading-none mb-0.5">+</span>
                                <span>Agregar usuario</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                    <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p className="italic">Cargando usuarios...</p>
                </div>
            ) : users.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No hay usuarios para mostrar</p>
                    <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
                        {searchTerm ? 'Pruebe a cambiar los filtros de búsqueda.' : 'Los usuarios aparecerán aquí una vez registrados.'}
                    </p>
                </div>
            ) : isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {paginatedUsers.map((u) => (
                        <div
                            key={u.id}
                            className="bg-white dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50 shadow-[0_2px_8px_rgba(0,0,0,0.07)] dark:shadow-none hover:border-primary/50 dark:hover:border-primary/50 transition-all group"
                        >
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                        {u.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3
                                            className="font-bold text-slate-800 dark:text-white text-base leading-tight max-w-[150px] truncate"
                                            title={u.username}
                                        >
                                            {u.username}
                                        </h3>
                                        <span className={`chip-uniform mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[u.role] ?? 'bg-slate-100 text-slate-600'}`}>
                                            {u.role}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleOpenModal(u)}
                                        className="p-2.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl hover:bg-amber-100 transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(u.id)}
                                        disabled={u.id === currentUser?.id}
                                        title={u.id === currentUser?.id ? 'No puedes eliminarte a ti mismo' : undefined}
                                        className="p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {visibleItems < users.length && (
                        <div ref={scrollObserverRef} className="h-10 flex items-center justify-center">
                            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                </div>
            ) : (
                <div className={`${allowPageFlow ? 'h-auto overflow-hidden' : 'flex-1 overflow-hidden'} flex flex-col min-h-0`}>
                    <div className="flex-1 flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden min-h-0">
                        <div ref={tableWrapperRef} className={allowPageFlow ? 'overflow-hidden' : 'flex-1 overflow-hidden'}>
                            <table className="w-full text-sm text-left relative">
                                <thead ref={theadRef} className="sticky top-0 bg-white dark:bg-slate-800 z-10 [&>tr>th]:pt-6 [&>tr>th:first-child]:rounded-tl-2xl [&>tr>th:last-child]:rounded-tr-2xl">
                                    <tr className="select-none border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 uppercase text-xs tracking-wider">
                                        <th onClick={() => requestSort('username')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Nombre {getSortIcon('username')}
                                            </div>
                                        </th>
                                        <th onClick={() => requestSort('role')} className="pb-3 px-4 text-center cursor-pointer hover:text-primary transition-colors group">
                                            <div className="flex items-center justify-center">
                                                Rol {getSortIcon('role')}
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
                                    {paginatedUsers.map((u) => (
                                        <tr key={u.id} style={rowHeight != null ? { height: `${rowHeight}px` } : undefined} className="border-b border-slate-200/70 dark:border-slate-700/60 odd:bg-slate-50 even:bg-white dark:odd:bg-slate-800 dark:even:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                                            <td className="py-3.1 px-4 text-center font-medium text-slate-700 dark:text-slate-200">
                                                <span
                                                    className="inline-block max-w-[160px] truncate"
                                                    title={u.username}
                                                >
                                                    {u.username}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`chip-uniform px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[u.role] ?? 'bg-slate-100 text-slate-600'}`}>
                                                    {u.role === 'gestor' ? 'Gestor' : u.role}
                                                </span>

                                                <div
                                                    className="text-[10px] text-slate-500 mt-1 max-w-[120px] truncate mx-auto"
                                                    title={getUserCentresLabel(u, centres)}
                                                >
                                                    {getUserCentresLabel(u, centres)}
                                                </div>

                                            </td>
                                            <td className="py-3 px-4 text-center ">
                                                <button
                                                    onClick={() => handleOpenModal(u)}
                                                    className="p-2 text-slate-400 hover:text-primary hover:bg-primary/20 dark:hover:bg-primary/20 rounded-lg transition-colors mr-1"
                                                    title="Editar usuario"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                    </svg>
                                                </button>

                                                <button
                                                    onClick={() => handleDeleteClick(u.id)}
                                                    disabled={u.id === currentUser?.id}
                                                    aria-label="Eliminar usuario"
                                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                                    title={u.id === currentUser?.id ? 'No puedes eliminarte a ti mismo' : 'Eliminar usuario'}
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
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
                                            defaultValue={currentPage}
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

            {/* MODAL */}
            {isModalOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-slate-900/80 backdrop-blur-xl animate-modal-overlay">
                    <div className="bg-white dark:bg-slate-800 shadow-2xl w-full h-full sm:h-[90vh] sm:max-w-4xl sm:rounded-3xl rounded-t-[32px] overflow-hidden flex flex-col transform transition-all animate-modal-slide-up">
                        <div className="select-none p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800/50">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                {editingId ? 'Editar usuario' : 'Añadir nuevo usuario'}
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
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre de usuario</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all"
                                        placeholder="ej. Usuario123"
                                        maxLength={20}
                                        value={formData.username}
                                        onChange={e => setFormData({ ...formData, username: e.target.value })}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Contraseña {editingId && <span className="text-xs text-slate-400 font-normal">(dejar en blanco para no cambiar)</span>}
                                    </label>
                                    <input
                                        type="password"
                                        required={!editingId}
                                        className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all"
                                        placeholder="••••••••"
                                        maxLength={20}
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Confirmar contraseña {editingId && <span className="text-xs text-slate-400 font-normal">(dejar en blanco para no cambiar)</span>}
                                    </label>
                                    <input
                                        type="password"
                                        required={!editingId}
                                        className={`w-full px-4 py-2 rounded-xl border bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:border-primary outline-none transition-all ${formData.confirmPassword && formData.password !== formData.confirmPassword
                                            ? 'border-red-400 dark:border-red-500 focus:ring-red-300'
                                            : 'border-slate-300 dark:border-slate-600 focus:ring-primary'
                                            }`}
                                        placeholder="••••••••"
                                        maxLength={20}
                                        value={formData.confirmPassword}
                                        onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    />
                                    {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                                        <p className="mt-1 text-xs text-red-500 dark:text-red-400">Las contraseñas no coinciden</p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rol</label>
                                    <div className="relative" ref={roleDropdownRef}>
                                        <button
                                            type="button"
                                            onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all flex justify-between items-center capitalize"
                                        >
                                            <span className={!formData.role ? 'text-slate-400' : ''}>
                                                {formData.role || 'Seleccionar rol...'}
                                            </span>
                                            <svg className={`w-4 h-4 transition-transform duration-200 ${isRoleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>

                                        {isRoleDropdownOpen && (
                                            <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-700 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                                    {['empleado', 'gestor', 'supervisor', 'admin'].map(r => (
                                                        <div
                                                            key={r}
                                                            onClick={() => {
                                                                setFormData({ ...formData, role: r });
                                                                setIsRoleDropdownOpen(false);
                                                            }}
                                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between capitalize
                                                                ${formData.role === r
                                                                    ? 'bg-primary/10 text-primary font-medium'
                                                                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600/50'}`}
                                                        >
                                                            <span>{r === 'admin' ? 'Administrador' : r}</span>
                                                            {formData.role === r && (
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
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Centros asignados</label>
                                    <div className="relative" ref={centreDropdownRef}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsCentreDropdownOpen(!isCentreDropdownOpen);
                                                if (!isCentreDropdownOpen) setCentreSearchTerm('');
                                            }}
                                            className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none focus:outline-none transition-all flex justify-between items-center"
                                        >
                                            <span className={formData.centre_ids.length === 0 ? 'text-slate-400' : ''}>
                                                {formData.centre_ids.length === 0
                                                    ? 'Seleccionar centros...'
                                                    : formData.centre_ids.length === 1
                                                        ? centres.find(c => c.id === formData.centre_ids[0])?.nombre || '1 centro seleccionado'
                                                        : `${formData.centre_ids.length} centros seleccionados`}
                                            </span>
                                            <svg className={`w-4 h-4 transition-transform duration-200 ${isCentreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>

                                        {isCentreDropdownOpen && (
                                            <div className="absolute z-[60] mt-2 w-full bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                                                <div className="p-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            placeholder="Buscar centro..."
                                                            value={centreSearchTerm}
                                                            onChange={(e) => setCentreSearchTerm(e.target.value)}
                                                            className="w-full pl-8 pr-4 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none transition-all text-slate-700 dark:text-slate-200"
                                                            autoFocus
                                                        />
                                                        <svg className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                                        </svg>
                                                    </div>
                                                </div>
                                                <div className="max-h-[260px] overflow-y-auto custom-scrollbar p-1">
                                                    {centres.filter(c => normalizeSearchText(c.nombre).includes(normalizeSearchText(centreSearchTerm))).length === 0 ? (
                                                        <div className="px-4 py-3 text-xs text-slate-500 italic text-center">No se encontraron centros</div>
                                                    ) : (
                                                        centres
                                                            .filter(c => normalizeSearchText(c.nombre).includes(normalizeSearchText(centreSearchTerm)))
                                                            .map(c => (
                                                                <label
                                                                    key={c.id}
                                                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                                                                        ${formData.centre_ids.includes(c.id)
                                                                            ? 'bg-primary/10 text-primary'
                                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300'}`}
                                                                >
                                                                    <div className="relative flex items-center">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={formData.centre_ids.includes(c.id)}
                                                                            onChange={(e) => {
                                                                                const newIds = e.target.checked
                                                                                    ? [...formData.centre_ids, c.id]
                                                                                    : formData.centre_ids.filter(id => id !== c.id);
                                                                                setFormData({ ...formData, centre_ids: newIds });
                                                                            }}
                                                                            className="w-4 h-4 text-primary bg-white border-slate-300 rounded focus:ring-primary focus:ring-2 dark:bg-slate-700 dark:border-slate-500"
                                                                        />
                                                                    </div>
                                                                    <span className="text-sm font-medium truncate flex-1" title={c.nombre}>{c.nombre}</span>
                                                                    {formData.centre_ids.includes(c.id) && (
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </label>
                                                            ))
                                                    )}
                                                </div>
                                                {formData.centre_ids.length > 0 && (
                                                    <div className="p-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                                                        <span className="text-[10px] text-slate-500">{formData.centre_ids.length} seleccionados</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setFormData({ ...formData, centre_ids: [] })}
                                                            className="text-[10px] font-bold text-primary hover:underline"
                                                        >
                                                            Limpiar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
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
                                    className="flex-1 px-4 py-2 bg-primary hover:brightness-90 text-white rounded-xl transition-colors font-medium shadow-sm shadow-primary/30 disabled:opacity-70 flex justify-center items-center"
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

            {deleteId && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
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
                            Esta acción eliminará al usuario permanentemente y no se puede deshacer.
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
                </div>,
                document.body
            )}
        </div>
    );
};

export default UsersView;

