/**
 * Landing Page Auth
 * Handles login, session management, and auth UI for the landing page.
 * Login state is shared with the reservation app through core/state.js.
 */
import { loginUser } from '../services/authService.js';
import { state, setLoginState } from '../core/state.js';

(function () {
    // ─── Modal Helpers ────────────────────────────────────────────────────────

    function showModal(id) {
        document.getElementById(id).style.display = 'flex';
    }

    function hideModal(id) {
        document.getElementById(id).style.display = 'none';
    }

    // ─── UI Sync ──────────────────────────────────────────────────────────────

    function syncUI() {
        const user = state.isLoggedIn ? state.user : null;
        const unlogged = document.getElementById('landing-auth-unlogged');
        const logged   = document.getElementById('landing-auth-logged');
        const nameEl   = document.getElementById('landing-user-name');

        if (user) {
            unlogged.style.display = 'none';
            logged.style.display   = 'block';
            nameEl.textContent = user.isStaff
                ? user.name
                : `User (***${(user.phone || '').slice(-3)})`;
        } else {
            unlogged.style.display = 'block';
            logged.style.display   = 'none';
        }
    }

    // ─── Event Listeners ─────────────────────────────────────────────────────

    function attachListeners() {
        // Login modal open/close
        document.getElementById('landing-login-btn').onclick   = () => showModal('landing-login-modal');
        document.getElementById('landing-login-close').onclick = () => hideModal('landing-login-modal');

        // User menu open/close
        document.getElementById('landing-menu-close').onclick = () => hideModal('landing-user-menu');

        // Backdrop close
        document.getElementById('landing-login-modal').onclick = (e) => {
            if (e.target.id === 'landing-login-modal') hideModal('landing-login-modal');
        };
        document.getElementById('landing-user-menu').onclick = (e) => {
            if (e.target.id === 'landing-user-menu') hideModal('landing-user-menu');
        };

        // Profile button → populate and open user menu
        document.getElementById('landing-profile-btn').onclick = () => {
            const user = state.isLoggedIn ? state.user : null;
            if (!user) return;
            document.getElementById('landing-user-initial').textContent =
                (user.name || user.phone || 'U')[0].toUpperCase();
            document.getElementById('landing-profile-name').textContent = user.name || user.phone;
            document.getElementById('landing-profile-type').textContent = user.isStaff
                ? 'BCHS Staff Member'
                : 'Community Member';
            showModal('landing-user-menu');
        };

        // Logout
        document.getElementById('landing-logout-btn').onclick = () => {
            setLoginState(false);
            hideModal('landing-user-menu');
            syncUI();
            setTimeout(() => location.reload(), 1000);
        };

        // Staff toggle — swap between phone and staff-ID fields
        const toggle = document.getElementById('landing-staff-toggle');
        const slider = document.getElementById('landing-slider');

        toggle.onchange = () => {
            slider.style.background = toggle.checked ? 'var(--primary-color, #800020)' : '#cbd5e1';
            document.getElementById('landing-phone-group').style.display   = toggle.checked ? 'none'  : 'block';
            document.getElementById('landing-staffid-group').style.display = toggle.checked ? 'block' : 'none';
        };

        // Login form submission
        document.getElementById('landing-login-form').onsubmit = async (e) => {
            e.preventDefault();
            await handleLogin(toggle);
        };
    }

    // ─── Login Logic ──────────────────────────────────────────────────────────

    async function handleLogin(toggle) {
        const errEl = document.getElementById('landing-login-error');
        errEl.style.display = 'none';

        if (toggle.checked) {
            await handleStaffLogin(errEl);
        } else {
            await handlePhoneLogin(errEl);
        }
    }

    async function processLogin(payload, errEl) {
        try {
            const user = await loginUser(payload);

            setLoginState(true, user);

            hideModal('landing-login-modal');
            syncUI();
        } catch (error) {
            errEl.textContent = error.message || 'Authentication failed.';
            errEl.style.display = 'block';
        }
    }

    async function handleStaffLogin(errEl) {
        const id = document.getElementById('landing-staffid').value.trim();

        if (!id) {
            errEl.textContent = 'Staff ID is required.';
            errEl.style.display = 'block';
            return;
        }

        await processLogin({ isStaff: true, staffId: id }, errEl);

    }

    async function handlePhoneLogin(errEl) {
        const raw     = document.getElementById('landing-phone').value.trim();
        const cleaned = raw.replace(/\s|-/g, '');

        if (!/^9\d{9}$/.test(cleaned)) {
            errEl.textContent = 'Enter a valid PH number (e.g. 9171234567).';
            errEl.style.display = 'block';
            return;
        }

        const phone = '0' + cleaned;

        await processLogin({ isStaff: false, phone }, errEl);

    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    attachListeners();
    syncUI();
})();
