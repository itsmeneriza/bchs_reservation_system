import 'dotenv/config'; // load variables from hidden .env file
import express from 'express';
import authRouter from './routes/auth.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});