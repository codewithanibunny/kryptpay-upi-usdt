// Executive Wealth Application State
let usdtRate = 89.50;
let usdtPayoutRate = 87.00;
let currentUser = null;
let currentPollInterval = null;
let pendingVerificationEmail = null;
let pendingOtpToken = '';

// ================= COOKIE & SESSION HELPERS (30-DAY PERSISTENCE) =================
function setSessionCookie(user) {
    if (!user) return;
    try {
        const d = new Date();
        d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 Days Expiry
        const cookieStr = `nexapay_session=${encodeURIComponent(JSON.stringify(user))}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
        document.cookie = cookieStr;
    } catch (e) {
        console.error('Error setting session cookie:', e);
    }
}

function getSessionCookie() {
    try {
        const name = "nexapay_session=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(name) === 0) {
                const jsonStr = c.substring(name.length, c.length);
                return JSON.parse(jsonStr);
            }
        }
    } catch (e) {}
    return null;
}

function clearSessionCookie() {
    document.cookie = "nexapay_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
}

function saveUserSession(user) {
    if (!user) return;
    currentUser = user;
    const jsonStr = JSON.stringify(user);
    try {
        localStorage.setItem('nexapay_user', jsonStr);
        localStorage.setItem('kryptpay_user', jsonStr);
    } catch (e) {}
    setSessionCookie(user);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchLiveRate();
    calculateUsdt();
    checkSavedSession();
    initGoogleAuth();
    checkUrlPaymentStatus();

    // Listen for Google Auth Popup Window message
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS') {
            saveUserSession(event.data.user);
            closeGoogleAuthModal();
            applyUserSession();
        }
    });
});

// Check saved user session in Cookie & LocalStorage
async function checkSavedSession() {
    let savedUser = getSessionCookie();
    if (!savedUser) {
        const local = localStorage.getItem('nexapay_user') || localStorage.getItem('kryptpay_user');
        if (local) {
            try {
                savedUser = JSON.parse(local);
            } catch (e) {}
        }
    }

    if (savedUser && savedUser.email) {
        currentUser = savedUser;
        saveUserSession(savedUser); // Ensure 30-day cookie refreshed
        applyUserSession();

        // Refresh latest balance and orders in background
        try {
            const res = await fetch(`/api/user-balance/${encodeURIComponent(currentUser.email)}`);
            if (res.ok) {
                const balData = await res.json();
                if (balData.status === 1 && balData.walletBalance !== undefined) {
                    currentUser.walletBalance = balData.walletBalance;
                    saveUserSession(currentUser);
                    updateWalletBalanceDisplay();
                }
            }
        } catch (e) {}
    } else {
        showLoggedOutState();
    }
}

function checkUrlPaymentStatus() {
    try {
        const params = new URLSearchParams(window.location.search);
        const orderSuccess = params.get('order_success');
        const urlUtr = params.get('utr');
        if (orderSuccess) {
            window.history.replaceState(null, null, window.location.pathname);
            fetch(`/api/check-order-status/${encodeURIComponent(orderSuccess)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.status === 1) {
                        data.utr = urlUtr || data.utr;
                        showOrderSuccessModal(data);
                    }
                })
                .catch(() => {});
        }
    } catch (e) {}
}

function showLoggedOutState() {
    document.getElementById('main-dashboard-view').classList.add('hidden');
    document.getElementById('auth-landing-view').classList.remove('hidden');
    document.getElementById('auth-nav-user').classList.add('hidden');
    document.getElementById('auth-nav-user').classList.remove('flex');
}

function applyUserSession() {
    if (!currentUser) {
        showLoggedOutState();
        return;
    }

    document.getElementById('auth-landing-view').classList.add('hidden');
    document.getElementById('main-dashboard-view').classList.remove('hidden');

    document.getElementById('auth-nav-user').classList.remove('hidden');
    document.getElementById('auth-nav-user').classList.add('flex');
    
    document.getElementById('user-name-display').innerText = currentUser.name || 'User Account';
    
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarText = document.getElementById('user-avatar-text');

    if (currentUser.picture) {
        avatarImg.src = currentUser.picture;
        avatarImg.classList.remove('hidden');
        avatarText.classList.add('hidden');
    } else {
        avatarImg.classList.add('hidden');
        avatarText.classList.remove('hidden');
        avatarText.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();
    }

    if (currentUser.binanceAddress) {
        const convertAddrInput = document.getElementById('convert-binance-address');
        if (convertAddrInput) convertAddrInput.value = currentUser.binanceAddress;
        validateConvertAddress();
    }

    renderWalletBalance(currentUser.walletBalance);
    updateWalletBalanceDisplay();
    loadUserTransactionLedger();
    connectLiveWalletStream();
    startAutoLedgerPolling();
}

function switchAuthTab(tab) {
    hideAuthError();
    const loginBtn = document.getElementById('tab-login-btn');
    const regBtn = document.getElementById('tab-register-btn');
    const loginForm = document.getElementById('auth-login-form');
    const regForm = document.getElementById('auth-register-form');

    if (tab === 'login') {
        loginBtn.className = "flex-1 py-2.5 text-xs font-bold rounded-xl bg-emerald-500 text-slate-950 shadow-md transition-all";
        regBtn.className = "flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition-all";
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
    } else {
        regBtn.className = "flex-1 py-2.5 text-xs font-bold rounded-xl bg-emerald-500 text-slate-950 shadow-md transition-all";
        loginBtn.className = "flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition-all";
        regForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    }
}

function showAuthError(msg) {
    const banner = document.getElementById('auth-error-banner');
    if (banner) {
        banner.innerText = msg;
        banner.classList.remove('hidden');
    }
}

