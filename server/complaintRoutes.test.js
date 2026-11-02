// @vitest-environment node

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from './app.js';
import { db } from './database.js';

describe('complaint API', () => {
  it('persists pending and resolved statuses and rejects unknown statuses', async () => {
    const citizen = await db.get('SELECT id FROM users WHERE email = ?', ['citizen@example.com']);
    expect(citizen?.id).toBeTruthy();

    const createResponse = await request(app)
      .post('/api/complaints')
      .send({
        citizenId: citizen.id,
        title: 'Complaint status sync test',
        description: 'This complaint verifies pending and resolved status updates.',
      });
    expect(createResponse.status).toBe(201);
    const complaintId = createResponse.body.complaint.id;

    try {
      const pendingResponse = await request(app)
        .put(`/api/complaints/${complaintId}/status`)
        .send({ status: 'pending' });
      expect(pendingResponse.status).toBe(200);
      expect(pendingResponse.body.complaint.status).toBe('PENDING');

      const invalidResponse = await request(app)
        .put(`/api/complaints/${complaintId}/status`)
        .send({ status: 'NOT A REAL STATUS' });
      expect(invalidResponse.status).toBe(400);

      const resolvedResponse = await request(app)
        .put(`/api/complaints/${complaintId}/status`)
        .send({ status: 'RESOLVED' });
      expect(resolvedResponse.status).toBe(200);
      expect(resolvedResponse.body.complaint.status).toBe('RESOLVED');

      const storedComplaint = await db.get('SELECT status FROM complaints WHERE id = ?', [complaintId]);
      expect(storedComplaint.status).toBe('RESOLVED');
    } finally {
      await request(app).delete(`/api/complaints/${complaintId}`);
    }
  });

  it('stores the model-predicted category instead of a submitted category', async () => {
    const citizen = await db.get('SELECT id FROM users WHERE email = ?', ['citizen@example.com']);
    expect(citizen?.id).toBeTruthy();

    const response = await request(app)
      .post('/api/complaints')
      .send({
        citizenId: citizen.id,
        category: 'Safety Rules',
        categorySource: 'ml',
        description: 'Akong gi reklamo si pangalan tungod sige siyag panumbag sa ako bisan wala nako siya gihilabtan.',
        location: 'Purok 7, near the hospital',
      });

    expect(response.status).toBe(201);
    expect(response.body.triage.category).toBe('Physical Assault');
    expect(response.body.complaint.category_name).toBe(response.body.triage.category);

    try {
      const stored = await db.get(
        `SELECT cat.name AS category_name, ch.name AS channel_name
         FROM complaints c
         LEFT JOIN complaint_categories cat ON cat.id = c.category_id
         LEFT JOIN channels ch ON ch.id = c.channel_id
         WHERE c.id = ?`,
        [response.body.complaint.id]
      );
      expect(stored.category_name).toBe(response.body.triage.category);
      expect(stored.channel_name).toBe(response.body.triage.channel);
    } finally {
      await request(app).delete(`/api/complaints/${response.body.complaint.id}`);
    }
  });

  it('stores Medical Assistance when an assault description requests treatment', async () => {
    const citizen = await db.get('SELECT id FROM users WHERE email = ?', ['citizen@example.com']);
    expect(citizen?.id).toBeTruthy();

    const response = await request(app)
      .post('/api/complaints')
      .send({
        citizenId: citizen.id,
        title: 'Medical assistance request',
        description: 'The resident hit me and I need to go to the clinic for treatment.',
      });

    expect(response.status).toBe(201);
    expect(response.body.triage.category).toBe('Medical Assistance');
    expect(response.body.complaint.category_name).toBe('Medical Assistance');

    try {
      const stored = await db.get(
        `SELECT cat.name AS category_name, ch.name AS channel_name
         FROM complaints c
         LEFT JOIN complaint_categories cat ON cat.id = c.category_id
         LEFT JOIN channels ch ON ch.id = c.channel_id
         WHERE c.id = ?`,
        [response.body.complaint.id]
      );
      expect(stored.category_name).toBe('Medical Assistance');
      expect(stored.channel_name).toBe('Medical Assistance');
    } finally {
      await request(app).delete(`/api/complaints/${response.body.complaint.id}`);
    }
  });

  it('allows only Officials to manually assign a complaint', async () => {
    const citizen = await db.get('SELECT id FROM users WHERE email = ?', ['citizen@example.com']);
    const official = await db.get(
      `SELECT users.id FROM users JOIN roles ON roles.id = users.role_id
       WHERE roles.name = 'OFFICIAL' LIMIT 1`
    );
    const tanod = await db.get(
      `SELECT users.id FROM users JOIN roles ON roles.id = users.role_id
       WHERE roles.name = 'TANOD' LIMIT 1`
    );

    expect(citizen?.id).toBeTruthy();
    expect(official?.id).toBeTruthy();
    expect(tanod?.id).toBeTruthy();

    const createResponse = await request(app)
      .post('/api/complaints')
      .send({
        citizenId: citizen.id,
        title: 'Assignment authorization test',
        description: 'Verify complaint assignment is restricted to Officials.',
      });
    expect(createResponse.status).toBe(201);
      expect(createResponse.body.complaint.source).toBe('online');

    const complaintId = createResponse.body.complaint.id;
    const secret = process.env.JWT_SECRET || 'dev_secret';
    const tanodToken = jwt.sign({ id: tanod.id, role: 'TANOD' }, secret);
    const officialToken = jwt.sign({ id: official.id, role: 'OFFICIAL' }, secret);

    try {
      const forbiddenResponse = await request(app)
        .put(`/api/complaints/${complaintId}/assign`)
        .set('Authorization', `Bearer ${tanodToken}`)
        .send({ assignedTo: official.id });
      expect(forbiddenResponse.status).toBe(403);

      const allowedResponse = await request(app)
        .put(`/api/complaints/${complaintId}/assign`)
        .set('Authorization', `Bearer ${officialToken}`)
        .send({ assignedTo: official.id });
      expect(allowedResponse.status).toBe(200);
    } finally {
      await request(app).delete(`/api/complaints/${complaintId}`);
    }
  });

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
    expect(createResponse.body.complaint.source).toBe('online');

    const deleteResponse = await request(app)
      .delete(`/api/complaints/${createResponse.body.complaint.id}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.message).toMatch(/deleted/i);

    const complaints = await db.get('SELECT * FROM complaints WHERE id = ?', [createResponse.body.complaint.id]);
    expect(complaints).toBeUndefined();
  });
});
