import { describe, expect, it } from 'vitest';
import { formatComplaintSource } from './complaintSource';

describe('formatComplaintSource', () => {
  it.each(['walk-in', 'walkin', 'WALK_IN', 'Barangay Hall'])(
    'labels %s as a Barangay Hall walk-in',
    (source) => {
      expect(formatComplaintSource(source)).toBe('Walk-in (Barangay Hall)');
    }
  );

  it.each(['online', 'ONLINE', null, undefined])(
    'labels %s as an online form submission',
    (source) => {
      expect(formatComplaintSource(source)).toBe('Online Form');
    }
  );
});