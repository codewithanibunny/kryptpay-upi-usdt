// Application State & Pre-seeded Accounts
let usdtRate = 89.50;
let currentUser = null;
let currentPollInterval = null;

// Demo account
const demoAccount = {
    name: 'Demo Trader',
    email: 'demo@kryptpay.com',
    binanceAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
};

document.addEventListener('DOMContentLoaded', () => {
    fetchLiveRate();
    calculateUsdt();
    checkSavedSession();
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
    
    document.getElementById('user-name-display').innerText = currentUser.name;
    document.getElementById('user-avatar-text').innerText = currentUser.name.charAt(0).toUpperCase();

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

/* ================= AUTHENTICATION HANDLERS ================= */

function fillDemoCredentials() {
    currentUser = demoAccount;
    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
    applyUserSession();
}

function loginWithGoogle() {
    currentUser = {
        name: 'Google User',
        email: 'user@gmail.com',
        binanceAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
    };
    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
    applyUserSession();
}

function handleEmailLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    
    currentUser = {
        name: email.split('@')[0],
        email: email,
        binanceAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
    };
    
    localStorage.setItem('kryptpay_user', JSON.stringify(currentUser));
    applyUserSession();
}

function handleRegistration(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const binanceAddress = document.getElementById('reg-binance-address').value.trim();

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
                userEmail: currentUser ? currentUser.email : 'guest@kryptpay.com'
            })
        });

        const data = await response.json();
        payBtn.disabled = false;
        payBtn.innerHTML = originalText;

        if (data.status === 1 && data.payment_url) {
            // Show Order Tracking Card
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
        alert('Server Connection Error. Make sure server is running on Port 8080.');
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
                    
                    // Show Success Modal with Binance TxHash and UTR
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

// Simulate instant webhook payment success for testing
async function simulatePaymentTest() {
    const orderNo = document.getElementById('mpx-order-ref').innerText;
    if (!orderNo || orderNo === '#KP-...') return;

    try {
        const res = await fetch('/api/simulate-payment-success', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_order_no: orderNo })
        });
        const data = await res.json();
        if (data.status === 1) {
            alert('Simulated Webhook Payment Success for Order: ' + orderNo);
        }
    } catch (e) {
        console.error('Simulation error', e);
    }
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
