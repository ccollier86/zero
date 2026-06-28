import type { Row } from '../../sync/types';

export interface MockUser extends Row {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  createdAt: number;
}

const now = Date.now();
const day = 86_400_000;

export const mockUsers: MockUser[] = [
  { id: 'u1', username: 'jdoe', email: 'john.doe@clinic.io', firstName: 'John', lastName: 'Doe', role: 'admin', status: 'active', createdAt: now - 90 * day },
  { id: 'u2', username: 'asmith', email: 'alice.smith@clinic.io', firstName: 'Alice', lastName: 'Smith', role: 'provider', status: 'active', createdAt: now - 75 * day },
  { id: 'u3', username: 'bjones', email: 'bob.jones@clinic.io', firstName: 'Bob', lastName: 'Jones', role: 'provider', status: 'active', createdAt: now - 60 * day },
  { id: 'u4', username: 'cgarcia', email: 'carol.garcia@clinic.io', firstName: 'Carol', lastName: 'Garcia', role: 'staff', status: 'active', createdAt: now - 55 * day },
  { id: 'u5', username: 'dwilson', email: 'david.wilson@clinic.io', firstName: 'David', lastName: 'Wilson', role: 'staff', status: 'inactive', createdAt: now - 45 * day },
  { id: 'u6', username: 'emartinez', email: 'elena.martinez@clinic.io', firstName: 'Elena', lastName: 'Martinez', role: 'provider', status: 'active', createdAt: now - 40 * day },
  { id: 'u7', username: 'ftaylor', email: 'frank.taylor@clinic.io', firstName: 'Frank', lastName: 'Taylor', role: 'viewer', status: 'active', createdAt: now - 30 * day },
  { id: 'u8', username: 'glee', email: 'grace.lee@clinic.io', firstName: 'Grace', lastName: 'Lee', role: 'viewer', status: 'suspended', createdAt: now - 20 * day },
  { id: 'u9', username: 'hpatel', email: 'hasan.patel@clinic.io', firstName: 'Hasan', lastName: 'Patel', role: 'staff', status: 'active', createdAt: now - 10 * day },
  { id: 'u10', username: 'ichen', email: 'iris.chen@clinic.io', firstName: 'Iris', lastName: 'Chen', role: 'admin', status: 'active', createdAt: now - 5 * day },
];