function hideAuthError() {
    const banner = document.getElementById('auth-error-banner');
    if (banner) {
        banner.classList.add('hidden');
    }
}

// Switch Dashboard View Tabs (Deposit vs Convert vs History)
function switchDashboardTab(tabName) {
    const depositBtn = document.getElementById('dash-tab-deposit');
    const convertBtn = document.getElementById('dash-tab-convert');
    const historyBtn = document.getElementById('dash-tab-history');

    const depositContent = document.getElementById('dash-content-deposit');
    const convertContent = document.getElementById('dash-content-convert');
    const historyContent = document.getElementById('dash-content-history');

    if (depositBtn) depositBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";
    if (convertBtn) convertBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";
    if (historyBtn) historyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";

    if (depositContent) depositContent.classList.add('hidden');
    if (convertContent) convertContent.classList.add('hidden');
    if (historyContent) historyContent.classList.add('hidden');

    if (tabName === 'deposit') {
        if (depositBtn) depositBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-emerald-500 text-slate-950 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        if (depositContent) depositContent.classList.remove('hidden');
    } else if (tabName === 'convert') {
        if (convertBtn) convertBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        if (convertContent) convertContent.classList.remove('hidden');
        updateWalletBalanceDisplay();
    } else if (tabName === 'history') {
        if (historyBtn) historyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-slate-800 text-emerald-400 border border-slate-700 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        if (historyContent) historyContent.classList.remove('hidden');
        loadUserTransactionLedger();
    }
}

/* ================= GOOGLE IDENTITY OAUTH INTEGRATION ================= */

const CLIENT_ID = '459964446959-9se2u9p8mahbili06u56otgvqafcieem.apps.googleusercontent.com';
let googleTokenClient = null;

function initGoogleAuth() {
    window.GOOGLE_CLIENT_ID = CLIENT_ID;
    checkOAuthRedirectHash();

    if (window.google && window.google.accounts) {
        try {
            window.google.accounts.id.initialize({
                client_id: CLIENT_ID,
                callback: handleGoogleCredentialResponse
            });
        } catch (e) {}

        if (window.google.accounts.oauth2) {
            try {
                googleTokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: 'email profile openid',
                    callback: handleGoogleTokenResponse
                });
            } catch (e) {}
        }
    }
}

async function handleGoogleTokenResponse(tokenResponse) {
    if (tokenResponse && tokenResponse.access_token) {
        await fetchGoogleUserInfo(tokenResponse.access_token);
    }
}

async function fetchGoogleUserInfo(accessToken) {
    try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const profile = await userInfoRes.json();
        if (profile && profile.email) {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: profile.email,
                    name: profile.name || profile.given_name,
                    picture: profile.picture
                })
            });
            const data = await res.json();
            if (data.status === 1) {
                saveUserSession(data.user);
                applyUserSession();
            }
        }
    } catch (err) {
        console.error('Error fetching Google user profile:', err);
    }
}

function checkOAuthRedirectHash() {
    if (window.location.hash && window.location.hash.includes('access_token=')) {
        try {
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const token = hashParams.get('access_token');
            if (token) {
                window.history.replaceState(null, null, window.location.pathname);
                fetchGoogleUserInfo(token);
            }
        } catch (e) {}
    }
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

async function handleGoogleCredentialResponse(response) {
    if (response && response.credential) {
        const payload = parseJwt(response.credential);
        if (payload) {
            try {
                const res = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: payload.email,
                        name: payload.name || payload.given_name,
                        picture: payload.picture
                    })
                });
                const data = await res.json();
                if (data.status === 1) {
                    saveUserSession(data.user);
                    applyUserSession();
                }
            } catch (e) {
                console.error('Google auth server error:', e);
            }
        }
    }
}

async function promptGoogleSignIn() {
    // 1. Initialize on-the-fly if SDK loaded after DOMContentLoaded
    if (!googleTokenClient && window.google && window.google.accounts && window.google.accounts.oauth2) {
        try {
            googleTokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'email profile openid',
                callback: handleGoogleTokenResponse
            });
        } catch (e) {}
    }

    if (googleTokenClient) {
        googleTokenClient.requestAccessToken();
        return;
    }

    if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
            window.google.accounts.id.prompt();
            return;
        } catch (e) {}
    }

    // 2. Fail-safe direct Google OAuth 2.0 URL redirect (never blocked by popup blockers)
    const redirectUri = window.location.origin + '/';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent('email profile openid')}`;
    
    window.location.href = authUrl;
}

async function handleCustomGoogleAuthSubmit(e) {
    e.preventDefault();

    const emailInput = document.getElementById('google-modal-email');
    const nameInput = document.getElementById('google-modal-name');
    const binanceInput = document.getElementById('google-modal-binance');

    const userEmail = emailInput ? emailInput.value.trim() : '';
    let userName = nameInput ? nameInput.value.trim() : '';
    const binanceAddr = binanceInput ? binanceInput.value.trim() : '';

    if (!userEmail) return;

    if (!userName) {
        const prefix = userEmail.split('@')[0];
        userName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }

    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: userEmail,
                name: userName,
                binanceAddress: binanceAddr,
                picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
            })
        });
        const data = await res.json();
        if (data.status === 1) {
            saveUserSession(data.user);
            closeGoogleAuthModal();
            applyUserSession();
        } else {
            alert('Google Auth error: ' + data.message);
        }
    } catch (err) {
        console.error('Google Auth submission error:', err);
        alert('Server connection error during Google sign in.');
    }
}

/* ================= STRICT EMAIL & OTP AUTHENTICATION ================= */

// 1. REGISTRATION SUBMIT -> GENERATE EMAIL OTP
async function handleRegistration(e) {
    e.preventDefault();
    hideAuthError();

    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const binanceAddress = document.getElementById('reg-binance-address').value.trim();

    if (!name || !email || !password || !binanceAddress) {
        showAuthError('Please fill in all registration fields.');
        return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(binanceAddress)) {
        showAuthError('Please enter a valid 0x... BEP20 Binance Address');
        return;
    }

    const regBtn = document.getElementById('reg-submit-btn');
    regBtn.disabled = true;
    regBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Generating Verification Code...`;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, binanceAddress })
        });

        const data = await res.json();
        regBtn.disabled = false;
        regBtn.innerHTML = `Register Account & Send Verification Code`;

        if (data.status === 1) {
            pendingVerificationEmail = data.email;
            pendingOtpToken = data.otpToken || '';
            document.getElementById('otp-target-email').innerText = data.email;
            if (data.otpCode) {
                const otpInput = document.getElementById('otp-input');
                if (otpInput) otpInput.value = data.otpCode;
            }
            document.getElementById('otp-verification-modal').classList.remove('hidden');
        } else {
            showAuthError(data.message || 'Registration failed.');
        }
    } catch (err) {
        regBtn.disabled = false;
        regBtn.innerHTML = `Register Account & Send Verification Code`;
        showAuthError('Server Connection Error.');
    }
}

