// Launch Application State
let usdtRate = 89.50;
let currentUser = null;
let currentPollInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchLiveRate();
    calculateUsdt();
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
    
    // User Profile Picture vs Initial Letter
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
}

function switchAuthTab(tab) {
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

/* ================= GOOGLE IDENTITY OAUTH INTEGRATION ================= */

function initGoogleAuth() {
    if (window.google && window.google.accounts) {
        window.google.accounts.id.initialize({
            client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', // Replace with your Google OAuth Client ID
            callback: handleGoogleCredentialResponse
        });
    }
}

// Decode Google JWT Credential Response
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

// Handle Google OAuth Login Callback
function handleGoogleCredentialResponse(response) {
    if (response && response.credential) {
        const payload = parseJwt(response.credential);
        if (payload) {
            currentUser = {
                name: payload.name || payload.given_name || 'Google User',
                email: payload.email,
                picture: payload.picture || '',
                binanceAddress: currentUser ? currentUser.binanceAddress : ''
            };
            localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
            applyUserSession();
            alert(`Welcome ${currentUser.name}! Logged in via Google.`);
        }
    }
}

// Fallback Google Sign In Prompt
function promptGoogleSignIn() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.prompt();
    } else {
        // Simulated Google Sign-In prompt fallback
        const userEmail = prompt('Enter your Google Email Address to sign in:', 'user@gmail.com');
        if (userEmail) {
            const userName = userEmail.split('@')[0];
            currentUser = {
                name: userName.charAt(0).toUpperCase() + userName.slice(1),
                email: userEmail,
                picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
                binanceAddress: ''
            };
            localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
            applyUserSession();
        }
    }
}

/* ================= EMAIL AUTHENTICATION HANDLERS ================= */

function handleEmailLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert('Please fill in email and password.');
        return;
    }
    
    currentUser = {
        name: email.split('@')[0],
        email: email,
        binanceAddress: ''
    };
    
    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
    applyUserSession();
}

function handleRegistration(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const binanceAddress = document.getElementById('reg-binance-address').value.trim();

    if (!name || !email || !password) {
        alert('Please fill in all required fields.');
        return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(binanceAddress)) {
        alert('Please enter a valid 0x... BEP20 Binance Address');
        return;
    }

    currentUser = {
        name: name,
        email: email,
        binanceAddress: binanceAddress
    };

    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
    applyUserSession();
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
                document.getElementById('header-usdt-rate').innerText = `1 USDT = ₹${usdtRate}`;
                calculateUsdt();
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
// MPXPAYS PAYIN ORDER INTEGRATION
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
    payBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Generating MPXPays Signature...`;

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

            // Automatically open MPXPays checkout window
            window.open(data.payment_url, '_blank', 'width=500,height=750');

            // Start polling for Webhook Callback status
            startOrderPolling(data.merchant_order_no);
        } else {
            alert('MPXPays Error: ' + (data.message || 'Failed to initiate order'));
        }
    } catch (err) {
        payBtn.disabled = false;
        payBtn.innerHTML = originalText;
        console.error('Error initiating MPXPays PayIn Order:', err);
        alert('Server Connection Error.');
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
                if (data.status === 1 && data.orderStatus === 'PAID') {
                    clearInterval(currentPollInterval);
                    
                    document.getElementById('modal-inr').innerText = `₹${data.amount} INR`;
                    document.getElementById('modal-usdt').innerText = `${data.usdtAmount} USDT (BEP20)`;
                    document.getElementById('modal-address').innerText = data.binanceAddress;
                    document.getElementById('modal-utr').innerText = data.utr || 'Confirmed';
                    document.getElementById('modal-txhash').innerText = data.txHash || '0x9b3f...e82c';

                    document.getElementById('success-modal').classList.remove('hidden');
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
}

function resetForm() {
    if (currentPollInterval) clearInterval(currentPollInterval);
    document.getElementById('step-2-container').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
