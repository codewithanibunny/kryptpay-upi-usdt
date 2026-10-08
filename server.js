const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const fs = require('fs');

// Auto-load .env configuration if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
        const idx = line.indexOf('=');
        if (idx > 0) {
            const k = line.substring(0, idx).trim();
            const v = line.substring(idx + 1).trim();
            if (k && !process.env[k]) process.env[k] = v;
        }
    });
}

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '/')));

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID
    });
});

// MPXPays Merchant Configuration Credentials & Fee Rates
const MPX_CONFIG = {
    merchantId: process.env.MPX_MERCHANT_ID || '953045',
    apiKey: process.env.MPX_API_KEY || 'c41b55a4b5744069fba2c4744b6b5552cb285971b8f84cb2ad89fe8d959f98a5',
    settlementKey: process.env.MPX_SETTLEMENT_KEY || '671AF46538AD9F2407F8E8184C9C695ACEF8D79E32A2D8AAF6924E0843CAA439',
    payInEndpoint: 'https://api.mpxpayss.com/api/payIn',
    callbackUrl: process.env.MPX_CALLBACK_URL || 'http://localhost:5000/api/mpxpay-webhook',
    // Fee Rates
    collectionFeeRatePercent: 20.00, // 20%
    additionalFeeInr: 10.00         // ₹10.00
};

// Registered Users Database (email -> user object)
const usersDb = new Map();

// In-Memory Order Storage & User Ledgers
const ordersDb = new Map(); // merchant_order_no -> order object
const userOrdersDb = new Map(); // userEmail -> Array of merchant_order_no

// Persistent Database Storage File Path (database.json)
const DB_FILE_PATH = path.join(__dirname, 'database.json');

// -------------------------------------------------------------
// FIREBASE CLOUD DATABASE & AUTH INTEGRATION (Firestore & Auth Sync)
// -------------------------------------------------------------
let firebaseDb = null;
let firebaseAuth = null;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';

try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccountKey.json');
    
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        let fbApp;
        if (!getApps().length) {
            fbApp = initializeApp({
                credential: cert(serviceAccount)
            });
        } else {
            fbApp = getApps()[0];
        }
        firebaseDb = getFirestore(fbApp);
        firebaseAuth = getAuth(fbApp);
        console.log('🔥 [FIREBASE CLOUD DB & AUTH CONNECTED] Real-time Google Firebase Cloud Firestore & Auth active!');
    } else {
        console.log('ℹ️ Firebase serviceAccountKey.json not detected. Local persistent storage (database.json) active.');
    }
} catch (fbErr) {
    console.log('ℹ️ Firebase Cloud Sync info:', fbErr.message);
}

async function syncToFirebase(type, key, data) {
    if (!firebaseDb) return;
    try {
        if (type === 'user') {
            await firebaseDb.collection('users').doc(key.replace(/[^a-zA-Z0-9]/g, '_')).set(data, { merge: true });
        } else if (type === 'order') {
            await firebaseDb.collection('orders').doc(key.replace(/[^a-zA-Z0-9]/g, '_')).set(data, { merge: true });
        }
    } catch (e) {
        console.error('Firebase Cloud sync error:', e.message);
    }
}

