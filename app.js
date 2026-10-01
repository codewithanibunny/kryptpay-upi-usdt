// Executive Wealth Application State
let usdtRate = 89.50;
let usdtPayoutRate = 87.00;
let currentUser = null;
let currentPollInterval = null;
let pendingVerificationEmail = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchLiveRate();
    calculateUsdt();
    calculateWithdrawInr();
    checkSavedSession();
    initGoogleAuth();
});

// Check saved user session in LocalStorage
function checkSavedSession() {
    const saved = localStorage.getItem('kryptpay_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            applyUserSession();
        } catch (e) {
            showLoggedOutState();
        }
    } else {
        showLoggedOutState();
    }
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
        const addrInput = document.getElementById('binance-address');
        addrInput.value = currentUser.binanceAddress;
        document.getElementById('address-saved-indicator').classList.remove('hidden');
        validateAddress();
    }

    loadUserTransactionLedger();
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

// Switch Dashboard View Tabs (Buy vs Withdraw vs History)
function switchDashboardTab(tabName) {
    const buyBtn = document.getElementById('dash-tab-buy');
    const withdrawBtn = document.getElementById('dash-tab-withdraw');
    const historyBtn = document.getElementById('dash-tab-history');

    const buyContent = document.getElementById('dash-content-buy');
    const withdrawContent = document.getElementById('dash-content-withdraw');
    const historyContent = document.getElementById('dash-content-history');

    buyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";
    withdrawBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";
    historyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all";

    buyContent.classList.add('hidden');
    withdrawContent.classList.add('hidden');
    historyContent.classList.add('hidden');

    if (tabName === 'buy') {
        buyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-emerald-500 text-slate-950 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        buyContent.classList.remove('hidden');
    } else if (tabName === 'withdraw') {
        withdrawBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-amber-500 text-slate-950 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        withdrawContent.classList.remove('hidden');
    } else if (tabName === 'history') {
        historyBtn.className = "flex-1 py-3 text-xs font-bold rounded-xl bg-slate-800 text-emerald-400 border border-slate-700 shadow-lg flex items-center justify-center gap-1.5 transition-all";
        historyContent.classList.remove('hidden');
        loadUserTransactionLedger();
    }
}

/* ================= GOOGLE IDENTITY OAUTH INTEGRATION ================= */

function initGoogleAuth() {
    if (window.GOOGLE_CLIENT_ID && window.google && window.google.accounts) {
        window.google.accounts.id.initialize({
            client_id: window.GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse
        });
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
                    currentUser = data.user;
                    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
                    applyUserSession();
                }
            } catch (e) {
                console.error('Google auth server error:', e);
            }
        }
    }
}

