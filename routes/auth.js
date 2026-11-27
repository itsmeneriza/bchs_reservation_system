import crypto from 'node:crypto';
import express from 'express';
import { AuthService } from '../scripts/AuthService.js';

const router = express.Router();

function getSessionSecret() {
    const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
        throw new Error('SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY must be configured.');
    }
    return secret;
}

function buildSessionToken(user) {
    const payload = {
        sub: user?.id || user?.staff_id || user?.mobile_number || user?.email || 'guest',
        isStaff: Boolean(user?.isStaff),
        mobile_number: user?.mobile_number || null,
        role: 'user',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', getSessionSecret()).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token) {
    if (typeof token !== 'string' || !token.trim()) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart) return null;

    let payload;
    try {
        const expectedSignature = crypto.createHmac('sha256', getSessionSecret()).update(payloadPart).digest('base64url');
        const expectedBuffer = Buffer.from(expectedSignature);
        const actualBuffer = Buffer.from(signaturePart);
        if (
            expectedBuffer.length !== actualBuffer.length ||
            !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
        ) {
            return null;
        }
        payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch (error) {
        return null;
    }

    if (!payload || typeof payload !== 'object' || payload.role !== 'user') return null;
    if (Date.now() > Number(payload.expiresAt || 0)) return null;
    return payload;
}

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

        const user = { ...result.user, isStaff: result.isStaff };
        return res.status(200).json({
            success: true,
            ...result,
            sessionToken: buildSessionToken(user),
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Unable to sign in. Please try again.',
        });
    }
}

async function handleSignup(req, res) {
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';

    if (!fullName || fullName.length > 120) {
        return res.status(400).json({ success: false, message: 'Enter your name (up to 120 characters).' });
    }

    if (!/^09\d{9}$/.test(phone)) {
        return res.status(400).json({ success: false, message: 'Enter a valid Philippine mobile number.' });
    }

    try {
        getSessionSecret();
        const result = await AuthService.signupGuest(fullName, phone);
        const user = { ...result.user, isStaff: false };
        return res.status(201).json({
            success: true,
            ...result,
            sessionToken: buildSessionToken(user),
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Unable to create your account. Please try again.',
        });
    }
}

async function handleUpdateProfile(req, res) {
    const authHeader = req.get('authorization') || '';
    const accessToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : '';
    const session = verifySessionToken(accessToken);

    if (!session) {
        return res.status(401).json({ success: false, message: 'Your sign-in is invalid or expired.' });
    }
    if (session.isStaff) {
        return res.status(403).json({ success: false, message: 'Staff profiles cannot be edited here.' });
    }

    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!fullName || fullName.length > 120) {
        return res.status(400).json({ success: false, message: 'Enter your name (up to 120 characters).' });
    }
    if (!/^09\d{9}$/.test(phone)) {
        return res.status(400).json({ success: false, message: 'Enter a valid Philippine mobile number.' });
    }
    if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }

    try {
        const guest = await AuthService.updateGuestProfile(session.sub, {
            fullName,
            email: email || null,
            phone,
        });
        return res.status(200).json({ success: true, user: guest });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Unable to update your profile. Please try again.',
        });
    }
}

router.post('/login', handleLogin);
router.post('/signup', handleSignup);
router.put('/profile', handleUpdateProfile);

export default router;