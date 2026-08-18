export type TransportWorkDirection = "FIELD_TO_KILN" | "KILN_TO_FIELD";

export type TransportWorker = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransportCrew = {
  id: string;
  factoryId: string;
  name: string;
  workDirection: TransportWorkDirection;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransportCrewAssignment = {
  id: string;
  factoryId: string;
  transportWorkerId: string;
  transportWorkerName: string;
  transportWorkerIsActive: boolean;
  transportCrewId: string;
  transportCrewName: string;
  transportCrewWorkDirection: TransportWorkDirection;
  transportCrewIsActive: boolean;
  createdAt: string;
};

export type TransportAssignedWorker = {
  transportWorkerId: string;
  transportWorkerName: string;
  transportWorkerIsActive: boolean;
};

export type TransportDailyAttendanceWorker = TransportAssignedWorker;

export type TransportDailyEntryWorkerChoice = TransportAssignedWorker & {
  isPreviouslyRecorded: boolean;
};

export type TransportDailyEntry = {
  dailyEntryId: string;
  factoryId: string;
  transportCrewId: string;
  workDate: string;
  payaQuantity: number;
};

export type TransportDailyEntryWithAttendance = TransportDailyEntry & {
  attendanceWorkerIds: string[];
  attendanceWorkers: TransportDailyAttendanceWorker[];
};

export type SaveTransportDailyEntryInput = {
  factoryId: string;
  transportCrewId: string;
  workDate: string;
  payaQuantity: number;
  transportWorkerIds: string[];
};

export type SaveTransportDailyEntryResult = {
  dailyEntryId: string;
  attendanceCount: number;
  savedPayaQuantity: number;
};

export type TransportCrewWageRate = {
  id: string;
  factoryId: string;
  transportCrewId: string;
  ratePerPaya: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};

export type TransportLockedWeeklyEarning = {
  weeklyEarningId: string;
  factoryId: string;
  transportWorkerId: string;
  transportWorkerName: string;
  transportWorkerIsActive: boolean;
  weekStart: string;
  totalAmount: number;
  createdAt: string;
};

export type TransportWeeklyEarningDetail = {
  detailId: string;
  factoryId: string;
  transportWeeklyEarningId: string;
  transportWorkerId: string;
  weekStart: string;
  workDate: string;
  transportCrewId: string;
  transportCrewName: string;
  transportCrewWorkDirection: TransportWorkDirection;
  transportDailyEntryId: string;
  transportCrewWageRateId: string;
  ratePerPayaSnapshot: number;
  payaQuantitySnapshot: number;
  attendanceCountSnapshot: number;
  dailyCrewPoolSnapshot: number;
  workerDailyShareSnapshot: number;
  createdAt: string;
};

export type TransportWorkerAvailableBalance = {
  totalEarned: number;
  totalWithdrawn: number;
  availableBalance: number;
};

export type TransportWorkerWithdrawal = {
  withdrawalId: string;
  factoryId: string;
  transportWorkerId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
};

export type CreatedTransportWorkerWithdrawal = TransportWorkerWithdrawal & {
  availableBalance: number;
};
