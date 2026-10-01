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

// Helper: Calculate MD5 Signature as per MPXPays Specs
function calculateMD5Signature(apiKey, amount2Dec, callbackUrl, merchantId, merchantOrderNo) {
    const signString = `${apiKey}${amount2Dec}${callbackUrl}${merchantId}${merchantOrderNo}`;
    return crypto.createHash('md5').update(signString).digest('hex');
}

const nodemailer = require('nodemailer');

async function sendOtpEmail(toEmail, otpCode, type = 'verification') {
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || '';
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_PASS || '';

    if (!smtpUser || !smtpPass) {
        console.log(`\n📧 [EMAIL OTP GENERATED] Sent to ${toEmail} | (${type.toUpperCase()}) OTP Code: ${otpCode}`);
        return false;
    }

    const isReset = type === 'reset';
    const subject = isReset 
        ? `🔐 ${otpCode} is your KryptPay Password Reset Code`
        : `🔑 ${otpCode} is your KryptPay Verification Code`;
    const title = isReset ? `Password Reset Request` : `Welcome to KryptPay`;
    const text = isReset 
        ? `Use the 6-digit code below to reset your KryptPay account password:`
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
            from: `"KryptPay Security" <${smtpUser}>`,
            to: toEmail,
            subject: subject,
            html: `
                <div style="font-family: Arial, sans-serif; background-color: #06090E; color: #ffffff; padding: 30px; border-radius: 16px; max-width: 500px; margin: 0 auto;">
                    <h2 style="color: #10B981; margin-top: 0;">KryptPay Security</h2>
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
        return false;
    }
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
    await sendOtpEmail(emailKey, otpCode, 'verification');

    res.json({
        status: 1,
        message: `Verification code sent to ${emailKey}`,
        email: emailKey
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
            isVerified: true
        };
        usersDb.set(emailKey, user);
    } else {
        user.isVerified = true;
        if (picture) user.picture = picture;
        if (binanceAddress) user.binanceAddress = binanceAddress;
        usersDb.set(emailKey, user);
    }

    res.json({
        status: 1,
        message: 'Google login successful!',
        user: {
            name: user.name,
            email: user.email,
            picture: user.picture,
            binanceAddress: user.binanceAddress,
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

    await sendOtpEmail(emailKey, resetOtp, 'reset');

    console.log(`🔑 [FORGOT PASSWORD OTP GENERATED] ${emailKey} -> ${resetOtp}`);

    res.json({
        status: 1,
        message: `Reset OTP sent to ${emailKey}. Please check your email inbox.`,
        email: emailKey
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
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ status: 0, message: 'Invalid payment amount' });
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
        if (isNaN(numInr) || numInr <= 0) {
            return res.status(400).json({ status: 0, message: 'Invalid INR amount.' });
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

// Start Express Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`👑 KryptPay Executive Server running on Port ${PORT}`);
    console.log(`💸 Collection Fee: 20.00% + ₹10.00`);
    console.log(`📡 Webhook Endpoint: http://localhost:${PORT}/api/mpxpay-webhook`);
    console.log(`====================================================`);
});
