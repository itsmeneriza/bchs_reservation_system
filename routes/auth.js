import express from 'express';
import { AuthService } from '../scripts/AuthService.js';

const router = express.Router();

async function handleLogin(req, res) {
  const { isStaff, staffId, phone } = req.body || {};

  if (typeof isStaff !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Choose a valid login type.' });
  }
  if (isStaff && (typeof staffId !== 'string' || !staffId.trim())) {
    return res.status(400).json({ success: false, message: 'Staff ID is required.' });
  }
  if (!isStaff && (typeof phone !== 'string' || !/^09\d{9}$/.test(phone))) {
    return res.status(400).json({ success: false, message: 'Enter a valid Philippine mobile number.' });
  }

  try {
    const result = isStaff
      ? await AuthService.staffLogin(staffId.trim())
      : await AuthService.loginGuest(phone);

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status === 503 ? 503 : 401).json({
      success: false,
      message: error.message || 'Unable to sign in. Please try again.'
    });
  }
}

router.post('/auth/login', handleLogin);
router.post('/login', handleLogin);

export default router;
