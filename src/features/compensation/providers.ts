import { getVehicleWagePaidTotal } from "../sales/services/vehicle-wage-service.ts";
import { getSoilPaidTotal } from "../soil/services/soil-payment-service.ts";
import { getStaffPaidTotal } from "../staff/services/staff-payment-service.ts";
import { getChamberTransportPaidTotal } from "../transport/services/transport-worker-financial-service.ts";
import {
  getMudSupplyPaidTotal,
  getProductionLabourPaidTotal,
} from "../wages/services/paid-total-service.ts";
import type { CompensationProvider } from "./compensation-provider.ts";

export const productionLabourProvider: CompensationProvider = {
  id: "production-labour",
  displayName: "Production Labour",
  getPaidTotal: getProductionLabourPaidTotal,
};

export const mudSupplyProvider: CompensationProvider = {
  id: "mud-supply",
  displayName: "Mud Supply",
  getPaidTotal: getMudSupplyPaidTotal,
};

export const chamberTransportProvider: CompensationProvider = {
  id: "chamber-transport",
  displayName: "Chamber Transport",
  getPaidTotal: getChamberTransportPaidTotal,
};

export const soilTrolleyProvider: CompensationProvider = {
  id: "soil-trolley",
  displayName: "Soil/Trolley",
  getPaidTotal: getSoilPaidTotal,
};

export const staffProvider: CompensationProvider = {
  id: "staff",
  displayName: "Staff",
  getPaidTotal: getStaffPaidTotal,
};

export const vehicleDeliveryWageProvider: CompensationProvider = {
  id: "vehicle-delivery-wage",
  displayName: "Vehicle Delivery Wage",
  getPaidTotal: getVehicleWagePaidTotal,
};

export const compensationProviders: readonly CompensationProvider[] = [
  productionLabourProvider,
  mudSupplyProvider,
  chamberTransportProvider,
  soilTrolleyProvider,
  staffProvider,
  vehicleDeliveryWageProvider,
];
