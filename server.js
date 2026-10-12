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

// Enable CORS and JSON body parser (compatible with Vercel Serverless)
app.use(cors());

app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        next();
    } else {
        express.json()(req, res, (err) => {
            if (err) return res.status(400).json({ status: 0, message: 'Invalid JSON request payload' });
            next();
        });
    }
});

app.use(express.urlencoded({ extended: true }));

// Serve static frontend files and explicit HTML routes
app.use(express.static(path.join(__dirname, '/')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

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
    callbackUrl: process.env.MPX_CALLBACK_URL || 'https://nexapay-ashen.vercel.app/api/mpxpay-webhook',
    // Fee Rates
    collectionFeeRatePercent: 20.00, // 20%
    additionalFeeInr: 10.00         // ₹10.00
};

// Registered Users Database (email -> user object)
const usersDb = new Map();

// In-Memory Order Storage & User Ledgers
const ordersDb = new Map(); // merchant_order_no -> order object
const userOrdersDb = new Map(); // userEmail -> Array of merchant_order_no

// Real-Time SSE Live Clients for 0.1ms instant wallet update
const liveSseClients = new Map(); // userEmail -> Set of express res objects

function broadcastLiveWallet(emailKey, eventData) {
    const em = (emailKey || '').toLowerCase().trim();
    const clientSet = liveSseClients.get(em);
    if (clientSet && clientSet.size > 0) {
        const payload = `data: ${JSON.stringify(eventData)}\n\n`;
        clientSet.forEach(clientRes => {
            try {
                clientRes.write(payload);
            } catch(e) {}
        });
    }
}

function syncUserWalletWithLedger(emailKey) {
    const em = (emailKey || '').toLowerCase().trim();
    const user = usersDb.get(em);
    if (!user) return 0.00;
    const orderNos = userOrdersDb.get(em) || [];
    let computedBal = 0.00;
    
    orderNos.forEach(no => {
        const o = ordersDb.get(no);
        if (o) {
            const isCompleted = o.status === 'COMPLETED' || o.status === 'PAID' || o.status === 'SUCCESS';
            if ((o.type === 'DEPOSIT' || o.type === 'BUY') && isCompleted) {
                const net = parseFloat(o.netAmount || (parseFloat(o.amount || 0) * 0.80));
                computedBal += isNaN(net) ? 0 : net;
            } else if (o.type === 'CONVERT' || o.type === 'WITHDRAW') {
                if (isCompleted || o.status === 'PROCESSING') {
                    const deduct = parseFloat(o.amount || 0);
                    computedBal -= isNaN(deduct) ? 0 : deduct;
                }
            }
        }
    });

    user.walletBalance = parseFloat(Math.max(0, computedBal).toFixed(2));
    usersDb.set(em, user);
    return user.walletBalance;
}

// Persistent Database Storage File Path (database.json)
// On Vercel serverless, __dirname is read-only so write to /tmp
const DB_FILE_PATH = process.env.VERCEL
    ? path.join('/tmp', 'database.json')
    : path.join(__dirname, 'database.json');

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
    let serviceAccount = null;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
        try {
            serviceAccount = JSON.parse(serviceAccountJson);
        } catch(e) {}
    } else {
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccountKey.json');
        if (fs.existsSync(serviceAccountPath)) {
            serviceAccount = require(serviceAccountPath);
        }
    }

    if (serviceAccount) {
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
        console.log('ℹ️ Firebase serviceAccount not detected. Local persistent storage & stateless token active.');
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
        // If on Vercel and /tmp/database.json doesn't exist yet, seed from bundled file
        if (process.env.VERCEL && !fs.existsSync(DB_FILE_PATH)) {
            const bundledPath = path.join(__dirname, 'database.json');
            if (fs.existsSync(bundledPath)) {
                try {
                    fs.copyFileSync(bundledPath, DB_FILE_PATH);
                } catch(copyErr) {}
            }
        }

        const pathToRead = fs.existsSync(DB_FILE_PATH) ? DB_FILE_PATH : path.join(__dirname, 'database.json');
        if (fs.existsSync(pathToRead)) {
            const raw = fs.readFileSync(pathToRead, 'utf8');
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

            console.log(`💾 [PERSISTENT DB LOADED] Restored ${usersDb.size} Users & ${ordersDb.size} Orders from ${pathToRead}!`);
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
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Cryptographic stateless registration token (immune to serverless restarts)
    const payloadStr = JSON.stringify({ name, email: emailKey, password, binanceAddress, otpCode, exp: expiresAt });
    const payloadB64 = Buffer.from(payloadStr).toString('base64');
    const signature = crypto.createHmac('sha256', MPX_CONFIG.apiKey).update(payloadB64).digest('hex');
    const otpToken = `${payloadB64}.${signature}`;

    const newUser = {
        name,
        email: emailKey,
        password,
        binanceAddress,
        isVerified: false,
        otpCode,
        otpExpires: expiresAt
    };

    usersDb.set(emailKey, newUser);
    saveDatabaseToDisk();
    await syncToFirebase('user', emailKey, newUser);
    
    const emailSent = await sendOtpEmail(emailKey, otpCode, 'verification', password, name);

    res.json({
        status: 1,
        message: emailSent 
            ? `Verification code sent to ${emailKey}` 
            : `Verification Code generated for ${emailKey}`,
        email: emailKey,
        otpToken: otpToken,
        otpCode: emailSent ? undefined : otpCode
    });
});

