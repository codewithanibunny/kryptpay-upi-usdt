// Application State & Pre-seeded Accounts
let usdtRate = 89.50;
let currentUser = null;

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
    // Hide main converter page
    document.getElementById('main-dashboard-view').classList.add('hidden');
    // Show landing auth portal
    document.getElementById('auth-landing-view').classList.remove('hidden');
    // Hide Header profile
    document.getElementById('auth-nav-user').classList.add('hidden');
    document.getElementById('auth-nav-user').classList.remove('flex');
}

function applyUserSession() {
    if (!currentUser) {
        showLoggedOutState();
        return;
    }

    // Hide auth landing view
    document.getElementById('auth-landing-view').classList.add('hidden');
    // Show main converter dashboard
    document.getElementById('main-dashboard-view').classList.remove('hidden');

    // Update Header UI
    document.getElementById('auth-nav-user').classList.remove('hidden');
    document.getElementById('auth-nav-user').classList.add('flex');
    
    document.getElementById('user-name-display').innerText = currentUser.name;
    document.getElementById('user-avatar-text').innerText = currentUser.name.charAt(0).toUpperCase();

    // Auto-fill Saved Binance Address into the Buy Box
    if (currentUser.binanceAddress) {
        const addrInput = document.getElementById('binance-address');
        addrInput.value = currentUser.binanceAddress;
        document.getElementById('address-saved-indicator').classList.remove('hidden');
        validateAddress();
    }
}

// Auth Tab Switcher (Login vs Sign Up)
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

/* ================= DASHBOARD & CONVERTER ================= */

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

function generateUPIPayment() {
    const inrVal = parseFloat(document.getElementById('inr-amount').value);
    const address = document.getElementById('binance-address').value.trim();
    let merchantUPI = document.getElementById('merchant-upi-input').value.trim();

    if (!merchantUPI) {
        alert('Please enter your receiving UPI ID.');
        return;
    }

    if (isNaN(inrVal) || inrVal < 200) {
        alert('Minimum amount is ₹200 INR.');
        return;
    }

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        alert('Please enter a valid Binance BEP20 USDT deposit address (starts with 0x).');
        return;
    }

    document.getElementById('pay-amount-heading').innerText = `₹${inrVal.toLocaleString('en-IN')} INR`;

    const upiUri = `upi://pay?pa=${encodeURIComponent(merchantUPI)}&pn=InstantUSDT&am=${inrVal}&cu=INR`;
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiUri)}&size=300&margin=1`;
    
    document.getElementById('upi-qr-image').src = qrUrl;
    document.getElementById('upi-id-text').innerText = merchantUPI;

    document.getElementById('gpay-link').href = upiUri;
    document.getElementById('phonepe-link').href = upiUri;
    document.getElementById('paytm-link').href = upiUri;

    document.getElementById('step-2-container').classList.remove('hidden');
    document.getElementById('step-2-container').scrollIntoView({ behavior: 'smooth' });
}

function copyUPIId() {
    const merchantUPI = document.getElementById('merchant-upi-input').value.trim();
    navigator.clipboard.writeText(merchantUPI);
    alert('UPI ID copied: ' + merchantUPI);
}

function submitUTRVerification() {
    const utr = document.getElementById('utr-input').value.trim();
    if (!utr || utr.length < 10) {
        alert('Please enter a valid 12-digit UTR / Reference number from your UPI app.');
        return;
    }

    const inrVal = document.getElementById('inr-amount').value;
    const usdtVal = (inrVal / usdtRate).toFixed(2);
    const address = document.getElementById('binance-address').value.trim();

    document.getElementById('modal-inr').innerText = `₹${inrVal} INR`;
    document.getElementById('modal-usdt').innerText = `${usdtVal} USDT (BEP20)`;
    document.getElementById('modal-address').innerText = address;
    document.getElementById('modal-txhash').innerText = '0x' + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join('');

    document.getElementById('success-modal').classList.remove('hidden');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.add('hidden');
    resetForm();
}

function resetForm() {
    document.getElementById('step-2-container').classList.add('hidden');
    document.getElementById('utr-input').value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
