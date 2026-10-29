import { describe, it, expect } from 'vitest';
import { triageComplaint, detectLanguage } from './triageService.js';

describe('triageComplaint', () => {
  it('classifies threat complaints as high priority', () => {
    const result = triageComplaint('There is a drunk person threatening neighbors.');

    expect(result.channel).toBe('Threats');
    expect(result.category).toBe('Threats');
    expect(result.priority).toBe('HIGH');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies infrastructure complaints as medium priority', () => {
    const result = triageComplaint('The drainage near the school is clogged and the road is flooded.');

    expect(result.channel).toBe('Damaged Infrastructures');
    expect(result.priority).toBe('MEDIUM');
  });

  it('classifies noise complaints as low priority', () => {
    const result = triageComplaint('Loud videoke music all night, noise disturbance.');

    expect(result.channel).toBe('Noise Complaints');
    expect(result.priority).toBe('LOW');
  });

  it('uses the incident address as an auxiliary signal without overriding text', () => {
    const withoutAddress = triageComplaint('My neighbor was punched during a fight.');
    const withAddress = triageComplaint('My neighbor was punched during a fight.', 'Purok 3, near the hospital');

    expect(withoutAddress.channel).toBe('Physical Assault');
    expect(withAddress.channel).toBe('Physical Assault');
    expect(withAddress.confidence).toBeGreaterThanOrEqual(withoutAddress.confidence - 0.2);
  });

  it('flags low-confidence complaints for human review', () => {
    const result = triageComplaint('Hello po.');

    expect(result.needsReview).toBe(true);
    expect(result.suggestedRole).toBeTruthy();
  });

  it('classifies Bisaya noise complaints', () => {
    const result = triageComplaint('Saba kaayo ang videoke sa among silingan matag gabii.');

    expect(result.channel).toBe('Noise Complaints');
    expect(result.priority).toBe('LOW');
    expect(result.language).toBe('ceb');
  });

  it('classifies Bisaya assault complaints', () => {
    const result = triageComplaint('Gikulata akong igsoon sa iyang bana gahapon.');

    expect(result.channel).toBe('Physical Assault');
    expect(result.priority).toBe('HIGH');
    expect(result.language).toBe('ceb');
  });

  it('classifies Bisaya threat complaints', () => {
    const result = triageComplaint('Gihadlok mi sa among silingan nga hubog.');

    expect(result.channel).toBe('Threats');
    expect(result.priority).toBe('HIGH');
  });

  it('classifies Tagalog threat complaints', () => {
    const result = triageComplaint('May nananakot sa amin dito sa lugar namin.');

    expect(result.channel).toBe('Threats');
    expect(result.language).toBe('tl');
  });

  it('classifies Bisaya medical requests', () => {
    const result = triageComplaint('Tabang, naay masakiton dinhi sa amoa.');

    expect(result.channel).toBe('Medical Assistance');
    expect(result.priority).toBe('HIGH');
    expect(result.language).toBe('ceb');
  });

  it('classifies Bisaya infrastructure complaints', () => {
    const result = triageComplaint('Guba ang dalan paingon sa amoa, ngitngit walay suga.');

    expect(result.channel).toBe('Damaged Infrastructures');
    expect(result.priority).toBe('MEDIUM');
  });

  it('classifies Bisaya cyberbullying complaints', () => {
    const result = triageComplaint('Gilibak ko sa facebook sa akong kaila.');

    expect(result.channel).toBe('Cyberbullying');
    expect(result.language).toBe('ceb');
  });

  it('classifies Bisaya drug reports', () => {
    const result = triageComplaint('Namaligya og droga akong silingan.');

    expect(result.channel).toBe('Drug Abuse');
    expect(result.priority).toBe('HIGH');
  });

  it('classifies Bisaya safety-rule violations', () => {
    const result = triageComplaint('Gilapas ang lagda sa curfew gabii.');

    expect(result.channel).toBe('Safety Rules');
    expect(result.language).toBe('ceb');
  });

  it('handles code-switched complaints', () => {
    const result = triageComplaint('Loud kaayo ang videoke, saba kaayo gabii.');

    expect(result.channel).toBe('Noise Complaints');
    expect(['ceb', 'mixed']).toContain(result.language);
  });

  it('detects English, Tagalog, and unknown text', () => {
    expect(detectLanguage('There is a drunk person threatening neighbors.')).toBe('en');
    expect(detectLanguage('May nananakot sa amin dito.')).toBe('tl');
    expect(detectLanguage('Hello po.')).toBe('mixed');
  });
});
