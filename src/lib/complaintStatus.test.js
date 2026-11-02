import { describe, expect, it } from 'vitest';
import {
  getComplaintStatusBadgeClass,
  getComplaintStatusLabel,
  isPendingComplaintStatus,
  isResolvedComplaintStatus,
} from './complaintStatus.js';

describe('complaint status presentation', () => {
  it('displays newly submitted complaints consistently as Pending', () => {
    expect(getComplaintStatusLabel('SUBMITTED')).toBe('Pending');
    expect(getComplaintStatusLabel('ASSIGNED')).toBe('Pending');
    expect(getComplaintStatusLabel('pending')).toBe('Pending');
    expect(isPendingComplaintStatus('SUBMITTED')).toBe(true);
    expect(isPendingComplaintStatus('ASSIGNED')).toBe(true);
    expect(isPendingComplaintStatus('PENDING')).toBe(true);
  });

  it('treats resolved and closed complaints as completed', () => {
    expect(getComplaintStatusLabel('RESOLVED')).toBe('Resolved');
    expect(getComplaintStatusBadgeClass('RESOLVED')).toBe('bg-green-100 text-green-800');
    expect(isResolvedComplaintStatus('RESOLVED')).toBe(true);
    expect(isResolvedComplaintStatus('CLOSED')).toBe(true);
    expect(isResolvedComplaintStatus('IN PROGRESS')).toBe(false);
  });

  it('uses the same pending label and badge throughout the dashboards', () => {
    expect(getComplaintStatusBadgeClass('SUBMITTED')).toBe('bg-yellow-100 text-yellow-800');
    expect(getComplaintStatusBadgeClass('ASSIGNED')).toBe('bg-yellow-100 text-yellow-800');
    expect(getComplaintStatusBadgeClass('IN PROGRESS')).toBe('bg-orange-100 text-orange-800');
  });
});