/* ================= FORGOT PASSWORD MODAL & LOGIC ================= */

function openForgotPasswordModal() {
    hideAuthError();
    document.getElementById('forgot-step-1').classList.remove('hidden');
    document.getElementById('forgot-step-2').classList.add('hidden');
    const loginEmail = document.getElementById('login-email');
    if (loginEmail && loginEmail.value) {
        document.getElementById('forgot-email-input').value = loginEmail.value.trim();
    }
    document.getElementById('forgot-password-modal').classList.remove('hidden');
}

function closeForgotPasswordModal() {
    document.getElementById('forgot-password-modal').classList.add('hidden');
}

async function handleSendForgotOtp(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email-input').value.trim();
    const btn = document.getElementById('forgot-send-btn');

    if (!email) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1"></i> Sending OTP...';

    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();

        if (data.status === 1) {
            document.getElementById('forgot-target-email').innerText = email;
            document.getElementById('forgot-step-1').classList.add('hidden');
            document.getElementById('forgot-step-2').classList.remove('hidden');
            if (data.otpCode) {
                const forgotOtpInput = document.getElementById('forgot-otp-input');
                if (forgotOtpInput) forgotOtpInput.value = data.otpCode;
            }
        } else {
            alert(data.message || 'Failed to send reset OTP');
        }
    } catch (err) {
        alert('Server error while sending OTP. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Send OTP to Email';
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-target-email').innerText.trim() || document.getElementById('forgot-email-input').value.trim();
    const otp = document.getElementById('forgot-otp-input').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value;
    const confirmPassword = document.getElementById('forgot-confirm-password').value;
    const btn = document.getElementById('forgot-reset-btn');

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match! Please check and try again.');
        return;
    }

    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1"></i> Updating Password...';

    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, newPassword })
        });
        const data = await response.json();

        if (data.status === 1) {
            alert('✅ Password updated successfully! Please log in with your new password.');
            closeForgotPasswordModal();
            switchAuthTab('login');
            document.getElementById('login-email').value = email;
            document.getElementById('login-password').value = newPassword;
        } else {
            alert(data.message || 'Failed to reset password.');
        }
    } catch (err) {
        alert('Server error while resetting password.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Update Password & Login';
    }
}

// 2. VERIFY EMAIL OTP CODE
async function handleOtpVerification(e) {
    e.preventDefault();
    const otp = document.getElementById('otp-input').value.trim();

    if (!otp || otp.length < 6) {
        alert('Please enter 6-digit OTP verification code.');
        return;
    }

    const otpBtn = document.getElementById('otp-submit-btn');
    otpBtn.disabled = true;
    otpBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Verifying Code...`;

    try {
        const res = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingVerificationEmail, otp, otpToken: pendingOtpToken })
        });

        const data = await res.json();
        otpBtn.disabled = false;
        otpBtn.innerHTML = `Verify Code & Activate Account`;

        if (data.status === 1 && data.user) {
            saveUserSession(data.user);
            closeOtpModal();
            applyUserSession();
            alert('🎉 Email Verified Successfully! Account Activated.');
        } else {
            alert('Verification Error: ' + data.message);
        }
    } catch (err) {
        otpBtn.disabled = false;
        otpBtn.innerHTML = `Verify Code & Activate Account`;
        alert('Connection error during verification.');
    }
}

function closeOtpModal() {
    document.getElementById('otp-verification-modal').classList.add('hidden');
    document.getElementById('otp-input').value = '';
}

// 3. STRICT EMAIL & PASSWORD LOGIN
async function handleEmailLogin(e) {
    e.preventDefault();
    hideAuthError();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showAuthError('Please enter email and password.');
        return;
    }

    const loginBtn = document.getElementById('login-submit-btn');
    loginBtn.disabled = true;
    loginBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Verifying Credentials...`;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        loginBtn.disabled = false;
        loginBtn.innerHTML = `Login to Dashboard`;

        if (data.status === 1 && data.user) {
            saveUserSession(data.user);
            applyUserSession();
        } else if (data.status === 2) {
            // Pending OTP Verification
            pendingVerificationEmail = data.email;
            document.getElementById('otp-target-email').innerText = data.email;
            document.getElementById('otp-verification-modal').classList.remove('hidden');
        } else {
            showAuthError(data.message || 'Invalid Credentials! Access Denied.');
        }
    } catch (err) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = `Login to Dashboard`;
        showAuthError('Server Connection Error.');
    }
}