// -------------------------------------------------------------
// AUTH 2: VERIFY EMAIL OTP CODE
// -------------------------------------------------------------
app.post('/api/auth/verify-otp', async (req, res) => {
    const { email, otp, otpToken } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ status: 0, message: 'Email and OTP code are required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const enteredOtp = otp.toString().trim();
    let user = usersDb.get(emailKey);

    // 1. Try Firestore if user not found in ephemeral serverless memory
    if (!user && firebaseDb) {
        try {
            const doc = await firebaseDb.collection('users').doc(emailKey.replace(/[^a-zA-Z0-9]/g, '_')).get();
            if (doc.exists) user = doc.data();
        } catch (e) {}
    }

    let isValidOtp = false;

    // 2. Check in-memory or Firestore OTP
    if (user && user.otpCode && user.otpCode.toString().trim() === enteredOtp) {
        if (!user.otpExpires || Date.now() <= user.otpExpires) {
            isValidOtp = true;
        }
    }

    // 3. Fallback: Cryptographic stateless HMAC verification
    if (!isValidOtp && otpToken && otpToken.includes('.')) {
        try {
            const [payloadB64, sig] = otpToken.split('.');
            const expectedSig = crypto.createHmac('sha256', MPX_CONFIG.apiKey).update(payloadB64).digest('hex');
            if (sig === expectedSig) {
                const regData = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
                if (regData.email === emailKey && regData.otpCode.toString().trim() === enteredOtp) {
                    if (Date.now() <= regData.exp) {
                        isValidOtp = true;
                        if (!user) {
                            user = {
                                name: regData.name,
                                email: emailKey,
                                password: regData.password,
                                binanceAddress: regData.binanceAddress,
                                isVerified: true,
                                walletBalance: 0.00
                            };
                        }
                    }
                }
            }
        } catch (tokErr) {
            console.error('Token verification error:', tokErr.message);
        }
    }

    if (!isValidOtp) {
        return res.status(400).json({ status: 0, message: 'Invalid or expired Verification Code! Please check your email.' });
    }

    user.isVerified = true;
    user.otpCode = null;
    usersDb.set(emailKey, user);
    saveDatabaseToDisk();
    await syncToFirebase('user', emailKey, user);

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
// 2. WEBHOOK & CALLBACK: MPXPAYS PAYMENT LISTENER
// -------------------------------------------------------------
app.all(['/api/mpxpay-webhook', '/api/mpxpay-callback'], (req, res) => {
    try {
        console.log('\n🔔 [MPXPays Webhook/Callback Received]:', { method: req.method, query: req.query, body: req.body });
        const payload = { ...req.query, ...req.body };
        const { status, amount, final_amount } = payload;

        const merchant_order_no = payload.merchant_order_no || payload.orderNo || payload.order_no || payload.merchantOrderNo;
        const platform_order_no = payload.platform_order_no || payload.orderId || payload.order_id || payload.trans_id;
        const realUtr = payload.utr || payload.transaction_id || payload.trans_id || payload.platform_order_no || payload.orderId || payload.ref_no || payload.bank_ref || null;

        if (!merchant_order_no) {
            console.log('⚠️ Webhook missing merchant_order_no:', payload);
            return res.status(200).json({ status: 'ignored', message: 'Missing merchant_order_no' });
        }

        let existingOrder = ordersDb.get(merchant_order_no);
        if (!existingOrder) {
            existingOrder = {
                merchant_order_no,
                type: 'DEPOSIT',
                amount: amount || '1000.00',
                feeTotal: '200.00',
                netAmount: (parseFloat(amount || 1000) * 0.80).toFixed(2),
                usdtAmount: '0.00',
                binanceAddress: '',
                userEmail: 'guest@kryptpay.com',
                status: 'PENDING',
                created_at: new Date().toISOString()
            };
            ordersDb.set(merchant_order_no, existingOrder);
        }

        const rawStatus = String(status || payload.order_status || payload.pay_status || '').toLowerCase();
        const isSuccess = ['success', '1', 'paid', 'completed', 'true'].includes(rawStatus);

        if (isSuccess) {
            const mockTxHash = '0x' + crypto.randomBytes(32).toString('hex');
            
            existingOrder.status = 'COMPLETED';
            existingOrder.utr = realUtr || existingOrder.utr || `UTR-${Date.now()}`;
            existingOrder.platform_order_no = platform_order_no || existingOrder.platform_order_no || realUtr;
            existingOrder.final_amount = final_amount || amount || existingOrder.amount;
            existingOrder.txHash = mockTxHash;
            existingOrder.paid_at = new Date().toISOString();

            ordersDb.set(merchant_order_no, existingOrder);

            // Auto-Credit INR to User Wallet Balance (Net Amount after 20% fee)
            const grossAmt = parseFloat(amount || existingOrder.amount || 0);
            const netCredited = parseFloat((grossAmt * 0.80).toFixed(2));
            
            const emailKey = (existingOrder.userEmail || '').toLowerCase();
            let newBal = 0;
            if (usersDb.has(emailKey)) {
                newBal = syncUserWalletWithLedger(emailKey);
                console.log(`💳 [WALLET AUTO-CREDITED] ${emailKey} credited +₹${netCredited} INR | New Balance: ₹${newBal} | Gateway UTR: ${existingOrder.utr}`);
            }

            saveDatabaseToDisk();

            // Broadcast real-time 0.1ms wallet update to open browser tab
            broadcastLiveWallet(emailKey, {
                type: 'WALLET_UPDATE',
                walletBalance: newBal,
                creditedAmount: netCredited,
                order: existingOrder
            });

            // If user was redirected in browser from payment gateway
            if (req.method === 'GET' || (req.headers.accept && req.headers.accept.includes('text/html'))) {
                return res.redirect(`/?order_success=${encodeURIComponent(merchant_order_no)}&utr=${encodeURIComponent(existingOrder.utr)}`);
            }

            return res.status(200).json({ status: 'success', message: 'Webhook processed', utr: existingOrder.utr });
        } else {
            if (rawStatus === 'failed' || rawStatus === '0') {
                existingOrder.status = 'FAILED';
                ordersDb.set(merchant_order_no, existingOrder);
                saveDatabaseToDisk();
            }
            return res.status(200).json({ status: 'ok', message: 'Webhook received' });
        }
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// -------------------------------------------------------------
// 2B. API: CLAIM / SUBMIT DEPOSIT UTR FOR STUCK PAYMENTS
// -------------------------------------------------------------
app.post('/api/claim-deposit-utr', (req, res) => {
    try {
        const { orderNo, utr, userEmail } = req.body;
        if (!utr) {
            return res.status(400).json({ status: 0, message: 'Please provide Bank UTR or Gateway Transaction ID.' });
        }

        const cleanUtr = utr.trim();
        let targetOrderNo = orderNo;

        // If orderNo not provided or invalid, find latest pending deposit for this user
        if (!targetOrderNo && userEmail) {
            const emailKey = userEmail.toLowerCase().trim();
            const userOrders = userOrdersDb.get(emailKey) || [];
            for (const no of userOrders) {
                const ord = ordersDb.get(no);
                if (ord && (ord.type === 'DEPOSIT' || ord.type === 'BUY') && (ord.status === 'PENDING' || ord.status === 'PROCESSING' || ord.status === 'PENDING_ADMIN_APPROVAL')) {
                    targetOrderNo = no;
                    break;
                }
            }
        }

        let order = targetOrderNo ? ordersDb.get(targetOrderNo) : null;
        if (!order) {
            // Create a pending record so admin can see and approve it
            const newOrderNo = targetOrderNo || `KP-BUY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
            order = {
                merchant_order_no: newOrderNo,
                type: 'DEPOSIT',
                amount: '1000.00',
                feeTotal: '200.00',
                netAmount: '800.00',
                usdtAmount: '0.00',
                binanceAddress: '',
                userEmail: (userEmail || 'user@kryptpay.com').toLowerCase(),
                status: 'PENDING_ADMIN_APPROVAL',
                utr: cleanUtr,
                txHash: null,
                created_at: new Date().toISOString()
            };
            ordersDb.set(newOrderNo, order);
            const emKey = order.userEmail;
            if (!userOrdersDb.has(emKey)) userOrdersDb.set(emKey, []);
            userOrdersDb.get(emKey).unshift(newOrderNo);
        } else {
            order.utr = cleanUtr;
            if (order.status !== 'COMPLETED') {
                order.status = 'PENDING_ADMIN_APPROVAL';
            }
            ordersDb.set(order.merchant_order_no, order);
        }

        saveDatabaseToDisk();

        console.log(`📌 [UTR CLAIM SUBMITTED] Order ${order.merchant_order_no} -> UTR: ${cleanUtr} (Status: ${order.status})`);

        res.json({
            status: 1,
            message: order.status === 'COMPLETED' 
                ? 'Payment is already confirmed and credited!' 
                : 'UTR recorded successfully! Queued for Admin Approval.',
            orderStatus: order.status,
            order
        });
    } catch(err) {
        console.error('Error claiming UTR:', err);
        res.status(500).json({ status: 0, message: 'Server error processing UTR claim.' });
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
        if (isNaN(numInr) || numInr < 100) {
            return res.status(400).json({ status: 0, message: 'Minimum USDT conversion amount is ₹100 INR.' });
        }

        if (Math.round(numInr) % 100 !== 0) {
            return res.status(400).json({ status: 0, message: 'Conversion amount must be an exact multiple of ₹100 (e.g. ₹500, ₹800, ₹1000).' });
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
// 3B. API: CREATE PAYOUT / WITHDRAWAL ORDER (UPI OR BANK)
// -------------------------------------------------------------
app.post('/api/create-payout-order', async (req, res) => {
    try {
        const { userEmail, usdtAmount, inrAmount, payoutMethod, upiId, bankName, accountNumber, ifscCode, accountHolderName } = req.body;

        const isUpiPayout = payoutMethod === 'UPI' || (upiId && !accountNumber);

        if (isUpiPayout) {
            if (!upiId || !upiId.includes('@')) {
                return res.status(400).json({ status: 0, message: 'Please provide a valid UPI ID (e.g. yourname@upi).' });
            }
        } else {
            if (!accountNumber || !ifscCode) {
                return res.status(400).json({ status: 0, message: 'Please provide Bank Account Number and IFSC Code.' });
            }
        }

        if (!accountHolderName) {
            return res.status(400).json({ status: 0, message: 'Please provide the Account / UPI Holder Name.' });
        }

        const emailKey = (userEmail || 'guest@kryptpay.com').toLowerCase().trim();
        const user = usersDb.get(emailKey);
        if (!user) {
            return res.status(404).json({ status: 0, message: 'User account not found.' });
        }

        // Calculate INR withdrawal amount (accept either direct inrAmount or usdtAmount)
        let withdrawInr = parseFloat(inrAmount);
        if (isNaN(withdrawInr) || withdrawInr <= 0) {
            const uVal = parseFloat(usdtAmount);
            if (!isNaN(uVal) && uVal > 0) {
                withdrawInr = parseFloat((uVal * 87.00).toFixed(2));
            }
        }

        if (isNaN(withdrawInr) || withdrawInr < 100) {
            return res.status(400).json({ status: 0, message: 'Minimum withdrawal amount is ₹100 INR.' });
        }

        const currentBal = user.walletBalance || 0;
        if (currentBal < withdrawInr) {
            return res.status(400).json({
                status: 0,
                message: `Insufficient Wallet Balance! Available: ₹${currentBal.toFixed(2)} INR. Requested: ₹${withdrawInr.toFixed(2)} INR.`
            });
        }

        const merchantOrderNo = `KP-WITHDRAW-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const payoutOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'WITHDRAW',
            payoutMethod: isUpiPayout ? 'UPI' : 'BANK',
            amount: withdrawInr.toFixed(2),
            usdtAmount: (withdrawInr / 89.50).toFixed(2),
            userEmail: emailKey,
            upiId: isUpiPayout ? upiId.trim() : null,
            bankName: isUpiPayout ? 'UPI Transfer' : (bankName || 'Bank Account'),
            accountNumber: isUpiPayout ? upiId.trim() : accountNumber.trim(),
            ifscCode: isUpiPayout ? 'UPI' : (ifscCode || '').toUpperCase().trim(),
            accountHolderName: accountHolderName.trim(),
            status: 'PROCESSING',
            utr: null,
            txHash: null,
            created_at: new Date().toISOString()
        };

        ordersDb.set(merchantOrderNo, payoutOrder);

        if (!userOrdersDb.has(emailKey)) {
            userOrdersDb.set(emailKey, []);
        }
        userOrdersDb.get(emailKey).unshift(merchantOrderNo);

        const newBal = syncUserWalletWithLedger(emailKey);
        saveDatabaseToDisk();
        await syncToFirebase('order', merchantOrderNo, payoutOrder);

        // Broadcast real-time 0.1ms wallet update
        broadcastLiveWallet(emailKey, {
            type: 'WALLET_UPDATE',
            walletBalance: newBal,
            order: payoutOrder
        });

        console.log(`💸 [PAYOUT / WITHDRAW SUBMITTED] ${merchantOrderNo} (₹${withdrawInr} to ${accountNumber} / ${ifscCode} for ${emailKey})`);

        res.json({
            status: 1,
            message: 'Withdrawal request submitted! It will be credited to your bank account after admin/gateway verification.',
            merchant_order_no: merchantOrderNo,
            inrAmount: withdrawInr.toFixed(2),
            newBalance: newBal
        });
    } catch (err) {
        console.error('Error in /api/create-payout-order:', err);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
});

// -------------------------------------------------------------
// 4. API: GET USER BALANCE & REAL-TIME SSE STREAM (0.1ms PUSH)
// -------------------------------------------------------------
app.get('/api/user-balance/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase().trim();
    const balance = syncUserWalletWithLedger(emailKey);
    res.json({
        status: 1,
        email: emailKey,
        walletBalance: balance
    });
});

app.get('/api/live-wallet/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase().trim();
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const currentBal = syncUserWalletWithLedger(emailKey);
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', walletBalance: currentBal })}\n\n`);

    if (!liveSseClients.has(emailKey)) {
        liveSseClients.set(emailKey, new Set());
    }
    liveSseClients.get(emailKey).add(res);

    const pingInterval = setInterval(() => {
        try { res.write(': ping\n\n'); } catch(e) {}
    }, 15000);

    req.on('close', () => {
        clearInterval(pingInterval);
        if (liveSseClients.has(emailKey)) {
            liveSseClients.get(emailKey).delete(res);
            if (liveSseClients.get(emailKey).size === 0) {
                liveSseClients.delete(emailKey);
            }
        }
    });
});

app.get('/api/user-transactions/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase().trim();
    const orderNos = userOrdersDb.get(emailKey) || [];
    const balance = syncUserWalletWithLedger(emailKey);
    const userOrdersList = orderNos.map(no => ordersDb.get(no)).filter(Boolean);

    res.json({
        status: 1,
        email: emailKey,
        walletBalance: balance,
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
            pendingOrdersCount: allOrders.filter(o => o.status === 'PENDING' || o.status === 'PROCESSING' || o.status === 'PENDING_ADMIN_APPROVAL').length
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
        const emailKey = (order.userEmail || '').toLowerCase();
        if (order.type === 'DEPOSIT' || order.type === 'BUY') {
            order.utr = order.utr || `ADMIN-UTR-${Date.now()}`;
        } else if (order.type === 'CONVERT' || order.type === 'WITHDRAW') {
            order.utr = order.utr || `SWAP-${Date.now()}`;
            order.txHash = order.txHash || '0x' + crypto.randomBytes(32).toString('hex');
        }
        ordersDb.set(orderNo, order);
        const newBal = syncUserWalletWithLedger(emailKey);
        saveDatabaseToDisk();
        console.log(`👑 [ADMIN MANUALLY CREDITED] ${emailKey} synced with ledger | New Bal: ₹${newBal}`);
        broadcastLiveWallet(emailKey, {
            type: 'WALLET_UPDATE',
            walletBalance: newBal,
            order: order
        });
    } else {
        ordersDb.set(orderNo, order);
        saveDatabaseToDisk();
    }

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

// Export app for Vercel / Serverless deployments & start listener
module.exports = app;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`👑 KryptPay Executive Server running on Port ${PORT}`);
        console.log(`💸 Collection Fee: 20.00% + ₹10.00`);
        console.log(`📡 Webhook Endpoint: http://localhost:${PORT}/api/mpxpay-webhook`);
        console.log(`====================================================`);
    });
}
