/**
 * Login Component
 * Handles portal authentication with phone and optional staff validation.
 */
import { loginUser, signupGuest, updateGuestProfile } from '../services/authService.js';
import { state, setLoginState } from '../core/state.js';
import { showToast } from './NotificationComponent.js';
import { isValidPHPhone, normalizePHPhone } from '../utils/dateUtils.js';

export class LoginHandler {
    constructor() {
        this.loginModal = document.getElementById('login-modal');
        this.signupModal = document.getElementById('signup-modal');
        this.userMenuModal = document.getElementById('user-menu-modal');
        this.loginForm = document.getElementById('login-form');
        this.signupForm = document.getElementById('signup-form');
        this.profileForm = document.getElementById('community-profile-form');
        this.staffToggle = document.getElementById('staff-toggle');
        this.phoneContainer = document.getElementById('phone-container');
        this.staffIdContainer = document.getElementById('staff-id-container');
        this.loginError = document.getElementById('login-error');
        
        this.unloggedContainer = document.getElementById('auth-unlogged');
        this.loggedContainer = document.getElementById('auth-logged');
        this.navUserName = document.getElementById('nav-user-name');
        
        this.init();
    }

    init() {
        this.attachEventListeners();
        this.syncUI();
    }

    attachEventListeners() {
        // Modal toggles
        document.getElementById('open-login-btn')?.addEventListener('click', () => this.open());
        document.getElementById('login-modal-close')?.addEventListener('click', () => this.close());
        document.getElementById('open-signup-btn')?.addEventListener('click', () => this.openSignup());
        document.getElementById('signup-modal-close')?.addEventListener('click', () => this.closeSignup());
        document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
            this.closeSignup();
            this.open();
        });
        document.getElementById('user-profile-btn')?.addEventListener('click', () => this.openUserMenu());
        document.getElementById('user-menu-close')?.addEventListener('click', () => this.closeUserMenu());
        
        // Staff toggle logic - switch between phone and ID fields
        this.staffToggle?.addEventListener('change', (e) => {
            const isStaff = e.target.checked;
            const phoneInput = document.getElementById('login-phone');
            const staffIdInput = document.getElementById('login-staff-id');
            
            if (isStaff) {
                // Show staff ID field, hide phone field
                if (this.phoneContainer) this.phoneContainer.style.display = 'none';
                if (this.staffIdContainer) this.staffIdContainer.style.display = 'block';
                document.getElementById('signup-prompt').style.display = 'none';
                
                // Update required attributes
                if (phoneInput) phoneInput.removeAttribute('required');
                if (staffIdInput) staffIdInput.setAttribute('required', 'true');
            } else {
                // Show phone field, hide staff ID field
                if (this.phoneContainer) this.phoneContainer.style.display = 'block';
                if (this.staffIdContainer) this.staffIdContainer.style.display = 'none';
                document.getElementById('signup-prompt').style.display = 'block';
                
                // Update required attributes
                if (phoneInput) phoneInput.setAttribute('required', 'true');
                if (staffIdInput) staffIdInput.removeAttribute('required');
            }
        });

        // Form Submission
        this.loginForm?.addEventListener('submit', (e) => this.handleLogin(e));
        this.signupForm?.addEventListener('submit', (e) => this.handleSignup(e));
        this.profileForm?.addEventListener('submit', (e) => this.handleProfileUpdate(e));

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', () => this.handleLogout());

        // Close on backdrop click
        [this.loginModal, this.signupModal, this.userMenuModal].forEach(modal => {
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.classList.remove('active');
                    }
                });
            }
        });
    }

    open() {
        if (this.loginError) this.loginError.style.display = 'none';
        this.loginModal?.classList.add('active');
    }

    close() {
        this.loginModal?.classList.remove('active');
    }

    openSignup() {
        const phone = document.getElementById('login-phone')?.value.trim();
        const signupPhone = document.getElementById('signup-phone');
        if (signupPhone && isValidPHPhone(phone || '')) signupPhone.value = phone;
        document.getElementById('signup-error').style.display = 'none';
        this.close();
        this.signupModal?.classList.add('active');
    }

    closeSignup() {
        this.signupModal?.classList.remove('active');
    }

    openUserMenu() {
        if (!state.isLoggedIn) return;
        
        const initialEl = document.getElementById('user-initial');
        const nameEl = document.getElementById('profile-name');
        const typeEl = document.getElementById('profile-type');

        if (initialEl) initialEl.textContent = (state.user?.name || state.user?.phone || 'U')[0].toUpperCase();
        if (nameEl) nameEl.textContent = state.user?.name || state.user?.phone;
        if (typeEl) typeEl.textContent = state.user?.isStaff ? `BCHS Staff Member` : 'Community Member';

        const profileSection = document.getElementById('community-profile-section');
        const isStaff = state.user?.isStaff === true;
        if (profileSection) {
            profileSection.style.display = isStaff ? 'none' : 'block';
        }
        document.getElementById('save-profile-btn').style.display = isStaff ? 'none' : '';
        if (!isStaff) {
            document.getElementById('profile-full-name').value = state.user?.name || '';
            document.getElementById('profile-email').value = state.user?.email || '';
            const phone = state.user?.phone || '';
            document.getElementById('profile-phone').value = phone.startsWith('0') ? phone.slice(1) : phone;
            document.getElementById('profile-update-error').style.display = 'none';
        }
        
        this.userMenuModal?.classList.add('active');
    }

    closeUserMenu() {
        this.userMenuModal?.classList.remove('active');
    }

    async handleLogin(e) {
        e.preventDefault();
        const phoneInput = document.getElementById('login-phone');
        const staffIdInput = document.getElementById('login-staff-id');
        
        const isStaff = this.staffToggle ? this.staffToggle.checked : false;

        let userData = {
            isStaff: isStaff,
            loginTime: new Date().toISOString()
        };

        if (isStaff) {
            // Staff login - use ID number
            const staffId = staffIdInput ? staffIdInput.value.trim() : "";
            
            if (!staffId) {
                this.showError("Staff ID is required for employee login.");
                return;
            }

            userData.staffId = staffId;
        } else {
            // Community member login - use phone number
            const raw = phoneInput ? phoneInput.value.trim() : "";

            // Input is digits after +63, so valid = 9XXXXXXXXX (10 digits)
            if (!isValidPHPhone(raw)) {
                this.showError("Please enter a valid Philippine mobile number (e.g. 9171234567).");
                return;
            }

            const normalized = normalizePHPhone(raw);
            userData.phone = normalized;
            userData.name = normalized;
        }

        // Login new: Call loginUser service and update app state with response
        try {
            userData = await loginUser(userData);

            setLoginState(true, userData);
            this.syncUI();
            this.close();
            showToast(`Welcome, ${userData.isStaff ? userData.name : 'User'}!`, 'success');
        } catch (error) {
            this.showError(error.message || "Authentication failed. Please try again");
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        const errorEl = document.getElementById('signup-error');
        errorEl.style.display = 'none';
        const fullName = document.getElementById('signup-name').value.trim();
        const rawPhone = document.getElementById('signup-phone').value.trim();

        if (!fullName || fullName.length > 120) {
            errorEl.textContent = 'Enter your name (up to 120 characters).';
            errorEl.style.display = 'block';
            return;
        }

        if (!isValidPHPhone(rawPhone)) {
            errorEl.textContent = 'Please enter a valid Philippine mobile number (e.g. 9171234567).';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const user = await signupGuest({
                fullName,
                phone: normalizePHPhone(rawPhone),
            });
            setLoginState(true, user);
            this.syncUI();
            this.closeSignup();
            showToast(`Welcome, ${user.name}!`, 'success');
        } catch (error) {
            errorEl.textContent = error.message || 'Unable to create your account. Please try again.';
            errorEl.style.display = 'block';
        }
    }

    async handleProfileUpdate(e) {
        e.preventDefault();
        const errorEl = document.getElementById('profile-update-error');
        errorEl.style.display = 'none';
        const fullName = document.getElementById('profile-full-name').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        const rawPhone = document.getElementById('profile-phone').value.trim();

        if (!fullName || fullName.length > 120) {
            errorEl.textContent = 'Enter your name (up to 120 characters).';
            errorEl.style.display = 'block';
            return;
        }
        if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
            errorEl.textContent = 'Enter a valid email address.';
            errorEl.style.display = 'block';
            return;
        }
        if (!isValidPHPhone(rawPhone)) {
            errorEl.textContent = 'Please enter a valid Philippine mobile number (e.g. 9171234567).';
            errorEl.style.display = 'block';
            return;
        }

        const saveButton = document.getElementById('save-profile-btn');
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        try {
            const user = await updateGuestProfile({
                fullName,
                email,
                phone: normalizePHPhone(rawPhone),
            });
            setLoginState(true, user);
            this.syncUI();
            document.getElementById('user-initial').textContent =
                (user.name || user.phone || 'U')[0].toUpperCase();
            document.getElementById('profile-name').textContent = user.name || user.phone;
            showToast('Profile updated successfully.', 'success');
        } catch (error) {
            errorEl.textContent = error.message || 'Unable to update your profile. Please try again.';
            errorEl.style.display = 'block';
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Changes';
        }
    }

    handleLogout() {
        setLoginState(false);
        this.syncUI();
        this.closeUserMenu();
        showToast('Logged out successfully.', 'info');
        setTimeout(() => location.reload(), 1000);
    }

    syncUI() {
        if (state.isLoggedIn) {
            if (this.unloggedContainer) this.unloggedContainer.style.display = 'none';
            if (this.loggedContainer) this.loggedContainer.style.display = 'block';
            
            // Mask phone to show only last 3 digits if not staff, else show name
            if (this.navUserName) {
                if (state.user?.isStaff) {
                    this.navUserName.textContent = state.user.name;
                } else {
                    const lastThree = state.user?.phone?.slice(-3) || '...';
                    this.navUserName.textContent = `User (***${lastThree})`;
                }
            }
        } else {
            if (this.unloggedContainer) this.unloggedContainer.style.display = 'block';
            if (this.loggedContainer) this.loggedContainer.style.display = 'none';
        }
    }

    showError(msg) {
        if (this.loginError) {
            this.loginError.textContent = msg;
            this.loginError.style.display = 'block';
        }
    }
}