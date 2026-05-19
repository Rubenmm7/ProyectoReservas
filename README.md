# Plataforma de Gestión de Reservas de Vehículos

Plataforma corporativa integral diseñada para la administración, reserva y validación de vehículos de flota de empresa. Ofrece un flujo automatizado de control de estado, validación de entregas (con fotos de cuentakilómetros e incidencias) y trazabilidad completa de acciones mediante logs de auditoría.

---

## Características Principales

### Dashboard
*   **Métricas Operativas:** Visualización de estadísticas clave en tiempo real (vehículos disponibles, reservas activas, incidencias).
*   **Panel de Alertas:** Notificaciones automáticas sobre documentación técnica caducada (ITV, seguro) y partes de taller obsoletos.
*   **Control de Accesos:** Menú y paneles adaptativos según los permisos del rol de usuario autenticado.

### Gestión de Flota (Vehículos)
*   Visualización y administración de vehículos por tipo (turismo, furgoneta, berlina, SUV, monovolumen).
*   Seguimiento en tiempo real de kilometraje y tipo de energía (eléctrico, híbrido, combustión).
*   Control de archivos adjuntos técnicos y de revisión de taller.

### Flujo de Reservas
*   Consulta dinámica de disponibilidad por fechas, centros operativos y tipo de vehículo.
*   Ciclo de vida controlado de reservas: `Pendiente` -> `Aprobada` -> `Entregada` -> `Revisada` (o `Rechazada`).
*   Formulario interactivo de recogida y entrega de vehículos para usuarios.

### Validaciones e Incidencias
*   Panel interactivo para administradores/supervisores de revisión de entregas.
*   Visor de fotografías de cuentakilómetros con controles de zoom y desplazamiento (pan).
*   Registro detallado y categorización de incidencias para derivar vehículos a taller de forma atómica.

### Auditoría
*   Historial inmutable de acciones críticas (inicios de sesión, cambios de rol, actualizaciones de reservas, alta de incidencias).
*   Búsqueda y filtrado avanzado con exportación completa de logs a PDF y Excel.

---

## Roles y Permisos

| Rol | Descripción | Permisos |
| :--- | :--- | :--- |
| **Administrador** | Administrador del sistema. | Control total del sistema, gestión de usuarios, vehículos, centros, auditorías y parámetros globales. |
| **Supervisor** | Gestor operativo de centros. | Aprobación de reservas, validación de entregas de vehículos y gestión de incidencias. |
| **Gestor** | Supervisor pasivo / Técnico. | Visualización de flota, consulta de documentación técnica y partes de taller (sin permisos de edición). |
| **Empleado** | Usuario final operativo. | Creación de solicitudes de reserva, realización de recogidas/entregas y reporte de kilómetros/incidencias. |

---

## Tecnologías y Arquitectura

El proyecto está diseñado bajo una arquitectura desacoplada estructurada en dos directorios principales:

### Frontend (front)
*   **Framework:** React 18 con Vite como herramienta de construcción rápida.
*   **Estilos:** Tailwind CSS v3 con directrices personalizadas de glassmorphic UI.
*   **Linter:** ESLint 9 integrado con soporte Flat Config para mantener la calidad y homogeneidad de código.
*   **Librerías Clave:** `jsPDF` (generación de informes de validación), `html2canvas` (renderizado de gráficos), `qrcode.react`, `socket.io-client`.

### Backend (back)
*   **Entorno:** Node.js v18+ con Express.
*   **Base de Datos:** MySQL 8.0 con soporte relacional completo.
*   **Comunicación:** WebSockets bidireccionales en tiempo real mediante Socket.IO.
*   **Mailing:** Envío automatizado de avisos (aprobaciones, rechazos, alertas) a través de servidor SMTP configurado con soporte Mailpit.

---

## Estructura del Proyecto

```text
ProyectoReservas/
├── back/                      # Backend de la API
│   ├── config/                # Configuraciones de BD y nodemailer
│   ├── controllers/           # Lógica de negocio por entidad
│   ├── middlewares/           # Autenticación, control de roles y subidas
│   ├── routes/                # Endpoints expuestos de la API
│   ├── utils/                 # Utilidades (logger de auditoría, oauth)
│   └── Dockerfile             # Configuración del contenedor Express
├── front/                     # Frontend SPA en React
│   ├── src/
│   │   ├── components/        # Componentes de UI y vistas específicas
│   │   ├── hooks/             # Custom hooks (autenticación, socket, alertas)
│   │   ├── utils/             # Clientes de API (apiFetch) y utilidades de sesión
│   │   └── main.jsx           # Punto de entrada
│   ├── Dockerfile             # Configuración del contenedor de desarrollo
│   └── Dockerfile.prod        # Configuración de producción usando Nginx
├── init/                      # Inicializadores de base de datos
│   ├── schema.sql             # Estructura de tablas y triggers
│   └── init.sql               # Inserción de semillas y usuarios iniciales
├── docker-compose.yml         # Orquestador multi-contenedor
└── README.md                  # Documentación del proyecto
```

