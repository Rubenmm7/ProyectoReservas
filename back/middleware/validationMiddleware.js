const { z } = require('zod');

const validate = (schema, source = 'body') => (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
        return res.status(400).json({
            error: 'Datos de entrada no válidos',
            details: result.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    req[source] = result.data;
    return next();
};

const idParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});

const loginSchema = z.object({
    username: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(200),
});

const selectCentreSchema = z.object({
    centre_id: z.coerce.number().int().positive(),
});

const reservationSchema = z.object({
    user_id: z.coerce.number().int().positive(),
    centre_id: z.coerce.number().int().positive(),
    vehicle_id: z.coerce.number().int().positive(),
    start_time: z.string().trim().min(10).max(40),
    end_time: z.string().trim().min(10).max(40),
    status: z.string().trim().min(3).max(30).optional(),
});

const reservationUpdateSchema = reservationSchema.partial().extend({
    km_entrega: z.coerce.number().nonnegative().optional(),
    estado_entrega: z.string().trim().min(3).max(30).optional(),
    informe_entrega: z.string().trim().max(1000).optional(),
    validacion_entrega: z.string().trim().max(30).optional(),
    foto_contador: z.string().optional().nullable(),
    motivo_rechazo: z.string().trim().max(255).optional().nullable(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviarse al menos un campo para actualizar',
});

const centreSchema = z.object({
    id_unifica: z.union([z.coerce.number(), z.string().length(0)]).optional().nullable(),
    nombre: z.string().trim().min(2).max(120),
    provincia: z.string().trim().min(1).max(100),
    localidad: z.string().trim().max(100).optional().nullable(),
    direccion: z.string().trim().max(255).optional().nullable(),
    telefono: z.string().trim().max(20).optional().nullable(),
    codigo_postal: z.string().trim().max(10).optional().nullable(),
});

const centreUpdateSchema = centreSchema.partial().refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviarse al menos un campo para actualizar',
});

const vehicleSchema = z.object({
    license_plate: z.string().trim().min(3).max(20),
    brand: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    vehicle_type: z.string().trim().min(1).max(50),
    seats: z.coerce.number().int().positive().max(99).optional(),
    trunk_capacity_l: z.coerce.number().int().nonnegative().max(99999).optional().nullable(),
    energy_type: z.enum(['combustion', 'hibrido', 'electrico']),
    fuel_level: z.enum(['vacio', 'medio-vacio', 'medio', 'medio-lleno', 'lleno']),
    kilometers: z.coerce.number().nonnegative().optional(),
    centre_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    status: z.string().trim().min(3).max(30).optional(),
});

const vehicleUpdateSchema = vehicleSchema.partial().refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviarse al menos un campo para actualizar',
});

const userSchema = z.object({
    username: z.string().trim().min(3).max(120),
    password: z.string().min(6).max(200),
    role: z.enum(['admin', 'supervisor', 'empleado', 'gestor']),
    centre_ids: z.array(z.coerce.number().int().positive()).optional(),
});

const userUpdateSchema = z.object({
    username: z.string().trim().min(3).max(120).optional(),
    password: z.string().min(6).max(200).optional(),
    role: z.enum(['admin', 'supervisor', 'empleado', 'gestor']).optional(),
    centre_ids: z.array(z.coerce.number().int().positive()).optional(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviarse al menos un campo para actualizar',
});

const validationUpdateSchema = z.object({
    status: z.string().trim().min(3).max(30).optional(),
    informe_entrega: z.string().trim().max(1000).optional(),
    estado_entrega: z.string().trim().min(3).max(30).optional(),
    km_entrega: z.coerce.number().nonnegative().optional(),
    informe_superior: z.string().trim().max(1000).optional().nullable(),
    incidencias: z.coerce.boolean().optional(),
    informe_incidencias: z.string().trim().max(1000).optional().nullable(),
    decision_estado: z.string().trim().min(3).max(30).optional().nullable(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviarse al menos un campo para actualizar',
});

module.exports = {
    validate,
    idParamSchema,
    loginSchema,
    selectCentreSchema,
    reservationSchema,
    reservationUpdateSchema,
    centreSchema,
    centreUpdateSchema,
    vehicleSchema,
    vehicleUpdateSchema,
    userSchema,
    userUpdateSchema,
    validationUpdateSchema,
};
