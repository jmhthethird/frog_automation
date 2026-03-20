'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;

beforeAll(() => {
  ctx = makeApp('notifications');
  // Access the db from the app context via require after DATA_DIR is set.
  db = require('../../src/db').db;
});

afterAll(() => ctx.cleanup());

describe('GET /api/notifications', () => {
  it('returns an empty array when there are no failed jobs or uploads', async () => {
    const res = await ctx.request.get('/api/notifications').expect(200);
    expect(res.body).toEqual({ notifications: [] });
  });

  it('returns a notification for a failed job', async () => {
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, error, completed_at)
      VALUES ('https://fail.example.com', 'Internal:All', 'failed', 'Process crashed', datetime('now'))
    `).run();

    const res = await ctx.request.get('/api/notifications').expect(200);
    const notifs = res.body.notifications;

    expect(notifs.length).toBeGreaterThanOrEqual(1);
    const failNotif = notifs.find(n => n.type === 'job_failed');
    expect(failNotif).toBeDefined();
    expect(failNotif.url).toBe('https://fail.example.com');
    expect(failNotif.message).toBe('Process crashed');
    expect(failNotif.id).toMatch(/^job-failed-/);
  });

  it('returns a notification for a failed Drive upload', async () => {
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, drive_upload_status, drive_upload_error, completed_at)
      VALUES ('https://drive-fail.example.com', 'Internal:All', 'completed', 'upload_failed', 'Quota exceeded', datetime('now'))
    `).run();

    const res = await ctx.request.get('/api/notifications').expect(200);
    const notifs = res.body.notifications;

    const driveNotif = notifs.find(n => n.type === 'drive_upload_failed' && n.url === 'https://drive-fail.example.com');
    expect(driveNotif).toBeDefined();
    expect(driveNotif.message).toBe('Quota exceeded');
    expect(driveNotif.id).toMatch(/^drive-failed-/);
  });

  it('returns both job_failed and drive_upload_failed for the same job', async () => {
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, error, drive_upload_status, drive_upload_error, completed_at)
      VALUES ('https://both-fail.example.com', 'Internal:All', 'failed', 'Job error', 'upload_failed', 'Drive error', datetime('now'))
    `).run();

    const res = await ctx.request.get('/api/notifications').expect(200);
    const notifs = res.body.notifications;

    const jobNotif = notifs.find(n => n.type === 'job_failed' && n.url === 'https://both-fail.example.com');
    const driveNotif = notifs.find(n => n.type === 'drive_upload_failed' && n.url === 'https://both-fail.example.com');
    expect(jobNotif).toBeDefined();
    expect(driveNotif).toBeDefined();
  });

  it('does not include completed jobs without Drive upload failures', async () => {
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, drive_upload_status, completed_at)
      VALUES ('https://ok.example.com', 'Internal:All', 'completed', 'uploaded', datetime('now'))
    `).run();

    const res = await ctx.request.get('/api/notifications').expect(200);
    const notifs = res.body.notifications;

    const okNotif = notifs.find(n => n.url === 'https://ok.example.com');
    expect(okNotif).toBeUndefined();
  });

  it('limits results to 50 notifications', async () => {
    for (let i = 0; i < 55; i++) {
      db.prepare(`
        INSERT INTO jobs (url, export_tabs, status, error, completed_at)
        VALUES ('https://bulk-${i}.example.com', 'Internal:All', 'failed', 'Error ${i}', datetime('now'))
      `).run();
    }

    const res = await ctx.request.get('/api/notifications').expect(200);
    // The SQL LIMIT 50 caps source rows; each failed job produces one notification,
    // so the total should be at most 50 from this batch (plus any from prior tests).
    const bulkNotifs = res.body.notifications.filter(n => n.url && n.url.includes('bulk-'));
    expect(bulkNotifs.length).toBeLessThanOrEqual(50);
  });
});