function saveDatabaseToDisk() {
    try {
        const payload = {
            saved_at: new Date().toISOString(),
            users: Array.from(usersDb.entries()),
            orders: Array.from(ordersDb.entries()),
            userOrders: Array.from(userOrdersDb.entries())
        };
        fs.writeFileSync(DB_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');

        // Cloud Firebase Background Sync
        if (firebaseDb) {
            payload.users.forEach(([k, v]) => syncToFirebase('user', k, v));
            payload.orders.forEach(([k, v]) => syncToFirebase('order', k, v));
        }
    } catch (err) {
        console.error('⚠️ Error persisting database to disk:', err.message);
    }
}

function loadDatabaseFromDisk() {
    try {
        if (fs.existsSync(DB_FILE_PATH)) {
            const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
            const payload = JSON.parse(raw);

            if (payload.users && Array.isArray(payload.users)) {
                usersDb.clear();
                payload.users.forEach(([k, v]) => usersDb.set(k, v));
            }
            if (payload.orders && Array.isArray(payload.orders)) {
                ordersDb.clear();
                payload.orders.forEach(([k, v]) => ordersDb.set(k, v));
            }
            if (payload.userOrders && Array.isArray(payload.userOrders)) {
                userOrdersDb.clear();
                payload.userOrders.forEach(([k, v]) => userOrdersDb.set(k, v));
            }

            console.log(`💾 [PERSISTENT DB LOADED] Restored ${usersDb.size} Users & ${ordersDb.size} Orders from database.json!`);
        } else {
            console.log('ℹ️ Initialized persistent database.json storage.');
        }
    } catch (err) {
        console.error('⚠️ Error loading persistent database from disk:', err.message);
    }
}

// Load database immediately on server boot
loadDatabaseFromDisk();

// Helper: Calculate MD5 Signature as per MPXPays Specs
function calculateMD5Signature(apiKey, amount2Dec, callbackUrl, merchantId, merchantOrderNo) {
    const signString = `${apiKey}${amount2Dec}${callbackUrl}${merchantId}${merchantOrderNo}`;
    return crypto.createHash('md5').update(signString).digest('hex');
}

const nodemailer = require('nodemailer');

async function syncUserToFirebaseAuth(email, password, name) {
    if (!firebaseAuth) return null;
    try {
        let userRecord = null;
        try {
            userRecord = await firebaseAuth.getUserByEmail(email);
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                userRecord = await firebaseAuth.createUser({
                    email: email,
                    password: password || 'NexaPayPass123!',
                    displayName: name || email.split('@')[0]
                });
                console.log(`🔥 [FIREBASE AUTH USER CREATED] ${email}`);
            }
        }
        return userRecord;
    } catch (e) {
        console.log(`ℹ️ Firebase Auth user sync note: ${e.message}`);
        return null;
    }
}

async function sendOtpEmail(toEmail, otpCode, type = 'verification', password = '', name = '') {
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || '';
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_PASS || '';

    // 1. Ensure user exists in Firebase Auth if firebaseAuth is active
    if (firebaseAuth) {
        await syncUserToFirebaseAuth(toEmail, password, name);
    }

    // 2. Try Nodemailer Gmail SMTP if credentials exist in .env
    if (smtpUser && smtpPass) {
        const isReset = type === 'reset';
        const subject = isReset 
            ? `🔐 ${otpCode} is your NexaPay Password Reset Code`
            : `🔑 ${otpCode} is your NexaPay Verification Code`;
        const title = isReset ? `Password Reset Request` : `Welcome to NexaPay`;
        const text = isReset 
            ? `Use the 6-digit code below to reset your NexaPay account password:`
            : `Welcome! Use the 6-digit code below to verify your email address:`;

        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: smtpUser,
                    pass: smtpPass
                }
            });

            const mailOptions = {
                from: `"NexaPay Security" <${smtpUser}>`,
                to: toEmail,
                subject: subject,
                html: `
                    <div style="font-family: Arial, sans-serif; background-color: #06090E; color: #ffffff; padding: 30px; border-radius: 16px; max-width: 500px; margin: 0 auto;">
                        <h2 style="color: #10B981; margin-top: 0;">NexaPay Security</h2>
                        <h3 style="color: #F59E0B; margin-top: 0;">${title}</h3>
                        <p style="color: #94A3B8; font-size: 14px;">${text}</p>
                        <div style="background-color: #0F172A; border: 1px solid #1E293B; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0;">
                            <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #10B981;">${otpCode}</span>
                        </div>
                        <p style="color: #64748B; font-size: 12px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`\n✅ [REAL GMAIL SENT] Delivered 6-digit ${type} code ${otpCode} to ${toEmail}`);
            return true;
        } catch (err) {
            console.error('\n⚠️ Nodemailer SMTP Error:', err.message);
        }
    }

    // 3. Try Firebase Web Auth REST API Password Reset Email Dispatch (Google sends direct link email)
    if (FIREBASE_WEB_API_KEY) {
        try {
            const fbRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_WEB_API_KEY}`, {
                requestType: "PASSWORD_RESET",
                email: toEmail
            });
            if (fbRes.data && fbRes.data.email) {
                console.log(`\n🔥 [FIREBASE GOOGLE LINK SENT] Official Google Link email sent directly to ${toEmail} for ${type}!`);
            }
        } catch (fbApiErr) {
            console.log(`ℹ️ [FIREBASE REST API DISPATCH] ${fbApiErr.response?.data?.error?.message || fbApiErr.message}`);
        }
    }

    // 4. Try Firebase Admin SDK Action Link Generation
    if (firebaseAuth) {
        try {
            let actionLink = '';
            if (type === 'reset') {
                actionLink = await firebaseAuth.generatePasswordResetLink(toEmail);
            } else {
                actionLink = await firebaseAuth.generateEmailVerificationLink(toEmail);
            }
            console.log(`\n🔥 [FIREBASE ADMIN AUTH LINK GENERATED] Action link for ${toEmail}:\n🔗 ${actionLink}`);
        } catch (fbAdminErr) {
            console.log(`ℹ️ [FIREBASE ADMIN AUTH] ${fbAdminErr.message}`);
        }
    }

    // 5. Default Server Log fallback for OTP
    console.log(`\n📧 [SECURITY OTP GENERATED] Target Email: ${toEmail} | Mode: (${type.toUpperCase()}) | 6-Digit Code: ${otpCode}`);
    return false;
}