function logoutUser() {
    clearSessionCookie();
    currentUser = null;
    try {
        localStorage.removeItem('nexapay_user');
        localStorage.removeItem('kryptpay_user');
        localStorage.removeItem('active_pending_order');
    } catch(e) {}
    showLoggedOutState();
}

/* ================= DASHBOARD & MPXPAYS PAYIN ================= */

async function fetchLiveRate() {
    try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr');
        if (res.ok) {
            const data = await res.json();
            if (data && data.tether && data.tether.inr) {
                usdtRate = (data.tether.inr * 1.008).toFixed(2);
                usdtPayoutRate = (data.tether.inr * 0.98).toFixed(2);
                document.getElementById('header-usdt-rate').innerText = `1 USDT = ₹${usdtRate}`;
                calculateUsdt();
                calculateWithdrawInr();
            }
        }
    } catch (e) {
        console.log('Using default reference rate');
    }
}

let liveWalletSource = null;

function renderWalletBalance(bal) {
    const num = parseFloat(bal || 0);
    const formatted = `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const headerBal = document.getElementById('wallet-balance-display');
    const convertBal = document.getElementById('convert-avail-balance');
    if (headerBal) headerBal.innerText = formatted;
    if (convertBal) convertBal.innerText = formatted;
}

function connectLiveWalletStream() {
    if (!currentUser || !currentUser.email) return;
    if (liveWalletSource) {
        try { liveWalletSource.close(); } catch(e) {}
    }

    try {
        liveWalletSource = new EventSource(`/api/live-wallet/${encodeURIComponent(currentUser.email)}`);

        liveWalletSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'WALLET_UPDATE') {
                    // REAL-TIME 0.1ms UI UPDATE
                    currentUser.walletBalance = data.walletBalance;
                    saveUserSession(currentUser);
                    renderWalletBalance(data.walletBalance);
                    loadUserTransactionLedger();
                    if (data.order && (data.order.status === 'COMPLETED' || data.order.status === 'PAID')) {
                        showOrderSuccessModal(data.order);
                    }
                } else if (data.type === 'CONNECTED') {
                    if (data.walletBalance !== undefined) {
                        currentUser.walletBalance = data.walletBalance;
                        saveUserSession(currentUser);
                        renderWalletBalance(data.walletBalance);
                    }
                }
            } catch(err) {}
        };

        liveWalletSource.onerror = () => {
            setTimeout(connectLiveWalletStream, 4000);
        };
    } catch(e) {}
}

async function updateWalletBalanceDisplay() {
    if (!currentUser || !currentUser.email) return;

    try {
        const res = await fetch(`/api/user-balance/${encodeURIComponent(currentUser.email)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.status === 1 && data.walletBalance !== undefined) {
                currentUser.walletBalance = data.walletBalance;
                saveUserSession(currentUser);
                renderWalletBalance(data.walletBalance);
            }
        }
    } catch (e) {}
}

function calculateDepositCredit() {
    const inrInput = document.getElementById('inr-amount');
    if (!inrInput) return;
    const inrVal = parseFloat(inrInput.value);

    const grossElem = document.getElementById('dep-gross-amount');
    const feeElem = document.getElementById('dep-fee-amount');
    const netElem = document.getElementById('dep-net-credit');

    if (isNaN(inrVal) || inrVal <= 0) {
        if (grossElem) grossElem.innerText = '₹0.00';
        if (feeElem) feeElem.innerText = '₹0.00';
        if (netElem) netElem.innerText = '₹0.00';
        return;
    }

    const fee = inrVal * 0.20;
    const netCredit = Math.max(0, inrVal - fee);

    if (grossElem) grossElem.innerText = `₹${inrVal.toFixed(2)}`;
    if (feeElem) feeElem.innerText = `₹${fee.toFixed(2)}`;
    if (netElem) netElem.innerText = `₹${netCredit.toFixed(2)}`;
}

function calculateConvertUsdt() {
    const inrInput = document.getElementById('convert-inr-amount');
    if (!inrInput) return;
    const inrVal = parseFloat(inrInput.value);
    const outputElem = document.getElementById('convert-usdt-output');

    if (isNaN(inrVal) || inrVal <= 0) {
        if (outputElem) outputElem.innerText = '0.00';
        return;
    }

    const usdtAmount = (inrVal / usdtRate).toFixed(2);
    if (outputElem) outputElem.innerText = usdtAmount;
}

function setConvertMaxAmount() {
    const bal = currentUser ? (currentUser.walletBalance || 0) : 0;
    const input = document.getElementById('convert-inr-amount');
    if (input) {
        const maxMultipleOf100 = Math.floor(bal / 100) * 100;
        if (maxMultipleOf100 < 1000) {
            alert(`Available wallet balance (₹${bal.toFixed(2)}) is below the minimum ₹1,000 conversion requirement or cannot form a ₹100 multiple.`);
            input.value = 1000;
        } else {
            input.value = maxMultipleOf100;
        }
        calculateConvertUsdt();
    }
}

function validateConvertAddress() {
    const addrInput = document.getElementById('convert-binance-address');
    if (!addrInput) return false;
    const val = addrInput.value.trim();
    const status = document.getElementById('convert-address-status');

    if (!val) {
        addrInput.classList.remove('border-emerald-500', 'border-red-500');
        if (status) {
            status.innerText = 'Binance App ➡️ Deposit ➡️ USDT ➡️ Choose "BNB Smart Chain (BEP20)"';
            status.className = 'text-[11px] text-slate-500 mt-1';
        }
        return false;
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(val)) {
        addrInput.classList.remove('border-red-500');
        addrInput.classList.add('border-emerald-500');
        if (status) {
            status.innerText = '✓ Valid BEP20 Binance Address';
            status.className = 'text-[11px] text-emerald-400 mt-1 font-semibold';
        }
        return true;
    } else {
        addrInput.classList.remove('border-emerald-500');
        addrInput.classList.add('border-red-500');
        if (status) {
            status.innerText = '⚠️ Must be a valid 0x... BEP20 address!';
            status.className = 'text-[11px] text-red-400 mt-1 font-semibold';
        }
        return false;
    }
}

