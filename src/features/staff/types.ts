export type StaffCategory = {
  id: string;
  factoryId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type StaffWorker = {
  id: string;
  factoryId: string;
  name: string;
  staffCategoryId: string;
  referenceSalary: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StaffPayment = {
  id: string;
  factoryId: string;
  staffWorkerId: string;
  paymentDate: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

export type StaffPaymentSummary = {
  totalPaid: number;
};

export type RecordedStaffPayment = StaffPayment & StaffPaymentSummary;