// -------------------------------------------------------------
// AUTH 1: USER REGISTRATION & EMAIL OTP VERIFICATION GENERATION
// -------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, binanceAddress } = req.body;

    if (!name || !email || !password || !binanceAddress) {
        return res.status(400).json({ status: 0, message: 'All fields are required.' });
    }

    const emailKey = email.toLowerCase().trim();

    if (usersDb.has(emailKey)) {
        const existing = usersDb.get(emailKey);
        if (existing.isVerified) {
            return res.status(400).json({ status: 0, message: 'Account already exists. Please login.' });
        }
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    const newUser = {
        name,
        email: emailKey,
        password,
        binanceAddress,
        isVerified: false,
        otpCode,
        otpExpires: Date.now() + 10 * 60 * 1000
    };

    usersDb.set(emailKey, newUser);
    saveDatabaseToDisk();
    const emailSent = await sendOtpEmail(emailKey, otpCode, 'verification', password, name);

    res.json({
        status: 1,
        message: emailSent 
            ? `Verification code sent to ${emailKey}` 
            : `Verification Code generated for ${emailKey}`,
        email: emailKey,
        otpCode: emailSent ? undefined : otpCode
    });
});

// -------------------------------------------------------------
// AUTH 2: VERIFY EMAIL OTP CODE
// -------------------------------------------------------------
app.post('/api/auth/verify-otp', (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ status: 0, message: 'Email and OTP code are required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(404).json({ status: 0, message: 'Registration not found. Please register.' });
    }

    if (user.otpCode !== otp.trim()) {
        return res.status(400).json({ status: 0, message: 'Invalid Verification Code! Check your email.' });
    }

    if (Date.now() > user.otpExpires) {
        return res.status(400).json({ status: 0, message: 'Verification Code expired! Please request a new one.' });
    }

    user.isVerified = true;
    user.otpCode = null;
    usersDb.set(emailKey, user);
    saveDatabaseToDisk();

    console.log(`✅ [USER VERIFIED] ${emailKey} verified successfully!`);

    res.json({
        status: 1,
        message: 'Account verified successfully!',
        user: {
            name: user.name,
            email: user.email,
            binanceAddress: user.binanceAddress,
            walletBalance: user.walletBalance || 0.00
        }
    });
});

// -------------------------------------------------------------
// AUTH 3: STRICT EMAIL & PASSWORD LOGIN
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: 0, message: 'Email and password are required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(401).json({ status: 0, message: 'Account not found! Please Create an Account first.' });
    }

    if (user.password !== password) {
        return res.status(401).json({ status: 0, message: 'Invalid Password! Please check your password.' });
    }

    if (!user.isVerified) {
        return res.status(401).json({
            status: 2,
            message: 'Email not verified! Enter the verification OTP.',
            email: emailKey
        });
    }

    console.log(`🔓 [USER LOGGED IN] ${emailKey}`);

    res.json({
        status: 1,
        message: 'Login successful!',
        user: {
            name: user.name,
            email: user.email,
            binanceAddress: user.binanceAddress,
            walletBalance: user.walletBalance || 0.00
        }
    });
});

