const db = require('../config/db');

const VEHICLE_COLUMNS = [
  {
    name: 'brand',
    definition: "VARCHAR(80) NOT NULL DEFAULT '' AFTER license_plate",
  },
  {
    name: 'vehicle_type',
    definition: "VARCHAR(50) NOT NULL DEFAULT 'turismo' AFTER model",
  },
  {
    name: 'seats',
    definition: 'TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER vehicle_type',
  },
  {
    name: 'trunk_capacity_l',
    definition: 'SMALLINT UNSIGNED DEFAULT NULL AFTER seats',
  },
  {
    name: 'energy_type',
    definition: "ENUM('combustion', 'hibrido', 'electrico') NOT NULL DEFAULT 'combustion' AFTER trunk_capacity_l",
  },
  {
    name: 'fuel_level',
    definition: "ENUM('vacio', 'medio-vacio', 'medio', 'medio-lleno', 'lleno') NOT NULL DEFAULT 'medio' AFTER energy_type",
  },
  {
    name: 'location',
    definition: 'VARCHAR(120) DEFAULT NULL AFTER fuel_level',
  },
  {
    name: 'extras',
    definition: 'TEXT DEFAULT NULL AFTER location',
  },
  {
    name: 'cost_centre',
    definition: 'VARCHAR(80) DEFAULT NULL AFTER extras',
  },
];

const KNOWN_BRANDS = [
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

const normalizeText = (value) => String(value ?? '').trim();

const inferBrandAndModel = (fullModel) => {
  const normalized = normalizeText(fullModel);
  if (!normalized) {
    return { brand: '', model: '' };
  }

  const matchedBrand = KNOWN_BRANDS.find((brand) => normalized.toLowerCase().startsWith(`${brand.toLowerCase()} `) || normalized.toLowerCase() === brand.toLowerCase());

  if (!matchedBrand) {
    return { brand: '', model: normalized };
  }

  const remainder = normalized.slice(matchedBrand.length).trim().replace(/^[-/,:]+\s*/, '');
  return {
    brand: matchedBrand,
    model: remainder || normalized,
  };
};

const ensureVehicleProfileColumns = async () => {
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.query(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'vehicles'
      `
    );

    const existingColumns = new Set(Array.isArray(rows) ? rows.map((row) => row.COLUMN_NAME) : []);

    for (const column of VEHICLE_COLUMNS) {
      if (existingColumns.has(column.name)) {
        continue;
      }

      await connection.query(`ALTER TABLE vehicles ADD COLUMN ${column.name} ${column.definition}`);
    }

    for (const column of VEHICLE_COLUMNS) {
      if (!existingColumns.has(column.name)) {
        continue;
      }
    }

    const [vehicles] = await connection.query(
      "SELECT id, brand, model FROM vehicles WHERE brand IS NULL OR brand = ''"
    );

    for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
      const inferred = inferBrandAndModel(vehicle.model);
      if (!inferred.brand) {
        continue;
      }

      await connection.query(
        'UPDATE vehicles SET brand = ?, model = ? WHERE id = ?',
        [inferred.brand, inferred.model, vehicle.id]
      );
    }
  } finally {
    connection.release();
  }
};

module.exports = { ensureVehicleProfileColumns, inferBrandAndModel };
