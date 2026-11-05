import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/admin/adminRoutes.js';
import citizenRoutes from './routes/citizen/citizenRoutes.js';
import officialRoutes from './routes/official/officialRoutes.js';
import tanodRoutes from './routes/tanod/tanodRoutes.js';
import luponRoutes from './routes/lupon/luponRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import classifyRoutes from './routes/classifyRoutes.js';

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://thesiscapstone-main.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow local-network (phone) access during development.
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*') ||
        (origin.endsWith('.vercel.app') && origin.includes('thesiscapstone-main'))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/citizen', citizenRoutes);
app.use('/api/official', officialRoutes);
app.use('/api/tanod', tanodRoutes);
app.use('/api/lupon', luponRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api', classifyRoutes);

// Unknown /api routes -> JSON (so the client never parses an HTML 404 as a
// generic "Request failed with status code ...").
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

// Global error handler -> always JSON. Body-parser errors (malformed JSON,
// payload too large) and unexpected crashes previously surfaced as HTML
// error pages, which axios reports without a message body.
 // eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err?.message || err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    message: err?.message || 'Internal server error.',
  });
});

export default app;