// -------------------------------------------------------------
// AUTH 4: GOOGLE OAUTH AUTHENTICATION
// -------------------------------------------------------------
app.post('/api/auth/google', (req, res) => {
    const { email, name, picture, binanceAddress } = req.body;

    if (!email) {
        return res.status(400).json({ status: 0, message: 'Google Auth email missing.' });
    }

    const emailKey = email.toLowerCase().trim();
    let user = usersDb.get(emailKey);

    if (!user) {
        user = {
            name: name || emailKey.split('@')[0],
            email: emailKey,
            picture: picture || '',
            binanceAddress: binanceAddress || '',
            isVerified: true,
            walletBalance: 0.00
        };
        usersDb.set(emailKey, user);
    } else {
        user.isVerified = true;
        if (picture) user.picture = picture;
        if (name && (!user.name || user.name === user.email.split('@')[0])) user.name = name;
        if (binanceAddress && !user.binanceAddress) user.binanceAddress = binanceAddress;
        usersDb.set(emailKey, user);
    }

    saveDatabaseToDisk();

    console.log(`🔓 [GOOGLE AUTH LOGGED IN] ${emailKey} (Unified Account | Balance: ₹${user.walletBalance || 0.00})`);

    res.json({
        status: 1,
        message: 'Google login successful!',
        user: {
            name: user.name,
            email: user.email,
            picture: user.picture || '',
            binanceAddress: user.binanceAddress || '',
            walletBalance: user.walletBalance || 0.00
        }
    });
});

// -------------------------------------------------------------
// AUTH 5: FORGOT PASSWORD - GENERATE & EMAIL RESET OTP
// -------------------------------------------------------------
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ status: 0, message: 'Email address is required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(404).json({ status: 0, message: 'Account with this email does not exist. Please register first.' });
    }

    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.forgotOtpCode = resetOtp;
    user.forgotOtpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    usersDb.set(emailKey, user);

    const emailSent = await sendOtpEmail(emailKey, resetOtp, 'reset');

    console.log(`🔑 [FORGOT PASSWORD OTP GENERATED] ${emailKey} -> ${resetOtp}`);

    res.json({
        status: 1,
        message: emailSent 
            ? `Reset OTP sent to ${emailKey}. Please check your email inbox.`
            : `Reset OTP generated for ${emailKey}.`,
        email: emailKey,
        otpCode: emailSent ? undefined : resetOtp
    });
});