async function promptGoogleSignIn() {
    if (window.GOOGLE_CLIENT_ID && window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.prompt();
        return;
    }

    const userEmail = prompt('Sign in with Google - Enter your Gmail address:', 'anibunny2387@gmail.com');
    if (userEmail) {
        const userName = userEmail.split('@')[0];
        const formattedName = userName.charAt(0).toUpperCase() + userName.slice(1);
        
        try {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: userEmail,
                    name: formattedName,
                    picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                })
            });
            const data = await res.json();
            if (data.status === 1) {
                currentUser = data.user;
                localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
                applyUserSession();
            }
        } catch (e) {
            console.error('Google sign in error', e);
        }
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
            document.getElementById('otp-target-email').innerText = data.email;
            
            if (data.devOtp) {
                document.getElementById('dev-otp-code').innerText = data.devOtp;
                document.getElementById('otp-dev-hint').classList.remove('hidden');
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
            body: JSON.stringify({ email: pendingVerificationEmail, otp })
        });

        const data = await res.json();
        otpBtn.disabled = false;
        otpBtn.innerHTML = `Verify Code & Activate Account`;

        if (data.status === 1 && data.user) {
            currentUser = data.user;
            localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
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
            currentUser = data.user;
            localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
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
    currentUser = null;
    localStorage.removeItem('kryptpay_user');
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

function calculateUsdt() {
    const inrVal = parseFloat(document.getElementById('inr-amount').value);
    const outputElem = document.getElementById('usdt-output');
    if (isNaN(inrVal) || inrVal <= 0) {
        outputElem.innerText = '0.00';
        return;
    }
    outputElem.innerText = (inrVal / usdtRate).toFixed(2);
}

function calculateWithdrawInr() {
    const usdtVal = parseFloat(document.getElementById('withdraw-usdt-amount').value);
    const outputElem = document.getElementById('withdraw-inr-output');
    if (isNaN(usdtVal) || usdtVal <= 0) {
        outputElem.innerText = '₹0.00';
        return;
    }
    const inrVal = (usdtVal * usdtPayoutRate).toFixed(2);
    outputElem.innerText = `₹${parseFloat(inrVal).toLocaleString('en-IN')}`;
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
    const inrVal = parseFloat(document.getElementById('inr-amount').value);
    const address = document.getElementById('binance-address').value.trim();

    if (isNaN(inrVal) || inrVal <= 0) {
        alert('Please enter a valid INR amount.');
        return;
    }

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        alert('Please enter a valid Binance BEP20 USDT deposit address (starts with 0x).');
        return;
    }

    const payBtn = document.getElementById('mpx-pay-btn');
    const originalText = payBtn.innerHTML;
    payBtn.disabled = true;
    payBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Generating PayIn Signature...`;

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
        payBtn.disabled = false;
        payBtn.innerHTML = originalText;

        if (data.status === 1 && data.payment_url) {
            document.getElementById('pay-amount-heading').innerText = `₹${parseFloat(data.amount).toLocaleString('en-IN')} INR`;
            document.getElementById('mpx-order-ref').innerText = data.merchant_order_no;
            
            const checkoutBtn = document.getElementById('open-checkout-btn');
            checkoutBtn.onclick = () => window.open(data.payment_url, '_blank', 'width=500,height=750');

            document.getElementById('step-2-container').classList.remove('hidden');
            document.getElementById('step-2-container').scrollIntoView({ behavior: 'smooth' });

            window.open(data.payment_url, '_blank', 'width=500,height=750');
            startOrderPolling(data.merchant_order_no);
        } else {
            alert('PayIn Error: ' + (data.message || 'Failed to initiate order'));
        }
    } catch (err) {
        payBtn.disabled = false;
        payBtn.innerHTML = originalText;
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
                    const isBuy = tx.type !== 'WITHDRAW';
                    const badgeClass = tx.status === 'COMPLETED' || tx.status === 'PAID'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30';
                    
                    const typeBadge = isBuy
                        ? '<span class="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">BUY</span>'
                        : '<span class="bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold">WITHDRAW</span>';

                    return `
                        <tr class="hover:bg-slate-900/60 transition-colors">
                            <td class="py-3 px-4 font-mono font-semibold text-white">${tx.merchant_order_no}</td>
                            <td class="py-3 px-4">${typeBadge}</td>
                            <td class="py-3 px-4 font-bold text-white">₹${parseFloat(tx.amount).toLocaleString('en-IN')}</td>
                            <td class="py-3 px-4 font-bold text-emerald-400">${tx.usdtAmount} USDT</td>
                            <td class="py-3 px-4 text-slate-300 font-mono text-[11px]">${tx.utr || 'Pending'}</td>
                            <td class="py-3 px-4">
                                <span class="px-2 py-0.5 rounded text-[10px] border font-bold ${badgeClass}">
                                    ${tx.status}
                                </span>
                            </td>
                            <td class="py-3 px-4 font-mono text-[11px] text-cyan-400">
                                ${tx.txHash ? tx.txHash.substring(0, 10) + '...' : '-'}
                            </td>
                        </tr>
                    `;
                }).join('');
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="py-8 text-center text-slate-500 font-sans">
                            <i class="fa-solid fa-receipt text-slate-600 text-2xl block mb-2"></i>
                            No transaction history found for <span class="text-slate-400 font-mono">${currentUser.email}</span>.
                            Make a Buy or Withdraw request to see your ledger logs.
                        </td>
                    </tr>
                `;
            }
        }
    } catch (err) {
        console.error('Error fetching user ledger:', err);
    }
}

// Poll order status until Webhook fires
function startOrderPolling(orderNo) {
    if (currentPollInterval) clearInterval(currentPollInterval);

    currentPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/check-order-status/${orderNo}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 1 && (data.orderStatus === 'PAID' || data.orderStatus === 'COMPLETED')) {
                    clearInterval(currentPollInterval);
                    
                    document.getElementById('modal-inr').innerText = `₹${data.amount} INR`;
                    document.getElementById('modal-usdt').innerText = `${data.usdtAmount} USDT (BEP20)`;
                    document.getElementById('modal-address').innerText = data.binanceAddress;
                    document.getElementById('modal-utr').innerText = data.utr || 'Confirmed';
                    document.getElementById('modal-txhash').innerText = data.txHash || '0x9b3f...e82c';

                    document.getElementById('success-modal').classList.remove('hidden');
                    loadUserTransactionLedger();
                }
            }
        } catch (e) {
            console.log('Polling error:', e);
        }
    }, 3000);
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