async function pasteConvertClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('convert-binance-address').value = text.trim();
            validateConvertAddress();
        }
    } catch (e) {
        alert('Paste shortcut: Ctrl+V into the box.');
    }
}

async function submitWalletConversion() {
    const inrInput = document.getElementById('convert-inr-amount');
    const addrInput = document.getElementById('convert-binance-address');

    const inrVal = parseFloat(inrInput ? inrInput.value : 0);
    const address = addrInput ? addrInput.value.trim() : '';

    if (isNaN(inrVal) || inrVal < 1000) {
        alert('Minimum USDT conversion amount is ₹1,000 INR.');
        return;
    }

    if (Math.round(inrVal) % 100 !== 0) {
        alert('Conversion amount must be in exact multiples of ₹100 (e.g. ₹1000, ₹1100, ₹1200).');
        return;
    }

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        alert('Please enter a valid Binance BEP20 USDT deposit address (starts with 0x).');
        return;
    }

    const availBal = currentUser ? (currentUser.walletBalance || 0) : 0;
    if (availBal < inrVal) {
        alert(`Insufficient Wallet Balance! Available: ₹${availBal.toFixed(2)} INR. Please Add Funds first via UPI.`);
        switchDashboardTab('deposit');
        return;
    }

    const convertBtn = document.getElementById('convert-submit-btn');
    const origText = convertBtn.innerHTML;
    convertBtn.disabled = true;
    convertBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Swapping Wallet INR to USDT...`;

    try {
        const res = await fetch('/api/wallet/convert-usdt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userEmail: currentUser ? currentUser.email : 'user@kryptpay.com',
                inrAmount: inrVal,
                binanceAddress: address
            })
        });

        const data = await res.json();
        convertBtn.disabled = false;
        convertBtn.innerHTML = origText;

        if (data.status === 1) {
            currentUser.walletBalance = data.newBalance;
            localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
            updateWalletBalanceDisplay();

            // Clear input fields
            if (inrInput) inrInput.value = '';
            calculateConvertUsdt();

            // Switch to ledger tab to show Processing... state immediately
            switchDashboardTab('history');
            loadUserTransactionLedger();
            startAutoLedgerPolling();
        } else {
            alert('Conversion Error: ' + data.message);
        }
    } catch (err) {
        convertBtn.disabled = false;
        convertBtn.innerHTML = origText;
        console.error('Wallet conversion error:', err);
        alert('Server connection error during wallet conversion.');
    }
}

function setQuickAmount(amt) {
    document.getElementById('inr-amount').value = amt;
    calculateUsdt();
}

function validateAddress() {
    const addrInput = document.getElementById('binance-address');
    const val = addrInput.value.trim();
    const status = document.getElementById('address-status');

    if (!val) {
        addrInput.classList.remove('border-emerald-500', 'border-red-500');
        status.innerText = 'Binance App ➡️ Deposit ➡️ USDT ➡️ Choose "BNB Smart Chain (BEP20)"';
        status.className = 'text-[11px] text-slate-500 mt-1';
        return false;
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(val)) {
        addrInput.classList.remove('border-red-500');
        addrInput.classList.add('border-emerald-500');
        status.innerText = '✓ Valid BEP20 Binance Address';
        status.className = 'text-[11px] text-emerald-400 mt-1 font-semibold';
        return true;
    } else {
        addrInput.classList.remove('border-emerald-500');
        addrInput.classList.add('border-red-500');
        status.innerText = '⚠️ Must be a valid 0x... BEP20 address!';
        status.className = 'text-[11px] text-red-400 mt-1 font-semibold';
        return false;
    }
}

async function pasteClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('binance-address').value = text.trim();
            validateAddress();
        }
    } catch (e) {
        alert('Paste shortcut: Ctrl+V into the box.');
    }
}

// ------------------------------------------------------------------
// MPXPAYS PAYIN ORDER INTEGRATION (BUY USDT)
// ------------------------------------------------------------------
async function initiateMPXPayInOrder() {
    const inrElem = document.getElementById('inr-amount');
    const inrVal = inrElem ? parseFloat(inrElem.value) : 0;

    if (isNaN(inrVal) || inrVal <= 0) {
        alert('Please enter a valid INR deposit amount.');
        return;
    }

    if (inrVal < 500) {
        alert('Minimum UPI deposit amount is ₹500 INR.');
        return;
    }

    const address = (currentUser && currentUser.binanceAddress) ? currentUser.binanceAddress : '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

    const payBtn = document.getElementById('mpx-pay-btn');
    const originalText = payBtn ? payBtn.innerHTML : '';
    if (payBtn) {
        payBtn.disabled = true;
        payBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-1"></i> Initiating UPI Deposit...`;
    }

    try {
        const response = await fetch('/api/create-payin-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: inrVal,
                binanceAddress: address,
                userEmail: currentUser ? currentUser.email : 'user@kryptpay.com'
            })
        });

        const data = await response.json();
        if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerHTML = originalText;
        }

        if (data.status === 1 && data.payment_url) {
            trackedProcessingOrders.add(data.merchant_order_no);
            try {
                localStorage.setItem('active_pending_order', data.merchant_order_no);
            } catch(e) {}

            const payAmtHeading = document.getElementById('pay-amount-heading');
            if (payAmtHeading) payAmtHeading.innerText = `₹${parseFloat(data.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} INR`;
            
            const orderRefElem = document.getElementById('mpx-order-ref');
            if (orderRefElem) orderRefElem.innerText = data.merchant_order_no;
            
            const checkoutBtn = document.getElementById('open-checkout-btn');
            if (checkoutBtn) {
                checkoutBtn.onclick = () => {
                    const payWin2 = window.open(data.payment_url, '_blank', 'width=500,height=750');
                    const checkPayWin2 = setInterval(() => {
                        if (!payWin2 || payWin2.closed) {
                            clearInterval(checkPayWin2);
                            updateWalletBalanceDisplay();
                            loadUserTransactionLedger();
                        }
                    }, 500);
                };
            }

            const step2Container = document.getElementById('step-2-container');
            if (step2Container) {
                step2Container.classList.remove('hidden');
                step2Container.scrollIntoView({ behavior: 'smooth' });
            }

            const payWin = window.open(data.payment_url, '_blank', 'width=500,height=750');
            const checkPayWin = setInterval(() => {
                if (!payWin || payWin.closed) {
                    clearInterval(checkPayWin);
                    updateWalletBalanceDisplay();
                    loadUserTransactionLedger();
                }
            }, 500);

            startAutoLedgerPolling();
            startOrderPolling(data.merchant_order_no);
        } else {
            alert('PayIn Error: ' + (data.message || 'Failed to initiate order'));
        }
    } catch (err) {
        if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerHTML = originalText;
        }
        console.error('Error initiating PayIn Order:', err);
        alert('Server Connection Error.');
    }
}

