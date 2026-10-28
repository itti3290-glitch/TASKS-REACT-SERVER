import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import taskRoutes from './routes/tasks.js';
import meRoutes from './routes/me.js';
import userRoutes from './routes/users.js';
import requestRoutes from './routes/requests.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'שלום מהשרת!' });
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/me', meRoutes);
app.use('/api/users', userRoutes);
app.use('/api/requests', requestRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'שגיאה בשרת, נסו שוב' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});