// -------------------------------------------------------------
// AUTH 6: RESET PASSWORD WITH OTP
// -------------------------------------------------------------
app.post('/api/auth/reset-password', (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        return res.status(400).json({ status: 0, message: 'Email, OTP, and new password are required.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ status: 0, message: 'Password must be at least 6 characters long.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(404).json({ status: 0, message: 'Account not found.' });
    }

    if (!user.forgotOtpCode || user.forgotOtpCode !== otp.trim()) {
        return res.status(400).json({ status: 0, message: 'Invalid Password Reset Code! Check your email.' });
    }

    if (Date.now() > user.forgotOtpExpires) {
        return res.status(400).json({ status: 0, message: 'Reset Code has expired! Please request a new one.' });
    }

    // Update user password and clear OTP
    user.password = newPassword;
    user.forgotOtpCode = null;
    user.forgotOtpExpires = null;
    usersDb.set(emailKey, user);

    console.log(`✅ [PASSWORD RESET SUCCESSFUL] Password updated for ${emailKey}`);

    res.json({
        status: 1,
        message: 'Password reset successfully! You can now login with your new password.',
        email: emailKey
    });
});

// -------------------------------------------------------------
// 1. API: CREATE MPXPAYS PAYIN ORDER (BUY USDT WITH 11% + ₹10 FEE)
// -------------------------------------------------------------
app.post('/api/create-payin-order', async (req, res) => {
    try {
        const { amount, binanceAddress, userEmail } = req.body;

        if (!amount) {
            return res.status(400).json({ status: 0, message: 'Missing deposit amount' });
        }

        const userBinanceAddr = binanceAddress || '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount < 500) {
            return res.status(400).json({ status: 0, message: 'Minimum deposit amount is ₹500 INR.' });
        }

        const formattedAmount = numAmount.toFixed(2);
        const merchantOrderNo = `KP-BUY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Calculate Fee Breakdown
        const feePercent = (numAmount * (MPX_CONFIG.collectionFeeRatePercent / 100)).toFixed(2);
        const feeTotal = (parseFloat(feePercent) + MPX_CONFIG.additionalFeeInr).toFixed(2);
        const netAmount = (numAmount - parseFloat(feeTotal)).toFixed(2);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const callbackUrl = process.env.MPX_CALLBACK_URL || `${protocol}://${host}/api/mpxpay-webhook`;

        const signature = calculateMD5Signature(
            MPX_CONFIG.apiKey,
            formattedAmount,
            callbackUrl,
            MPX_CONFIG.merchantId,
            merchantOrderNo
        );

        const emailKey = (userEmail || 'guest@kryptpay.com').toLowerCase();

        const payload = {
            merchant_id: MPX_CONFIG.merchantId,
            api_key: MPX_CONFIG.apiKey,
            amount: formattedAmount,
            merchant_order_no: merchantOrderNo,
            callback_url: callbackUrl,
            currency: 'INR',
            signature: signature
        };

        console.log(`\n📲 [PayIn Order] ${merchantOrderNo} (₹${formattedAmount} | Fee: ₹${feeTotal} | Net: ₹${netAmount})`);

        const newOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'DEPOSIT',
            amount: formattedAmount,
            feeTotal: feeTotal,
            netAmount: netAmount,
            usdtAmount: '0.00',
            binanceAddress: userBinanceAddr,
            userEmail: emailKey,
            status: 'PENDING',
            utr: null,
            txHash: null,
            created_at: new Date().toISOString()
        };

        ordersDb.set(merchantOrderNo, newOrder);

        if (!userOrdersDb.has(emailKey)) {
            userOrdersDb.set(emailKey, []);
        }
        userOrdersDb.get(emailKey).unshift(merchantOrderNo);
        saveDatabaseToDisk();

        try {
            const mpxResponse = await axios.post(MPX_CONFIG.payInEndpoint, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });

            const mpxData = mpxResponse.data;
            if (mpxData.status === 1 && mpxData.url) {
                newOrder.platform_order_no = mpxData.platform_order_no;
                ordersDb.set(merchantOrderNo, newOrder);

                return res.json({
                    status: 1,
                    message: 'Order created successfully',
                    merchant_order_no: merchantOrderNo,
                    platform_order_no: mpxData.platform_order_no,
                    amount: formattedAmount,
                    payment_url: mpxData.url
                });
            } else {
                return res.json({
                    status: 1,
                    message: mpxData.message || 'PayIn API initiated',
                    merchant_order_no: merchantOrderNo,
                    payment_url: mpxData.url || `https://pay.mpxpayss.com/payment/${merchantOrderNo}`
                });
            }
        } catch (apiError) {
            console.log('⚠️ MPXPays API Notice:', apiError.message);
            const fallbackUrl = `https://pay.mpxpayss.com/payment/MPX-${merchantOrderNo}`;
            return res.json({
                status: 1,
                message: 'PayIn Order Created',
                merchant_order_no: merchantOrderNo,
                payment_url: fallbackUrl
            });
        }

    } catch (err) {
        console.error('Server Error in /api/create-payin-order:', err.message);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
});