// ------------------------------------------------------------------
// WITHDRAWAL / PAYOUT HANDLER (SELL USDT FOR BANK INR)
// ------------------------------------------------------------------
async function handleWithdrawalSubmit(e) {
    e.preventDefault();

    const usdtAmount = document.getElementById('withdraw-usdt-amount').value;
    const bankName = document.getElementById('payout-bank-name').value.trim();
    const accountHolderName = document.getElementById('payout-holder-name').value.trim();
    const accountNumber = document.getElementById('payout-account-no').value.trim();
    const ifscCode = document.getElementById('payout-ifsc').value.trim();

    if (!usdtAmount || !accountNumber || !ifscCode || !accountHolderName) {
        alert('Please fill in all bank account details for withdrawal.');
        return;
    }

    const payoutBtn = document.getElementById('payout-btn');
    const origText = payoutBtn.innerHTML;
    payoutBtn.disabled = true;
    payoutBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Submitting Payout...`;

    try {
        const res = await fetch('/api/create-payout-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usdtAmount: usdtAmount,
                userEmail: currentUser ? currentUser.email : 'user@kryptpay.com',
                bankName: bankName,
                accountHolderName: accountHolderName,
                accountNumber: accountNumber,
                ifscCode: ifscCode
            })
        });

        const data = await res.json();
        payoutBtn.disabled = false;
        payoutBtn.innerHTML = origText;

        if (data.status === 1) {
            alert(`✅ Withdrawal Request Submitted!\nOrder ID: ${data.merchant_order_no}\nNet Payout: ₹${data.inrAmount} INR\nSettlement Status: Processing`);
            switchDashboardTab('history');
        } else {
            alert('Payout Error: ' + data.message);
        }
    } catch (err) {
        payoutBtn.disabled = false;
        payoutBtn.innerHTML = origText;
        alert('Connection error during payout submission.');
    }
}

// ------------------------------------------------------------------
// LOAD USER'S PRIVATE TRANSACTION HISTORY LEDGER
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// LOAD USER'S PRIVATE TRANSACTION HISTORY LEDGER & CONTINUOUS POLLING
// ------------------------------------------------------------------

let autoLedgerTimer = null;
let trackedProcessingOrders = new Set();

function startAutoLedgerPolling() {
    if (autoLedgerTimer) clearInterval(autoLedgerTimer);
    autoLedgerTimer = setInterval(() => {
        if (currentUser && currentUser.email) {
            loadUserTransactionLedger();
            updateWalletBalanceDisplay();
        }
    }, 1000);
}

async function loadUserTransactionLedger() {
    if (!currentUser || !currentUser.email) return;

    const emailElem = document.getElementById('ledger-user-email');
    if (emailElem) emailElem.innerText = currentUser.email;

    const tbody = document.getElementById('transaction-ledger-rows');
    if (!tbody) return;

    try {
        const res = await fetch(`/api/user-transactions/${encodeURIComponent(currentUser.email)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.status === 1 && data.transactions && data.transactions.length > 0) {
                
                tbody.innerHTML = data.transactions.map(tx => {
                    const isDeposit = tx.type === 'DEPOSIT' || tx.type === 'BUY';
                    const isConvert = tx.type === 'CONVERT' || tx.type === 'WITHDRAW';

                    const typeBadge = isDeposit
                        ? '<span class="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">DEPOSIT</span>'
                        : '<span class="bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold">CONVERT</span>';

                    const isPendingApproval = tx.status === 'PENDING_ADMIN_APPROVAL';
                    const isProcessing = tx.status === 'PROCESSING' || tx.status === 'PENDING' || isPendingApproval;
                    const isCompleted = tx.status === 'COMPLETED' || tx.status === 'PAID' || tx.status === 'SUCCESS';

                    if (isProcessing) {
                        trackedProcessingOrders.add(tx.merchant_order_no);
                    } else if (isCompleted && trackedProcessingOrders.has(tx.merchant_order_no)) {
                        // Order completed! Remove from set and trigger success modal
                        trackedProcessingOrders.delete(tx.merchant_order_no);
                        try { localStorage.removeItem('active_pending_order'); } catch(e) {}
                        showOrderSuccessModal(tx);
                        updateWalletBalanceDisplay();
                    }

                    // INR Amount Formatting
                    const netAmt = tx.netAmount || (isDeposit ? (parseFloat(tx.amount) * 0.80).toFixed(2) : tx.amount);
                    const inrDisplay = isDeposit
                        ? `<span class="text-emerald-400 font-bold">+₹${parseFloat(netAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>`
                        : `<span class="text-slate-200 font-bold">-₹${parseFloat(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>`;

                    // USDT Column Formatting
                    const usdtDisplay = isDeposit
                        ? `<span class="text-slate-500 font-mono text-[11px]">- (In Wallet)</span>`
                        : `<span class="font-bold text-amber-400">${tx.usdtAmount} USDT</span>`;

                    // Status Badge Markup
                    let statusMarkup = '';
                    if (isPendingApproval) {
                        statusMarkup = `<span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-pulse inline-flex items-center gap-1.5"><i class="fa-solid fa-clock text-[10px]"></i> Pending Approval</span>`;
                    } else if (isProcessing) {
                        statusMarkup = isDeposit
                            ? `<span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 animate-pulse inline-flex items-center gap-1.5"><i class="fa-solid fa-spinner animate-spin text-[10px]"></i> Awaiting UPI...</span>`
                            : `<span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 animate-pulse inline-flex items-center gap-1.5"><i class="fa-solid fa-spinner animate-spin text-[10px]"></i> Processing...</span>`;
                    } else if (isCompleted) {
                        statusMarkup = isDeposit
                            ? `<span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 inline-flex items-center gap-1.5"><i class="fa-solid fa-circle-check text-emerald-400"></i> Wallet Credited</span>`
                            : `<span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 inline-flex items-center gap-1.5"><i class="fa-solid fa-circle-check text-emerald-400"></i> Completed</span>`;
                    } else {
                        statusMarkup = `
                            <span class="px-2.5 py-1 text-[10px] font-extrabold rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 inline-flex items-center gap-1.5">
                                <i class="fa-solid fa-circle-xmark"></i> Failed
                            </span>
                        `;
                    }

                    // UTR Display with 1-click submit button if pending
                    let utrDisplay = '';
                    if (isProcessing) {
                        if (tx.utr) {
                            utrDisplay = `<span class="bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold font-mono text-[11px]">${tx.utr}</span>`;
                        } else {
                            utrDisplay = `
                                <div class="flex items-center gap-1.5">
                                    <span class="text-amber-400/80 font-mono text-[11px]"><i class="fa-solid fa-clock mr-1"></i>Awaiting...</span>
                                    <button onclick="promptSubmitUtr('${tx.merchant_order_no}')" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">
                                        Enter UTR
                                    </button>
                                </div>
                            `;
                        }
                    } else {
                        utrDisplay = `<span class="text-slate-300 font-mono text-[11px]">${tx.utr || 'Confirmed'}</span>`;
                    }

                    // BSC TxHash Display
                    let txHashDisplay = '';
                    if (isDeposit) {
                        txHashDisplay = `<span class="text-slate-500 font-mono text-[11px]">- (In Wallet)</span>`;
                    } else if (isProcessing) {
                        txHashDisplay = `<span class="text-amber-400/80 font-mono text-[11px] flex items-center gap-1"><i class="fa-solid fa-arrows-rotate animate-spin text-[9px]"></i> Dispatched on Chain...</span>`;
                    } else if (tx.txHash) {
                        txHashDisplay = `<a href="https://bscscan.com/tx/${tx.txHash}" target="_blank" class="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1 hover:underline"><i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i> ${tx.txHash.substring(0, 10)}...</a>`;
                    } else {
                        txHashDisplay = `-`;
                    }

                    return `
                        <tr class="hover:bg-slate-900/60 transition-colors">
                            <td class="py-3 px-4 font-mono font-semibold text-white">${tx.merchant_order_no}</td>
                            <td class="py-3 px-4">${typeBadge}</td>
                            <td class="py-3 px-4">${inrDisplay}</td>
                            <td class="py-3 px-4">${usdtDisplay}</td>
                            <td class="py-3 px-4">${utrDisplay}</td>
                            <td class="py-3 px-4">${statusMarkup}</td>
                            <td class="py-3 px-4">${txHashDisplay}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="py-8 text-center text-slate-500 font-sans">
                            <i class="fa-solid fa-receipt text-slate-600 text-2xl block mb-2"></i>
                            No transaction history found for <span class="text-slate-400 font-mono">${currentUser.email}</span>.
                            Make a Deposit or Convert request to see your ledger logs.
                        </td>
                    </tr>
                `;
            }
        }
    } catch (err) {
        console.error('Error fetching user ledger:', err);
    }
}

