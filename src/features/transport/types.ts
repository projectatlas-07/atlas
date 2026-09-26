export type TransportWorker = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransportGroup = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransportGroupAssignment = {
  id: string;
  factoryId: string;
  transportWorkerId: string;
  transportWorkerName: string;
  transportWorkerIsActive: boolean;
  transportGroupId: string;
  transportGroupName: string;
  transportGroupIsActive: boolean;
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
  transportGroupId: string;
  workDate: string;
  payaQuantity: number;
};

export type TransportDailyEntryWithAttendance = TransportDailyEntry & {
  attendanceWorkerIds: string[];
  attendanceWorkers: TransportDailyAttendanceWorker[];
};

export type TransportDailyOperationsEntry = TransportDailyEntry & {
  transportGroupName: string;
  attendanceCount: number;
  attendanceWorkers: TransportDailyAttendanceWorker[];
};

export type SaveTransportDailyEntryInput = {
  factoryId: string;
  transportGroupId: string;
  workDate: string;
  payaQuantity: number;
  transportWorkerIds: string[];
};

export type SaveTransportDailyEntryResult = {
  dailyEntryId: string;
  attendanceCount: number;
  savedPayaQuantity: number;
};

export type TransportGroupWageRate = {
  id: string;
  factoryId: string;
  transportGroupId: string;
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
  transportGroupId: string;
  transportGroupName: string;
  transportDailyEntryId: string;
  transportGroupWageRateId: string;
  ratePerPayaSnapshot: number;
  payaQuantitySnapshot: number;
  attendanceCountSnapshot: number;
  dailyGroupPoolSnapshot: number;
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