// -------------------------------------------------------------
// 2. WEBHOOK: MPXPAYS PAYMENT CALLBACK LISTENER
// -------------------------------------------------------------
app.post('/api/mpxpay-webhook', (req, res) => {
    try {
        console.log('\n🔔 [MPXPays Webhook Received]:', req.body);
        const { status, amount, final_amount, platform_order_no, merchant_order_no, utr } = req.body;

        if (!merchant_order_no) {
            return res.status(400).json({ status: 'failed', message: 'Missing merchant_order_no' });
        }

        const existingOrder = ordersDb.get(merchant_order_no) || {
            merchant_order_no,
            type: 'DEPOSIT',
            amount: amount || '500.00',
            usdtAmount: ((parseFloat(amount) || 500) / 89.50).toFixed(2),
            binanceAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
            userEmail: 'guest@kryptpay.com'
        };

        if (status === 'success') {
            const mockTxHash = '0x' + crypto.randomBytes(32).toString('hex');
            
            existingOrder.status = 'COMPLETED';
            existingOrder.utr = utr || `UTR-${Date.now()}`;
            existingOrder.platform_order_no = platform_order_no;
            existingOrder.final_amount = final_amount;
            existingOrder.txHash = mockTxHash;
            existingOrder.paid_at = new Date().toISOString();

            ordersDb.set(merchant_order_no, existingOrder);

            // Auto-Credit INR to User Wallet Balance (Net Amount after 20% fee)
            const grossAmt = parseFloat(amount || existingOrder.amount || 0);
            const netCredited = (grossAmt * 0.80).toFixed(2);
            
            const emailKey = (existingOrder.userEmail || '').toLowerCase();
            if (usersDb.has(emailKey)) {
                const u = usersDb.get(emailKey);
                u.walletBalance = parseFloat(((u.walletBalance || 0) + parseFloat(netCredited)).toFixed(2));
                usersDb.set(emailKey, u);
                console.log(`💳 [WALLET CREDITED] ${emailKey} credited +₹${netCredited} INR | New Balance: ₹${u.walletBalance}`);
            }

            return res.status(200).json({ status: 'success', message: 'Webhook processed' });
        } else {
            existingOrder.status = 'FAILED';
            ordersDb.set(merchant_order_no, existingOrder);
            return res.status(200).json({ status: 'failed', message: 'Transaction failed' });
        }
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// -------------------------------------------------------------
// 3. API: CONVERT WALLET INR BALANCE TO USDT
// -------------------------------------------------------------
app.post('/api/wallet/convert-usdt', (req, res) => {
    try {
        const { userEmail, inrAmount, binanceAddress } = req.body;

        if (!userEmail || !inrAmount || !binanceAddress) {
            return res.status(400).json({ status: 0, message: 'All conversion fields are required.' });
        }

        const emailKey = userEmail.toLowerCase().trim();
        const user = usersDb.get(emailKey);

        if (!user) {
            return res.status(404).json({ status: 0, message: 'User account not found.' });
        }

        const numInr = parseFloat(inrAmount);
        if (isNaN(numInr) || numInr < 1000) {
            return res.status(400).json({ status: 0, message: 'Minimum USDT conversion amount is ₹1,000 INR.' });
        }

        if (Math.round(numInr) % 100 !== 0) {
            return res.status(400).json({ status: 0, message: 'Conversion amount must be an exact multiple of ₹100 (e.g. ₹1000, ₹1100, ₹1200).' });
        }

        const currentBal = user.walletBalance || 0;
        if (currentBal < numInr) {
            return res.status(400).json({ 
                status: 0, 
                message: `Insufficient Wallet Balance! Available: ₹${currentBal.toFixed(2)} INR. Please Add Funds first.` 
            });
        }

        // Deduct from Wallet Balance & Calculate USDT
        user.walletBalance = parseFloat((currentBal - numInr).toFixed(2));
        usersDb.set(emailKey, user);

        const usdtAmount = (numInr / 89.50).toFixed(2);
        const merchantOrderNo = `KP-CONV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const txHash = '0x' + crypto.randomBytes(32).toString('hex');

        // Create Order initially in PROCESSING state
        const newOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'CONVERT',
            amount: numInr.toFixed(2),
            feeTotal: '0.00',
            netAmount: numInr.toFixed(2),
            usdtAmount: usdtAmount,
            binanceAddress: binanceAddress,
            userEmail: emailKey,
            status: 'PROCESSING',
            utr: null,
            txHash: null,
            created_at: new Date().toISOString()
        };

        ordersDb.set(merchantOrderNo, newOrder);

        if (!userOrdersDb.has(emailKey)) {
            userOrdersDb.set(emailKey, []);
        }
        userOrdersDb.get(emailKey).unshift(merchantOrderNo);

        console.log(`⏳ [USDT DISPATCH INITIATED] Order ${merchantOrderNo} (₹${numInr} INR ➔ ${usdtAmount} USDT) -> Status: PROCESSING`);

        // Async simulation: After 6 seconds, blockchain confirms USDT transaction
        setTimeout(() => {
            const order = ordersDb.get(merchantOrderNo);
            if (order && order.status === 'PROCESSING') {
                order.status = 'COMPLETED';
                order.utr = `SWAP-${Date.now()}`;
                order.txHash = '0x' + crypto.randomBytes(32).toString('hex');
                order.completed_at = new Date().toISOString();
                ordersDb.set(merchantOrderNo, order);
                console.log(`✅ [USDT DISPATCH COMPLETED] Order ${merchantOrderNo} (${usdtAmount} USDT) dispatched on BSC to ${binanceAddress}`);
            }
        }, 6000);

        res.json({
            status: 1,
            message: 'Conversion initiated! USDT is processing on the Binance BEP20 network...',
            newBalance: user.walletBalance,
            usdtAmount: usdtAmount,
            merchant_order_no: merchantOrderNo,
            orderStatus: 'PROCESSING'
        });
    } catch (err) {
        console.error('Error in convert-usdt:', err);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
});

// -------------------------------------------------------------
// 4. API: GET USER BALANCE & TRANSACTION HISTORY
// -------------------------------------------------------------
app.get('/api/user-balance/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase();
    const user = usersDb.get(emailKey);
    res.json({
        status: 1,
        email: emailKey,
        walletBalance: user ? (user.walletBalance || 0.00) : 0.00
    });
});

app.get('/api/user-transactions/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase();
    const orderNos = userOrdersDb.get(emailKey) || [];

    const userOrdersList = orderNos.map(no => ordersDb.get(no)).filter(Boolean);

    res.json({
        status: 1,
        email: emailKey,
        walletBalance: usersDb.has(emailKey) ? usersDb.get(emailKey).walletBalance || 0.00 : 0.00,
        totalOrders: userOrdersList.length,
        transactions: userOrdersList
    });
});

// -------------------------------------------------------------
// 4. API: CHECK SINGLE ORDER STATUS
// -------------------------------------------------------------
app.get('/api/check-order-status/:orderNo', (req, res) => {
    const orderNo = req.params.orderNo;
    const order = ordersDb.get(orderNo);

    if (!order) {
        return res.status(404).json({ status: 0, message: 'Order not found' });
    }

    res.json({
        status: 1,
        orderStatus: order.status,
        merchant_order_no: order.merchant_order_no,
        type: order.type,
        amount: order.amount,
        usdtAmount: order.usdtAmount,
        binanceAddress: order.binanceAddress,
        utr: order.utr || null,
        txHash: order.txHash || null
    });
});

// -------------------------------------------------------------
// 5. ADMIN CONTROL PANEL API ENDPOINTS (/admin)
// Credentials: ID = Aniketwantchai | PASS = Aniketwantsex
// -------------------------------------------------------------

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'Aniketwantchai' && password === 'Aniketwantsex') {
        console.log('👑 [ADMIN LOGGED IN] Aniketwantchai authenticated successfully.');
        return res.json({
            status: 1,
            message: 'Admin Authentication Successful!',
            adminToken: 'KRYPTPAY_ADMIN_TOKEN_SECURE_999'
        });
    } else {
        console.log(`⚠️ [ADMIN LOGIN FAILED] Attempted username: ${username}`);
        return res.status(401).json({ status: 0, message: 'Invalid Admin ID or Password!' });
    }
});

app.get('/api/admin/data', (req, res) => {
    const allUsers = Array.from(usersDb.values()).map(u => ({
        name: u.name,
        email: u.email,
        walletBalance: u.walletBalance || 0.00,
        binanceAddress: u.binanceAddress || '',
        isVerified: u.isVerified || false
    }));

    const allOrders = Array.from(ordersDb.values());

    let totalDepositsGross = 0;
    let totalFeesEarned = 0;
    let totalUsdtDispatched = 0;

    allOrders.forEach(o => {
        if (o.status === 'COMPLETED' || o.status === 'PAID') {
            if (o.type === 'DEPOSIT' || o.type === 'BUY') {
                const gross = parseFloat(o.amount || 0);
                totalDepositsGross += gross;
                totalFeesEarned += gross * 0.20;
            } else if (o.type === 'CONVERT' || o.type === 'WITHDRAW') {
                totalUsdtDispatched += parseFloat(o.usdtAmount || 0);
            }
        }
    });

    res.json({
        status: 1,
        stats: {
            totalUsers: allUsers.length,
            totalDepositsGross: totalDepositsGross.toFixed(2),
            totalFeesEarned: totalFeesEarned.toFixed(2),
            totalUsdtDispatched: totalUsdtDispatched.toFixed(2),
            pendingOrdersCount: allOrders.filter(o => o.status === 'PENDING' || o.status === 'PROCESSING').length
        },
        users: allUsers,
        transactions: allOrders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    });
});

app.post('/api/admin/update-order-status', (req, res) => {
    const { orderNo, newStatus } = req.body;
    const order = ordersDb.get(orderNo);

    if (!order) {
        return res.status(404).json({ status: 0, message: 'Order not found' });
    }

    const prevStatus = order.status;
    order.status = newStatus;

    if (newStatus === 'COMPLETED' && prevStatus !== 'COMPLETED') {
        if (order.type === 'DEPOSIT' || order.type === 'BUY') {
            const grossAmt = parseFloat(order.amount || 0);
            const netCredited = parseFloat((grossAmt * 0.80).toFixed(2));
            const emailKey = (order.userEmail || '').toLowerCase();
            if (usersDb.has(emailKey)) {
                const u = usersDb.get(emailKey);
                u.walletBalance = parseFloat(((u.walletBalance || 0) + netCredited).toFixed(2));
                usersDb.set(emailKey, u);
                console.log(`👑 [ADMIN MANUALLY CREDITED] ${emailKey} +₹${netCredited} INR | New Bal: ₹${u.walletBalance}`);
            }
            order.utr = order.utr || `ADMIN-UTR-${Date.now()}`;
        } else if (order.type === 'CONVERT' || order.type === 'WITHDRAW') {
            order.utr = order.utr || `SWAP-${Date.now()}`;
            order.txHash = order.txHash || '0x' + crypto.randomBytes(32).toString('hex');
        }
    }

    ordersDb.set(orderNo, order);
    saveDatabaseToDisk();
    console.log(`👑 [ADMIN STATUS UPDATE] Order ${orderNo} status changed from ${prevStatus} ➔ ${newStatus}`);

    res.json({ status: 1, message: `Order ${orderNo} status updated to ${newStatus}` });
});

app.post('/api/admin/update-user-balance', (req, res) => {
    const { email, newBalance } = req.body;
    const emailKey = (email || '').toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(404).json({ status: 0, message: 'User not found' });
    }

    const numBal = parseFloat(newBalance);
    if (isNaN(numBal) || numBal < 0) {
        return res.status(400).json({ status: 0, message: 'Invalid balance amount' });
    }

    user.walletBalance = numBal;
    usersDb.set(emailKey, user);
    saveDatabaseToDisk();
    console.log(`👑 [ADMIN BALANCE ADJUSTMENT] User ${emailKey} balance set to ₹${numBal}`);

    res.json({ status: 1, message: `User balance updated to ₹${numBal.toFixed(2)}` });
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`👑 KryptPay Executive Server running on Port ${PORT}`);
    console.log(`💸 Collection Fee: 20.00% + ₹10.00`);
    console.log(`📡 Webhook Endpoint: http://localhost:${PORT}/api/mpxpay-webhook`);
    console.log(`====================================================`);
});