function showOrderSuccessModal(tx) {
    const isDeposit = tx.type === 'DEPOSIT' || tx.type === 'BUY';
    const modal = document.getElementById('success-modal');
    if (!modal) return;

    const titleElem = document.getElementById('modal-title');
    const subtitleElem = document.getElementById('modal-subtitle');
    const inrLabel = document.getElementById('modal-inr-label');
    const inrElem = document.getElementById('modal-inr');
    const usdtLabel = document.getElementById('modal-usdt-label');
    const usdtElem = document.getElementById('modal-usdt');
    const utrLabel = document.getElementById('modal-utr-label');
    const utrElem = document.getElementById('modal-utr');
    const rowAddr = document.getElementById('row-modal-address');
    const addrElem = document.getElementById('modal-address');
    const rowHash = document.getElementById('row-modal-txhash');
    const hashElem = document.getElementById('modal-txhash');

    if (isDeposit) {
        if (titleElem) titleElem.innerText = 'UPI Deposit Confirmed!';
        if (subtitleElem) subtitleElem.innerText = 'Payment verified! Funds credited to your NexaPay Wallet balance.';
        if (inrLabel) inrLabel.innerText = 'Gross Paid:';
        if (inrElem) inrElem.innerText = `₹${parseFloat(tx.amount || 0).toFixed(2)} INR`;
        if (usdtLabel) usdtLabel.innerText = 'Net Credited to Wallet:';
        const netAmt = tx.netAmount || (parseFloat(tx.amount || 0) * 0.80).toFixed(2);
        if (usdtElem) usdtElem.innerText = `+₹${parseFloat(netAmt).toFixed(2)} INR (+80%)`;
        if (utrLabel) utrLabel.innerText = 'Gateway UTR / Ref:';
        if (utrElem) utrElem.innerText = tx.utr || tx.transaction_id || 'CONFIRMED';
        if (rowAddr) rowAddr.style.display = 'none';
        if (rowHash) rowHash.style.display = 'none';
    } else {
        if (titleElem) titleElem.innerText = 'USDT Dispatched!';
        if (subtitleElem) subtitleElem.innerText = 'USDT has been dispatched to your Binance BEP20 address.';
        if (inrLabel) inrLabel.innerText = 'Amount Converted:';
        if (inrElem) inrElem.innerText = `₹${parseFloat(tx.amount || 0).toFixed(2)} INR`;
        if (usdtLabel) usdtLabel.innerText = 'USDT Received:';
        if (usdtElem) usdtElem.innerText = `${tx.usdtAmount || '0.00'} USDT (BEP20)`;
        if (utrLabel) utrLabel.innerText = 'Internal Ref / UTR:';
        if (utrElem) utrElem.innerText = tx.utr || 'Confirmed';
        if (rowAddr) {
            rowAddr.style.display = 'flex';
            if (addrElem) addrElem.innerText = tx.binanceAddress || 'Saved Address';
        }
        if (rowHash) {
            rowHash.style.display = 'flex';
            if (hashElem) hashElem.innerText = tx.txHash ? tx.txHash.substring(0, 14) + '...' : '0x9b3f...e82c';
        }
    }

    modal.classList.remove('hidden');
}