---

## Instalación y Puesta en Marcha

### Requisitos Previos
*   Docker y Docker Compose instalados, o
*   Node.js v18+ y MySQL 8.0+ instalados localmente de forma independiente.

---

### Opción A: Despliegue con Docker

El entorno Dockerizado levanta automáticamente la base de datos, phpMyAdmin, el servidor de correo Mailpit, el backend y el frontend.

1.  **Clonar el repositorio** y situarse en la raíz del proyecto.
2.  **Iniciar los servicios:**
    ```bash
    docker-compose up --build
    ```
3.  **Acceder a las aplicaciones:**
    *   **Frontend (Desarrollo):** `http://localhost:5173`
    *   **Frontend (Producción Nginx):** `http://localhost:8081`
    *   **Backend (Express API):** `http://localhost:4000`
    *   **phpMyAdmin (Administrador BD):** `http://localhost:8080` (Host: `db`, Usuario: `root`, Contraseña: `root`)
    *   **Mailpit (Servidor Webmail de pruebas):** `http://localhost:8025`

---

### Opción B: Instalación Manual (Local)

#### 1. Configuración de Base de Datos
1. Crea una base de datos MySQL llamada `proyecto_reservas`.
2. Ejecuta los scripts SQL en orden:
   ```bash
   mysql -u tu_usuario -p proyecto_reservas < init/schema.sql
   mysql -u tu_usuario -p proyecto_reservas < init/init.sql
   ```

#### 2. Configuración del Servidor (Backend)
1. Navega al directorio `/back`:
   ```bash
   cd back
   ```
2. Instala las dependencias de Node:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` tomando como referencia `.env.docker` y rellena tus datos de conexión a base de datos y SMTP de correo.
4. Arranca la API en modo desarrollo:
   ```bash
   npm run dev
   ```

#### 3. Configuración del Cliente (Frontend)
1. Abre una nueva terminal y navega a `/front`:
   ```bash
   cd front
   ```
2. Instala las dependencias del frontend:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` configurando la dirección de la API backend (por defecto `http://localhost:4000`).
4. Inicia el servidor de desarrollo Vite:
   ```bash
   npm run dev
   ```

---

## Credenciales por Defecto

Cuentas creadas por semilla:

| Usuario | Contraseña | Rol Asignado |
| :--- | :--- | :--- |
| `admin` | `admin123` | **Administrador** |
| `supervisor` | `supervisor123` | **Supervisor** |
| `gestor` | `gestor123` | **Gestor** |
| `empleado` | `empleado123` | **Empleado** |

---

## Mejoras de Seguridad Aplicadas (Hardening)

Medidas de seguridad implementadas y auditadas en el proyecto:

*   **Sesiones seguras (Cookies httpOnly):** El token JWT se almacena en cookies con flags de seguridad `HttpOnly`, `Secure` y política de restricción `SameSite=Lax`.
*   **Prevención de User Enumeration:** Respuestas fallidas en el login retornan un código de estado `401` y mensaje genérico unificado, independientemente de si el nombre de usuario o la contraseña fueron incorrectos.
*   **Mitigación de Timing Attacks (Bcrypt):** En caso de no existir el usuario en base de datos, el backend ejecuta una comparación simulada contra un hash dummy de Bcrypt para asegurar un tiempo de respuesta consistente.
*   **Wrapper seguro de peticiones (apiFetch):** Envoltura `apiFetch` que realiza validación estricta de tipos de argumentos, inyecta credenciales seguras e intercepta errores de sesión para realizar cierres controlados.
*   **CSP & HSTS (Cabeceras de Nginx):** El servidor de producción Nginx inyecta cabeceras `Content-Security-Policy`, `Strict-Transport-Security` y `Permissions-Policy` para evitar ataques XSS, Clickjacking e inyección de recursos no deseados.
*   **Sanitización de Datos de Sesión:** Función helper `sanitizeUser` que limpia y whitelistea estrictamente los campos permitidos del usuario en el cliente, descartando contraseñas o atributos sensibles de la base de datos.
*   **Protección OAuth:** Validación estricta y uso del parámetro `state` para prevenir ataques de falsificación de peticiones en sitios cruzados (CSRF).

---

## Desarrollo y Calidad de Código

Para asegurar la cohesión del código en el frontend, se recomienda pasar el analizador estático periódicamente:

```bash
npm run lint
```

---

Desarrollado por **Ruben Maderas**.