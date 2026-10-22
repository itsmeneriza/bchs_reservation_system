import express from 'express';
import { AuthService } from '../scripts/AuthService.js';

const router = express.Router();

async function handleLogin(req, res) {
    const { isStaff, staffId, phone } = req.body || {};

    if (typeof isStaff !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Invalid request body. isStaff must be a boolean.' });
    }

    if (isStaff && (typeof staffId !== 'string' || !staffId.trim())) {
        return res.status(400).json({ success: false, message: 'Staff ID is required.' });
    }

    if (!isStaff && (typeof phone !== 'string' || !phone.trim())) {
        return res.status(400).json({ success: false, message: 'Enter a valid phone number.' });
    }

    try {
        const result = isStaff
            ? await AuthService.staffLogin(staffId.trim())
            : await AuthService.loginGuest(phone.trim());
        
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Unable to sign in. Please try again.'});
    }
}

router.post('/login', handleLogin);

export default router;