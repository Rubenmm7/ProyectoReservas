const db = require('../config/db');

const EXTRA_VEHICLES = [
  [11, '2345DDD', 'Audi', 'A4 Avant', 'berlina', 5, 495, 'hibrido', 'medio-lleno', 'Parking Ejecutivo', 'Pack Business, sensores 360', 'CC-DIRECCION', 'disponible', 28400],
  [12, '3456EEE', 'BMW', 'X1 xDrive', 'suv', 5, 540, 'hibrido', 'medio', 'Parking Ejecutivo', 'Navegador, asientos calefactados', 'CC-DIRECCION', 'disponible', 19300],
  [13, '4567FFF', 'Kia', 'Niro EV', 'suv', 5, 475, 'electrico', 'lleno', 'Punto de carga 1', 'Cable carga, asistente aparcamiento', 'CC-SOSTENIBILIDAD', 'disponible', 8600],
  [14, '5678GGG', 'Opel', 'Combo Life', 'monovolumen', 7, 597, 'combustion', 'medio-lleno', 'Parking Logistica', 'Puertas laterales, ISOFIX', 'CC-OPERACIONES', 'disponible', 37250],
  [15, '6789HHH', 'Skoda', 'Octavia', 'berlina', 5, 600, 'combustion', 'medio', 'Parking Norte', 'Sensor ángulo muerto, DAB', 'CC-ADMIN', 'disponible', 41500],
  [16, '7890JJJ', 'Volvo', 'XC40 Recharge', 'suv', 5, 413, 'electrico', 'lleno', 'Punto de carga 2', 'Pilot Assist, cámara trasera', 'CC-SOSTENIBILIDAD', 'disponible', 12100],
  [17, '8901KKK', 'Mazda', 'CX-5', 'suv', 5, 506, 'combustion', 'medio-lleno', 'Parking Norte', 'Head-up display, keyless', 'CC-VENTAS', 'disponible', 33800],
  [18, '9012LLL', 'Citroën', 'Berlingo XL', 'furgoneta', 3, 850, 'combustion', 'medio', 'Nave 3', 'Carga modular, doble puerta lateral', 'CC-LOGISTICA', 'disponible', 62400],
  [19, '0123MMM', 'Nissan', 'Leaf', 'turismo', 5, 435, 'electrico', 'medio-lleno', 'Punto de carga 3', 'e-Pedal, ProPILOT', 'CC-SOSTENIBILIDAD', 'disponible', 18800],
  [20, '1234NNN', 'Toyota', 'Proace City', 'industrial', 2, 2100, 'combustion', 'medio', 'Nave 1', 'Panel separador, sensores traseros', 'CC-OPERACIONES', 'disponible', 49800],
];

const seedExtraVehicles = async () => {
  const connection = await db.getConnection();

  try {
    for (const vehicle of EXTRA_VEHICLES) {
      const [rows] = await connection.query('SELECT id FROM vehicles WHERE license_plate = ?', [vehicle[1]]);
      if (Array.isArray(rows) && rows.length > 0) {
        continue;
      }

      await connection.query(
        `INSERT INTO vehicles (
          id, license_plate, brand, model, vehicle_type, seats, trunk_capacity_l,
          energy_type, fuel_level, location, extras, cost_centre, status, kilometers
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        vehicle
      );
    }
  } finally {
    connection.release();
  }
};

module.exports = { seedExtraVehicles };
