import crypto from 'node:crypto';
import express from 'express';
import { AuthService } from '../scripts/AuthService.js';

const router = express.Router();

function getSessionSecret() {
    return process.env.SESSION_SECRET || process.env.SUPABASE_ANON_KEY || 'bchs-local-dev-secret';
}

function buildSessionToken(user) {
    const payload = {
        sub: user?.id || user?.staff_id || user?.mobile_number || user?.email || 'guest',
        isStaff: Boolean(user?.isStaff),
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
    const [payloadPart, signaturePart] = token.split('.');
    if (!payloadPart || !signaturePart) return null;

    const expectedSignature = crypto.createHmac('sha256', getSessionSecret()).update(payloadPart).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signaturePart))) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
        if (!payload || typeof payload !== 'object') return null;
        if (Date.now() > Number(payload.expiresAt || 0)) return null;
        return payload;
    } catch (error) {
        return null;
    }
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
        return res.status(500).json({ success: false, message: error.message || 'Unable to sign in. Please try again.'});
    }
}

router.post('/login', handleLogin);

export default router;