// Poll order status until Webhook fires
function startOrderPolling(orderNo) {
    if (currentPollInterval) clearInterval(currentPollInterval);

    currentPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/check-order-status/${encodeURIComponent(orderNo)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 1 && (data.orderStatus === 'PAID' || data.orderStatus === 'COMPLETED')) {
                    clearInterval(currentPollInterval);
                    trackedProcessingOrders.delete(orderNo);
                    try { localStorage.removeItem('active_pending_order'); } catch(e) {}
                    showOrderSuccessModal(data);
                    loadUserTransactionLedger();
                    updateWalletBalanceDisplay();
                }
            }
        } catch (e) {
            console.log('Polling error:', e);
        }
    }, 500);
}

// Stuck Payment Claim Helpers
function toggleClaimSection() {
    const sec = document.getElementById('claim-utr-section');
    const icon = document.getElementById('claim-toggle-icon');
    if (sec) {
        sec.classList.toggle('hidden');
        if (icon) {
            icon.innerHTML = sec.classList.contains('hidden') 
                ? '<i class="fa-solid fa-chevron-down"></i>' 
                : '<i class="fa-solid fa-chevron-up"></i>';
        }
    }
}

async function submitDepositUtrClaim(orderNo) {
    const input = document.getElementById('claim-utr-input');
    const utrVal = input ? input.value.trim() : '';
    const activeOrder = orderNo || document.getElementById('mpx-order-ref')?.innerText?.trim()?.replace('#', '') || localStorage.getItem('active_pending_order');

    if (!utrVal) {
        alert('Please enter your Bank UTR or Gateway Transaction ID (e.g. W6101...)');
        return;
    }

    const btn = document.getElementById('claim-utr-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Checking...';
    }

    try {
        const res = await fetch('/api/claim-deposit-utr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderNo: activeOrder,
                utr: utrVal,
                userEmail: currentUser ? currentUser.email : ''
            })
        });
        const data = await res.json();
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Verify UTR';
        }

        const msgElem = document.getElementById('claim-status-msg');
        if (data.status === 1) {
            if (msgElem) {
                msgElem.className = 'text-[11px] text-emerald-400 font-semibold block';
                msgElem.innerText = '✓ ' + (data.message || 'UTR recorded! Queued for Admin Verification.');
            }
            if (activeOrder) {
                trackedProcessingOrders.add(activeOrder);
                startOrderPolling(activeOrder);
            }
            loadUserTransactionLedger();
            startAutoLedgerPolling();
        } else {
            if (msgElem) {
                msgElem.className = 'text-[11px] text-red-400 font-semibold block';
                msgElem.innerText = '⚠️ ' + (data.message || 'Submission failed.');
            }
        }
    } catch(err) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Verify UTR';
        }
        alert('Connection error submitting UTR.');
    }
}

function promptSubmitUtr(orderNo) {
    const utr = prompt(`Enter Gateway Transaction ID or Bank UTR for ${orderNo}:`);
    if (utr && utr.trim()) {
        const input = document.getElementById('claim-utr-input');
        if (input) input.value = utr.trim();
        const orderRef = document.getElementById('mpx-order-ref');
        if (orderRef) orderRef.innerText = orderNo;
        submitDepositUtrClaim(orderNo);
    }
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.add('hidden');
    resetForm();
    switchDashboardTab('history');
}

function resetForm() {
    if (currentPollInterval) clearInterval(currentPollInterval);
    document.getElementById('step-2-container').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 0ms Instant Wakeup Listeners (User switches back from UPI app or payment tab)
window.addEventListener('focus', () => {
    if (currentUser && currentUser.email) {
        updateWalletBalanceDisplay();
        loadUserTransactionLedger();
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser && currentUser.email) {
        updateWalletBalanceDisplay();
        loadUserTransactionLedger();
    }
});
