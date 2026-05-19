DROP DATABASE IF EXISTS proyecto_reservas;
CREATE DATABASE IF NOT EXISTS proyecto_reservas;
USE `proyecto_reservas`;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    auth_provider ENUM('local', 'microsoft365') NOT NULL DEFAULT 'local',
    role ENUM('admin', 'empleado', 'supervisor', 'gestor') DEFAULT 'empleado',
    outlook_sync_enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS centres (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_unifica INT UNIQUE,
    nombre VARCHAR(155) NOT NULL,
    provincia VARCHAR(100) NOT NULL,
    localidad VARCHAR(100),
    direccion VARCHAR(255),
    telefono VARCHAR(20),
    codigo_postal VARCHAR(10),
    fecha_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_plate VARCHAR(15) NOT NULL UNIQUE,
    brand VARCHAR(80) NOT NULL DEFAULT '',
    model VARCHAR(100) NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL DEFAULT 'turismo',
    seats TINYINT UNSIGNED NOT NULL DEFAULT 5,
    trunk_capacity_l SMALLINT UNSIGNED DEFAULT NULL,
    energy_type ENUM('combustion', 'hibrido', 'electrico') NOT NULL DEFAULT 'combustion',
    fuel_level ENUM('vacio', 'medio-vacio', 'medio', 'medio-lleno', 'lleno') NOT NULL DEFAULT 'medio',
    status ENUM('disponible', 'no-disponible', 'reservado', 'en-uso', 'pendiente-validacion', 'formulario-entrega-pendiente', 'en-taller') DEFAULT 'disponible',
    kilometers INT DEFAULT 0,
    centre_id INT NULL DEFAULT NULL,
    km_taller_acumulados INT DEFAULT 0,
    CONSTRAINT fk_vehicles_centre FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE SET NULL,
    INDEX idx_brand (brand),
    INDEX idx_vehicle_type (vehicle_type),
    INDEX idx_energy_type (energy_type),
    INDEX idx_fuel_level (fuel_level),
    INDEX idx_status (status),
    INDEX idx_vehicles_centre (centre_id),
    INDEX idx_km_taller (km_taller_acumulados)
);

CREATE TABLE IF NOT EXISTS reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    vehicle_id INT,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status ENUM('pendiente', 'aprobada', 'activa', 'rechazada','finalizada') DEFAULT 'pendiente',
    motivo_rechazo TEXT NULL DEFAULT NULL,
    finalization_mail_sent_at DATETIME NULL DEFAULT NULL,
    delivery_reminder_sent_at DATETIME NULL DEFAULT NULL,
    outlook_event_id VARCHAR(512) NULL DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_vehicle_id (vehicle_id),
    INDEX idx_status_reservations (status),
    INDEX idx_start_end_time (start_time, end_time),
    INDEX idx_outlook_event_id (outlook_event_id)
);

CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT,
    original_name VARCHAR(255),
    type ENUM('seguro', 'itv', 'permiso-circulacion', 'ficha-tecnica', 'otros', 'parte-taller') NOT NULL,
    expiration_date DATE NOT NULL,
    file_path VARCHAR(255),
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
    INDEX idx_vehicle_id_docs (vehicle_id),
    INDEX idx_type (type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id_auditoria INT AUTO_INCREMENT PRIMARY KEY,
    users_id INT,
    rol_momento VARCHAR(50), 
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accion VARCHAR(20), 
    tabla_afectada VARCHAR(50), 
    registro_id INT, 
    detalles_admin TEXT,
    centre_id INT NULL DEFAULT NULL,
    FOREIGN KEY (users_id) REFERENCES users(id),
    INDEX idx_audit_centre (centre_id),
    INDEX idx_users_id (users_id),
    INDEX idx_fecha (fecha),
    INDEX idx_accion (accion),
    INDEX idx_tabla_afectada (tabla_afectada),
    INDEX idx_usuario_fecha (users_id, fecha),
    INDEX idx_tabla_registro (tabla_afectada, registro_id),
    INDEX idx_accion_tabla_fecha (accion, tabla_afectada, fecha)
);

CREATE TABLE IF NOT EXISTS validations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id INT UNIQUE,
    km_inicial INT NOT NULL,
    km_entrega INT,
    informe_entrega VARCHAR(500),
    informe_superior TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    incidencias BOOLEAN DEFAULT FALSE,
    informe_incidencias TEXT,
    status VARCHAR(50) DEFAULT 'pendiente',
    decision_estado VARCHAR(100),
    foto_contador MEDIUMTEXT NULL,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
    INDEX idx_reservation_id (reservation_id),
    INDEX idx_status_validations (status),
    INDEX idx_deleted_at (deleted_at)
);

CREATE TABLE IF NOT EXISTS user_centres (
    user_id INT NOT NULL,
    centre_id INT NOT NULL,
    PRIMARY KEY (user_id, centre_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE,
    INDEX idx_uc_centre (centre_id)
);
