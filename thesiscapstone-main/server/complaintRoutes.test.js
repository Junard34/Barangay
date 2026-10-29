import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app.js';
import { db } from './database.js';

describe('complaint API', () => {
  it('deletes a complaint by id', async () => {
    const citizen = await db.get('SELECT id FROM users WHERE email = ?', ['citizen@example.com']);

    const createResponse = await request(app)
      .post('/api/complaints')
      .send({
        citizenId: citizen.id,
        title: 'Delete test complaint',
        description: 'This complaint should be removable.',
        location: 'Purok 1, near the chapel',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.triage?.channel).toBeTruthy();

    const deleteResponse = await request(app)
      .delete(`/api/complaints/${createResponse.body.complaint.id}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.message).toMatch(/deleted/i);

    const complaints = await db.get('SELECT * FROM complaints WHERE id = ?', [createResponse.body.complaint.id]);
    expect(complaints).toBeUndefined();
  });
});
