const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const mailingController = require('../controllers/mailingController');
const { verifyToken, checkRole, injectCentreFilter } = require('../middleware/authMiddleware');
const {
  validate,
  idParamSchema,
  reservationSchema,
  reservationUpdateSchema,
  centreSchema,
  centreUpdateSchema,
  vehicleSchema,
  vehicleUpdateSchema,
  userSchema,
  userUpdateSchema,
  validationUpdateSchema,
} = require('../middleware/validationMiddleware');

router.use(verifyToken);
router.use(injectCentreFilter);

router.post('/centres/sync', checkRole(['admin', 'supervisor']), dashboardController.syncCentres);
router.get('/centres', dashboardController.getCentres);
router.get('/centres/:id/details', checkRole(['admin', 'supervisor']), dashboardController.getCentreDetails);
router.post('/centres', checkRole(['admin', 'supervisor']), validate(centreSchema), dashboardController.createCentre);
router.put('/centres/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), validate(centreUpdateSchema), dashboardController.updateCentre);
router.delete('/centres/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), dashboardController.deleteCentre);
router.get('/stats', checkRole(['admin', 'supervisor']), dashboardController.getStats);

router.get('/reservations', dashboardController.getRecentReservations);
router.post('/reservations', validate(reservationSchema), dashboardController.createReservation);
router.put('/reservations/:id', validate(idParamSchema, 'params'), validate(reservationUpdateSchema), dashboardController.updateReservation);
router.delete('/reservations/:id', validate(idParamSchema, 'params'), dashboardController.deleteReservation);
router.post('/mailing/test', checkRole(['admin']), mailingController.sendTestMail);
router.get('/outlook/diagnostic', checkRole(['admin']), dashboardController.outlookDiagnostic);

router.get('/vehicles', checkRole(['admin', 'supervisor', 'empleado', 'gestor']), dashboardController.getVehicles);
router.post('/vehicles', checkRole(['admin', 'supervisor']), validate(vehicleSchema), dashboardController.createVehicle);
router.put('/vehicles/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), validate(vehicleUpdateSchema), dashboardController.updateVehicle);
router.delete('/vehicles/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), dashboardController.deleteVehicle);

router.get('/vehicles/:id/documents', checkRole(['admin', 'supervisor', 'gestor']), dashboardController.getVehicleDocuments);
router.post('/vehicles/:id/documents', checkRole(['admin', 'supervisor']), dashboardController.uploadVehicleDocument);
router.get('/documents/:id/view', checkRole(['admin', 'supervisor', 'gestor']), dashboardController.serveDocument);
router.put('/documents/:id', checkRole(['admin', 'supervisor']), dashboardController.updateVehicleDocument);
router.delete('/documents/:id', checkRole(['admin', 'supervisor']), dashboardController.deleteVehicleDocument);

router.get('/users', checkRole(['admin', 'supervisor']), dashboardController.getUsers);
router.post('/users', checkRole(['admin']), validate(userSchema), dashboardController.createUser);
router.put('/users/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), validate(userUpdateSchema), dashboardController.updateUser);
router.delete('/users/:id', checkRole(['admin']), validate(idParamSchema, 'params'), dashboardController.deleteUser);
router.post('/delete-user/:id', checkRole(['admin']), validate(idParamSchema, 'params'), dashboardController.deleteUser);

router.get('/validations', dashboardController.getValidations);
router.put('/validations/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), validate(validationUpdateSchema), dashboardController.updateValidation);
router.delete('/validations/:id', checkRole(['admin', 'supervisor']), validate(idParamSchema, 'params'), dashboardController.deleteValidation);

module.exports = router;
