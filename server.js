import 'dotenv/config'; // load variables from hidden .env file
import express from 'express';
import { AuthService } from './scripts/AuthService.js';

const app = express();
app.use(express.json());
app.use('/api', authRouter);

// Login API Endpoint
app.post('/api/login', async (req, res) => {
  const { isStaff, staffId, phone } = req.body;

  try {
    if (isStaff) {
      const result = await AuthService.loginStaff(staffId);
      return res.json({ success: true, ...result });
    } else {
      const result = await AuthService.loginGuest(phone);
      return res.json({ success: true, ...result });
    }
  } catch (err) {
    return res.status(401).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});