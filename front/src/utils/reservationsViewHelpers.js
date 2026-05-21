import { formatLocalDateTime, toLocalInputDateTime } from './dateTime';
import { hasValidDeliveryKilometers } from './delivery';
import { isNonTerminalReservationStatus } from './statusConcordance';

export const normalizeSearchText = (value) =>
    String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

export const matchesSearchableFields = (item, query, fields) => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    return fields.some((field) => normalizeSearchText(item?.[field]).includes(normalizedQuery));
};

export const getUserCentreIds = (user) => {
    if (!user) return [];

    const rawCentreIds =
        user.centre_ids ??
        user.centreIds ??
        user.centres ??
        user.centre_id ??
        user.centreId ??
        [];
    const list = Array.isArray(rawCentreIds) ? rawCentreIds : [rawCentreIds];

    return list
        .filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
        .map((id) => String(id?.id ?? id?.centre_id ?? id));
};

export const isVehicleInUserCentres = (vehicle, userCentreIds) => {
    if (!Array.isArray(userCentreIds) || userCentreIds.length === 0) return true;
    return userCentreIds.includes(String(vehicle?.centre_id));
};

export const hasBlockingReservationForVehicle = (reservations, vehicleId, excludeReservationId = null) => {
    if (!vehicleId) return false;
    return (Array.isArray(reservations) ? reservations : []).some((reservation) => {
        if (String(reservation?.vehicle_id) !== String(vehicleId)) return false;
        if (excludeReservationId && String(reservation?.id) === String(excludeReservationId)) return false;
        return isNonTerminalReservationStatus(reservation?.status);
    });
};

export const hasDeliveryBeenSubmitted = (reservation, submittedDeliveryIds = []) => {
    if (!reservation) return false;
    if (Array.isArray(submittedDeliveryIds) && submittedDeliveryIds.some((id) => String(id) === String(reservation.id))) return true;
    if (hasValidDeliveryKilometers(reservation)) return true;
    return false;
};

export const isEmployeeLikeRole = (role) => role === 'empleado' || role === 'gestor';
export const isEmployeeLikeUser = (user) => isEmployeeLikeRole(user?.role);
export const isAdminOrSupervisorUser = (user) => user?.role === 'admin' || user?.role === 'supervisor';

export const canOpenDeliveryForm = (reservation, currentUser, submittedDeliveryIds = [], hasDeliveryHandler = true) => {
    if (!hasDeliveryHandler || !currentUser) return false;
    if (hasDeliveryBeenSubmitted(reservation, submittedDeliveryIds)) return false;
    const status = String(reservation?.status ?? '').toLowerCase();
    if (status !== 'finalizada') return false;
    if (String(reservation.user_id) === String(currentUser.id)) return true;
    if ((currentUser.role === 'admin' || currentUser.role === 'supervisor')) return true;
    return false;
};

export const formatDate = (value) => formatLocalDateTime(value);

export const formatEnergyTypeLabel = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return '—';

    const labels = {
        combustion: 'Combustión',
        hibrido: 'Híbrido',
        electrico: 'Eléctrico',
    };

    return labels[normalized] || normalized.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

export const roundUpToFiveMinutes = (date) => {
    const next = new Date(date);
    const minutes = next.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 5) * 5;

    if (roundedMinutes === 60) {
        next.setHours(next.getHours() + 1, 0, 0, 0);
        return next;
    }

    next.setMinutes(roundedMinutes, 0, 0);
    return next;
};

export const getDefaultReservationStart = () => roundUpToFiveMinutes(new Date(Date.now() + 5 * 60 * 1000));

export const getDefaultReservationEnd = (startDate) => {
    const end = new Date(startDate);
    end.setHours(end.getHours() + 1);
    return roundUpToFiveMinutes(end);
};

export const toLocalISOString = (date) => toLocalInputDateTime(date);
export const formatTimeUnit = (value) => String(value).padStart(2, '0');
